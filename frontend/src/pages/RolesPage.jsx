import React, { useEffect, useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Plus, MagnifyingGlass, PencilSimple, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth, hasPerm } from "@/auth/AuthContext";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const PERM_COLS = [
    { key: "view", label: "View" },
    { key: "add", label: "Add" },
    { key: "edit", label: "Edit" },
    { key: "delete", label: "Delete" },
    { key: "print", label: "Print" },
];

export default function RolesPage() {
    const { user } = useAuth();
    const isSuper = user?.type === "SuperAdmin";
    const canAdd = hasPerm(user, "role", "add");
    const canEdit = hasPerm(user, "role", "edit");
    const canDelete = hasPerm(user, "role", "delete");
    const [rows, setRows] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [forms, setForms] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({ name: "", status: "Active", company_id: "", permissions: [] });
    const [saving, setSaving] = useState(false);
    const [delId, setDelId] = useState(null);

    const load = async () => {
        setLoading(true);
        try {
            const [r, c, f] = await Promise.all([api.get("/roles"), api.get("/companies"), api.get("/forms")]);
            setRows(r.data || []);
            setCompanies(c.data || []);
            setForms(f.data || []);
        } catch (e) { toast.error(formatApiError(e)); } finally { setLoading(false); }
    };
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return s ? rows.filter((r) => (r.name || "").toLowerCase().includes(s)) : rows;
    }, [rows, q]);

    const companyName = (id) => companies.find((c) => c.id === id)?.name || "—";

    const emptyPermissions = () =>
        forms.map((f) => ({ form_code: f.code, form_name: f.name, view: false, add: false, edit: false, delete: false, print: false }));

    const mergePermissions = (existing) => {
        // Ensure every current form is represented in the matrix
        const map = new Map((existing || []).map((p) => [p.form_code, p]));
        return forms.map((f) => {
            const p = map.get(f.code) || {};
            return {
                form_code: f.code, form_name: f.name,
                view: !!p.view, add: !!p.add, edit: !!p.edit, delete: !!p.delete, print: !!p.print,
            };
        });
    };

    const openCreate = () => {
        setEditing(null);
        setForm({
            name: "", status: "Active",
            company_id: isSuper ? "" : user.company_id,
            permissions: emptyPermissions(),
        });
        setOpen(true);
    };
    const openEdit = (row) => {
        setEditing(row);
        setForm({ ...row, permissions: mergePermissions(row.permissions) });
        setOpen(true);
    };
    const togglePerm = (formCode, key) => {
        setForm((prev) => ({
            ...prev,
            permissions: prev.permissions.map((p) =>
                p.form_code === formCode ? { ...p, [key]: !p[key] } : p
            ),
        }));
    };
    const setColumnAll = (key, value) => {
        setForm((prev) => ({
            ...prev,
            permissions: prev.permissions.map((p) => ({ ...p, [key]: value })),
        }));
    };

    const save = async () => {
        setSaving(true);
        try {
            const body = {
                name: form.name, status: form.status,
                permissions: form.permissions,
                company_id: isSuper ? form.company_id : undefined,
            };
            if (editing) {
                await api.put(`/roles/${editing.id}`, body);
                toast.success("Role updated");
            } else {
                await api.post("/roles", body);
                toast.success("Role created");
            }
            setOpen(false);
            await load();
        } catch (e) { toast.error(formatApiError(e)); } finally { setSaving(false); }
    };
    const del = async () => {
        try { await api.delete(`/roles/${delId}`); toast.success("Role deleted"); setDelId(null); await load(); }
        catch (e) { toast.error(formatApiError(e)); }
    };

    return (
        <div className="space-y-5" data-testid="role-page">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <div className="label-cap">Master · Setup</div>
                    <h1 className="font-heading font-black text-2xl mt-1">Role Profile</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Define roles and their per-form permissions (View / Add / Edit / Delete / Print).
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input data-testid="role-search" className="pl-8 h-9 w-[220px]" placeholder="Search role…" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    <Button data-testid="role-add-btn" onClick={openCreate} disabled={!canAdd} className="bg-brand hover:bg-brand-hover text-white h-9 gap-1.5 disabled:opacity-40 disabled:pointer-events-none">
                        <Plus size={14} weight="bold" /> Add Role
                    </Button>
                </div>
            </div>

            <div className="card-flat overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead className="label-cap py-2.5 text-foreground/70">Name</TableHead>
                            {isSuper && <TableHead className="label-cap py-2.5 text-foreground/70">Company</TableHead>}
                            <TableHead className="label-cap py-2.5 text-foreground/70">Permissions Summary</TableHead>
                            <TableHead className="label-cap py-2.5 text-foreground/70">Status</TableHead>
                            <TableHead className="label-cap py-2.5 text-right w-[110px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={isSuper ? 5 : 4} className="text-center py-10 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow><TableCell colSpan={isSuper ? 5 : 4} className="text-center py-14 text-sm text-muted-foreground">No roles yet.</TableCell></TableRow>
                        ) : filtered.map((r) => {
                            const count = (r.permissions || []).filter((p) => p.view || p.add || p.edit || p.delete || p.print).length;
                            return (
                                <TableRow key={r.id} data-testid={`role-row-${r.name}`} className="text-[13px]">
                                    <TableCell className="py-2.5 font-medium">{r.name}</TableCell>
                                    {isSuper && <TableCell className="py-2.5">{companyName(r.company_id)}</TableCell>}
                                    <TableCell className="py-2.5 text-muted-foreground">
                                        {count} form{count !== 1 ? "s" : ""} enabled
                                    </TableCell>
                                    <TableCell className="py-2.5">
                                        <Badge className={r.status === "Active" ? "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100" : "bg-zinc-100 text-zinc-600 border border-zinc-200"}>{r.status}</Badge>
                                    </TableCell>
                                    <TableCell className="py-2.5 text-right">
                                        <div className="inline-flex gap-1">
                                            {canEdit && (
                                                <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`role-edit-${r.name}`} onClick={() => openEdit(r)}><PencilSimple size={14} /></Button>
                                            )}
                                            {canDelete && (
                                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid={`role-delete-${r.name}`} onClick={() => setDelId(r.id)}><Trash size={14} /></Button>
                                            )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-3xl" data-testid="role-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading">{editing ? "Edit Role" : "New Role"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                            <Label className="label-cap">Role Name *</Label>
                            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-9" data-testid="role-field-name" />
                        </div>
                        {isSuper && (
                            <div className="space-y-1.5">
                                <Label className="label-cap">Company *</Label>
                                <Select value={form.company_id || ""} onValueChange={(v) => setForm({ ...form, company_id: v })}>
                                    <SelectTrigger className="h-9" data-testid="role-field-company"><SelectValue placeholder="Select" /></SelectTrigger>
                                    <SelectContent>{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                                </Select>
                            </div>
                        )}
                        <div className="space-y-1.5">
                            <Label className="label-cap">Status</Label>
                            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                                <SelectTrigger className="h-9" data-testid="role-field-status"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Active">Active</SelectItem>
                                    <SelectItem value="Inactive">Inactive</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="mt-4">
                        <div className="label-cap mb-2">Permissions Matrix</div>
                        <div className="border border-border rounded-md overflow-auto max-h-[420px]">
                            <table className="w-full text-[13px]">
                                <thead className="bg-muted/40 sticky top-0">
                                    <tr>
                                        <th className="text-left label-cap py-2 px-3">Form</th>
                                        {PERM_COLS.map((c) => (
                                            <th key={c.key} className="label-cap py-2 px-3 text-center">
                                                <div>{c.label}</div>
                                                <button
                                                    type="button"
                                                    data-testid={`role-perm-all-${c.key}`}
                                                    className="text-[10px] text-brand mt-0.5 hover:underline"
                                                    onClick={() => {
                                                        const allOn = form.permissions.every((p) => p[c.key]);
                                                        setColumnAll(c.key, !allOn);
                                                    }}
                                                >
                                                    Toggle all
                                                </button>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {form.permissions.map((p) => (
                                        <tr key={p.form_code} className="border-t border-border">
                                            <td className="py-2 px-3">{p.form_name}</td>
                                            {PERM_COLS.map((c) => (
                                                <td key={c.key} className="py-2 px-3 text-center">
                                                    <Checkbox
                                                        data-testid={`role-perm-${p.form_code}-${c.key}`}
                                                        checked={!!p[c.key]}
                                                        onCheckedChange={() => togglePerm(p.form_code, c.key)}
                                                    />
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button data-testid="role-save-btn" onClick={save} disabled={saving} className="bg-brand hover:bg-brand-hover text-white">
                            {saving ? "Saving…" : "Save Role"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!delId} onOpenChange={(v) => !v && setDelId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete role?</AlertDialogTitle>
                        <AlertDialogDescription>Users assigned to this role will lose their permissions.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={del}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
