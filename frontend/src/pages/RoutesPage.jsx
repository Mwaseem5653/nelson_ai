import React, { useMemo, useState } from "react";
import MasterPage from "@/components/MasterPage";
import { Badge } from "@/components/ui/badge";
import { Folders, Folder, FolderOpen, CaretRight, CaretDown } from "@phosphor-icons/react";
import { useAuth } from "@/auth/AuthContext";

function buildTree(rows) {
    const nodes = {};
    rows.forEach((r) => { nodes[r.id] = { ...r, children: [] }; });
    const roots = [];
    rows.forEach((r) => {
        const node = nodes[r.id];
        const parent = r.parent_id && nodes[r.parent_id];
        if (parent) parent.children.push(node);
        else roots.push(node);
    });
    return roots;
}

// Flatten the tree into an indented list of visible rows (no recursive JSX).
function flattenVisible(roots, expanded, out = [], depth = 0) {
    for (const n of roots) {
        out.push({ ...n, depth });
        if (n.children.length && expanded[n.id]) {
            flattenVisible(n.children, expanded, out, depth + 1);
        }
    }
    return out;
}

function NodeRow({ node, expanded, onToggle }) {
    const isGroup = !!node.is_group;
    const hasChildren = node.children.length > 0;
    const isOpen = !!expanded[node.id];
    return (
        <div
            className="flex items-center gap-1.5 py-1.5 pr-2 text-[13px] rounded-[3px] hover:bg-muted cursor-pointer"
            style={{ paddingLeft: `${8 + node.depth * 16}px` }}
            onClick={() => hasChildren && onToggle(node.id)}
            data-testid={`route-tree-node-${node.code || node.id}`}
        >
            <span className="shrink-0 grid place-items-center w-4 text-muted-foreground">
                {hasChildren ? (
                    isOpen ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />
                ) : (
                    <span className="w-3" />
                )}
            </span>
            <span className="shrink-0">
                {isGroup ? (
                    isOpen ? (
                        <FolderOpen size={14} weight="fill" className="text-amber-500" />
                    ) : (
                        <Folder size={14} weight="fill" className="text-amber-500" />
                    )
                ) : (
                    <Folders size={14} className="text-muted-foreground" />
                )}
            </span>
            <span className="truncate font-medium">{node.name}</span>
            {node.group && (
                <span className="ml-1 shrink-0 rounded-[2px] bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {node.group}
                </span>
            )}
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground font-mono">{node.code}</span>
        </div>
    );
}

export default function RoutesPage() {
    const { user } = useAuth();
    const isSuper = user?.type === "SuperAdmin";
    const [routes, setRoutes] = useState([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState("");
    const [expanded, setExpanded] = useState({});

    const nameById = (arr, id) => arr.find((x) => x.id === id)?.name || "—";
    const fullLabel = (r) => (r ? `${r.name} · ${r.code}` : "");

    const effectiveCompanyId = isSuper ? selectedCompanyId : (user?.company_id || "");
    // Only "group" routes can be parents.
    const parentOptions = (routes || [])
        .filter((r) => r.is_group)
        .map((r) => ({ value: r.id, label: fullLabel(r) }));

    // Filter tree to active company for clarity
    const treeRows = useMemo(() => {
        if (!effectiveCompanyId) return routes;
        return routes.filter((r) => r.company_id === effectiveCompanyId);
    }, [routes, effectiveCompanyId]);

    const tree = useMemo(() => buildTree(treeRows), [treeRows]);
    const flatNodes = useMemo(() => flattenVisible(tree, expanded), [tree, expanded]);

    const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

    const FIELDS = [
        { name: "code", label: "Code", required: true, colHeader: "Code" },
        { name: "name", label: "Name", required: true, colHeader: "Name" },
        {
            name: "is_group",
            label: "Is Group",
            type: "checkbox",
            checkLabel: "This is a group/folder (not a booking route)",
            colHeader: "Type",
            cell: (row) =>
                row.is_group ? (
                    <Badge variant="outline" className="text-[11px] border-amber-300 bg-amber-50 text-amber-700">Group</Badge>
                ) : (
                    <Badge variant="outline" className="text-[11px]">Route</Badge>
                ),
        },
        {
            name: "parent_id",
            label: "Parent / Group",
            type: "select",
            options: parentOptions,
            placeholder: "None (top-level)",
            colHeader: "Parent",
            cell: (row) => nameById(routes, row.parent_id),
        },
        { name: "group", label: "Group Tag", colHeader: "Group" },
        { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
    ];

    return (
        <div className="flex flex-col xl:flex-row gap-6 items-start">
            <div className="flex-1 min-w-0 w-full">
                <MasterPage
                    title="Route"
                    description="Routes form a user-defined tree (Area > Zone > Route). Pick a Parent to nest a route; left open to build a group."
                    endpoint="/routes"
                    fields={FIELDS}
                    testidPrefix="route"
                    formCode="route"
                    importEntity="routes"
                    onCompanyChange={setSelectedCompanyId}
                    onDataLoaded={(d) => setRoutes(Array.isArray(d) ? d : [])}
                />
            </div>

            <aside className="w-full xl:w-[340px] shrink-0 card-flat overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                    <Folders size={15} className="text-brand" />
                    <span className="label-cap">Route Tree</span>
                    <span className="ml-auto text-[11px] text-muted-foreground">
                        {flatNodes.length} node(s)
                    </span>
                </div>
                <div className="p-2 max-h-[70vh] overflow-auto" data-testid="route-tree">
                    {flatNodes.length === 0 ? (
                        <div className="text-muted-foreground text-sm px-4 py-6 text-center">
                            No routes yet. Create routes and set a Parent to build your tree.
                        </div>
                    ) : (
                        flatNodes.map((n) => (
                            <NodeRow key={n.id} node={n} expanded={expanded} onToggle={toggle} />
                        ))
                    )}
                </div>
            </aside>
        </div>
    );
}