/**
 * Thin typed wrapper around window.addonAPI (Mosaic addon preload).
 * All node registry access goes through nodes:read permission.
 */

export type AddonInitResult = {
  addonId: string;
  manifest: unknown;
  theme?: { mode?: string; [k: string]: unknown };
  app?: { version?: string; [k: string]: unknown };
};

export type HypercycleNode = {
  id: string;
  name?: string;
  apiHost?: string;
  apiPort?: string | number;
  network?: string;
  senderAddress?: string;
  licenseKey?: string;
  tags?: string;
  isActive?: boolean;
  aimPort?: string | number;
  [k: string]: unknown;
};

declare global {
  interface Window {
    addonAPI?: {
      init: () => Promise<AddonInitResult>;
      nodes?: {
        list: () => Promise<HypercycleNode[]>;
        getSavedAims?: (license?: string) => Promise<unknown>;
      };
    };
  }
}

export async function initAddon(): Promise<AddonInitResult> {
  if (!window.addonAPI?.init) {
    throw new Error("window.addonAPI is not available. Open this page inside Mosaic as an installed addon.");
  }
  return window.addonAPI.init();
}

export async function listNodes(): Promise<HypercycleNode[]> {
  if (!window.addonAPI?.nodes?.list) {
    throw new Error("addonAPI.nodes.list is not available (need nodes:read permission).");
  }
  const result = await window.addonAPI.nodes.list();
  return Array.isArray(result) ? result : [];
}

/** Probe node HTTP /health with a short timeout (renderer-side fetch). */
export async function probeHealth(
  host: string,
  port: string | number,
  timeoutMs = 4000
): Promise<{ ok: boolean; latencyMs: number; status?: number; error?: string }> {
  const base = `http://${host}:${port}`;
  const started = performance.now();
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/health`, { signal: ctrl.signal, method: "GET" });
    const latencyMs = Math.round(performance.now() - started);
    return { ok: res.ok, latencyMs, status: res.status };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    return {
      ok: false,
      latencyMs,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    window.clearTimeout(timer);
  }
}
