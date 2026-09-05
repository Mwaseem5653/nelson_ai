import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "@/api/client";

const AuthCtx = createContext(null);

// Cache roles in memory
let rolesCache = null;
let rolesCacheTimestamp = 0;
const CACHE_DURATION = 60000; // 1 minute

async function getRoles() {
    // Return cached roles if fresh
    if (rolesCache && (Date.now() - rolesCacheTimestamp) < CACHE_DURATION) {
        return rolesCache;
    }
    
    try {
        const { data } = await api.get("/roles");
        rolesCache = data;
        rolesCacheTimestamp = Date.now();
        // Also store in localStorage for quick access
        localStorage.setItem('user_roles', JSON.stringify(data));
        return data;
    } catch (error) {
        console.error('Error fetching roles:', error);
        // Try to get from localStorage as fallback
        const stored = localStorage.getItem('user_roles');
        if (stored) {
            try {
                return JSON.parse(stored);
            } catch (e) {
                return [];
            }
        }
        return [];
    }
}

// Synchronous version for components (uses localStorage cache)
function getRolesSync() {
    const stored = localStorage.getItem('user_roles');
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            return [];
        }
    }
    return [];
}

export function hasPerm(user, formCode, action = "view") {
    if (!user || user === false) return false;
    
    // SuperAdmin has all permissions
    if (user.type === "SuperAdmin") return true;
    
    // Admin users have all permissions
    if (user.type === "Admin") return true;
    
    // If user has a role, check role permissions
    if (user.role_id) {
        // Get roles from localStorage
        const roles = getRolesSync();
        const role = roles.find(r => r.id === user.role_id);
        
        if (role) {
            // If role name contains "admin" (case insensitive), grant all permissions
            if (role.name && role.name.toLowerCase().includes('admin')) {
                return true;
            }
            
            // Check specific form permission
            if (role.permissions && Array.isArray(role.permissions)) {
                const perm = role.permissions.find(p => p.form_code === formCode);
                if (perm) {
                    return perm[action] === true;
                }
            }
        }
    }
    
    // Fallback: check if permissions are directly on user (backward compatibility)
    const p = (user.permissions || []).find((x) => x.form_code === formCode);
    return !!(p && p[action]);
}

// Async version for when you need to fetch fresh data
export async function hasPermAsync(user, formCode, action = "view") {
    if (!user || user === false) return false;
    if (user.type === "SuperAdmin") return true;
    if (user.type === "Admin") return true;
    
    if (user.role_id) {
        try {
            const roles = await getRoles();
            const role = roles.find(r => r.id === user.role_id);
            
            if (role) {
                if (role.name && role.name.toLowerCase().includes('admin')) {
                    return true;
                }
                if (role.permissions) {
                    const perm = role.permissions.find(p => p.form_code === formCode);
                    if (perm) {
                        return perm[action] === true;
                    }
                }
            }
        } catch (error) {
            console.error('Error checking permissions:', error);
        }
        return false;
    }
    
    const p = (user.permissions || []).find((x) => x.form_code === formCode);
    return !!(p && p[action]);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null); // null=loading, false=anon, obj=user
    const [error, setError] = useState("");

    const refresh = useCallback(async () => {
        try {
            const { data } = await api.get("/auth/me");
            setUser(data);
            
            // Pre-fetch roles and cache them
            if (data && data.role_id) {
                try {
                    const { data: rolesData } = await api.get("/roles");
                    localStorage.setItem('user_roles', JSON.stringify(rolesData));
                    rolesCache = rolesData;
                    rolesCacheTimestamp = Date.now();
                } catch (e) {
                    console.error('Error pre-fetching roles:', e);
                }
            }
        } catch {
            setUser(false);
        }
    }, []);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const login = async (login_id, password) => {
        setError("");
        try {
            const { data } = await api.post("/auth/login", { login_id, password });
            if (data.access_token) localStorage.setItem("nelson_token", data.access_token);
            // Re-fetch /auth/me so we get the enriched user (with permissions)
            await refresh();
            return true;
        } catch (e) {
            setError(formatApiError(e));
            return false;
        }
    };

    const logout = async () => {
        try {
            await api.post("/auth/logout");
        } catch {}
        localStorage.removeItem("nelson_token");
        localStorage.removeItem("user_roles");
        setUser(false);
    };

    const can = (formCode, action = "view") => hasPerm(user, formCode, action);

    return (
        <AuthCtx.Provider value={{ user, error, login, logout, refresh, can }}>
            {children}
        </AuthCtx.Provider>
    );
}

export function useAuth() {
    return useContext(AuthCtx);
}