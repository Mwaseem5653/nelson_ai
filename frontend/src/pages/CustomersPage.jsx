import React, { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import MasterPage from "@/components/MasterPage";
import { useAuth } from "@/auth/AuthContext";

export default function CustomersPage() {
    const { user } = useAuth();
    const isSuper = user?.type === "SuperAdmin";
    const [routes, setRoutes] = useState([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState("");

    useEffect(() => {
        api.get("/routes").then((r) => setRoutes(r.data || [])).catch(() => {});
    }, []);

    // Full path label, e.g. "Acme / North Zone / Route-A" (group ancestors + route name)
    const routePathLabel = (routeId) => {
        if (!routeId) return "—";
        const parts = [];
        const seen = new Set();
        let cur = routes.find((r) => r.id === routeId);
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            parts.unshift(cur.name);
            cur = cur.parent_id ? routes.find((p) => p.id === cur.parent_id) : null;
        }
        return parts.join(" / ");
    };

    const effectiveCompanyId = isSuper ? selectedCompanyId : (user?.company_id || "");
    const filteredRoutes = useMemo(
        () => (effectiveCompanyId ? routes.filter((r) => r.company_id === effectiveCompanyId) : routes)
            .filter((r) => r.is_group !== true),
        [routes, effectiveCompanyId]
    );

    const FIELDS = [
        { name: "code", label: "Code", required: true, colHeader: "Code" },
        { name: "name", label: "Name", required: true, colHeader: "Name" },
        {
            name: "route_id",
            label: "Route",
            type: "combobox",
            colHeader: "Route",
            options: filteredRoutes.map((r) => ({ value: r.id, label: routePathLabel(r.id) })),
            placeholder: "Search route…",
            searchPlaceholder: "Search route…",
            cell: (row) => routePathLabel(row.route_id),
        },
        { name: "phone", label: "Phone", colHeader: "Phone" },
        { name: "whatsapp", label: "WhatsApp", colHeader: "WhatsApp" },
        { name: "email", label: "Email", colHeader: "Email" },
        { name: "address", label: "Address", type: "textarea", wide: true, hidden: true },
        { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
    ];

    return (
        <MasterPage
            title="Customer"
            description="Customers assigned to routes. Employees can only book orders for their allowed customers."
            endpoint="/customers"
            fields={FIELDS}
            testidPrefix="customer"
            formCode="customer"
            importEntity="customers"
            onCompanyChange={setSelectedCompanyId}
        />
    );
}
