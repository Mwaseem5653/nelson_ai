import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

export default function ProtectedRoute({ children }) {
    const { user } = useAuth();
    if (user === null)
        return (
            <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
                Loading…
            </div>
        );
    if (user === false) return <Navigate to="/login" replace />;
    return children;
}
