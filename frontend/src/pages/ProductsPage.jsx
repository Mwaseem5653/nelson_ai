import React from "react";
import MasterPage from "@/components/MasterPage";

const FIELDS = [
    { name: "code", label: "Code", required: true, colHeader: "Code" },
    { name: "name", label: "Name", required: true, colHeader: "Name" },
    { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
];

export default function ProductsPage() {
    return (
        <MasterPage
            title="Product"
            description="Product families used to group items."
            endpoint="/products"
            fields={FIELDS}
            testidPrefix="product"
            formCode="product"
            importEntity="products"
        />
    );
}
