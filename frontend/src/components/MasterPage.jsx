import React, { useEffect, useMemo, useRef, useState } from "react";
import api, { formatApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { 
    Plus, 
    MagnifyingGlass, 
    PencilSimple, 
    Trash, 
    DownloadSimple, 
    UploadSimple, 
    Buildings, 
    CaretDown, 
    Check, 
    ArrowUp, 
    ArrowDown, 
    Funnel, 
    X 
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
    Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command, CommandInput, CommandList, CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth, hasPerm } from "@/auth/AuthContext";

/**
 * Reusable master CRUD screen.
 *
 * Props:
 *  - title, description
 *  - endpoint: e.g. "/departments"
 *  - fields: [{ name, label, type, options?, required?, colHeader?, hidden?, cell?(row), placeholder? }]
 *  - testidPrefix
 *  - formCode: form code for permission lookup (e.g. "department"). If omitted, all actions are allowed.
 *  - importEntity?: string; when set, Import + Template buttons shown
 *  - onDataLoaded?: (rows) => void
 *  - initialForm?: object of defaults for new records
 *  - hideCompanyField?: boolean — set true when the entity is company itself (CompaniesPage)
 *  - enablePagination?: boolean — enable pagination (default: true)
 *  - defaultPageSize?: number — default records per page (default: 25)
 *  - enableSorting?: boolean — enable column sorting (default: true)
 *  - enableAdvancedFilter?: boolean — enable advanced filter (default: true)
 *  - sortableFields?: string[] — which fields can be sorted (default: all)
 *  - filterableFields?: string[] — which fields can be filtered (default: all)
 */
export default function MasterPage({
    title,
    description,
    endpoint,
    fields,
    testidPrefix,
    formCode,
    initialForm = {},
    onDataLoaded,
    importEntity,
    hideCompanyField = false,
    onCompanyChange,
    // ===== ENABLED BY DEFAULT =====
    enablePagination = true,
    defaultPageSize = 25,
    enableSorting = true,
    enableAdvancedFilter = true,
    sortableFields = [],
    filterableFields = [],
}) {
    const { user } = useAuth();
    const isSuper = user?.type === "SuperAdmin";

    // Permissions: if formCode not provided, default to allow all (backwards compat)
    const canAdd = !formCode || hasPerm(user, formCode, "add");
    const canEdit = !formCode || hasPerm(user, formCode, "edit");
    const canDelete = !formCode || hasPerm(user, formCode, "delete");

    const [rows, setRows] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [deleteId, setDeleteId] = useState(null);
    const fileInputRef = useRef(null);
    const [importing, setImporting] = useState(false);
    const [importReport, setImportReport] = useState(null);

    // Pagination states
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    // Sorting states
    const [sortField, setSortField] = useState('');
    const [sortDirection, setSortDirection] = useState('asc');

    // Advanced filter states
    const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
    const [advancedFilters, setAdvancedFilters] = useState({});

    // Load companies once for SuperAdmin
    useEffect(() => {
        if (isSuper && !hideCompanyField) {
            api.get("/companies").then((r) => setCompanies(r.data || [])).catch(() => {});
        }
    }, [isSuper, hideCompanyField]);

    const load = async () => {
        setLoading(true);
        try {
            const { data } = await api.get(endpoint);
            setRows(Array.isArray(data) ? data : []);
            onDataLoaded && onDataLoaded(data);
            setCurrentPage(1);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [endpoint]);

    const companyName = (id) => companies.find((c) => c.id === id)?.name || "—";

    // Get display value for a field (handles cell renderers)
    const getDisplayValue = (row, fieldName) => {
        const field = fields.find(f => f.name === fieldName);
        if (field?.cell) {
            return field.cell(row);
        }
        return row[fieldName];
    };

    // Check if a field is a select/combobox type
    const isSelectField = (fieldName) => {
        const field = fields.find(f => f.name === fieldName);
        return field && (field.type === 'select' || field.type === 'combobox');
    };

    // Apply search filter
    const searchFiltered = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (!s) return rows;
        return rows.filter((r) =>
            fields.some((f) => {
                const v = getDisplayValue(r, f.name);
                return typeof v === "string" && v.toLowerCase().includes(s);
            }) || (r.code || "").toLowerCase().includes(s) || (r.name || "").toLowerCase().includes(s)
        );
    }, [rows, q, fields]);

    // Apply advanced filters
    const advancedFiltered = useMemo(() => {
        if (!enableAdvancedFilter || Object.keys(advancedFilters).length === 0) {
            return searchFiltered;
        }
        return searchFiltered.filter(row => {
            return Object.entries(advancedFilters).every(([key, filterValue]) => {
                if (!filterValue || filterValue === '') return true;
                
                // For select fields, compare the raw value (ID)
                if (isSelectField(key)) {
                    const rawValue = row[key];
                    return String(rawValue) === String(filterValue);
                }
                
                // For text fields, compare the display value
                let displayValue = getDisplayValue(row, key);
                if (displayValue == null) displayValue = '';
                return String(displayValue).toLowerCase().includes(String(filterValue).toLowerCase());
            });
        });
    }, [searchFiltered, advancedFilters, enableAdvancedFilter]);

    // Apply sorting
    const sortedData = useMemo(() => {
        if (!enableSorting || !sortField) return advancedFiltered;
        
        return [...advancedFiltered].sort((a, b) => {
            let aVal = getDisplayValue(a, sortField);
            let bVal = getDisplayValue(b, sortField);
            
            if (aVal == null) aVal = '';
            if (bVal == null) bVal = '';
            
            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();
            
            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [advancedFiltered, sortField, sortDirection, enableSorting]);

    // Apply pagination
    const paginatedData = useMemo(() => {
        if (!enablePagination) return sortedData;
        
        const startIndex = (currentPage - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        return sortedData.slice(startIndex, endIndex);
    }, [sortedData, currentPage, pageSize, enablePagination]);

    const totalItems = sortedData.length;
    const totalPages = Math.ceil(totalItems / pageSize);
    const startIndex = (currentPage - 1) * pageSize + 1;
    const endIndex = Math.min(currentPage * pageSize, totalItems);

    // Handle sort
    const handleSort = (fieldName) => {
        if (!enableSorting) return;
        
        const isSortable = sortableFields.length === 0 || sortableFields.includes(fieldName);
        if (!isSortable) return;
        
        if (sortField === fieldName) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(fieldName);
            setSortDirection('asc');
        }
        setCurrentPage(1);
    };

    // Get sort icon
    const getSortIcon = (fieldName) => {
        if (!enableSorting || sortField !== fieldName) {
            return <span className="ml-1 opacity-40 text-[10px]">↕</span>;
        }
        return sortDirection === 'asc' 
            ? <ArrowUp size={12} className="ml-1" />
            : <ArrowDown size={12} className="ml-1" />;
    };

    // Clear all advanced filters
    const clearAdvancedFilters = () => {
        setAdvancedFilters({});
    };

    const openCreate = () => {
        if (!canAdd) return;
        setEditing(null);
        const defaults = { status: "Active", ...initialForm };
        fields.forEach((f) => {
            if (defaults[f.name] === undefined) defaults[f.name] = f.type === "checkbox" ? false : "";
        });
        if (isSuper) defaults.company_id = defaults.company_id || "";
        setForm(defaults);
        onCompanyChange && onCompanyChange(defaults.company_id || "");
        setOpen(true);
    };
    const openEdit = (row) => {
        if (!canEdit) return;
        setEditing(row);
        setForm({ ...row });
        onCompanyChange && onCompanyChange(row.company_id || "");
        setOpen(true);
    };

    const save = async () => {
        setSaving(true);
        try {
            const body = { ...form };
            if (isSuper && !hideCompanyField && !editing && !body.company_id) {
                toast.error("Please select a company");
                setSaving(false);
                return;
            }
            if (editing) {
                await api.put(`${endpoint}/${editing.id}`, body);
                toast.success(`${title} updated`);
            } else {
                await api.post(endpoint, body);
                toast.success(`${title} created`);
            }
            setOpen(false);
            await load();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setSaving(false);
        }
    };

    const del = async () => {
        if (!deleteId) return;
        try {
            await api.delete(`${endpoint}/${deleteId}`);
            toast.success(`${title} deleted`);
            setDeleteId(null);
            await load();
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };

    const downloadTemplate = async () => {
        try {
            const res = await api.get(`/import/${importEntity}/template`, { responseType: "blob" });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const a = document.createElement("a");
            a.href = url;
            a.download = `nelson_${importEntity}_template.xlsx`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };

    const onFilePicked = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setImporting(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const { data } = await api.post(`/import/${importEntity}`, fd, {
                headers: { "Content-Type": "multipart/form-data" },
            });
            setImportReport(data);
            if (data.created > 0)
                toast.success(`Imported ${data.created} of ${data.total_rows} rows`);
            else if (data.errors?.length) toast.error(`Import completed with errors`);
            else toast.message(`No new rows created`);
            await load();
        } catch (err) {
            toast.error(formatApiError(err));
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const showCompanyCol = isSuper && !hideCompanyField;
    const showPagination = enablePagination && totalItems > pageSize;

    return (
        <div className="space-y-5" data-testid={`${testidPrefix}-page`}>
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                <div>
                    <div className="label-cap">Master · Setup</div>
                    <h1 className="font-heading font-black text-2xl mt-1">{title}</h1>
                    {description && (
                        <p className="text-sm text-muted-foreground mt-1">{description}</p>
                    )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <MagnifyingGlass
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            data-testid={`${testidPrefix}-search`}
                            className="pl-8 h-9 w-[180px]"
                            placeholder="Search…"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>
                    
                    {enableAdvancedFilter && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-9 gap-1.5"
                            onClick={() => setShowAdvancedFilter(!showAdvancedFilter)}
                        >
                            <Funnel size={14} />
                            Filters
                            {Object.keys(advancedFilters).length > 0 && (
                                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                                    {Object.keys(advancedFilters).length}
                                </Badge>
                            )}
                        </Button>
                    )}

                    {importEntity && canAdd && (
                        <>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx"
                                className="hidden"
                                onChange={onFilePicked}
                                data-testid={`${testidPrefix}-file-input`}
                            />
                            <Button
                                variant="outline"
                                className="h-9 gap-1.5"
                                onClick={downloadTemplate}
                                data-testid={`${testidPrefix}-template-btn`}
                                title="Download an Excel template"
                            >
                                <DownloadSimple size={14} />
                                Template
                            </Button>
                            <Button
                                variant="outline"
                                className="h-9 gap-1.5"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={importing}
                                data-testid={`${testidPrefix}-import-btn`}
                                title="Import from filled Excel template"
                            >
                                <UploadSimple size={14} />
                                {importing ? "Importing…" : "Import"}
                            </Button>
                        </>
                    )}
                    {canAdd && (
                        <Button
                            data-testid={`${testidPrefix}-add-btn`}
                            onClick={openCreate}
                            className="bg-brand hover:bg-brand-hover text-white h-9 gap-1.5"
                        >
                            <Plus size={14} weight="bold" />
                            Add New
                        </Button>
                    )}
                </div>
            </div>

            {/* Advanced Filter Panel */}
            {enableAdvancedFilter && showAdvancedFilter && (
                <div className="card-flat p-4 bg-muted/20">
                    <div className="flex items-center justify-between mb-3">
                        <span className="label-cap">Advanced Filters</span>
                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={clearAdvancedFilters}
                            >
                                <X size={12} className="mr-1" />
                                Clear All
                            </Button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {fields
                            .filter(f => !f.hidden && (filterableFields.length === 0 || filterableFields.includes(f.name)))
                            .map(f => {
                                // For select/combobox fields, show a dropdown with options
                                if (f.type === 'select' || f.type === 'combobox') {
                                    const options = f.options || [];
                                    return (
                                        <div key={f.name} className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">{f.label}</Label>
                                            <select
                                                value={advancedFilters[f.name] || ''}
                                                onChange={(e) => {
                                                    setAdvancedFilters({
                                                        ...advancedFilters,
                                                        [f.name]: e.target.value
                                                    });
                                                    setCurrentPage(1);
                                                }}
                                                className="w-full h-8 text-xs border border-input rounded-md bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                                            >
                                                <option value="">All {f.label}s</option>
                                                {options.map(opt => (
                                                    <option key={opt.value} value={opt.value}>
                                                        {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                }
                                
                                // For status field, show a dropdown
                                if (f.name === 'status') {
                                    return (
                                        <div key={f.name} className="space-y-1">
                                            <Label className="text-xs text-muted-foreground">{f.label}</Label>
                                            <select
                                                value={advancedFilters[f.name] || ''}
                                                onChange={(e) => {
                                                    setAdvancedFilters({
                                                        ...advancedFilters,
                                                        [f.name]: e.target.value
                                                    });
                                                    setCurrentPage(1);
                                                }}
                                                className="w-full h-8 text-xs border border-input rounded-md bg-background px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                                            >
                                                <option value="">All</option>
                                                <option value="Active">Active</option>
                                                <option value="Inactive">Inactive</option>
                                            </select>
                                        </div>
                                    );
                                }
                                
                                // For text fields, show text input
                                return (
                                    <div key={f.name} className="space-y-1">
                                        <Label className="text-xs text-muted-foreground">{f.label}</Label>
                                        <Input
                                            placeholder={`Filter by ${f.label.toLowerCase()}`}
                                            value={advancedFilters[f.name] || ''}
                                            onChange={(e) => {
                                                setAdvancedFilters({
                                                    ...advancedFilters,
                                                    [f.name]: e.target.value
                                                });
                                                setCurrentPage(1);
                                            }}
                                            className="h-8 text-xs"
                                        />
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="card-flat overflow-hidden">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-muted/40 hover:bg-muted/40">
                                {fields
                                    .filter((f) => !f.hidden)
                                    .map((f) => {
                                        const isSortable = enableSorting && (sortableFields.length === 0 || sortableFields.includes(f.name));
                                        return (
                                            <TableHead
                                                key={f.name}
                                                className={cn(
                                                    "label-cap py-2.5 text-foreground/70",
                                                    isSortable && "cursor-pointer hover:text-foreground select-none"
                                                )}
                                                onClick={() => isSortable && handleSort(f.name)}
                                            >
                                                <div className="flex items-center">
                                                    {f.colHeader || f.label}
                                                    {isSortable && getSortIcon(f.name)}
                                                </div>
                                            </TableHead>
                                        );
                                    })}
                                {showCompanyCol && (
                                    <TableHead className="label-cap py-2.5 text-foreground/70">Company</TableHead>
                                )}
                                <TableHead className="label-cap py-2.5 text-right w-[110px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={fields.length + (showCompanyCol ? 2 : 1)} className="text-center py-10 text-muted-foreground text-sm">
                                        Loading…
                                    </TableCell>
                                </TableRow>
                            ) : paginatedData.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={fields.length + (showCompanyCol ? 2 : 1)} className="text-center py-14 text-sm">
                                        <div className="mx-auto max-w-md border border-dashed border-border rounded-md p-8">
                                            <div className="label-cap mb-1">Nothing found</div>
                                            <div className="text-muted-foreground">
                                                No {title.toLowerCase()} match your filters.
                                            </div>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                paginatedData.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        data-testid={`${testidPrefix}-row-${row.code || row.id}`}
                                        className="text-[13px]"
                                    >
                                        {fields
                                            .filter((f) => !f.hidden)
                                            .map((f) => (
                                                <TableCell key={f.name} className="py-2.5">
                                                    {f.cell ? (
                                                        f.cell(row)
                                                    ) : f.name === "status" ? (
                                                        <Badge
                                                            variant={row.status === "Active" ? "default" : "secondary"}
                                                            className={
                                                                row.status === "Active"
                                                                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border border-emerald-200"
                                                                    : "bg-zinc-100 text-zinc-600 border border-zinc-200"
                                                            }
                                                        >
                                                            {row.status}
                                                        </Badge>
                                                    ) : (
                                                        <span>{row[f.name] ?? "—"}</span>
                                                    )}
                                                </TableCell>
                                            ))}
                                        {showCompanyCol && (
                                            <TableCell className="py-2.5">
                                                <Badge variant="outline" className="text-[11px]">
                                                    <Buildings size={11} className="mr-1" />
                                                    {companyName(row.company_id)}
                                                </Badge>
                                            </TableCell>
                                        )}
                                        <TableCell className="py-2.5 text-right">
                                            <div className="inline-flex gap-1">
                                                {canEdit && (
                                                    <Button
                                                        data-testid={`${testidPrefix}-edit-${row.code || row.id}`}
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7"
                                                        onClick={() => openEdit(row)}
                                                    >
                                                        <PencilSimple size={14} />
                                                    </Button>
                                                )}
                                                {canDelete && (
                                                    <Button
                                                        data-testid={`${testidPrefix}-delete-${row.code || row.id}`}
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                                        onClick={() => setDeleteId(row.id)}
                                                    >
                                                        <Trash size={14} />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination Controls */}
                {showPagination && (
                    <div className="px-4 py-3 border-t border-border bg-muted/30">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span>Show</span>
                                <select
                                    value={pageSize}
                                    onChange={(e) => {
                                        setPageSize(Number(e.target.value));
                                        setCurrentPage(1);
                                    }}
                                    className="border border-border rounded px-1 py-0.5 text-xs bg-background"
                                >
                                    <option value={10}>10</option>
                                    <option value={25}>25</option>
                                    <option value={50}>50</option>
                                    <option value={100}>100</option>
                                </select>
                                <span>entries</span>
                                <span className="hidden sm:inline">
                                    ({startIndex}-{endIndex} of {totalItems})
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                    disabled={currentPage === 1}
                                    className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    Prev
                                </button>
                                <span className="text-xs text-muted-foreground px-2">
                                    {currentPage} / {totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                    disabled={currentPage === totalPages}
                                    className="px-2 py-1 text-xs border border-border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Dialog: Create / Edit */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg" data-testid={`${testidPrefix}-dialog`}>
                    <DialogHeader>
                        <DialogTitle className="font-heading">
                            {editing ? `Edit ${title}` : `New ${title}`}
                        </DialogTitle>
                        <DialogDescription>
                            Fields marked * are required.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isSuper && !hideCompanyField && (
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label className="label-cap">
                                    Company *
                                    {editing && <span className="ml-2 normal-case tracking-normal text-muted-foreground">(locked)</span>}
                                </Label>
                                <Select
                                    value={form.company_id || ""}
                                    onValueChange={(v) => {
                                        setForm({ ...form, company_id: v });
                                        onCompanyChange && onCompanyChange(v);
                                    }}
                                    disabled={!!editing}
                                >
                                    <SelectTrigger className="h-9" data-testid={`${testidPrefix}-field-company`}>
                                        <SelectValue placeholder="Select company" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {companies.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                        {fields
                            .filter((f) => f.name !== "status")
                            .map((f) => (
                                <FormField
                                    key={f.name}
                                    field={f}
                                    value={form[f.name] ?? ""}
                                    onChange={(v) => setForm({ ...form, [f.name]: v })}
                                    testidPrefix={testidPrefix}
                                />
                            ))}
                        {fields.find((f) => f.name === "status") && (
                            <FormField
                                field={{ name: "status", label: "Status", type: "status", required: true }}
                                value={form.status || "Active"}
                                onChange={(v) => setForm({ ...form, status: v })}
                                testidPrefix={testidPrefix}
                            />
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button
                            data-testid={`${testidPrefix}-save-btn`}
                            onClick={save}
                            disabled={saving}
                            className="bg-brand hover:bg-brand-hover text-white"
                        >
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete confirm */}
            <AlertDialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {title}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel data-testid={`${testidPrefix}-cancel-delete`}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            data-testid={`${testidPrefix}-confirm-delete`}
                            onClick={del}
                            className="bg-destructive hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Import Report */}
            <Dialog open={!!importReport} onOpenChange={(v) => !v && setImportReport(null)}>
                <DialogContent className="sm:max-w-lg" data-testid={`${testidPrefix}-import-report`}>
                    <DialogHeader>
                        <DialogTitle className="font-heading">Import Result</DialogTitle>
                        <DialogDescription>
                            {importReport?.total_rows ?? 0} row(s) processed for {title}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-3 gap-3">
                        <Stat label="Created" value={importReport?.created ?? 0} tone="ok" />
                        <Stat label="Skipped" value={importReport?.skipped_duplicates?.length ?? 0} tone="muted" />
                        <Stat label="Errors" value={importReport?.errors?.length ?? 0} tone={importReport?.errors?.length ? "err" : "muted"} />
                    </div>
                    {(importReport?.errors?.length > 0 || importReport?.skipped_duplicates?.length > 0) && (
                        <div className="mt-2 border border-border rounded-md max-h-[240px] overflow-auto text-[12px]">
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
                        <Button
                            data-testid={`${testidPrefix}-import-report-close`}
                            onClick={() => setImportReport(null)}
                            className="bg-brand hover:bg-brand-hover text-white"
                        >
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function Stat({ label, value, tone }) {
    const cls =
        tone === "ok"
            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
            : tone === "err"
            ? "bg-red-50 border-red-200 text-red-800"
            : "bg-muted border-border text-foreground";
    return (
        <div className={`border rounded-md px-3 py-2 ${cls}`}>
            <div className="label-cap">{label}</div>
            <div className="font-heading font-black text-xl mt-0.5">{value}</div>
        </div>
    );
}

function FormField({ field, value, onChange, testidPrefix }) {
    const id = `${testidPrefix}-field-${field.name}`;
    const wide = field.wide ? "sm:col-span-2" : "";
    return (
        <div className={`space-y-1.5 ${wide}`}>
            <Label htmlFor={id} className="label-cap">
                {field.label}
                {field.required ? " *" : ""}
            </Label>
            {field.type === "select" ? (
                <Select value={value || ""} onValueChange={onChange}>
                    <SelectTrigger id={id} data-testid={id} className="h-9">
                        <SelectValue placeholder={field.placeholder || "Select…"} />
                    </SelectTrigger>
                    <SelectContent>
                        {(field.options || []).map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                                {o.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : field.type === "combobox" ? (
                <ComboboxField field={field} value={value} onChange={onChange} testidPrefix={testidPrefix} />
            ) : field.type === "status" ? (
                <Select value={value || "Active"} onValueChange={onChange}>
                    <SelectTrigger id={id} data-testid={id} className="h-9">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                    </SelectContent>
                </Select>
            ) : field.type === "textarea" ? (
                <textarea
                    id={id}
                    data-testid={id}
                    value={value || ""}
                    onChange={(e) => onChange(e.target.value)}
                    rows={3}
                    placeholder={field.placeholder}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                />
            ) : field.type === "password" ? (
                <Input
                    id={id}
                    data-testid={id}
                    type="password"
                    value={value || ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={field.placeholder}
                    className="h-9"
                />
            ) : field.type === "checkbox" ? (
                <div className="flex items-center gap-2 h-9">
                    <input
                        id={id}
                        data-testid={id}
                        type="checkbox"
                        checked={!!value}
                        onChange={(e) => onChange(e.target.checked)}
                        className="h-4 w-4 rounded border border-input accent-[hsl(var(--primary))]"
                    />
                    {field.checkLabel && <span className="text-[13px] text-muted-foreground">{field.checkLabel}</span>}
                </div>
            ) : (
                <Input
                    id={id}
                    data-testid={id}
                    value={value || ""}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={field.placeholder}
                    className="h-9"
                />
            )}
        </div>
    );
}

function ComboboxField({ field, value, onChange, testidPrefix }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const id = `${testidPrefix}-field-${field.name}`;
    const options = field.options || [];
    const selected = options.find((o) => o.value === value);

    const filtered = query.trim()
        ? options.filter((o) => String(o.label || "").toLowerCase().includes(query.trim().toLowerCase()))
        : options;

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    id={id}
                    data-testid={id}
                    className={cn(
                        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
                        "focus:outline-none focus:ring-1 focus:ring-ring"
                    )}
                >
                    <span className={cn("truncate", selected ? "text-foreground" : "text-muted-foreground")}>
                        {selected ? selected.label : (field.placeholder || "Select…")}
                    </span>
                    <CaretDown size={13} className="shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[240px] p-0" align="start">
                <Command shouldFilter={false}>                    
                    <CommandInput placeholder={field.searchPlaceholder || "Search…"} value={query} onValueChange={setQuery} />
                    <CommandList className="max-h-[240px]">
                        {field.clearable !== false && (
                            <CommandItem
                                value="__clear__"
                                onSelect={() => { onChange(""); setOpen(false); }}
                                className="text-muted-foreground"
                            >
                                <Check size={13} className={cn("mr-2", !value ? "opacity-100" : "opacity-0")} />
                                None
                            </CommandItem>
                        )}
                        {filtered.length === 0 ? (
                            <div className="py-6 text-center text-sm text-muted-foreground">No results</div>
                        ) : (
                            filtered.map((o) => (
                                <CommandItem
                                    key={o.value}
                                    value={o.value}
                                    onSelect={() => { onChange(o.value); setOpen(false); }}
                                >
                                    <Check size={13} className={cn("mr-2", o.value === value ? "opacity-100" : "opacity-0")} />
                                    {o.label}
                                </CommandItem>
                            ))
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}