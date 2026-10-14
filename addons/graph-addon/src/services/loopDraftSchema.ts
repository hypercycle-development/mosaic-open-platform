/**
 * loop-draft payload schema — the Loops → Graph contract.
 *
 * KEEP IDENTICAL to addons/loops-addon/src/services/bucketPayload.ts.
 * graph-addon and loops-addon are separate packages with separate builds and no
 * shared dependency, so Graph carries its own copy of the reader side. Graph
 * only ever needs the validator and the constants.
 *
 * ── Trust model ────────────────────────────────────────────────────────────
 * A bucket is one add-on's data exposed to another. The host guarantees who
 * wrote it and that the user connected the two. It guarantees NOTHING about
 * the contents. `data` is untrusted input — exactly as untrusted as a URL, and
 * treated the same way here: parsed, shape-checked, length-bounded, never
 * evaluated, never interpolated into HTML, never used to resolve a path or
 * fetch a resource.
 */

export const LOOP_DRAFT_SCHEMA_VERSION = 1 as const;
export const LOOP_DRAFTS_BUCKET_ID = "loop-drafts" as const;
export const LOOP_DRAFT_KIND = "loop-draft" as const;

/** The publisher Graph reads from. Addressing is by owner at call time. */
export const LOOPS_ADDON_OWNER_ID = "loops-addon" as const;

/** Mirrors ITEM_ID_PATTERN in electron/addons/buckets.ts. */
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const LOOP_NODE_TYPES = [
  "vault-read",
  "vault-write",
  "agent-action",
  "mcp-call",
  "checkpointer",
  "verifier",
] as const;
export type LoopNodeType = (typeof LOOP_NODE_TYPES)[number];

export interface LoopDraftPayload {
  v: typeof LOOP_DRAFT_SCHEMA_VERSION;
  loopId: string;
  name: string;
  description: string;
  status: "draft" | "running" | "paused" | "error";
  tag: "graph-created" | "custom";
  nodes: Array<{ id: string; type: LoopNodeType; label: string; sourceId?: string }>;
  edges: Array<{ from: string; to: string }>;
  createdAt: string;
  publishedAt: number;
}

export const MAX_NAME_LEN = 200;
export const MAX_DESCRIPTION_LEN = 2000;
export const MAX_LABEL_LEN = 200;
export const MAX_NODES = 200;
export const MAX_EDGES = 400;
export const MAX_SOURCE_ID_LEN = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStr(v: unknown, max: number): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/**
 * Validate one untrusted payload. Returns the typed payload, or a reason string.
 *
 * REJECTING is the point. A malformed draft is reported and skipped; it never
 * reaches the renderer as a node, and a single bad item cannot crash the graph
 * or take down the other drafts in the bucket.
 */
export function validateLoopDraft(data: unknown): { ok: true; value: LoopDraftPayload } | { ok: false; reason: string } {
  if (!isRecord(data)) return { ok: false, reason: "payload is not an object" };
  if (data.v !== LOOP_DRAFT_SCHEMA_VERSION) return { ok: false, reason: `unsupported schema version: ${String(data.v)}` };

  if (!isStr(data.loopId, 128) || !ITEM_ID_PATTERN.test(data.loopId)) {
    return { ok: false, reason: `invalid loopId: ${String(data.loopId)}` };
  }
  if (!isStr(data.name, MAX_NAME_LEN)) return { ok: false, reason: "invalid or missing name" };
  if (typeof data.description !== "string" || data.description.length > MAX_DESCRIPTION_LEN) {
    return { ok: false, reason: "invalid or oversized description" };
  }
  if (!["draft", "running", "paused", "error"].includes(data.status as string)) {
    return { ok: false, reason: `invalid status: ${String(data.status)}` };
  }
  if (!["graph-created", "custom"].includes(data.tag as string)) {
    return { ok: false, reason: `invalid tag: ${String(data.tag)}` };
  }
  if (typeof data.createdAt !== "string" || data.createdAt.length > 64) {
    return { ok: false, reason: "invalid createdAt" };
  }
  if (typeof data.publishedAt !== "number" || !Number.isFinite(data.publishedAt) || data.publishedAt <= 0) {
    return { ok: false, reason: "invalid publishedAt" };
  }

  if (!Array.isArray(data.nodes) || data.nodes.length > MAX_NODES) {
    return { ok: false, reason: `invalid or oversized nodes array (max ${MAX_NODES})` };
  }
  if (!Array.isArray(data.edges) || data.edges.length > MAX_EDGES) {
    return { ok: false, reason: `invalid or oversized edges array (max ${MAX_EDGES})` };
  }

  const nodes: LoopDraftPayload["nodes"] = [];
  const seenNodeIds = new Set<string>();
  for (const n of data.nodes) {
    if (!isRecord(n)) return { ok: false, reason: "node is not an object" };
    if (!isStr(n.id, 128) || !ITEM_ID_PATTERN.test(n.id)) return { ok: false, reason: `invalid node id: ${String(n.id)}` };
    if (seenNodeIds.has(n.id)) return { ok: false, reason: `duplicate node id: ${n.id}` };
    seenNodeIds.add(n.id);
    if (!LOOP_NODE_TYPES.includes(n.type as LoopNodeType)) return { ok: false, reason: `invalid node type: ${String(n.type)}` };
    if (!isStr(n.label, MAX_LABEL_LEN)) return { ok: false, reason: `invalid node label on ${n.id}` };
    // sourceId stays an opaque identifier on this side. It is displayed as text
    // if at all — never resolved to a file, an agent, or a fetch.
    if (n.sourceId !== undefined && (typeof n.sourceId !== "string" || n.sourceId.length > MAX_SOURCE_ID_LEN)) {
      return { ok: false, reason: `invalid sourceId on node ${n.id}` };
    }
    nodes.push({
      id: n.id,
      type: n.type as LoopNodeType,
      label: n.label,
      ...(typeof n.sourceId === "string" ? { sourceId: n.sourceId } : {}),
    });
  }

  const edges: LoopDraftPayload["edges"] = [];
  for (const e of data.edges) {
    if (!isRecord(e)) return { ok: false, reason: "edge is not an object" };
    if (!isStr(e.from, 128) || !isStr(e.to, 128)) return { ok: false, reason: "invalid edge endpoints" };
    if (!seenNodeIds.has(e.from)) return { ok: false, reason: `edge references unknown node: ${e.from}` };
    if (!seenNodeIds.has(e.to)) return { ok: false, reason: `edge references unknown node: ${e.to}` };
    edges.push({ from: e.from, to: e.to });
  }

  return {
    ok: true,
    value: {
      v: LOOP_DRAFT_SCHEMA_VERSION,
      loopId: data.loopId as string,
      name: data.name as string,
      description: data.description as string,
      status: data.status as LoopDraftPayload["status"],
      tag: data.tag as LoopDraftPayload["tag"],
      nodes,
      edges,
      createdAt: data.createdAt as string,
      publishedAt: data.publishedAt as number,
    },
  };
}