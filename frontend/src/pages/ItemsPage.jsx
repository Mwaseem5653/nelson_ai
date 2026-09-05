import React, { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import MasterPage from "@/components/MasterPage";
import { useAuth } from "@/auth/AuthContext";
import { Badge } from "@/components/ui/badge";
import { 
    Package,
    Folder, 
    FolderOpen,
    ShoppingBag,
    Cube,
    CaretRight, 
    CaretDown,
    Buildings,
    Tag
} from "@phosphor-icons/react";

// Build tree: Brand -> Items
function buildBrandTree(items, brands, units) {
    const brandMap = {};
    brands.forEach(b => {
        brandMap[b.id] = {
            ...b,
            type: 'brand',
            children: []
        };
    });
    
    // Group items by brand
    items.forEach(item => {
        const brand = brandMap[item.brand_id];
        if (brand) {
            const unit = units.find(u => u.id === item.unit_id);
            brand.children.push({
                ...item,
                type: 'item',
                unit: unit,
                parentType: 'brand'
            });
        }
    });
    
    // Return only brands that have items
    return Object.values(brandMap).filter(brand => 
        brand.children.length > 0
    );
}

// Build tree: Product -> Items
function buildProductTree(items, products, units) {
    const productMap = {};
    products.forEach(p => {
        productMap[p.id] = {
            ...p,
            type: 'product',
            children: []
        };
    });
    
    // Group items by product
    items.forEach(item => {
        const product = productMap[item.product_id];
        if (product) {
            const unit = units.find(u => u.id === item.unit_id);
            product.children.push({
                ...item,
                type: 'item',
                unit: unit,
                parentType: 'product'
            });
        }
    });
    
    // Return only products that have items
    return Object.values(productMap).filter(product => 
        product.children.length > 0
    );
}

// Flatten tree for display
function flattenVisible(nodes, expanded, out = [], depth = 0) {
    for (const node of nodes) {
        out.push({ ...node, depth });
        
        if (node.children && node.children.length && expanded[node.id]) {
            flattenVisible(node.children, expanded, out, depth + 1);
        }
    }
    return out;
}

// Tree node component
function TreeNode({ node, expanded, onToggle }) {
    const isBrand = node.type === 'brand';
    const isProduct = node.type === 'product';
    const isItem = node.type === 'item';
    const hasChildren = node.children && node.children.length > 0;
    const isOpen = !!expanded[node.id];
    
    let icon;
    let badgeText = '';
    let badgeColor = '';
    let iconColor = '';
    
    if (isBrand) {
        icon = isOpen ? <FolderOpen size={16} weight="fill" /> : <Folder size={16} weight="fill" />;
        iconColor = 'text-blue-600';
        badgeText = 'Brand';
        badgeColor = 'bg-blue-100 text-blue-800 border-blue-200';
    } else if (isProduct) {
        icon = <ShoppingBag size={16} />;
        iconColor = 'text-purple-600';
        badgeText = 'Product';
        badgeColor = 'bg-purple-100 text-purple-800 border-purple-200';
    } else if (isItem) {
        icon = <Cube size={16} />;
        iconColor = 'text-emerald-600';
        badgeText = node.unit?.name || 'Item';
        badgeColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
    }
    
    return (
        <div
            className={`flex items-center gap-2 py-1.5 pr-2 text-[13px] rounded-[3px] hover:bg-muted cursor-pointer ${iconColor}`}
            style={{ paddingLeft: `${8 + node.depth * 24}px` }}
            onClick={() => hasChildren && onToggle(node.id)}
        >
            <span className="shrink-0 grid place-items-center w-4 text-muted-foreground">
                {hasChildren ? (
                    isOpen ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />
                ) : (
                    <span className="w-3" />
                )}
            </span>
            <span className="shrink-0">{icon}</span>
            <span className="truncate font-medium">{node.name}</span>
            {!isItem && (
                <Badge variant="outline" className={`text-[10px] ml-1 ${badgeColor}`}>
                    {badgeText}
                </Badge>
            )}
            {isItem && (
                <>
                    <Badge variant="outline" className={`text-[10px] ml-1 ${badgeColor}`}>
                        {badgeText}
                    </Badge>
                    {node.parentType === 'brand' && (
                        <Badge variant="outline" className="text-[10px] ml-1 bg-blue-50 text-blue-700 border-blue-200">
                            Brand
                        </Badge>
                    )}
                    {node.parentType === 'product' && (
                        <Badge variant="outline" className="text-[10px] ml-1 bg-purple-50 text-purple-700 border-purple-200">
                            Product
                        </Badge>
                    )}
                </>
            )}
            {node.code && (
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground font-mono">
                    {node.code}
                </span>
            )}
        </div>
    );
}

export default function ItemsPage() {
    const { user } = useAuth();
    const isSuper = user?.type === "SuperAdmin";
    const [items, setItems] = useState([]);
    const [products, setProducts] = useState([]);
    const [brands, setBrands] = useState([]);
    const [units, setUnits] = useState([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState("");
    const [expandedBrand, setExpandedBrand] = useState({});
    const [expandedProduct, setExpandedProduct] = useState({});
    const [activeTab, setActiveTab] = useState('brand');

    // Load data
    useEffect(() => {
        (async () => {
            try {
                const [itemsRes, productsRes, brandsRes, unitsRes] = await Promise.all([
                    api.get("/items"),
                    api.get("/products"),
                    api.get("/brands"),
                    api.get("/units"),
                ]);
                setItems(itemsRes.data || []);
                setProducts(productsRes.data || []);
                setBrands(brandsRes.data || []);
                setUnits(unitsRes.data || []);
            } catch (error) {
                console.error('Error loading data:', error);
            }
        })();
    }, []);

    const nameById = (arr, id) => arr.find((x) => x.id === id)?.name || "—";

    const effectiveCompanyId = isSuper ? selectedCompanyId : (user?.company_id || "");
    const filterByCompany = (arr) =>
        effectiveCompanyId ? arr.filter((x) => x.company_id === effectiveCompanyId) : arr;

    // Filter data
    const filteredBrands = useMemo(() => filterByCompany(brands), [brands, effectiveCompanyId]);
    const filteredProducts = useMemo(() => filterByCompany(products), [products, effectiveCompanyId]);
    const filteredItems = useMemo(() => filterByCompany(items), [items, effectiveCompanyId]);

    // Build trees
    const brandTree = useMemo(() => 
        buildBrandTree(filteredItems, filteredBrands, units), 
        [filteredItems, filteredBrands, units]
    );

    const productTree = useMemo(() => 
        buildProductTree(filteredItems, filteredProducts, units), 
        [filteredItems, filteredProducts, units]
    );

    // Flatten trees
    const flatBrandNodes = useMemo(() => 
        flattenVisible(brandTree, expandedBrand), 
        [brandTree, expandedBrand]
    );

    const flatProductNodes = useMemo(() => 
        flattenVisible(productTree, expandedProduct), 
        [productTree, expandedProduct]
    );

    const toggleBrand = (id) => setExpandedBrand((prev) => ({ ...prev, [id]: !prev[id] }));
    const toggleProduct = (id) => setExpandedProduct((prev) => ({ ...prev, [id]: !prev[id] }));

    // Auto-expand first level
    useEffect(() => {
        if (brandTree.length > 0 && Object.keys(expandedBrand).length === 0) {
            const newExpanded = {};
            brandTree.forEach(brand => {
                newExpanded[brand.id] = true;
            });
            setExpandedBrand(newExpanded);
        }
    }, [brandTree]);

    useEffect(() => {
        if (productTree.length > 0 && Object.keys(expandedProduct).length === 0) {
            const newExpanded = {};
            productTree.forEach(product => {
                newExpanded[product.id] = true;
            });
            setExpandedProduct(newExpanded);
        }
    }, [productTree]);

    const productOpts = useMemo(() => 
        filteredProducts.map((p) => ({ value: p.id, label: p.name })), 
        [filteredProducts]
    );
    
    const brandOpts = useMemo(() => 
        filteredBrands.map((b) => ({ value: b.id, label: b.name })), 
        [filteredBrands]
    );
    
    const unitOpts = useMemo(() => 
        filterByCompany(units).map((u) => ({ value: u.id, label: u.name })), 
        [units, effectiveCompanyId]
    );

    // ===== UPDATED FIELDS WITH TYPE: "combobox" INSTEAD OF "select" =====
    const FIELDS = [
        { name: "code", label: "Item Code", required: true, colHeader: "Code" },
        { name: "name", label: "Item Name", required: true, colHeader: "Item Name" },
        {
            name: "product_id",
            label: "Product",
            type: "combobox",  // Changed from "select" to "combobox"
            required: true,
            colHeader: "Product",
            options: productOpts,
            placeholder: isSuper && !selectedCompanyId ? "Select company first" : "Search product…",
            searchPlaceholder: "Search products…",
            cell: (r) => nameById(products, r.product_id),
        },
        {
            name: "brand_id",
            label: "Brand",
            type: "combobox",  // Changed from "select" to "combobox"
            required: true,
            colHeader: "Brand",
            options: brandOpts,
            placeholder: isSuper && !selectedCompanyId ? "Select company first" : "Search brand…",
            searchPlaceholder: "Search brands…",
            cell: (r) => nameById(brands, r.brand_id),
        },
        {
            name: "unit_id",
            label: "Unit",
            type: "combobox",  // Changed from "select" to "combobox"
            required: true,
            colHeader: "Unit",
            options: unitOpts,
            placeholder: isSuper && !selectedCompanyId ? "Select company first" : "Search unit…",
            searchPlaceholder: "Search units…",
            cell: (r) => nameById(units, r.unit_id),
        },
        { name: "status", label: "Status", type: "status", required: true, colHeader: "Status" },
    ];

    const currentFlatNodes = activeTab === 'brand' ? flatBrandNodes : flatProductNodes;
    const currentTree = activeTab === 'brand' ? brandTree : productTree;
    const currentToggle = activeTab === 'brand' ? toggleBrand : toggleProduct;

    return (
        <div className="flex flex-col xl:flex-row gap-6 items-start">
            <div className="flex-1 min-w-0 w-full">
                <MasterPage
                    title="Item"
                    description="Sellable items linking Product, Brand and Unit."
                    endpoint="/items"
                    fields={FIELDS}
                    testidPrefix="item"
                    formCode="item"
                    importEntity="items"
                    onCompanyChange={setSelectedCompanyId}
                    onDataLoaded={(d) => setItems(Array.isArray(d) ? d : [])}
                    sortableFields={['code', 'name', 'product_id', 'brand_id', 'unit_id', 'status']}
                    filterableFields={['code', 'name', 'product_id', 'brand_id', 'unit_id', 'status']}
                />
            </div>

            <aside className="w-full xl:w-[380px] shrink-0 card-flat overflow-hidden">
                <div className="px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2 mb-2">
                        <Package size={15} className="text-brand" />
                        <span className="label-cap">Item Tree</span>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                            {filteredItems.length} items
                        </span>
                    </div>
                    
                    {/* Tab Switcher */}
                    <div className="flex gap-1 bg-muted p-1 rounded-md">
                        <button
                            className={`flex-1 px-3 py-1 text-xs rounded-md transition-all ${
                                activeTab === 'brand' 
                                    ? 'bg-white shadow-sm text-foreground' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setActiveTab('brand')}
                        >
                            <Folder size={12} className="inline mr-1" />
                            By Brand
                        </button>
                        <button
                            className={`flex-1 px-3 py-1 text-xs rounded-md transition-all ${
                                activeTab === 'product' 
                                    ? 'bg-white shadow-sm text-foreground' 
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                            onClick={() => setActiveTab('product')}
                        >
                            <ShoppingBag size={12} className="inline mr-1" />
                            By Product
                        </button>
                    </div>
                </div>
                
                <div className="p-2 max-h-[70vh] overflow-auto" data-testid="item-tree">
                    {currentFlatNodes.length === 0 ? (
                        <div className="text-muted-foreground text-sm px-4 py-6 text-center">
                            {effectiveCompanyId ? (
                                <>
                                    <p>No items found for this company.</p>
                                    <p className="text-xs mt-1">
                                        {activeTab === 'brand' ? 'Brands' : 'Products'}: 0 · Items: {filteredItems.length}
                                    </p>
                                </>
                            ) : (
                                <p>Select a company to view the item tree.</p>
                            )}
                        </div>
                    ) : (
                        currentFlatNodes.map((n) => (
                            <TreeNode 
                                key={n.id} 
                                node={n} 
                                expanded={activeTab === 'brand' ? expandedBrand : expandedProduct}
                                onToggle={currentToggle} 
                            />
                        ))
                    )}
                </div>
            </aside>
        </div>
    );
}