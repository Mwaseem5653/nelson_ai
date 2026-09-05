import React, { useEffect, useMemo, useRef, useState } from "react";
import api, { formatApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
    Plus, MagnifyingGlass, PencilSimple, Trash, UserCircle, UsersFour, Package,
    DownloadSimple, UploadSimple, Buildings, Folder, FolderOpen, 
    CaretRight, CaretDown, Users
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth, hasPerm } from "@/auth/AuthContext";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const FORM_CODE = "employee";

// Simple tree building - no recursion in rendering
function buildCustomerTree(customers, routes) {
    const routeMap = {};
    
    routes.forEach(r => {
        routeMap[r.id] = {
            id: r.id,
            code: r.code,
            name: r.name,
            parent_id: r.parent_id,
            is_group: r.is_group,
            type: 'route',
            children: [],
            customers: []
        };
    });

    // Build hierarchy
    const rootRoutes = [];
    routes.forEach(r => {
        const node = routeMap[r.id];
        if (r.parent_id && routeMap[r.parent_id]) {
            routeMap[r.parent_id].children.push(node);
        } else {
            rootRoutes.push(node);
        }
    });

    // Add customers
    customers.forEach(c => {
        if (c.route_id && routeMap[c.route_id]) {
            routeMap[c.route_id].customers.push({
                id: c.id,
                code: c.code,
                name: c.name,
                phone: c.phone || '',
                type: 'customer'
            });
        }
    });

    return rootRoutes;
}

// Flat render function - no recursion
function renderTreeNodes(nodes, expanded, chosenCustomers, onToggle, onCustomerToggle, depth = 0) {
    const result = [];
    
    for (const node of nodes) {
        if (!node) continue;
        
        const isExpanded = !!expanded[node.id];
        const allCustomerIds = getAllCustomerIdsFlat(node);
        const selectedCount = allCustomerIds.filter(id => chosenCustomers.includes(id)).length;
        const allSelected = allCustomerIds.length > 0 && selectedCount === allCustomerIds.length;
        const someSelected = selectedCount > 0 && selectedCount < allCustomerIds.length;
        
        result.push({
            ...node,
            depth,
            isExpanded,
            allSelected,
            someSelected,
            customerCount: allCustomerIds.length,
            selectedCount,
            isRoute: true,
            isCustomer: false
        });
        
        if (isExpanded) {
            // Render children routes
            if (node.children && node.children.length > 0) {
                const childResults = renderTreeNodes(node.children, expanded, chosenCustomers, onToggle, onCustomerToggle, depth + 1);
                result.push(...childResults);
            }
            
            // Render customers
            if (node.customers && node.customers.length > 0) {
                node.customers.forEach(customer => {
                    const isSelected = chosenCustomers.includes(customer.id);
                    result.push({
                        ...customer,
                        depth: depth + 1,
                        isCustomer: true,
                        isSelected,
                        isRoute: false
                    });
                });
            }
        }
    }
    
    return result;
}

function getAllCustomerIdsFlat(node) {
    let ids = [];
    if (node.customers) {
        ids = ids.concat(node.customers.map(c => c.id));
    }
    if (node.children) {
        node.children.forEach(child => {
            ids = ids.concat(getAllCustomerIdsFlat(child));
        });
    }
    return ids;
}

