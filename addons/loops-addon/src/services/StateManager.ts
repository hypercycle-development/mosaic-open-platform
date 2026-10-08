/**
 * StateManager — persistent cross-run state for Stargate loops.
 *
 * Two durable artifacts per loop, modeled on loop-engineering best practice:
 *   - STATE.md  : what's true right now (current iteration, last outcomes, known issues)
 *   - VISION.md : where this loop is headed (goal contract, success conditions, do-not-drift boundary)
 *
 * Plus an append-only run ledger (JSONL) so every run's result, learnings and
 * failure modes survive session restarts. All three live in the host Vault via
 * the mosaicAPI bridge, so a Node Factory owner can pick up a loop exactly
 * where it left off after a reboot.
 *
 * Storage layout (Vault):
 *   box:     "stargate-loops"
 *   entry:   "<loop-id>/STATE.md"      (current state, markdown)
 *   entry:   "<loop-id>/VISION.md"     (goal contract, markdown)
 *   entry:   "<loop-id>/runs.jsonl"    (append-only ledger, one JSON per line)
 */

export interface LoopStateSnapshot {
  loopId: string;
  iteration: number;
  goal: string;
  lastOutcome: "success" | "failure" | "partial" | "unknown";
  knownIssues: string[];
  openQuestions: string[];
  /** Free-form notes the loop itself appended */
  notes: string;
  updatedAt: number;
}

export interface LoopVisionContract {
  loopId: string;
  destination: string;              // the long-term goal this loop keeps re-centering on
  successCondition: string;         // what "done" looks like — checked by a fresh evaluator model
  antiGoal: string;                 // what this loop must never optimize for (drift guard)
  createdAt: number;
  updatedAt: number;
}

export interface LoopRunRecord {
  loopId: string;
  runId: string;
  iteration: number;
  startedAt: number;
  finishedAt: number;
  outcome: "success" | "failure" | "partial";
  /** What this run produced or changed */
  outputs: string[];
  /** Learnings worth keeping (one-liners) */
  learnings: string[];
  /** Failure modes hit this run, if any */
  failureModes: string[];
  /** IDs of graph nodes that completed, for resume */
  completedNodeIds: string[];
}

/* ---------- Vault bridge typing (minimal, mirrors graph-addon) ---------- */
type VaultBoxes = { id: string; name: string }[];
interface VaultEntry { id: string; boxId: string; name: string; content?: string }
declare global {
  interface Window {
    mosaicAPI?: {
      vault?: {
        listBoxes?: () => Promise<VaultBoxes>;
        createBox?: (name: string) => Promise<{ id: string }>;
        listEntries?: (boxId: string) => Promise<VaultEntry[]>;
        getEntry?: (entryId: string) => Promise<VaultEntry & { content: string }>;
        putEntry?: (boxId: string, name: string, content: string) => Promise<VaultEntry>;
        updateEntry?: (entryId: string, patch: { content?: string; name?: string }) => Promise<void>;
        findByName?: (boxId: string, name: string) => Promise<VaultEntry | null>;
      };
    };
  }
}

const BOX_NAME = "stargate-loops";
const memoryFallback = new Map<string, string>(); // used when Vault bridge is absent (dev/preview)

function vaultBridge() {
  return typeof window !== "undefined" ? window.mosaicAPI?.vault : undefined;
}

async function ensureBox(): Promise<string | null> {
  const v = vaultBridge();
  if (!v?.listBoxes) return null;
  const boxes = await v.listBoxes();
  const existing = boxes.find((b) => b.name === BOX_NAME);
  if (existing) return existing.id;
  if (!v.createBox) return null;
  return (await v.createBox(BOX_NAME)).id;
}

async function readEntry(name: string): Promise<string | null> {
  const v = vaultBridge();
  const boxId = await ensureBox();
  if (!v || !boxId) return memoryFallback.get(name) ?? null;
  let entry: VaultEntry | null = null;
  if (v.findByName) entry = await v.findByName(boxId, name);
  else if (v.listEntries) entry = (await v.listEntries(boxId)).find((e) => e.name === name) ?? null;
  if (!entry) return null;
  const full = v.getEntry ? await v.getEntry(entry.id) : entry;
  return full?.content ?? null;
}

async function writeEntry(name: string, content: string): Promise<void> {
  const v = vaultBridge();
  const boxId = await ensureBox();
  if (!v || !boxId) { memoryFallback.set(name, content); return; }
  let entry: VaultEntry | null = null;
  if (v.findByName) entry = await v.findByName(boxId, name);
  else if (v.listEntries) entry = (await v.listEntries(boxId)).find((e) => e.name === name) ?? null;
  if (entry && v.updateEntry) await v.updateEntry(entry.id, { content });
  else if (!entry && v.putEntry) await v.putEntry(boxId, name, content);
}

/* ------------------------------- Rendering ------------------------------ */

