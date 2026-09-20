import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Server,
  Settings2,
  XCircle,
} from "lucide-react";
import { initAddon, listNodes, probeHealth, type HypercycleNode } from "./addonApi";

type Tab = "overview" | "nodes" | "alerts" | "settings";
type Probe = { ok: boolean; latencyMs: number; status?: number; error?: string; at: string };

const NAV: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "nodes", label: "Nodes", icon: Server },
  { id: "alerts", label: "Alerts", icon: AlertTriangle },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "bad" | "warn" | "neutral";
}) {
  const c = {
    good: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    bad: "border-red-400/20 bg-red-400/10 text-red-300",
    warn: "border-amber-400/20 bg-amber-400/10 text-amber-300",
    neutral: "border-white/10 bg-white/5 text-slate-400",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${c}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[.035] ${className}`}>{children}</section>
  );
}

function hostOf(n: HypercycleNode): string {
  return String(n.apiHost || "127.0.0.1");
}
function portOf(n: HypercycleNode): string {
  return String(n.apiPort ?? "8000");
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [nodes, setNodes] = useState<HypercycleNode[]>([]);
  const [probes, setProbes] = useState<Record<string, Probe>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [appInfo, setAppInfo] = useState("");

  const refreshNodes = useCallback(async () => {
    try {
      const list = await listNodes();
      setNodes(list);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const init = await initAddon();
        if (cancelled) return;
        setAppInfo(
          [init.addonId, init.app?.version ? `app ${init.app.version}` : ""].filter(Boolean).join(" · ")
        );
        setReady(true);
        await refreshNodes();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshNodes]);

  const testOne = useCallback(async (n: HypercycleNode) => {
    const result = await probeHealth(hostOf(n), portOf(n));
    const probe: Probe = { ...result, at: new Date().toISOString() };
    setProbes((prev) => ({ ...prev, [n.id]: probe }));
    return probe;
  }, []);

  const testAll = useCallback(async () => {
    setBusy(true);
    setNotice("Testing fleet...");
    try {
      const active = nodes.filter((n) => n.isActive !== false);
      await Promise.all(active.map((n) => testOne(n)));
      setNotice(`Tested ${active.length} node(s).`);
    } finally {
      setBusy(false);
    }
  }, [nodes, testOne]);

  const stats = useMemo(() => {
    const active = nodes.filter((n) => n.isActive !== false);
    let alive = 0;
    let dead = 0;
    for (const n of active) {
      const p = probes[n.id];
      if (!p) continue;
      if (p.ok) alive += 1;
      else dead += 1;
    }
    return { total: nodes.length, active: active.length, alive, dead, untested: active.length - alive - dead };
  }, [nodes, probes]);

  if (!ready && !error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        Initializing Fleet Manager...
      </div>
    );
  }

  if (error && !ready) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <XCircle className="text-red-400" size={28} />
        <p className="text-sm text-red-300">{error}</p>
        <p className="max-w-md text-[11px] text-slate-500">
          Install this addon via Mosaic Configuration → Addons → Install unpacked, pointing at the folder that
          contains manifest.json. Requires permission nodes:read.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#07090d] text-slate-200">
      {/* Side nav */}
      <nav className="flex w-44 shrink-0 flex-col border-r border-white/10 bg-black/30 p-3">
        <div className="mb-4 px-1">
          <div className="text-xs font-semibold tracking-wide text-white">Fleet Manager</div>
          <div className="mt-0.5 truncate text-[9px] text-slate-600">{appInfo || "addon"}</div>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const on = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] transition ${
                  on ? "bg-sky-400/15 text-sky-200" : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon size={14} />
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-black/20 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-white">
                {NAV.find((n) => n.id === tab)?.label}
              </h1>
              <Badge tone="good">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> LIVE
              </Badge>
            </div>
            <p className="mt-0.5 text-[10px] text-slate-500">
              {stats.alive}/{stats.active} active nodes online · registry from Mosaic
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || stats.active === 0}
              onClick={() => void testAll()}
              className="rounded-xl border border-white/10 bg-white/[.05] px-3 py-2 text-[10px] font-semibold text-slate-200 hover:bg-white/[.09] disabled:opacity-40"
            >
              <Activity size={12} className="mr-1 inline" />
              {busy ? "Testing..." : "Test fleet"}
            </button>
            <button
              type="button"
              onClick={() => void refreshNodes()}
              className="rounded-xl border border-sky-400/20 bg-sky-400/[.06] px-3 py-2 text-[10px] font-semibold text-sky-200"
            >
              <RefreshCw size={12} className="mr-1 inline" />
              Refresh
            </button>
          </div>
        </header>

        {notice && (
          <div className="mx-4 mt-3 flex items-center justify-between rounded-xl border border-sky-400/10 bg-sky-400/[.04] px-3 py-2 text-[10px] text-sky-200">
            <span>{notice}</span>
            <button type="button" className="text-slate-600" onClick={() => setNotice("")}>
              ×
            </button>
          </div>
        )}
        {error && (
          <div className="mx-4 mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-[10px] text-red-200">
            {error}
          </div>
        )}

        <main className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "overview" && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Total nodes</div>
                <div className="mt-2 text-2xl font-semibold text-white">{stats.total}</div>
              </Card>
              <Card className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Active</div>
                <div className="mt-2 text-2xl font-semibold text-white">{stats.active}</div>
              </Card>
              <Card className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Alive</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-300">{stats.alive}</div>
              </Card>
              <Card className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">Dead / untested</div>
                <div className="mt-2 text-2xl font-semibold text-red-300">
                  {stats.dead}
                  <span className="text-base text-slate-500"> / {stats.untested}</span>
                </div>
              </Card>
              <Card className="p-4 sm:col-span-2 lg:col-span-4">
                <div className="text-[11px] font-medium text-slate-300">About this addon</div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  Fleet Manager reads the local HyperCycle node registry via <code className="text-slate-400">addonAPI.nodes</code>{" "}
                  (permission <code className="text-slate-400">nodes:read</code>). Health probes call each node&apos;s{" "}
                  <code className="text-slate-400">/health</code> endpoint from the renderer. Add or edit nodes in Mosaic
                  Configuration; this tab does not store private keys.
                </p>
              </Card>
            </div>
          )}

          {tab === "nodes" && (
            <Card className="overflow-hidden">
              <div className="border-b border-white/10 px-4 py-3 text-[11px] text-slate-400">
                {nodes.length === 0
                  ? "No nodes in the Mosaic registry. Add nodes in Mosaic Configuration first."
                  : `${nodes.length} node(s) from registry`}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[11px]">
                  <thead className="bg-black/20 text-slate-500">
                    <tr>
                      <th className="p-3 font-medium">Name</th>
                      <th className="p-3 font-medium">Endpoint</th>
                      <th className="p-3 font-medium">Network</th>
                      <th className="p-3 font-medium">Status</th>
                      <th className="p-3 font-medium">Latency</th>
                      <th className="p-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {nodes.map((n) => {
                      const p = probes[n.id];
                      const tone = !p ? "neutral" : p.ok ? "good" : "bad";
                      const label = !p ? "UNTESTED" : p.ok ? "ALIVE" : "DEAD";
                      return (
                        <tr key={n.id} className="border-t border-white/5 hover:bg-white/[.03]">
                          <td className="p-3 font-medium text-slate-200">{n.name || n.id}</td>
                          <td className="p-3 text-slate-400">
                            {hostOf(n)}:{portOf(n)}
                          </td>
                          <td className="p-3 text-slate-400">{String(n.network || "--")}</td>
                          <td className="p-3">
                            <Badge tone={tone}>
                              {p?.ok ? <CheckCircle2 size={10} /> : p ? <XCircle size={10} /> : null}
                              {label}
                            </Badge>
                          </td>
                          <td className="p-3 text-slate-400">{p ? `${p.latencyMs} ms` : "--"}</td>
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => void testOne(n)}
                              className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/5"
                            >
                              Test
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {tab === "alerts" && (
            <Card className="p-4">
              <div className="text-[11px] font-medium text-slate-300">Alerts</div>
              <p className="mt-2 text-[11px] text-slate-500">
                Transition alerts (ALIVE → DEAD and the reverse) will appear here after fleet tests. Run{" "}
                <strong className="text-slate-400">Test fleet</strong> on the Dashboard or Nodes tab.
              </p>
              <ul className="mt-4 space-y-2">
                {nodes
                  .filter((n) => probes[n.id] && !probes[n.id].ok)
                  .map((n) => (
                    <li
                      key={n.id}
                      className="flex items-center gap-2 rounded-xl border border-red-400/15 bg-red-400/[.06] px-3 py-2 text-[11px] text-red-200"
                    >
                      <AlertTriangle size={14} />
                      <span>
                        {n.name || n.id} is DEAD ({probes[n.id]?.error || `HTTP ${probes[n.id]?.status}`})
                      </span>
                    </li>
                  ))}
                {nodes.every((n) => !probes[n.id] || probes[n.id].ok) && (
                  <li className="text-[11px] text-slate-600">No dead nodes reported yet.</li>
                )}
              </ul>
            </Card>
          )}

          {tab === "settings" && (
            <Card className="p-4">
              <div className="text-[11px] font-medium text-slate-300">Settings</div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Node create/edit lives in Mosaic Configuration (core app). This addon only reads the registry and
                probes public health endpoints. No private keys are stored here.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="neutral">nodes:read</Badge>
                <Badge tone="neutral">no main process</Badge>
                <Badge tone="neutral">MIT</Badge>
              </div>
            </Card>
          )}
        </main>
      </div>
    </div>
  );
}
