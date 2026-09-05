import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider } from "@/auth/AuthContext";
import ProtectedRoute from "@/auth/ProtectedRoute";
import AppShell from "@/components/AppShell";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import CompaniesPage from "@/pages/CompaniesPage";
import RolesPage from "@/pages/RolesPage";
import UsersPage from "@/pages/UsersPage";
import DepartmentsPage from "@/pages/DepartmentsPage";
import RoutesPage from "@/pages/RoutesPage";
import BrandsPage from "@/pages/BrandsPage";
import ProductsPage from "@/pages/ProductsPage";
import UnitsPage from "@/pages/UnitsPage";
import ItemsPage from "@/pages/ItemsPage";
import CustomersPage from "@/pages/CustomersPage";
import EmployeesPage from "@/pages/EmployeesPage";
import SalesOrdersPage from "@/pages/SalesOrdersPage";
import WhatsAppPage from "@/pages/WhatsAppPage";

const Guarded = ({ children }) => (
    <ProtectedRoute>
        <AppShell>{children}</AppShell>
    </ProtectedRoute>
);

function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Guarded><DashboardPage /></Guarded>} />
                    <Route path="/setup/companies" element={<Guarded><CompaniesPage /></Guarded>} />
                    <Route path="/setup/roles" element={<Guarded><RolesPage /></Guarded>} />
                    <Route path="/setup/users" element={<Guarded><UsersPage /></Guarded>} />
                    <Route path="/setup/departments" element={<Guarded><DepartmentsPage /></Guarded>} />
                    <Route path="/setup/routes" element={<Guarded><RoutesPage /></Guarded>} />
                    <Route path="/setup/brands" element={<Guarded><BrandsPage /></Guarded>} />
                    <Route path="/setup/products" element={<Guarded><ProductsPage /></Guarded>} />
                    <Route path="/setup/units" element={<Guarded><UnitsPage /></Guarded>} />
                    <Route path="/setup/items" element={<Guarded><ItemsPage /></Guarded>} />
                    <Route path="/setup/customers" element={<Guarded><CustomersPage /></Guarded>} />
                    <Route path="/setup/employees" element={<Guarded><EmployeesPage /></Guarded>} />
                    <Route path="/orders" element={<Guarded><SalesOrdersPage /></Guarded>} />
                    <Route path="/whatsapp" element={<Guarded><WhatsAppPage /></Guarded>} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
                <Toaster
                    position="bottom-right"
                    theme="light"
                    toastOptions={{
                        className: "font-sans",
                        style: {
                            borderRadius: "4px",
                            border: "1px solid hsl(var(--border))",
                        },
                    }}
                />
            </BrowserRouter>
        </AuthProvider>
    );
}

export default App;
