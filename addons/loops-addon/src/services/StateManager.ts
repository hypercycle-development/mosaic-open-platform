/**
 * StateManager — persistent cross-run state for Stargate loops.
 *
 * Two durable artifacts per loop, modeled on loop-engineering best practice:
 *   - STATE.md  : what's true right now (current iteration, last outcomes, known issues)
 *   - VISION.md : where this loop is headed (goal contract, success conditions, do-not-drift boundary)
 *
 * Plus an append-only run ledger (JSONL) so every run's result, learnings and
 * failure modes survive session restarts.
 *
 * Note: Vault persistence is NOT available via addonAPI (Dr. Robert confirmed
 * vault is not on the addonAPI surface). StateManager uses localStorage + in-memory
 * fallback. When Mosaic adds vault:read/vault:write permissions, persistence can
 * be upgraded.
 *
 * Storage layout (localStorage):
 *   key: "stargate-loops/<loop-id>/STATE.md"
 *   key: "stargate-loops/<loop-id>/VISION.md"
 *   key: "stargate-loops/<loop-id>/runs.jsonl"
 */

export interface LoopStateSnapshot {
  loopId: string;
  iteration: number;
  goal: string;
  lastOutcome: "success" | "failure" | "partial" | "unknown";
  knownIssues: string[];
  openQuestions: string[];
  notes: string;
  updatedAt: number;
}

export interface LoopVisionContract {
  loopId: string;
  destination: string;              // the long-term goal this loop keeps re-centering on
  successCondition: string;         // what "done" looks like — checked by a fresh evaluator model
  antiGoal: string;                 // what this loop must never optimize for (drift guard)
  createdAt?: number;
  updatedAt?: number;
}

export interface LoopRunRecord {
  loopId: string;
  runId: string;
  iteration: number;
  startedAt: number;
  finishedAt: number;
  outcome: "success" | "failure" | "partial";
  outputs: string[];
  learnings: string[];
  failureModes: string[];
  completedNodeIds: string[];
}

const memoryFallback = new Map<string, string>();

function getStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch { /* localStorage may be blocked in webview */ }
  return null;
}

async function readEntry(name: string): Promise<string | null> {
  const storage = getStorage();
  if (storage) {
    try { return storage.getItem(name); } catch { /* blocked */ }
  }
  return memoryFallback.get(name) ?? null;
}

async function writeEntry(name: string, content: string): Promise<void> {
  const storage = getStorage();
  if (storage) {
    try { storage.setItem(name, content); return; } catch { /* quota exceeded or blocked */ }
  }
  memoryFallback.set(name, content);
}

export class StateManager {
  private loopId: string;

  constructor(loopId: string) {
    this.loopId = loopId;
  }

  // Static convenience methods for when caller doesn't want to instantiate
  static async saveState(state: LoopStateSnapshot): Promise<void> {
    const mgr = new StateManager(state.loopId);
    await mgr.saveState(state);
  }

  static async saveVision(vision: LoopVisionContract): Promise<void> {
    const mgr = new StateManager(vision.loopId);
    await mgr.saveVision(vision);
  }

  private key(name: string) {
    return `stargate-loops/${this.loopId}/${name}`;
  }

  /* ── STATE.md ─────────────────────────────────────────────────────────── */

  async loadState(): Promise<LoopStateSnapshot | null> {
    const raw = await readEntry(this.key("STATE.md"));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LoopStateSnapshot;
    } catch {
      return null;
    }
  }

  async saveState(state: LoopStateSnapshot): Promise<void> {
    state.updatedAt = Date.now();
    await writeEntry(this.key("STATE.md"), JSON.stringify(state, null, 2));
  }

  async updateState(partial: Partial<LoopStateSnapshot>): Promise<LoopStateSnapshot | null> {
    const current = await this.loadState();
    if (!current) return null;
    const merged = { ...current, ...partial, loopId: this.loopId };
    await this.saveState(merged);
    return merged;
  }

  /* ── VISION.md ────────────────────────────────────────────────────────── */

  async loadVision(): Promise<LoopVisionContract | null> {
    const raw = await readEntry(this.key("VISION.md"));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as LoopVisionContract;
    } catch {
      return null;
    }
  }

  async saveVision(vision: LoopVisionContract): Promise<void> {
    vision.updatedAt = Date.now();
    await writeEntry(this.key("VISION.md"), JSON.stringify(vision, null, 2));
  }

  /* ── Run ledger (JSONL) ───────────────────────────────────────────────── */

  async appendRun(run: LoopRunRecord): Promise<void> {
    const line = JSON.stringify(run);
    const key = this.key("runs.jsonl");
    const existing = (await readEntry(key)) ?? "";
    await writeEntry(key, existing + line + "\n");
  }

  async listRuns(): Promise<LoopRunRecord[]> {
    const raw = await readEntry(this.key("runs.jsonl"));
    if (!raw) return [];
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as LoopRunRecord; } catch { return null; }
      })
      .filter((r): r is LoopRunRecord => r !== null);
  }

  async clearRuns(): Promise<void> {
    await writeEntry(this.key("runs.jsonl"), "");
  }

  /* ── Convenience ──────────────────────────────────────────────────────── */

  async createDefaultState(): Promise<LoopStateSnapshot> {
    const state: LoopStateSnapshot = {
      loopId: this.loopId,
      iteration: 0,
      goal: "",
      lastOutcome: "unknown",
      knownIssues: [],
      openQuestions: [],
      notes: "",
      updatedAt: Date.now(),
    };
    await this.saveState(state);
    return state;
  }

  async createDefaultVision(): Promise<LoopVisionContract> {
    const vision: LoopVisionContract = {
      loopId: this.loopId,
      destination: "",
      successCondition: "",
      antiGoal: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.saveVision(vision);
    return vision;
  }
}
