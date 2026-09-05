import React, { useEffect, useMemo, useState } from "react";
import api, { formatApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
    Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, PencilSimple, Trash, MagnifyingGlass, Key } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth, hasPerm } from "@/auth/AuthContext";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function UsersPage() {
    const { user } = useAuth();
    const isSuper = user?.type === "SuperAdmin";
    const canAdd = hasPerm(user, "user", "add");
    const canEdit = hasPerm(user, "user", "edit");
    const canDelete = hasPerm(user, "user", "delete");
    const [rows, setRows] = useState([]);
    const [companies, setCompanies] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");
    const [open, setOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [delId, setDelId] = useState(null);
    const [resetFor, setResetFor] = useState(null);
    const [newPass, setNewPass] = useState("");

    const load = async () => {
        setLoading(true);
        try {
            const [u, c, r] = await Promise.all([
                api.get("/users"),
                api.get("/companies"),
                api.get("/roles"),
            ]);
            setRows(u.data || []);
            setCompanies(c.data || []);
            setRoles(r.data || []);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        return s
            ? rows.filter((r) =>
                [r.full_name, r.login_id, r.email, r.type].some((v) => (v || "").toLowerCase().includes(s))
            )
            : rows;
    }, [rows, q]);

    const companyName = (id) => companies.find((c) => c.id === id)?.name || "—";
    const roleName = (id) => roles.find((r) => r.id === id)?.name || "—";

    const rolesForCompany = (cid) => roles.filter((r) => r.company_id === cid);

    const openCreate = () => {
        setEditing(null);
        setForm({
            full_name: "",
            login_id: "",
            password: "",
            email: "",
            type: "Employee",
            company_id: isSuper ? "" : user.company_id,
            role_id: "",
            status: "Active",
        });
        setOpen(true);
    };
    const openEdit = (row) => {
        setEditing(row);
        setForm({ ...row, password: "" });
        setOpen(true);
    };
    const save = async () => {
        setSaving(true);
        try {
            const body = { ...form };
            if (editing) {
                if (!body.password) delete body.password;
                await api.put(`/users/${editing.id}`, body);
                toast.success("User updated");
            } else {
                await api.post("/users", body);
                toast.success("User created");
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
        try {
            await api.delete(`/users/${delId}`);
            toast.success("User deleted");
            setDelId(null);
            await load();
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };
    const submitReset = async () => {
        try {
            await api.post("/auth/reset-password", { user_id: resetFor.id, new_password: newPass });
            toast.success(`Password reset for ${resetFor.login_id}`);
            setResetFor(null);
            setNewPass("");
        } catch (e) {
            toast.error(formatApiError(e));
        }
    };

    return (
        <div className="space-y-5" data-testid="user-page">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <div className="label-cap">Master · Setup</div>
                    <h1 className="font-heading font-black text-2xl mt-1">User Profile</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Admin & Employee login accounts. Employees identify themselves on WhatsApp by their number.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input data-testid="user-search" className="pl-8 h-9 w-[220px]" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
                    </div>
                    <Button data-testid="user-add-btn" onClick={openCreate} disabled={!canAdd} className="bg-brand hover:bg-brand-hover text-white h-9 gap-1.5 disabled:opacity-40 disabled:pointer-events-none">
                        <Plus size={14} weight="bold" />
                        Add New
                    </Button>
                </div>
            </div>

            <div className="card-flat overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead className="label-cap py-2.5 text-foreground/70">Login ID</TableHead>
                            <TableHead className="label-cap py-2.5 text-foreground/70">Full Name</TableHead>
                            <TableHead className="label-cap py-2.5 text-foreground/70">Email</TableHead>
                            <TableHead className="label-cap py-2.5 text-foreground/70">Type</TableHead>
                            {isSuper && <TableHead className="label-cap py-2.5 text-foreground/70">Company</TableHead>}
                            <TableHead className="label-cap py-2.5 text-foreground/70">Role</TableHead>
                            <TableHead className="label-cap py-2.5 text-foreground/70">Status</TableHead>
                            <TableHead className="label-cap py-2.5 text-right w-[140px]">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={isSuper ? 8 : 7} className="text-center py-10 text-muted-foreground text-sm">Loading…</TableCell></TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow><TableCell colSpan={isSuper ? 8 : 7} className="text-center py-14 text-sm text-muted-foreground">No users found.</TableCell></TableRow>
                        ) : filtered.map((r) => (
                            <TableRow key={r.id} data-testid={`user-row-${r.login_id}`} className="text-[13px]">
                                <TableCell className="py-2.5 font-mono text-[12px]">{r.login_id}</TableCell>
                                <TableCell className="py-2.5">{r.full_name}</TableCell>
                                <TableCell className="py-2.5 text-muted-foreground">{r.email || "—"}</TableCell>
                                <TableCell className="py-2.5">
                                    <Badge variant="outline" className="text-[11px]">{r.type}</Badge>
                                </TableCell>
                                {isSuper && <TableCell className="py-2.5">{r.company_id ? companyName(r.company_id) : "—"}</TableCell>}
                                <TableCell className="py-2.5">{roleName(r.role_id)}</TableCell>
                                <TableCell className="py-2.5">
                                    <Badge className={r.status === "Active" ? "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100" : "bg-zinc-100 text-zinc-600 border border-zinc-200"}>
                                        {r.status}
                                    </Badge>
                                </TableCell>
                                <TableCell className="py-2.5 text-right">
                                    <div className="inline-flex gap-1">
                                        {canEdit && (
                                            <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`user-reset-${r.login_id}`} onClick={() => setResetFor(r)} title="Reset password">
                                                <Key size={14} />
                                            </Button>
                                        )}
                                        {canEdit && (
                                            <Button size="icon" variant="ghost" className="h-7 w-7" data-testid={`user-edit-${r.login_id}`} onClick={() => openEdit(r)}>
                                                <PencilSimple size={14} />
                                            </Button>
                                        )}
                                        {canDelete && (
                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" data-testid={`user-delete-${r.login_id}`} onClick={() => setDelId(r.id)}>
                                                <Trash size={14} />
                                            </Button>
                                        )}
                                    </div>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {/* Create/Edit dialog */}
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="sm:max-w-lg" data-testid="user-dialog">
                    <DialogHeader>
                        <DialogTitle className="font-heading">{editing ? "Edit User" : "New User"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-4">
                        <Field label="Full Name *" testid="user-field-name"><Input value={form.full_name || ""} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="h-9" data-testid="user-field-name" /></Field>
                        <Field label="Login ID *" testid="user-field-login"><Input value={form.login_id || ""} onChange={(e) => setForm({ ...form, login_id: e.target.value })} disabled={!!editing} className="h-9" data-testid="user-field-login" /></Field>
                        {!editing && (
                            <Field label="Password *" testid="user-field-password"><Input type="password" value={form.password || ""} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-9" data-testid="user-field-password" /></Field>
                        )}
                        <Field label="Email"><Input value={form.email || ""} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-9" /></Field>
                        <Field label="Type *">
                            <Select value={form.type || "Employee"} onValueChange={(v) => setForm({ ...form, type: v })}>
                                <SelectTrigger className="h-9" data-testid="user-field-type"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {isSuper && <SelectItem value="SuperAdmin">SuperAdmin</SelectItem>}
                                    <SelectItem value="Admin">Admin</SelectItem>
                                    <SelectItem value="Employee">Employee</SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>
                        {isSuper && form.type !== "SuperAdmin" && (
                            <Field label="Company *">
                                <Select value={form.company_id || ""} onValueChange={(v) => setForm({ ...form, company_id: v, role_id: "" })}>
                                    <SelectTrigger className="h-9" data-testid="user-field-company"><SelectValue placeholder="Select company" /></SelectTrigger>
                                    <SelectContent>
                                        {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </Field>
                        )}
                        {form.type !== "SuperAdmin" && (
                            <Field label="Role">
                                <Select value={form.role_id || ""} onValueChange={(v) => setForm({ ...form, role_id: v })}>
                                    <SelectTrigger className="h-9" data-testid="user-field-role"><SelectValue placeholder="Select role" /></SelectTrigger>
                                    <SelectContent>
                                        {rolesForCompany(form.company_id || user.company_id).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </Field>
                        )}
                        <Field label="Status">
                            <Select value={form.status || "Active"} onValueChange={(v) => setForm({ ...form, status: v })}>
                                <SelectTrigger className="h-9" data-testid="user-field-status"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Active">Active</SelectItem>
                                    <SelectItem value="Inactive">Inactive</SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                        <Button data-testid="user-save-btn" onClick={save} disabled={saving} className="bg-brand hover:bg-brand-hover text-white">
                            {saving ? "Saving…" : "Save"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Reset password */}
            <Dialog open={!!resetFor} onOpenChange={(v) => !v && setResetFor(null)}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="font-heading">Reset password for {resetFor?.login_id}</DialogTitle>
                    </DialogHeader>
                    <Field label="New Password *">
                        <Input type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} className="h-9" data-testid="user-reset-input" />
                    </Field>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setResetFor(null); setNewPass(""); }}>Cancel</Button>
                        <Button onClick={submitReset} data-testid="user-reset-submit" className="bg-brand hover:bg-brand-hover text-white">Reset</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!delId} onOpenChange={(v) => !v && setDelId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete user?</AlertDialogTitle>
                        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
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

function Field({ label, children }) {
    return (
        <div className="space-y-1.5">
            <Label className="label-cap">{label}</Label>
            {children}
        </div>
    );
}
