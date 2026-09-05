import React from "react";
import MasterPage from "@/components/MasterPage";

const FIELDS = [
    { name: "code", label: "Code", required: true, colHeader: "Code" },
    { name: "name", label: "Name", required: true, colHeader: "Name" },
    { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
];

export default function UnitsPage() {
    return (
        <MasterPage
            title="Unit"
            description="Units of measurement (e.g. Carton, KG, Piece). Unique per company."
            endpoint="/units"
            fields={FIELDS}
            testidPrefix="unit"
            formCode="unit"
            importEntity="units"
        />
    );
}