export default function EmployeesPage() {
    const { user } = useAuth();
    const isSuper = user?.type === "SuperAdmin";

    const canAdd = hasPerm(user, FORM_CODE, "add");
    const canEdit = hasPerm(user, FORM_CODE, "edit");
    const canDelete = hasPerm(user, FORM_CODE, "delete");

    const [rows, setRows] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [brands, setBrands] = useState([]);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");

    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [delId, setDelId] = useState(null);

    const [allowOpen, setAllowOpen] = useState(false);
    const [allowFor, setAllowFor] = useState(null);
    const [tab, setTab] = useState("customers");
    const [selBrandId, setSelBrandId] = useState("");
    const [custSearch, setCustSearch] = useState("");
    const [itemSearch, setItemSearch] = useState("");
    const [chosenCustomers, setChosenCustomers] = useState([]);
    const [chosenItems, setChosenItems] = useState([]);
    const [savingAllowed, setSavingAllowed] = useState(false);
    const [expanded, setExpanded] = useState({});

    const fileInputRef = useRef(null);
    const [importing, setImporting] = useState(false);
    const [importReport, setImportReport] = useState(null);

    const downloadTemplate = async () => {
        try {
            const res = await api.get("/import/employees/template", { responseType: "blob" });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement("a");
            a.href = url; a.download = "nelson_employees_template.xlsx";
            document.body.appendChild(a); a.click(); a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) { toast.error(formatApiError(e)); }
    };
    
    const onFilePicked = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const { data } = await api.post("/import/employees", fd, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            setImportReport(data);
            if (data.created > 0) toast.success(`Imported ${data.created} of ${data.total_rows} employees`);
            else if (data.errors?.length) toast.error("Import completed with errors");
            else toast.message("No new rows created");
            await load();
        } catch (err) { toast.error(formatApiError(err)); }
        finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const load = async () => {
        setLoading(true);
        try {
            const promises = [
                api.get("/employees"),
                api.get("/departments"),
                api.get("/routes"),
                api.get("/customers"),
                api.get("/brands"),
                api.get("/items"),
            ];
            if (isSuper) promises.push(api.get("/companies"));
            const results = await Promise.all(promises);
            const [e, d, r, c, b, i, co] = results;
            setRows(e.data || []);
            setDepartments(d.data || []);
            setRoutes(r.data || []);
            setCustomers(c.data || []);
            setBrands(b.data || []);
            setItems(i.data || []);
            if (co) setCompanies(co.data || []);
        } catch (err) { toast.error(formatApiError(err)); } finally { setLoading(false); }
    };
    
    useEffect(() => { load(); }, []);

    const nameById = (arr, id) => arr.find((x) => x.id === id)?.name || "—";
    
    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return s ? rows.filter((r) => [r.code, r.name, r.whatsapp].some((v) => (v || "").toLowerCase().includes(s))) : rows;
    }, [rows, q]);

    const formCompanyId = isSuper ? (form.company_id || "") : (user?.company_id || "");
    const filterByCo = (arr) => (formCompanyId ? arr.filter((x) => x.company_id === formCompanyId) : arr);

    const formDepartments = useMemo(() => filterByCo(departments), [departments, formCompanyId]);
    const formRoutes = useMemo(() => filterByCo(routes).filter((r) => r.is_group !== true), [routes, formCompanyId]);

    const openCreate = () => {
        if (!canAdd) return;
        setEditing(null);
        setForm({ code: "", name: "", whatsapp: "", company_id: "", department_id: "", route_id: "", status: "Active", allowed_customers: [], allowed_items: [] });
        setOpen(true);
    };
    
    const openEdit = (row) => {
        if (!canEdit) return;
        setEditing(row);
        setForm({ ...row });
        setOpen(true);
    };
    
    const onCompanyChange = (v) => {
        setForm({ ...form, company_id: v, department_id: "", route_id: "" });
    };
    
    const save = async () => {
        if (isSuper && !editing && !form.company_id) {
            toast.error("Please select a company");
            return;
        }
        setSaving(true);
        try {
            if (editing) { await api.put(`/employees/${editing.id}`, form); toast.success("Employee updated"); }
            else { await api.post("/employees", form); toast.success("Employee created"); }
            setOpen(false); await load();
        } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
    };
    
    const del = async () => {
        try { await api.delete(`/employees/${delId}`); toast.success("Employee deleted"); setDelId(null); await load(); }
        catch (e) { toast.error(formatApiError(e)); }
    };

    const allowedCompanyId = allowFor?.company_id || user?.company_id || "";
    const filterAllowedByCo = (arr) => (allowedCompanyId ? arr.filter((x) => x.company_id === allowedCompanyId) : arr);

    const openAllowed = (row) => {
        if (!canEdit) return;
        setAllowFor(row);
        setTab("customers");
        setSelBrandId("");
        setCustSearch(""); setItemSearch("");
        setChosenCustomers(row.allowed_customers || []);
        setChosenItems(row.allowed_items || []);
        setExpanded({});
        setAllowOpen(true);
    };

    const toggle = (list, setList, id) => {
        setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
    };

    const toggleCustomer = (id, forceState) => {
        if (forceState !== undefined) {
            if (forceState) {
                if (!chosenCustomers.includes(id)) {
                    setChosenCustomers([...chosenCustomers, id]);
                }
            } else {
                setChosenCustomers(chosenCustomers.filter(x => x !== id));
            }
        } else {
            setChosenCustomers(chosenCustomers.includes(id) 
                ? chosenCustomers.filter(x => x !== id) 
                : [...chosenCustomers, id]
            );
        }
    };

    const saveAllowedCustomers = async () => {
        setSavingAllowed(true);
        try {
            await api.put(`/employees/${allowFor.id}/allowed-customers`, { ids: chosenCustomers });
            toast.success(`Saved ${chosenCustomers.length} allowed customers`);
            await load();
        } catch (e) { toast.error(formatApiError(e)); } finally { setSavingAllowed(false); }
    };
    
    const saveAllowedItems = async () => {
        setSavingAllowed(true);
        try {
            await api.put(`/employees/${allowFor.id}/allowed-items`, { ids: chosenItems });
            toast.success(`Saved ${chosenItems.length} allowed items`);
            await load();
        } catch (e) { toast.error(formatApiError(e)); } finally { setSavingAllowed(false); }
    };

    const toggleExpanded = (id) => {
        setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const allowedRoutes = useMemo(() => filterAllowedByCo(routes), [routes, allowedCompanyId]);
    const allowedCustomers = useMemo(() => filterAllowedByCo(customers), [customers, allowedCompanyId]);
    
    const customerTree = useMemo(() => {
        return buildCustomerTree(allowedCustomers, allowedRoutes);
    }, [allowedCustomers, allowedRoutes]);

    // Filter tree by search - simplified
    const filteredTree = useMemo(() => {
        if (!custSearch.trim()) return customerTree;
        const search = custSearch.trim().toLowerCase();
        
        const filterNode = (nodes) => {
            const result = [];
            for (const node of nodes) {
                if (!node) continue;
                const nodeMatches = (node.name || '').toLowerCase().includes(search) || 
                                   (node.code || '').toLowerCase().includes(search);
                let filteredChildren = [];
                let filteredCustomers = [];
                
                if (node.children) {
                    filteredChildren = filterNode(node.children);
                }
                if (node.customers) {
                    filteredCustomers = node.customers.filter(c => 
                        (c.name || '').toLowerCase().includes(search) || 
                        (c.code || '').toLowerCase().includes(search)
                    );
                }
                
                if (nodeMatches || filteredChildren.length > 0 || filteredCustomers.length > 0) {
                    result.push({
                        ...node,
                        children: filteredChildren,
                        customers: filteredCustomers
                    });
                }
            }
            return result;
        };
        
        return filterNode(customerTree);
    }, [customerTree, custSearch]);

    // Auto-expand all nodes
    useEffect(() => {
        if (customerTree.length > 0 && Object.keys(expanded).length === 0) {
            const newExpanded = {};
            const expandAll = (nodes) => {
                nodes.forEach(node => {
                    if (node && node.id) {
                        newExpanded[node.id] = true;
                        if (node.children && node.children.length > 0) {
                            expandAll(node.children);
                        }
                    }
                });
            };
            expandAll(customerTree);
            setExpanded(newExpanded);
        }
    }, [customerTree]);

    // Flatten tree for display
    const flatNodes = useMemo(() => {
        return renderTreeNodes(filteredTree, expanded, chosenCustomers, toggleExpanded, toggleCustomer);
    }, [filteredTree, expanded, chosenCustomers]);

    const filteredItems = useMemo(() => {
        const base = filterAllowedByCo(items);
        const list = selBrandId ? base.filter((i) => i.brand_id === selBrandId) : base;
        const s = itemSearch.trim().toLowerCase();
        return s ? list.filter((i) => [i.name, i.code].some((v) => (v || "").toLowerCase().includes(s))) : list;
    }, [items, selBrandId, itemSearch, allowedCompanyId]);

    const allowedBrands = useMemo(() => filterAllowedByCo(brands), [brands, allowedCompanyId]);

    // Render a single tree node
    const renderNode = (node) => {
        if (node.isCustomer) {
            return (
                <div
                    key={node.id}
                    className="flex items-center gap-2 py-1.5 pr-2 text-[13px] rounded-[3px] hover:bg-muted"
                    style={{ paddingLeft: `${8 + node.depth * 24}px` }}
                >
                    <Checkbox
                        checked={node.isSelected || false}
                        onCheckedChange={() => toggleCustomer(node.id)}
                        className="ml-1"
                    />
                    <Users size={14} className="text-emerald-600" />
                    <span className="truncate">{node.name}</span>
                    {node.phone && (
                        <span className="text-[11px] text-muted-foreground">{node.phone}</span>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground font-mono">
                        {node.code}
                    </span>
                </div>
            );
        }

        return (
            <div key={node.id}>
                <div
                    className={`flex items-center gap-2 py-1.5 pr-2 text-[13px] rounded-[3px] hover:bg-muted cursor-pointer ${node.someSelected ? 'bg-blue-50/50' : ''}`}
                    style={{ paddingLeft: `${8 + node.depth * 24}px` }}
                    onClick={() => {
                        if (node.children?.length > 0 || node.customers?.length > 0) {
                            toggleExpanded(node.id);
                        }
                    }}
                >
                    <span className="shrink-0 grid place-items-center w-4 text-muted-foreground">
                        {(node.children?.length > 0 || node.customers?.length > 0) ? (
                            node.isExpanded ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />
                        ) : (
                            <span className="w-3" />
                        )}
                    </span>
                    <Checkbox
                        checked={node.allSelected || false}
                        className="ml-1"
                        data-state={node.someSelected && !node.allSelected ? 'indeterminate' : ''}
                        onCheckedChange={(checked) => {
                            const allIds = getAllCustomerIdsFlat(node);
                            if (checked) {
                                allIds.forEach(id => toggleCustomer(id, true));
                            } else {
                                allIds.forEach(id => toggleCustomer(id, false));
                            }
                        }}
                        onClick={(e) => e.stopPropagation()}
                    />
                    {node.isExpanded ? <FolderOpen size={16} weight="fill" className="text-amber-500" /> : <Folder size={16} weight="fill" className="text-amber-500" />}
                    <span className="truncate font-medium">{node.name}</span>
                    {node.customerCount > 0 && (
                        <Badge variant="outline" className="text-[10px] ml-1 bg-blue-100 text-blue-800 border-blue-200">
                            {node.customerCount} customers
                        </Badge>
                    )}
                    {node.someSelected && (
                        <Badge variant="outline" className="text-[10px] ml-1 bg-emerald-100 text-emerald-800 border-emerald-200">
                            {node.selectedCount} selected
                        </Badge>
                    )}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground font-mono">
                        {node.code}
                    </span>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-5" data-testid="employee-page">
            {/* Header */}
            <div className="flex items-end justify-between gap-3">
                <div>
                    <div className="label-cap">Master · Setup</div>
                    <h1 className="font-heading font-black text-2xl mt-1">Employee Profile</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Field agents who place orders on WhatsApp. Configure allowed customers and items per employee.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input data-testid="employee-search" className="pl-8 h-9 w-[220px]" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    {canAdd && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx"
                                className="hidden"
                                onChange={onFilePicked}
                                data-testid="employee-file-input"
                            />
                            <Button variant="outline" className="h-9 gap-1.5" onClick={downloadTemplate} data-testid="employee-template-btn">
                                <DownloadSimple size={14} /> Template
                            </Button>
                            <Button variant="outline" className="h-9 gap-1.5" onClick={() => fileInputRef.current?.click()} disabled={importing} data-testid="employee-import-btn">
                                <UploadSimple size={14} /> {importing ? "Importing…" : "Import"}
                            </Button>
                            <Button data-testid="employee-add-btn" onClick={openCreate} className="bg-brand hover:bg-brand-hover text-white h-9 gap-1.5">
                                <Plus size={14} weight="bold" /> Add Employee
                            </Button>
                        </>
                    )}
                </div>
            </div>

            {/* Table */}
            <div className="card-flat overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead className="label-cap py-2.5">Code</TableHead>
                            <TableHead className="label-cap py-2.5">Name</TableHead>
                            <TableHead className="label-cap py-2.5">WhatsApp</TableHead>
                            <TableHead className="label-cap py-2.5">Department</TableHead>
                            <TableHead className="label-cap py-2.5">Route</TableHead>
                            {isSuper && <TableHead className="label-cap py-2.5">Company</TableHead>}
                            <TableHead className="label-cap py-2.5">Allowed</TableHead>
                            <TableHead className="label-cap py-2.5">Status</TableHead>
                            <TableHead className="label-cap py-2.5 text-right w-[160px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={isSuper ? 9 : 8} className="text-center py-10 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow><TableCell colSpan={isSuper ? 9 : 8} className="text-center py-14 text-sm text-muted-foreground">No employees yet.</TableCell></TableRow>
                        ) : filtered.map((r) => (
                            <TableRow key={r.id} data-testid={`employee-row-${r.code}`} className="text-[13px]">
                                <TableCell className="py-2.5 font-mono text-[12px]">{r.code}</TableCell>
                                <TableCell className="py-2.5">{r.name}</TableCell>
                                <TableCell className="py-2.5 font-mono text-[12px]">{r.whatsapp}</TableCell>
                                <TableCell className="py-2.5">{nameById(departments, r.department_id)}</TableCell>
                                <TableCell className="py-2.5">{nameById(routes, r.route_id)}</TableCell>
                                {isSuper && (
                                    <TableCell className="py-2.5">
                                        <Badge variant="outline" className="text-[11px]"><Buildings size={11} className="mr-1" />{nameById(companies, r.company_id)}</Badge>
                                    </TableCell>
                                )}
                                <TableCell className="py-2.5">
                                    <div className="flex gap-2">
                                        <Badge variant="outline" className="text-[11px]"><UsersFour size={11} className="mr-1" />{(r.allowed_customers || []).length}</Badge>
                                        <Badge variant="outline" className="text-[11px]"><Package size={11} className="mr-1" />{(r.allowed_items || []).length}</Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="py-2.5">
                                    <Badge className={r.status === "Active" ? "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100" : "bg-zinc-100 text-zinc-600 border border-zinc-200"}>{r.status}</Badge>
                                </TableCell>
                                <TableCell className="py-2.5 text-right">
                                    <div className="inline-flex gap-1">
                                        {canEdit && (
                                            <Button size="sm" variant="outline" className="h-7 text-[11px] px-2" data-testid={`employee-allowed-${r.code}`} onClick={() => openAllowed(r)}>Allowed</Button>
                                        )}
                                        {canEdit && (
                                            <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`employee-edit-${r.code}`} onClick={() => openEdit(r)}><PencilSimple size={14} /></Button>
                                        )}
                                        {canDelete && (
                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid={`employee-delete-${r.code}`} onClick={() => setDelId(r.id)}><Trash size={14} /></Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Basic create/edit dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg" data-testid="employee-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading">{editing ? "Edit Employee" : "New Employee"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4">
                        {isSuper && (
                            <div className="space-y-1.5 col-span-2">
                                <Label className="label-cap">Company *{editing ? " (locked)" : ""}</Label>
                                <Select value={form.company_id || ""} onValueChange={onCompanyChange} disabled={!!editing}>
                                    <SelectTrigger className="h-9" data-testid="employee-field-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                                    <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label className="label-cap">Code *</Label>
                            <Input value={form.code || ""} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editing} className="h-9" data-testid="employee-field-code" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="label-cap">Name *</Label>
                            <Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" data-testid="employee-field-name" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="label-cap">WhatsApp No *</Label>
                            <Input value={form.whatsapp || ""} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className="h-9" placeholder="+92300…" data-testid="employee-field-whatsapp" />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="label-cap">Department</Label>
                            <Select value={form.department_id || ""} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                                <SelectTrigger className="h-9" data-testid="employee-field-department"><SelectValue placeholder={isSuper && !form.company_id ? "Select company first" : "Select"} /></SelectTrigger>
                                <SelectContent>{formDepartments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="label-cap">Route</Label>
                            <Select value={form.route_id || ""} onValueChange={(v) => setForm({ ...form, route_id: v })}>
                                <SelectTrigger className="h-9" data-testid="employee-field-route"><SelectValue placeholder={isSuper && !form.company_id ? "Select company first" : "Select"} /></SelectTrigger>
                                <SelectContent>{formRoutes.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label className="label-cap">Status</Label>
                            <Select value={form.status || "Active"} onValueChange={(v) => setForm({ ...form, status: v })}>
                                <SelectTrigger className="h-9" data-testid="employee-field-status"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Active">Active</SelectItem>
                                    <SelectItem value="Inactive">Inactive</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button data-testid="employee-save-btn" onClick={save} disabled={saving} className="bg-brand hover:bg-brand-hover text-white">
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Allowed customers + items with tree view */}
            <Dialog open={allowOpen} onOpenChange={setAllowOpen}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="employee-allowed-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading flex items-center gap-2">
                            <UserCircle size={18} weight="fill" />
                            Allowed Customers &amp; Items — <span className="text-brand">{allowFor?.name}</span>
                        </DialogTitle>
                    </DialogHeader>

                    <Tabs value={tab} onValueChange={setTab}>
                        <TabsList>
                            <TabsTrigger value="customers" data-testid="allowed-tab-customers">
                                <UsersFour size={14} className="mr-1.5" /> Allowed Customers
                            </TabsTrigger>
                            <TabsTrigger value="items" data-testid="allowed-tab-items">
                                <Package size={14} className="mr-1.5" /> Allowed Items
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="customers" className="space-y-3 mt-4">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <Input data-testid="allowed-customer-search" className="pl-8 h-9" placeholder="Search customers or routes…" value={custSearch} onChange={(e) => setCustSearch(e.target.value)} />
                                </div>
                                <div className="text-[12px] text-muted-foreground self-center whitespace-nowrap">
                                    {chosenCustomers.length} selected
                                </div>
                            </div>
                            
                            <div className="border border-border rounded-md max-h-[400px] overflow-auto p-2">
                                {flatNodes.length === 0 ? (
                                    <div className="py-6 text-center text-muted-foreground">
                                        {custSearch ? 'No matching routes or customers found.' : 'No customers assigned to routes yet.'}
                                    </div>
                                ) : (
                                    <div className="space-y-0.5">
                                        {flatNodes.map(node => renderNode(node))}
                                    </div>
                                )}
                            </div>
                            
                            <div className="flex justify-end gap-2">
                                <Button 
                                    variant="outline" 
                                    onClick={() => {
                                        const allCustomerIds = [];
                                        const collectAll = (nodes) => {
                                            nodes.forEach(node => {
                                                if (node.customers) {
                                                    node.customers.forEach(c => allCustomerIds.push(c.id));
                                                }
                                                if (node.children) collectAll(node.children);
                                            });
                                        };
                                        collectAll(filteredTree);
                                        setChosenCustomers(allCustomerIds);
                                        toast.info(`Selected ${allCustomerIds.length} customers`);
                                    }}
                                >
                                    Select All
                                </Button>
                                <Button 
                                    variant="outline" 
                                    onClick={() => {
                                        setChosenCustomers([]);
                                        toast.info('Cleared all selections');
                                    }}
                                >
                                    Clear All
                                </Button>
                                <Button data-testid="save-allowed-customers" onClick={saveAllowedCustomers} disabled={savingAllowed} className="bg-brand hover:bg-brand-hover text-white">
                                    {savingAllowed ? "Saving…" : "Save Allowed Customers"}
                                </Button>
                            </div>
                        </TabsContent>

                        <TabsContent value="items" className="space-y-3 mt-4">
                            <div className="flex gap-2">
                                <Select value={selBrandId} onValueChange={setSelBrandId}>
                                    <SelectTrigger className="h-9 w-[220px]" data-testid="allowed-brand-select"><SelectValue placeholder="Select brand" /></SelectTrigger>
                                    <SelectContent>{allowedBrands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                                </Select>
                                <div className="relative flex-1">
                                    <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <Input data-testid="allowed-item-search" className="pl-8 h-9" placeholder="Search items of this brand…" value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
                                </div>
                                <div className="text-[12px] text-muted-foreground self-center whitespace-nowrap">
                                    {chosenItems.length} selected
                                </div>
                            </div>
                            <div className="border border-border rounded-md max-h-[400px] overflow-auto">
                                <table className="w-full text-[13px]">
                                    <thead className="bg-muted/40 sticky top-0">
                                        <tr>
                                            <th className="text-left label-cap py-2 px-3 w-[40px]"></th>
                                            <th className="text-left label-cap py-2 px-3">Code</th>
                                            <th className="text-left label-cap py-2 px-3">Item Name</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredItems.length === 0 ? (
                                            <tr><td colSpan={3} className="py-6 text-center text-muted-foreground">No items for this brand.</td></tr>
                                        ) : filteredItems.map((i) => (
                                            <tr key={i.id} className="border-t border-border">
                                                <td className="py-2 px-3">
                                                    <Checkbox
                                                        data-testid={`allowed-item-${i.code}`}
                                                        checked={chosenItems.includes(i.id)}
                                                        onCheckedChange={() => toggle(chosenItems, setChosenItems, i.id)}
                                                    />
                                                </td>
                                                <td className="py-2 px-3 font-mono text-[12px]">{i.code}</td>
                                                <td className="py-2 px-3">{i.name}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="flex justify-end">
                                <Button data-testid="save-allowed-items" onClick={saveAllowedItems} disabled={savingAllowed} className="bg-brand hover:bg-brand-hover text-white">
                                    {savingAllowed ? "Saving…" : "Save Allowed Items"}
                                </Button>
                            </div>
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!delId} onOpenChange={(v) => !v && setDelId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete employee?</AlertDialogTitle>
                        <AlertDialogDescription>Their allowed customer/item settings will be removed.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={del}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Import Report */}
            <Dialog open={!!importReport} onOpenChange={(v) => !v && setImportReport(null)}>
                <DialogContent className="sm:max-w-lg" data-testid="employee-import-report">
                    <DialogHeader>
                        <DialogTitle className="font-heading">Import Result</DialogTitle>
                    </DialogHeader>
                    <div className="text-sm text-muted-foreground">
                        {importReport?.total_rows ?? 0} row(s) processed.
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-2">
                        <div className="border rounded-md px-3 py-2 bg-emerald-50 border-emerald-200 text-emerald-800">
                            <div className="label-cap">Created</div>
                            <div className="font-heading font-black text-xl mt-0.5">{importReport?.created ?? 0}</div>
                        </div>
                        <div className="border rounded-md px-3 py-2 bg-muted border-border">
                            <div className="label-cap">Skipped</div>
                            <div className="font-heading font-black text-xl mt-0.5">{importReport?.skipped_duplicates?.length ?? 0}</div>
                        </div>
                        <div className={`border rounded-md px-3 py-2 ${importReport?.errors?.length ? "bg-red-50 border-red-200 text-red-800" : "bg-muted border-border"}`}>
                            <div className="label-cap">Errors</div>
                            <div className="font-heading font-black text-xl mt-0.5">{importReport?.errors?.length ?? 0}</div>
                        </div>
                    </div>
                    {(importReport?.errors?.length > 0 || importReport?.skipped_duplicates?.length > 0) && (
                        <div className="mt-3 border border-border rounded-md max-h-[220px] overflow-auto text-[12px]">
                            <table className="w-full">
                                <thead className="bg-muted/40 sticky top-0">
                                    <tr>
                                        <th className="text-left label-cap py-1.5 px-3">Row</th>
                                        <th className="text-left label-cap py-1.5 px-3">Code</th>
                                        <th className="text-left label-cap py-1.5 px-3">Issue</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(importReport?.errors || []).map((e, i) => (
                                        <tr key={`err-${i}`} className="border-t border-border">
                                            <td className="py-1.5 px-3 font-mono">{e.row}</td>
                                            <td className="py-1.5 px-3 font-mono">{e.code || "—"}</td>
                                            <td className="py-1.5 px-3 text-destructive">{e.error}</td>
                                        </tr>
                                    ))}
                                    {(importReport?.skipped_duplicates || []).map((d, i) => (
                                        <tr key={`dup-${i}`} className="border-t border-border">
                                            <td className="py-1.5 px-3 font-mono">{d.row}</td>
                                            <td className="py-1.5 px-3 font-mono">{d.code}</td>
                                            <td className="py-1.5 px-3 text-muted-foreground">Duplicate code — skipped</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <DialogFooter>
                        <Button onClick={() => setImportReport(null)} className="bg-brand hover:bg-brand-hover text-white">Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}