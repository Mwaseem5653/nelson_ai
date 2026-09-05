import React, { useEffect, useState } from "react";
import api from "@/api/client";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { ShoppingCartSimple, ClockCounterClockwise, UsersFour, UserGear, Package, ChatCircleDots } from "@phosphor-icons/react";
import { useAuth } from "@/auth/AuthContext";

const KPI = [
    { key: "orders_today", label: "Orders Today", icon: ShoppingCartSimple, accent: true },
    { key: "orders_pending", label: "Pending Orders", icon: ClockCounterClockwise },
    { key: "orders_total", label: "Total Orders", icon: ChatCircleDots },
    { key: "customers_total", label: "Customers", icon: UsersFour },
    { key: "employees_total", label: "Employees", icon: UserGear },
    { key: "items_total", label: "Items", icon: Package },
];

export default function DashboardPage() {
    const [stats, setStats] = useState({});
    const { user } = useAuth();
    useEffect(() => {
        api.get("/dashboard/stats").then((r) => setStats(r.data || {})).catch(() => {});
    }, []);

    return (
        <div className="space-y-6" data-testid="dashboard-page">
            <div>
                <div className="label-cap">Overview</div>
                <h1 className="font-heading font-black text-2xl mt-1">
                    {user?.type === "SuperAdmin" ? "All Companies" : "Company Dashboard"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Snapshot of today's activity. WhatsApp AI extraction goes live in Phase 3.
                </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {KPI.map((k) => (
                    <Card
                        key={k.key}
                        data-testid={`kpi-${k.key}`}
                        className={
                            k.accent
                                ? "!bg-brand !text-white border border-brand rounded-md transition-colors duration-200 hover:!bg-brand-hover"
                                : "card-flat transition-colors duration-200 hover:border-foreground/30"
                        }
                    >
                        <CardHeader className="pb-1 pt-4">
                            <div className={`flex items-center justify-between ${k.accent ? "text-white/90" : "text-muted-foreground"}`}>
                                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold">
                                    {k.label}
                                </span>
                                <k.icon size={16} weight="regular" />
                            </div>
                        </CardHeader>
                        <CardContent className="pb-4">
                            <div className={`font-heading font-black text-3xl ${k.accent ? "text-white" : "text-foreground"}`}>
                                {stats[k.key] ?? "—"}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid md:grid-cols-3 gap-4">
                <Card className="card-flat md:col-span-2">
                    <CardHeader className="pb-2">
                        <CardTitle className="font-heading text-base">Recent Sales Orders</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="border border-dashed border-border rounded-md p-8 text-center">
                            <div className="label-cap mb-1">Waiting on Phase 3</div>
                            <div className="text-sm text-muted-foreground max-w-sm mx-auto">
                                Sales orders will appear here once WhatsApp bridge + Gemini extraction are enabled.
                                All masters below are ready to receive AI-extracted matches.
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card className="card-flat">
                    <CardHeader className="pb-2">
                        <CardTitle className="font-heading text-base">Setup Checklist</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm space-y-2">
                        <Step done={stats.customers_total > 0} label="Add customers" />
                        <Step done={stats.items_total > 0} label="Add items (product / brand / unit)" />
                        <Step done={stats.employees_total > 0} label="Register employees + WhatsApp numbers" />
                        <Step done={false} label="Configure employee allowed customers + items" />
                        <Step done={false} label="Link WhatsApp session (Phase 3)" />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function Step({ done, label }) {
    return (
        <div className="flex items-center gap-2">
            <span
                className={`inline-block h-3.5 w-3.5 rounded-full border ${done ? "bg-emerald-500 border-emerald-500" : "border-border"}`}
                aria-hidden="true"
            />
            <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
        </div>
    );
}
