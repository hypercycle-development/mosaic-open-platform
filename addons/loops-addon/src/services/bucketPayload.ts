/**
 * loop-draft payload schema — the Loops → Graph contract.
 *
 * VERSIONED AND VALIDATED ON BOTH SIDES. This file defines what crosses the
 * bucket boundary from the writer's side.
 *
 * Graph does NOT import this file — it carries its own copy in
 * `graph-addon/src/services/loopDraftSchema.ts`, because the two add-ons are
 * separate packages with separate builds and no shared dependency. The shared
 * `validateLoopDraft` logic is kept identical in both; only the comments differ
 * and the writer-only helpers below (`toBucketItem`, `isValidBucketId`) exist
 * only here. A test asserts the shared surface matches, but nothing enforces it
 * mechanically, so a change to the validation rules must be made in BOTH files.
 *
 * ── Why the schema is narrow ──────────────────────────────────────────────
 * A bucket is one add-on's data exposed to another. The host guarantees who
 * wrote it and that the user connected the two. It guarantees NOTHING about the
 * contents — so `data` is untrusted input, exactly like a URL. The payload
 * below is deliberately small: loop topology only. No credentials, no file
 * paths, no config, no localStorage contents, no Vault data.
 *
 * ── Why this is duplicated into Graph ─────────────────────────────────────
 * graph-addon and loops-addon are separate packages with separate builds and
 * no shared dependency. Rather than add a build-time coupling between two PRs
 * that independent reviewers check separately, Graph carries its own copy. KEEP THE TWO
 * COPIES IDENTICAL — this file is the source of truth for both.
 */

/** Schema version. Graph refuses anything it does not recognise. */
export const LOOP_DRAFT_SCHEMA_VERSION = 1 as const;

/** The bucket Loops is the sole writer of. Must match manifest `publishes[].id`. */
export const LOOP_DRAFTS_BUCKET_ID = "loop-drafts" as const;

/** The kind readers declare. Must match manifest `publishes[].kind`. */
export const LOOP_DRAFT_KIND = "loop-draft" as const;

/** Owner id Graph passes to `buckets.read()`. */
export const LOOPS_ADDON_OWNER_ID = "loops-addon" as const;

/**
 * Mirrors ITEM_ID_PATTERN in electron/addons/buckets.ts — `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`.
 * Checked here so a bad id is reported at the writer, not swallowed by the host.
 */
const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** Mirrors BUCKET_ID_PATTERN — `/^[a-z][a-z0-9-]{1,40}$/`. */
const BUCKET_ID_PATTERN = /^[a-z][a-z0-9-]{1,40}$/;

/** Mirrors LoopNode.type in loops-addon LoopsPanel. */
export const LOOP_NODE_TYPES = [
  "vault-read",
  "vault-write",
  "agent-action",
  "mcp-call",
  "checkpointer",
  "verifier",
] as const;
export type LoopNodeType = (typeof LOOP_NODE_TYPES)[number];

/** What Graph actually renders. Deliberately excludes config, schemas, timings. */
export interface LoopDraftPayload {
  /** Schema version, so a future change can be detected rather than misread. */
  v: typeof LOOP_DRAFT_SCHEMA_VERSION;
  loopId: string;
  name: string;
  description: string;
  status: "draft" | "running" | "paused" | "error";
  tag: "graph-created" | "custom";
  /** Topology only — enough to draw and to seed a loop builder. */
  nodes: Array<{ id: string; type: LoopNodeType; label: string; sourceId?: string }>;
  edges: Array<{ from: string; to: string }>;
  createdAt: string;
  /** Publish time. Lets Graph show staleness honestly. */
  publishedAt: number;
}

/** Upper bounds. Generous for topology, far below the host's 10 MB / 2000 item caps. */
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
 * REJECTING is the point. A bucket item is authored by another add-on and may
 * be hand-edited on disk; nothing here is executed, evaluated or interpolated
 * into HTML. Every field is checked for the exact expected type and a bounded
 * length before use.
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
    // sourceId may point at an agent/MCP/box. Bounded, and treated as an opaque
    // identifier on the reader side — never resolved, never fetched.
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
    // A dangling edge cannot be drawn. Reject rather than silently drop — a
    // graph that quietly loses topology is worse than one that refuses it.
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

/** Build a bucket item from a validated payload, or a reason it cannot be built. */
export function toBucketItem(loopId: string, payload: LoopDraftPayload): { id: string; data: LoopDraftPayload } | { error: string } {
  const id = `draft-${loopId}`;
  if (!ITEM_ID_PATTERN.test(id)) return { error: `derived item id is invalid: ${id}` };
  return { id, data: payload };
}

/** True when a string is a bucket id the host would accept. Guards manifest typos. */
export function isValidBucketId(id: string): boolean {
  return BUCKET_ID_PATTERN.test(id);
}