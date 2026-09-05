import React, { useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LockKey, User as UserIcon } from "@phosphor-icons/react";

export default function LoginPage() {
    const { login, error, user } = useAuth();
    const [loginId, setLoginId] = useState("");
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const nav = useNavigate();

    if (user && user !== false) return <Navigate to="/dashboard" replace />;

    const submit = async (e) => {
        e.preventDefault();
        setBusy(true);
        const ok = await login(loginId, password);
        setBusy(false);
        if (ok) nav("/dashboard");
    };

    return (
        <div className="min-h-screen grid md:grid-cols-2">
            {/* Left brand panel */}
            <div
                className="relative hidden md:flex flex-col justify-between p-10 text-white"
                style={{ background: "linear-gradient(135deg, #0A0A0A 0%, #14161f 100%)" }}
                data-testid="login-brand-panel"
            >
                <div className="absolute inset-0 grid-lines-bg opacity-[0.08] pointer-events-none" aria-hidden="true" />
                <div className="relative flex items-center gap-3">
                    <div className="h-10 w-10 grid place-items-center bg-brand text-white font-black rounded-[3px]">N</div>
                    <div>
                        <div className="font-heading font-black text-lg leading-none">NELSON</div>
                        <div className="text-[10px] tracking-[0.18em] uppercase text-white/50 mt-1">
                            Order Chatbot
                        </div>
                    </div>
                </div>
                <div className="relative space-y-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                        Multi-tenant · AI-powered · WhatsApp
                    </div>
                    <h1 className="font-heading font-black text-4xl leading-[1.05]">
                        Book orders <br />
                        with a single <span className="text-brand">message.</span>
                    </h1>
                    <p className="text-sm text-white/60 max-w-md">
                        Employees send Text, Voice, or Image on WhatsApp — AI extracts the order,
                        matches customers &amp; items, and confirms in seconds.
                    </p>
                </div>
                <div className="relative text-[11px] text-white/40 tracking-wider">
                    © NELSON · v1.0
                </div>
            </div>

            {/* Right form panel */}
            <div className="flex items-center justify-center p-6 md:p-10">
                <form
                    onSubmit={submit}
                    className="w-full max-w-sm card-flat p-8 space-y-6"
                    data-testid="login-form"
                >
                    <div>
                        <div className="label-cap">Sign In</div>
                        <h2 className="font-heading font-black text-2xl mt-1">Welcome back</h2>
                        <p className="text-sm text-muted-foreground mt-1">
                            Enter your credentials to access the admin panel.
                        </p>
                    </div>

                    <div className="space-y-3">
                        <div>
                            <Label htmlFor="login_id" className="label-cap">
                                Login ID
                            </Label>
                            <div className="relative mt-1.5">
                                <UserIcon
                                    size={15}
                                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <Input
                                    id="login_id"
                                    data-testid="login-input-id"
                                    value={loginId}
                                    onChange={(e) => setLoginId(e.target.value)}
                                    placeholder="e.g. admin"
                                    className="pl-8"
                                    autoFocus
                                    autoComplete="username"
                                    required
                                />
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="password" className="label-cap">
                                Password
                            </Label>
                            <div className="relative mt-1.5">
                                <LockKey
                                    size={15}
                                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                                    aria-hidden="true"
                                />
                                <Input
                                    id="password"
                                    data-testid="login-input-password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="pl-8"
                                    autoComplete="current-password"
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div
                            data-testid="login-error"
                            className="text-[12px] text-destructive bg-destructive/10 border border-destructive/30 rounded px-3 py-2"
                        >
                            {error}
                        </div>
                    )}

                    <Button
                        type="submit"
                        data-testid="login-submit-btn"
                        disabled={busy}
                        className="w-full bg-brand hover:bg-brand-hover text-white font-semibold"
                    >
                        {busy ? "Signing in…" : "Sign In"}
                    </Button>

                    <div className="text-[11px] text-muted-foreground border-t border-border pt-4 space-y-1">
                        <div className="label-cap">Seeded test accounts</div>
                        <div>
                            SuperAdmin: <code className="font-mono">superadmin</code> /{" "}
                            <code className="font-mono">SuperAdmin@123</code>
                        </div>
                        <div>
                            Admin (Demo Co): <code className="font-mono">admin</code> /{" "}
                            <code className="font-mono">Admin@123</code>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
