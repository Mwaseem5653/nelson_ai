import React, { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { WhatsappLogo, MagnifyingGlass } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";

export default function SalesOrdersPage() {
    const [rows, setRows] = useState([]);
    const [customers, setCustomers] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [q, setQ] = useState("");

    useEffect(() => {
        Promise.all([
            api.get("/orders"),
            api.get("/customers"),
            api.get("/employees"),
            api.get("/routes"),
            api.get("/departments"),
        ]).then(([o, c, e, r, d]) => {
            setRows(o.data || []);
            setCustomers(c.data || []);
            setEmployees(e.data || []);
            setRoutes(r.data || []);
            setDepartments(d.data || []);
        }).catch(() => {}).finally(() => setLoading(false));
    }, []);

    const nameById = (arr, id) => arr.find((x) => x.id === id)?.name || "—";

    const enriched = useMemo(() => rows.map((o) => ({
        ...o,
        customer_name: nameById(customers, o.customer_id),
        employee_name: nameById(employees, o.employee_id),
        route_name: nameById(routes, o.route_id),
        department_name: nameById(departments, o.department_id),
    })), [rows, customers, employees, routes, departments]);

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (!s) return enriched;
        return enriched.filter((o) =>
            [o.customer_name, o.employee_name, o.status].some((v) =>
                (v || "").toLowerCase().includes(s)
            )
        );
    }, [enriched, q]);

    return (
        <div className="space-y-5" data-testid="sales-order-page">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <div className="label-cap">Transaction</div>
                    <h1 className="font-heading font-black text-2xl mt-1">Sales Orders</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Orders received via WhatsApp. AI extracts details and matches against each
                        employee's allowed customers &amp; items; the employee confirms on WhatsApp
                        before the order is saved.
                    </p>
                </div>
                <div className="relative">
                    <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        data-testid="orders-search"
                        className="pl-8 h-9 w-[240px]"
                        placeholder="Search…"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                </div>
            </div>

            <div className="card-flat overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                            <TableHead className="label-cap py-2.5">Order Date</TableHead>
                            <TableHead className="label-cap py-2.5">Customer</TableHead>
                            <TableHead className="label-cap py-2.5">Employee</TableHead>
                            <TableHead className="label-cap py-2.5">Department</TableHead>
                            <TableHead className="label-cap py-2.5">Route</TableHead>
                            <TableHead className="label-cap py-2.5">Items</TableHead>
                            <TableHead className="label-cap py-2.5">Received Via</TableHead>
                            <TableHead className="label-cap py-2.5">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Loading…</TableCell></TableRow>
                        ) : filtered.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center py-16">
                                    <div className="mx-auto max-w-md border border-dashed border-border rounded-md p-8">
                                        <div className="label-cap mb-1">No orders yet</div>
                                        <div className="text-sm text-muted-foreground">
                                            Orders will start flowing once the WhatsApp session is linked and employees begin sending messages.
                                        </div>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : filtered.map((o) => (
                            <TableRow key={o.id} className="text-[13px]" data-testid={`order-row-${o.id}`}>
                                <TableCell className="py-2.5 font-mono text-[12px]">
                                    {(o.order_date || "").slice(0, 19).replace("T", " ")}
                                </TableCell>
                                <TableCell className="py-2.5">{o.customer_name}</TableCell>
                                <TableCell className="py-2.5">{o.employee_name}</TableCell>
                                <TableCell className="py-2.5">{o.department_name}</TableCell>
                                <TableCell className="py-2.5">{o.route_name}</TableCell>
                                <TableCell className="py-2.5">
                                    <Badge variant="outline">{o.total_items ?? "—"}</Badge>
                                </TableCell>
                                <TableCell className="py-2.5">
                                    <Badge variant="outline" className="gap-1">
                                        {o.source === "whatsapp" && <WhatsappLogo size={11} weight="fill" className="text-emerald-500" />}
                                        {o.message_type || "text"}
                                    </Badge>
                                </TableCell>
                                <TableCell className="py-2.5">
                                    <Badge className={o.status === "Confirmed" ? "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-100" : "bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-100"}>
                                        {o.status}
                                    </Badge>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