function stateToMarkdown(s: LoopStateSnapshot): string {
  return [
    `# STATE — ${s.loopId}`,
    "",
    `> Auto-managed by Stargate StateManager. Updated: ${new Date(s.updatedAt).toISOString()}`,
    "",
    `- Loop: \`${s.loopId}\``,
    `- Iteration: **${s.iteration}**`,
    `- Goal: ${s.goal}`,
    `- Last outcome: **${s.lastOutcome}**`,
    "",
    "## Known issues",
    ...(s.knownIssues.length ? s.knownIssues.map((i) => `- [ ] ${i}`) : ["- (none)"]),
    "",
    "## Open questions",
    ...(s.openQuestions.length ? s.openQuestions.map((q) => `- [ ] ${q}`) : ["- (none)"]),
    "",
    "## Notes",
    s.notes || "(empty)",
    "",
  ].join("\n");
}

function visionToMarkdown(v: LoopVisionContract): string {
  return [
    `# VISION — ${v.loopId}`,
    "",
    "## Destination (the long-term goal)",
    v.destination,
    "",
    "## Success condition (checked by a fresh evaluator model)",
    v.successCondition,
    "",
    "## Anti-goal (what this loop must NEVER optimize for)",
    v.antiGoal,
    "",
    `> Created: ${new Date(v.createdAt).toISOString()} · Updated: ${new Date(v.updatedAt).toISOString()}`,
    "",
  ].join("\n");
}

/* ------------------------------- The service ---------------------------- */

export class StateManager {
  private static key(loopId: string, kind: "STATE.md" | "VISION.md" | "runs.jsonl") {
    return `${loopId}/${kind}`;
  }

  /** Load persisted state, or a fresh snapshot if this loop has never run. */
  static async loadState(loopId: string, goal: string): Promise<LoopStateSnapshot> {
    const raw = await readEntry(this.key(loopId, "STATE.md"));
    if (!raw) {
      return { loopId, iteration: 0, goal, lastOutcome: "unknown", knownIssues: [], openQuestions: [], notes: "", updatedAt: Date.now() };
    }
    const m = (re: RegExp) => raw.match(re)?.[1]?.trim();
    const list = (section: string) => {
      const match = raw.match(new RegExp(`## ${section}\\s*\\n([\\s\\S]*?)(?:\\n## |$)`));
      const body = match?.[1] ?? "";
      return body.split("\n").filter((l) => l.startsWith("- [ ]")).map((l) => l.replace(/^- \[ \] /, ""));
    };
    return {
      loopId,
      iteration: Number(m(/Iteration:\*\* (\d+)/) ?? 0),
      goal: m(/Goal: (.+)/) ?? goal,
      lastOutcome: (m(/Last outcome:\*\* (\w+)/) as LoopStateSnapshot["lastOutcome"]) ?? "unknown",
      knownIssues: list("Known issues"),
      openQuestions: list("Open questions"),
      notes: raw.split("## Notes")[1]?.trim() ?? "",
      updatedAt: Date.now(),
    };
  }

  static async saveState(s: LoopStateSnapshot): Promise<void> {
    await writeEntry(this.key(s.loopId, "STATE.md"), stateToMarkdown({ ...s, updatedAt: Date.now() }));
  }

  /** Create or refresh the loop's goal contract. */
  static async saveVision(v: Omit<LoopVisionContract, "createdAt" | "updatedAt"> & { createdAt?: number }): Promise<LoopVisionContract> {
    const full: LoopVisionContract = { ...v, createdAt: v.createdAt ?? Date.now(), updatedAt: Date.now() };
    await writeEntry(this.key(full.loopId, "VISION.md"), visionToMarkdown(full));
    return full;
  }

  static async loadVision(loopId: string): Promise<LoopVisionContract | null> {
    const raw = await readEntry(this.key(loopId, "VISION.md"));
    if (!raw) return null;
    const grab = (h: string) => raw.match(new RegExp(`## ${h}[^\n]*\\n([\\s\\S]*?)(?:\\n## |\\n> |$)`))?.[1]?.trim() ?? "";
    return {
      loopId,
      destination: grab("Destination"),
      successCondition: grab("Success condition"),
      antiGoal: grab("Anti-goal"),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  /** Append one run to the ledger. Durable; read back with loadRuns(). */
  static async appendRun(r: LoopRunRecord): Promise<void> {
    const key = this.key(r.loopId, "runs.jsonl");
    const existing = (await readEntry(key)) ?? "";
    const line = JSON.stringify(r);
    await writeEntry(key, existing.endsWith("\n") || existing === "" ? existing + line + "\n" : existing + "\n" + line + "\n");
  }

  static async loadRuns(loopId: string): Promise<LoopRunRecord[]> {
    const raw = await readEntry(this.key(loopId, "runs.jsonl"));
    if (!raw) return [];
    return raw.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line) as LoopRunRecord; } catch { return null; }
    }).filter((x): x is LoopRunRecord => x !== null);
  }

  /**
   * Resume helper: which nodeIds already finished across prior runs, so the
   * executor can skip completed work and continue mid-graph after a reboot.
   */
  static async completedNodeSet(loopId: string): Promise<Set<string>> {
    const runs = await this.loadRuns(loopId);
    const set = new Set<string>();
    for (const r of runs) for (const n of r.completedNodeIds) set.add(n);
    return set;
  }

  /** Latest recorded iteration (0 when brand-new). */
  static async lastIteration(loopId: string): Promise<number> {
    const runs = await this.loadRuns(loopId);
    return runs.length ? Math.max(...runs.map((r) => r.iteration)) : 0;
  }
}
