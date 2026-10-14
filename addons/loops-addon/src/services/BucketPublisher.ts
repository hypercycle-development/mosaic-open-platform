/**
 * BucketPublisher — Loops' side of the loop-drafts bucket.
 *
 * Loops is the SOLE WRITER of `loop-drafts`. Graph may read it, but never
 * writes. Nothing here can request a connection, escalate permission, or
 * prompt the user: `buckets.write` either succeeds because the manifest
 * declares the bucket, or fails and is reported as a failure.
 *
 * ── Honest reporting ───────────────────────────────────────────────────────
 * `publishLoop` returns a discriminated result. It NEVER reports success for a
 * write that did not happen. A missing bridge, a rejected manifest, a cap
 * breach and a storage error are all distinct, and each reaches the UI as
 * itself. This is the defect class review feedback caught in two rounds — an
 * add-on telling the user something happened when it didn't.
 */

import {
  LOOP_DRAFTS_BUCKET_ID,
  LOOP_DRAFT_SCHEMA_VERSION,
  type LoopDraftPayload,
  validateLoopDraft,
  toBucketItem,
} from "./bucketPayload";

/** Mirrors the buckets surface in electron/addon-preload.ts. */
export interface BucketsAPI {
  write(bucketId: string, items: Array<{ id: string; data: unknown }>): Promise<unknown>;
  clear(bucketId: string, ids?: string[]): Promise<unknown>;
  list(): Promise<unknown>;
  read(ownerId: string, bucketId: string): Promise<unknown>;
}

/**
 * The bridge's top-level error reader. It is NOT inside the `buckets`
 * namespace, which is why a namespace-shaped interface never surfaced it.
 * See `docs/addon-api.md` → "How a call behaves".
 */
export interface AddonAPIErrorReader {
  parseError(err: unknown): { code: string; message: string };
}

interface AddonAPIWithBuckets {
  buckets?: BucketsAPI;
  parseError?: AddonAPIErrorReader["parseError"];
}

/**
 * Read a host error into its code and clean message.
 *
 * The host throws `RangeError` for a cap refusal, but that class does not
 * survive the contextBridge: the preload re-wraps every failure as a plain
 * `Error` whose message encodes the code as `[CODE] text`, because
 * contextBridge silently drops a custom `.code` property. So `instanceof
 * RangeError` can never be true here, and keying on it left the cap branch
 * unreachable.
 *
 * `parseError` is the documented way to read these. When it is absent — an
 * older host, or a hand-built bridge in a test — fall back to parsing the
 * message shape directly rather than losing the code.
 */
const ERROR_CODE_PATTERN = /^\[([A-Z_]+)\] ([\s\S]*)$/;

function readHostError(err: unknown, addonAPI: unknown): { code: string; message: string } {
  const parseError = (addonAPI as AddonAPIWithBuckets | undefined)?.parseError;
  if (typeof parseError === "function") {
    const parsed = parseError(err);
    if (parsed && typeof parsed.code === "string" && typeof parsed.message === "string") {
      return parsed;
    }
  }
  const raw = err instanceof Error ? err.message : String(err);
  const match = ERROR_CODE_PATTERN.exec(raw);
  return match ? { code: match[1], message: match[2] } : { code: "UNKNOWN_ERROR", message: raw };
}

/**
 * Codes the host uses for a caller's own bad input, as opposed to a runtime
 * failure on our side. See the seven-code table in `docs/addon-api.md`.
 */
const CALLER_ERROR_CODES: ReadonlySet<string> = new Set(["BAD_ARGS", "NOT_FOUND", "PERMISSION_DENIED"]);

export type PublishResult =
  | { ok: true; itemId: string; loopName: string }
  | { ok: false; code: "bridge-missing" | "validation-failed" | "write-rejected" | "write-failed"; reason: string };

/**
 * The Loops `Loop` shape, declared locally so this service does not depend on
 * the panel's UI types. Only what is published appears here — by omission, the
 * rest of the loop object (config, schemas, timings) cannot leak by accident.
 */
