import React from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
    House,
    Buildings,
    UsersThree,
    IdentificationCard,
    Truck,
    Tag,
    Package,
    Ruler,
    Cube,
    UserList,
    UserGear,
    ShoppingCartSimple,
    ChartLineUp,
    WhatsappLogo,
    SignOut,
    ShieldCheck,
} from "@phosphor-icons/react";
import { useAuth, hasPerm } from "@/auth/AuthContext";

const NAV = {
    System: [
        { to: "/dashboard", label: "Dashboard", icon: ChartLineUp, code: "dashboard", testid: "nav-dashboard" },
    ],
    Setup: [
        { to: "/setup/companies", label: "Company Profile", icon: Buildings, code: "company", superOnly: true, testid: "nav-companies" },
        { to: "/setup/roles", label: "Role Profile", icon: ShieldCheck, code: "role", testid: "nav-roles" },
        { to: "/setup/users", label: "User Profile", icon: UsersThree, code: "user", testid: "nav-users" },
        { to: "/setup/departments", label: "Department", icon: IdentificationCard, code: "department", testid: "nav-departments" },
        { to: "/setup/routes", label: "Route", icon: Truck, code: "route", testid: "nav-routes" },
        { to: "/setup/brands", label: "Brand", icon: Tag, code: "brand", testid: "nav-brands" },
        { to: "/setup/products", label: "Product", icon: Package, code: "product", testid: "nav-products" },
        { to: "/setup/units", label: "Unit", icon: Ruler, code: "unit", testid: "nav-units" },
        { to: "/setup/items", label: "Item", icon: Cube, code: "item", testid: "nav-items" },
        { to: "/setup/customers", label: "Customer", icon: UserList, code: "customer", testid: "nav-customers" },
        { to: "/setup/employees", label: "Employee", icon: UserGear, code: "employee", testid: "nav-employees" },
    ],
    Transaction: [
        { to: "/orders", label: "Sales Order", icon: ShoppingCartSimple, code: "sales_order", testid: "nav-orders" },
    ],
    Integration: [
        { to: "/whatsapp", label: "WhatsApp", icon: WhatsappLogo, code: "whatsapp", testid: "nav-whatsapp" },
    ],
};

function Sidebar() {
    const { user, logout } = useAuth();
    const nav = useNavigate();
    const isSuper = user?.type === "SuperAdmin";

    const canSee = (item) => {
        if (item.superOnly && !isSuper) return false;
        // SuperAdmin sees everything; others need explicit view permission on the form
        if (isSuper) return true;
        return hasPerm(user, item.code, "view");
    };

    return (
        <aside
            className="w-[240px] shrink-0 h-screen sticky top-0 border-r border-border flex flex-col"
            style={{ background: "hsl(var(--sidebar-bg))", color: "hsl(var(--sidebar-fg))" }}
            data-testid="sidebar-nav"
        >
            <div className="px-5 pt-5 pb-4 border-b border-white/10">
                <div className="flex items-center gap-2">
                    <div className="h-8 w-8 grid place-items-center bg-brand text-white font-black rounded-[3px]">N</div>
                    <div>
                        <div className="font-heading font-black text-[15px] leading-none">NELSON</div>
                        <div className="text-[10px] tracking-[0.15em] uppercase text-white/50 mt-1">
                            Order Chatbot
                        </div>
                    </div>
                </div>
            </div>

            <nav className="flex-1 overflow-y-auto py-3 px-2">
                {Object.entries(NAV).map(([group, items]) => {
                    const visible = items.filter(canSee);
                    if (visible.length === 0) return null;
                    return (
                        <div key={group} className="mb-4">
                            <div className="px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] font-semibold text-white/40">
                                {group}
                            </div>
                            {visible.map((it) => (
                                <NavLink
                                    key={it.to}
                                    to={it.to}
                                    data-testid={it.testid}
                                    className={({ isActive }) =>
                                        `sidebar-item flex items-center gap-2.5 px-3 py-2 mx-1 rounded-[3px] text-[13px] transition-colors duration-150 ${
                                            isActive
                                                ? "bg-white/10 text-white active"
                                                : "text-white/70 hover:bg-white/5 hover:text-white"
                                        }`
                                    }
                                >
                                    <it.icon size={16} weight="regular" />
                                    <span>{it.label}</span>
                                </NavLink>
                            ))}
                        </div>
                    );
                })}
            </nav>

            <div className="p-3 border-t border-white/10">
                <div className="flex items-center gap-2 px-2 py-2">
                    <div className="h-8 w-8 rounded-[3px] bg-white/10 grid place-items-center text-sm font-semibold">
                        {(user?.full_name || "U").slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold truncate">{user?.full_name}</div>
                        <div className="text-[10px] text-white/50 truncate uppercase tracking-wide">
                            {user?.type}
                        </div>
                    </div>
                    <button
                        data-testid="logout-btn"
                        onClick={async () => {
                            await logout();
                            nav("/login");
                        }}
                        className="p-1.5 rounded hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                        title="Logout"
                    >
                        <SignOut size={16} />
                    </button>
                </div>
            </div>
        </aside>
    );
}

function Header() {
    const location = useLocation();
    const crumbs = location.pathname.split("/").filter(Boolean);
    return (
        <div className="h-14 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-10 flex items-center px-6">
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                <House size={13} />
                {crumbs.length === 0 ? (
                    <span>Home</span>
                ) : (
                    crumbs.map((c, i) => (
                        <React.Fragment key={i}>
                            <span>/</span>
                            <span
                                className={
                                    i === crumbs.length - 1
                                        ? "text-foreground font-medium capitalize"
                                        : "capitalize"
                                }
                            >
                                {c.replace(/-/g, " ")}
                            </span>
                        </React.Fragment>
                    ))
                )}
            </div>
        </div>
    );
}

export default function AppShell({ children }) {
    return (
        <div className="flex min-h-screen bg-background text-foreground">
            <Sidebar />
            <div className="flex-1 min-w-0 flex flex-col">
                <Header />
                <main className="flex-1 p-6 md:p-8 animate-fade-in">{children}</main>
            </div>
        </div>
    );
}
