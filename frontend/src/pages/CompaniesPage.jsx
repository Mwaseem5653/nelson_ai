import React, { useEffect, useState } from "react";
import api from "@/api/client";
import MasterPage from "@/components/MasterPage";
import { useAuth } from "@/auth/AuthContext";

const FIELDS = [
    { name: "code", label: "Code", required: true, colHeader: "Code" },
    { name: "name", label: "Name", required: true, colHeader: "Name" },
    { name: "address", label: "Address", type: "textarea", wide: true, colHeader: "Address" },
    { name: "phone", label: "Phone", colHeader: "Phone" },
    { name: "whatsapp", label: "WhatsApp No", colHeader: "WhatsApp" },
    { name: "email", label: "Email", colHeader: "Email" },
    { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
];

export default function CompaniesPage() {
    return (
        <MasterPage
            title="Company"
            description="Register organisations (tenants) that will use the order booking system."
            endpoint="/companies"
            fields={FIELDS}
            testidPrefix="company"
            formCode="company"
            hideCompanyField={true}
        />
    );
}
