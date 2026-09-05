import React from "react";
import MasterPage from "@/components/MasterPage";

const FIELDS = [
    { name: "code", label: "Code", required: true, colHeader: "Code" },
    { name: "name", label: "Name", required: true, colHeader: "Name" },
    { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
];

export default function BrandsPage() {
    return (
        <MasterPage
            title="Brand"
            description="Brand catalog. Code + Name must be unique per company."
            endpoint="/brands"
            fields={FIELDS}
            testidPrefix="brand"
            formCode="brand"
            importEntity="brands"
        />
    );
}