export interface PublishableLoop {
  id: string;
  name: string;
  description: string;
  status: "draft" | "running" | "paused" | "error";
  tag: "graph-created" | "custom";
  nodes: Array<{ id: string; type: string; label: string; sourceId?: string }>;
  edges: Array<{ from: string; to: string }>;
  createdAt: string;
}

/** Narrow an arbitrary loop to the published shape, validating as we go. */
function toPayload(loop: PublishableLoop): LoopDraftPayload {
  return {
    v: LOOP_DRAFT_SCHEMA_VERSION,
    loopId: loop.id,
    name: loop.name,
    description: loop.description ?? "",
    status: loop.status,
    tag: loop.tag,
    nodes: loop.nodes.map((n) => ({
      id: n.id,
      type: n.type as LoopDraftPayload["nodes"][number]["type"],
      label: n.label,
      ...(typeof n.sourceId === "string" ? { sourceId: n.sourceId } : {}),
    })),
    edges: loop.edges.map((e) => ({ from: e.from, to: e.to })),
    createdAt: loop.createdAt,
    publishedAt: Date.now(),
  };
}

/**
 * Publish one loop draft into `loop-drafts`.
 *
 * Validates locally BEFORE writing, so a malformed loop never reaches the host
 * and the user gets a specific reason rather than a generic cap error.
 */
export async function publishLoop(addonAPI: unknown, loop: PublishableLoop): Promise<PublishResult> {
  const buckets = (addonAPI as AddonAPIWithBuckets | undefined)?.buckets;

  if (!buckets || typeof buckets.write !== "function") {
    return {
      ok: false,
      code: "bridge-missing",
      reason:
        "The buckets bridge is not available. This build of Mosaic does not expose addonAPI.buckets — " +
        "buckets shipped in v0.1.13, so Mosaic needs updating before anything can be published.",
    };
  }

  // Validate through the same function Graph uses, so a payload that writes is
  // a payload that reads.
  const candidate = toPayload(loop);
  const validated = validateLoopDraft(candidate);
  if (!validated.ok) {
    return { ok: false, code: "validation-failed", reason: validated.reason };
  }

  const item = toBucketItem(loop.id, validated.value);
  if ("error" in item) {
    return { ok: false, code: "validation-failed", reason: item.error };
  }

  try {
    await buckets.write(LOOP_DRAFTS_BUCKET_ID, [item]);
    // Reaching here means the host accepted the write. Anything else throws.
    return { ok: true, itemId: item.id, loopName: validated.value.name };
  } catch (err) {
    const { code, message } = readHostError(err, addonAPI);
    // A cap refusal (2000 items / 10 MB / 200 MB) is the host enforcing a
    // limit, which arrives as BAD_ARGS — a rejection of the write rather than
    // an unexpected failure, and actionable on its own.
    if (CALLER_ERROR_CODES.has(code)) {
      return { ok: false, code: "write-rejected", reason: `Refused by Mosaic — ${message}` };
    }
    return { ok: false, code: "write-failed", reason: message || "Unknown failure writing to the bucket." };
  }
}

/**
 * Remove one draft from the bucket. Used when a loop is deleted, so Graph does
 * not keep showing a design that no longer exists.
 */
export async function retractLoopDraft(addonAPI: unknown, loopId: string): Promise<PublishResult> {
  const buckets = (addonAPI as AddonAPIWithBuckets | undefined)?.buckets;
  if (!buckets || typeof buckets.clear !== "function") {
    return { ok: false, code: "bridge-missing", reason: "The buckets bridge is not available." };
  }
  try {
    await buckets.clear(LOOP_DRAFTS_BUCKET_ID, [`draft-${loopId}`]);
    return { ok: true, itemId: `draft-${loopId}`, loopName: loopId };
  } catch (err) {
    const { message } = readHostError(err, addonAPI);
    return { ok: false, code: "write-failed", reason: message || "Unknown failure clearing the bucket item." };
  }
}