/**
 * BucketReader — Graph's side of the loop-drafts bucket.
 *
 * Graph NEVER writes to this bucket and never asks to be connected to it.
 * There is no API for an add-on to request a grant, and none is attempted here.
 * Whether Graph can read is entirely the user's decision, made in Mosaic
 * Settings against a named bucket.
 *
 * ── The null rule ──────────────────────────────────────────────────────────
 * `buckets.read()` returns `null` for EVERY one of these, on purpose, so a
 * reader cannot probe which add-ons or buckets exist:
 *
 *     no such add-on · no such bucket · never connected · declined ·
 *     revoked · publisher uninstalled · it stopped declaring that bucket
 *
 * This service therefore NEVER distinguishes them, and never reports any of
 * them as an error. It reports one state: "not connected", and points the user
 * at Settings. Inferring which case applied would turn a read into a discovery
 * primitive — exactly what the host's uniform null is there to prevent.
 */

import {
  LOOP_DRAFTS_BUCKET_ID,
  LOOPS_ADDON_OWNER_ID,
  validateLoopDraft,
  type LoopDraftPayload,
} from "./loopDraftSchema";

interface BucketsAPI {
  write(bucketId: string, items: Array<{ id: string; data: unknown }>): Promise<unknown>;
  clear(bucketId: string, ids?: string[]): Promise<unknown>;
  list(): Promise<unknown>;
  read(ownerId: string, bucketId: string): Promise<unknown>;
}

/**
 * `parseError` sits at the TOP level of addonAPI, not inside the buckets
 * namespace (electron/addon-preload.ts). Reading the host's code keeps a
 * raw "[BAD_ARGS] …" message from reaching the UI as if it were the reason.
 */
const ERROR_CODE_PATTERN = /^\[([A-Z_]+)\] ([\s\S]*)$/;

function readHostError(err: unknown, addonAPI: unknown): { code: string; message: string } {
  const parseError = (addonAPI as AddonAPIWithBuckets | undefined)?.parseError;
  if (typeof parseError === "function") {
    const parsed = parseError(err);
    if (parsed && typeof parsed.code === "string" && typeof parsed.message === "string") return parsed;
  }
  const raw = err instanceof Error ? err.message : String(err);
  const match = ERROR_CODE_PATTERN.exec(raw);
  return match ? { code: match[1], message: match[2] } : { code: "UNKNOWN_ERROR", message: raw };
}

interface AddonAPIWithBuckets {
  buckets?: BucketsAPI;
  parseError?: (err: unknown) => { code: string; message: string };
}

export type ReadState =
  /** Real drafts, validated. `rejected` lists anything malformed that was skipped. */
  | { state: "connected"; drafts: LoopDraftPayload[]; rejected: Array<{ id: string; reason: string }> }
  /** read() returned null — not connected, or any of the other indistinguishable cases. */
  | { state: "not-connected" }
  /** The buckets bridge does not exist in this Mosaic build. */
  | { state: "bridge-missing"; reason: string }
  /** read() itself threw. Distinct from null, and reported as a failure. */
  | { state: "read-failed"; reason: string };

/**
 * Read loop drafts from the buckets Loops publishes.
 *
 * Never throws. Every path returns a ReadState, because a failed read must
 * leave the graph rendering what it already has rather than blanking the view.
 */
export async function readLoopDrafts(addonAPI: unknown): Promise<ReadState> {
  const buckets = (addonAPI as AddonAPIWithBuckets | undefined)?.buckets;

  if (!buckets || typeof buckets.read !== "function") {
    return {
      state: "bridge-missing",
      reason:
        "The buckets bridge is not available. This build of Mosaic does not expose addonAPI.buckets — " +
        "buckets shipped in v0.1.13, so Mosaic needs updating before loop drafts can be read.",
    };
  }

  let raw: unknown;
  try {
    raw = await buckets.read(LOOPS_ADDON_OWNER_ID, LOOP_DRAFTS_BUCKET_ID);
  } catch (err) {
    // Strip the wire-format [CODE] prefix so the user sees the host's message
    // rather than "[BAD_ARGS] Write exceeds the 2000-item per-bucket cap".
    const { message } = readHostError(err, addonAPI);
    return { state: "read-failed", reason: message || "Unknown failure reading the bucket." };
  }

  // Uniform null. Do not differentiate the cases behind it.
  if (raw === null || raw === undefined) return { state: "not-connected" };

  // Shape-check the envelope before trusting anything inside it.
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { state: "read-failed", reason: "Bucket contents were not in the expected shape." };
  }
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) {
    return { state: "read-failed", reason: "Bucket contents had no items array." };
  }

  const drafts: LoopDraftPayload[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  for (const item of items) {
    if (typeof item !== "object" || item === null) {
      rejected.push({ id: "(malformed item)", reason: "item is not an object" });
      continue;
    }
    const { id, data } = item as { id?: unknown; data?: unknown };
    const itemId = typeof id === "string" ? id : "(no id)";

    const result = validateLoopDraft(data);
    if (!result.ok) {
      // Skipped, not fatal. One malformed item must not hide the valid ones.
      rejected.push({ id: itemId, reason: result.reason });
      continue;
    }
    drafts.push(result.value);
  }

  // Newest first — the most recently published draft is the interesting one.
  drafts.sort((a, b) => b.publishedAt - a.publishedAt);
  return { state: "connected", drafts, rejected };
}

/**
 * Best-effort check for whether a read is possible, for UI affordances only.
 * Uses buckets.list(), which returns a flat BucketSummary[] — the caller's own
 * buckets (`own: true`) plus every granted one (`own: false`). Never a request
 * for anything the user has not already granted.
 */
export async function isLoopDraftConnectionAvailable(addonAPI: unknown): Promise<boolean> {
  const buckets = (addonAPI as AddonAPIWithBuckets | undefined)?.buckets;
  if (!buckets || typeof buckets.list !== "function") return false;
  try {
    const listing = await buckets.list();
    // Confirmed against listFor() in electron/addons/buckets.ts: a flat array.
    if (!Array.isArray(listing)) return false;
    return listing.some((r) => {
      const entry = r as { owner?: unknown; bucket?: unknown; own?: unknown };
      return entry.owner === LOOPS_ADDON_OWNER_ID && entry.bucket === LOOP_DRAFTS_BUCKET_ID && entry.own === false;
    });
  } catch {
    return false;
  }
}