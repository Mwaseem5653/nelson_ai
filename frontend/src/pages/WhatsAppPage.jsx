import React, { useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "@/api/client";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import {
    WhatsappLogo, QrCode, LinkSimpleBreak, ArrowClockwise,
    LinkSimple, PaperPlaneTilt, Robot,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth, hasPerm } from "@/auth/AuthContext";

const STATUS_MAP = {
    ready: { label: "Linked", tone: "ok" },
    authenticated: { label: "Connecting…", tone: "warn" },
    waiting_qr: { label: "Scan QR code", tone: "warn" },
    starting: { label: "Starting…", tone: "warn" },
    restarting: { label: "Restarting…", tone: "warn" },
    disconnected: { label: "Disconnected", tone: "err" },
    auth_failure: { label: "Auth failure", tone: "err" },
    init_error: { label: "Init error", tone: "err" },
    bridge_unreachable: { label: "Bridge offline", tone: "err" },
};

export default function WhatsAppPage() {
    const { user } = useAuth();
    const canManage = user?.type === "SuperAdmin" || user?.type === "Admin";

    const [state, setState] = useState({ status: "starting", qr: null, ready: false });
    const [messages, setMessages] = useState([]);
    const [loading, setLoading] = useState(false);

    // Simulator inputs
    const [simFrom, setSimFrom] = useState("");
    const [simBody, setSimBody] = useState("");
    const [simBusy, setSimBusy] = useState(false);
    const [lastSim, setLastSim] = useState(null);

    const loadStatus = useCallback(async () => {
        try {
            const { data } = await api.get("/whatsapp/status");
            setState(data);
        } catch (e) {
            setState({ status: "bridge_unreachable", qr: null, ready: false });
        }
    }, []);

    const loadMessages = useCallback(async () => {
        try {
            const { data } = await api.get("/whatsapp/messages?limit=25");
            setMessages(data || []);
        } catch {}
    }, []);

    useEffect(() => {
        loadStatus();
        loadMessages();
        const iv = setInterval(() => { loadStatus(); loadMessages(); }, 4000);
        return () => clearInterval(iv);
    }, [loadStatus, loadMessages]);

    const restart = async () => {
        setLoading(true);
        try {
            await api.post("/whatsapp/restart");
            toast.success("Restarting WhatsApp session…");
            setTimeout(loadStatus, 2000);
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setLoading(false);
        }
    };

    const simulate = async () => {
        if (!simFrom.trim() || !simBody.trim()) {
            toast.error("Enter a WhatsApp number and a message");
            return;
        }
        setSimBusy(true); setLastSim(null);
        try {
            const raw = simFrom.replace(/\D/g, "");
            const from_number = `${raw}@c.us`;
            const { data } = await api.post("/whatsapp/simulate", { from_number, body: simBody });
            setLastSim(data);
            const action = data?.result?.action || "processed";
            toast.success(`Simulated: ${action.replace(/_/g, " ")}`);
            loadMessages();
        } catch (e) {
            toast.error(formatApiError(e));
        } finally {
            setSimBusy(false);
        }
    };

    const st = STATUS_MAP[state.status] || { label: state.status, tone: "warn" };
    const badgeCls =
        st.tone === "ok"
            ? "border-emerald-300 text-emerald-800 bg-emerald-50"
            : st.tone === "err"
            ? "border-red-300 text-red-700 bg-red-50"
            : "border-amber-300 text-amber-800 bg-amber-50";

    return (
        <div className="space-y-6" data-testid="whatsapp-page">
            <div className="flex items-end justify-between gap-3">
                <div>
                    <div className="label-cap">Integration</div>
                    <h1 className="font-heading font-black text-2xl mt-1">WhatsApp Connection</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Link your WhatsApp Web session. Once linked, employee messages route through
                        Gemini 3 Flash and land on the Sales Orders page after confirmation.
                    </p>
                </div>
                {canManage && (
                    <Button
                        variant="outline"
                        className="h-9 gap-1.5"
                        onClick={restart}
                        disabled={loading}
                        data-testid="wa-restart-btn"
                    >
                        <ArrowClockwise size={14} /> {loading ? "Restarting…" : "Restart Session"}
                    </Button>
                )}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                {/* Session status + QR */}
                <Card className="card-flat">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="font-heading text-base flex items-center gap-2">
                                <WhatsappLogo size={18} weight="fill" className="text-emerald-500" />
                                Session Status
                            </CardTitle>
                            <Badge variant="outline" className={badgeCls} data-testid="wa-status-badge">
                                {state.ready ? (
                                    <LinkSimple size={12} className="mr-1" />
                                ) : (
                                    <LinkSimpleBreak size={12} className="mr-1" />
                                )}
                                {st.label}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="border border-dashed border-border rounded-md p-4 min-h-[280px] flex flex-col items-center justify-center text-center">
                            {state.qr ? (
                                <>
                                    <img
                                        data-testid="wa-qr-image"
                                        src={state.qr}
                                        alt="Scan WhatsApp QR"
                                        className="w-[240px] h-[240px] rounded-sm"
                                    />
                                    <div className="text-xs text-muted-foreground mt-3 max-w-xs">
                                        Open WhatsApp on the company phone → <b>Linked Devices</b> →{" "}
                                        <b>Link a device</b> → scan this QR.
                                    </div>
                                </>
                            ) : state.ready ? (
                                <>
                                    <div className="h-16 w-16 grid place-items-center rounded-full bg-emerald-50 text-emerald-600">
                                        <WhatsappLogo size={32} weight="fill" />
                                    </div>
                                    <div className="mt-3 font-heading font-black text-lg">Linked & Ready</div>
                                    <div className="text-xs text-muted-foreground max-w-xs mt-1">
                                        The bridge is authenticated. Employee messages will now flow into Gemini automatically.
                                    </div>
                                </>
                            ) : state.status === "bridge_unreachable" ? (
                                <>
                                    <QrCode size={48} className="text-muted-foreground mb-3" />
                                    <div className="label-cap mb-1">Bridge Offline</div>
                                    <div className="text-xs text-muted-foreground max-w-xs">
                                        The <code className="font-mono">wa-bridge</code> service isn't reachable.
                                        Use the simulator below to test the pipeline while it comes online.
                                    </div>
                                </>
                            ) : (
                                <>
                                    <QrCode size={48} className="text-muted-foreground mb-3 animate-pulse" />
                                    <div className="label-cap mb-1">{st.label}</div>
                                    <div className="text-xs text-muted-foreground max-w-xs">
                                        Waiting for the WhatsApp bridge to generate a QR code. This can take
                                        30&ndash;60&nbsp;seconds on first boot.
                                    </div>
                                </>
                            )}
                        </div>
                    </CardContent>
                </Card>

                {/* Simulator */}
                <Card className="card-flat">
                    <CardHeader>
                        <CardTitle className="font-heading text-base flex items-center gap-2">
                            <Robot size={18} weight="regular" />
                            Test the Pipeline
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-xs text-muted-foreground">
                            Send a message as any employee's WhatsApp number to test the full extraction &
                            matching pipeline without needing to link WhatsApp.
                        </p>
                        <div className="space-y-1.5">
                            <Label className="label-cap">Employee WhatsApp Number</Label>
                            <Input
                                data-testid="wa-sim-from"
                                placeholder="e.g. 923001234567"
                                value={simFrom}
                                onChange={(e) => setSimFrom(e.target.value)}
                                className="h-9 font-mono"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="label-cap">Message</Label>
                            <textarea
                                data-testid="wa-sim-body"
                                value={simBody}
                                onChange={(e) => setSimBody(e.target.value)}
                                placeholder="Contoso Ltd — 3 bags Widget Pro, 2 kg Steel Rod"
                                rows={3}
                                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button
                                data-testid="wa-sim-send"
                                onClick={simulate}
                                disabled={simBusy}
                                className="bg-brand hover:bg-brand-hover text-white gap-1.5"
                            >
                                <PaperPlaneTilt size={14} weight="fill" />
                                {simBusy ? "Sending…" : "Simulate Inbound"}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => { setSimBody("YES"); }}
                                disabled={simBusy}
                            >
                                YES
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => { setSimBody("NO"); }}
                                disabled={simBusy}
                            >
                                NO
                            </Button>
                        </div>

                        {lastSim && (
                            <div className="border border-border rounded-md p-3 text-[12px] bg-muted/40" data-testid="wa-sim-result">
                                <div className="label-cap mb-1">Bot Response</div>
                                {lastSim.reply?.length > 0 ? (
                                    lastSim.reply.map((r, i) => (
                                        <pre key={i} className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
{r.body}
                                        </pre>
                                    ))
                                ) : (
                                    <div className="text-muted-foreground">
                                        (Action: <code className="font-mono">{lastSim.result?.action}</code>)
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Recent WhatsApp Messages */}
            <Card className="card-flat">
                <CardHeader>
                    <CardTitle className="font-heading text-base">Recent WhatsApp Traffic</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-muted/40 hover:bg-muted/40">
                                    <TableHead className="label-cap py-2.5 w-[160px]">When</TableHead>
                                    <TableHead className="label-cap py-2.5 w-[80px]">Dir</TableHead>
                                    <TableHead className="label-cap py-2.5 w-[180px]">From</TableHead>
                                    <TableHead className="label-cap py-2.5">Body / Media</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {messages.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="py-10 text-center text-muted-foreground text-sm">
                                            No messages yet. Send a simulator message above to test.
                                        </TableCell>
                                    </TableRow>
                                ) : messages.map((m) => (
                                    <TableRow key={m.id} className="text-[12px]" data-testid={`wa-msg-${m.id}`}>
                                        <TableCell className="py-2 font-mono">
                                            {new Date(m.created_at).toLocaleString(undefined, { hour12: false })}
                                        </TableCell>
                                        <TableCell className="py-2">
                                            <Badge variant="outline" className="text-[10px]">
                                                {m.direction || "in"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="py-2 font-mono">{m.wa_from}</TableCell>
                                        <TableCell className="py-2">
                                            {m.body || (m.media_mime ? <span className="italic text-muted-foreground">[{m.media_mime}]</span> : "—")}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* How-it-works panel */}
            <Card className="card-flat">
                <CardHeader><CardTitle className="font-heading text-base">How the pipeline works</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-3 text-muted-foreground">
                    <Row n="1" text="Employee sends text / voice / image / PDF to the linked WhatsApp Web session." />
                    <Row n="2" text="Sender's WhatsApp number is matched against the Employee master." />
                    <Row n="3" text="Message routes to Gemini 3 Flash — text goes in-line, voice/image/PDF as file attachments." />
                    <Row n="4" text="Extracted customer + items are matched against the employee's Allowed lists." />
                    <Row n="5" text='Employee gets a "Reply YES to confirm" message; on YES we persist the order.' />
                </CardContent>
            </Card>
        </div>
    );
}

function Row({ n, text }) {
    return (
        <div className="flex gap-3">
            <div className="h-6 w-6 shrink-0 grid place-items-center rounded-[3px] bg-secondary text-foreground text-[12px] font-semibold">{n}</div>
            <div className="pt-0.5">{text}</div>
        </div>
    );
}
