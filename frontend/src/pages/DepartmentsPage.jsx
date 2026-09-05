import React from "react";
import MasterPage from "@/components/MasterPage";

const FIELDS = [
    { name: "code", label: "Code", required: true, colHeader: "Code" },
    { name: "name", label: "Name", required: true, colHeader: "Name" },
    { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
];

export default function DepartmentsPage() {
    return (
        <MasterPage
            title="Department"
            description="Organisational departments within your company."
            endpoint="/departments"
            fields={FIELDS}
            testidPrefix="department"
            formCode="department"
            importEntity="departments"
        />
    );
}
