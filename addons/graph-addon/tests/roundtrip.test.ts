/**
 * Cross-add-on integration test: a payload the WRITER will produce is one the
 * READER accepts. Nothing else proves that contract holds.
 *
 * It imports ../loops-addon, so it only runs where both add-ons sit side by
 * side. Run it with `npm run test:cross` from a tree that has both; with only
 * this add-on present it is skipped with a message rather than failing at
 * module load and taking the rest of the suite with it.
 */
/**
 * Round-trip tests: Loops writes → Graph reads.
 *
 * The two add-ons are separate packages with separate builds, so this is the
 * only place both sides meet. It proves the thing that actually matters for the
 * integration — that a payload the writer is willing to produce is a payload
 * the reader is willing to accept, and that the reader refuses everything else.
 *
 * ── DEPENDS ON THE OTHER PR ────────────────────────────────────────────────
 * This file imports `../../loops-addon/src/services/BucketPublisher` and
 * reads `../../loops-addon/manifest.json`, so it only runs once PR 1
 * (loops-buckets) has landed. That is the honest reason for the Loops-first
 * merge order: Graph's read side is reviewable and testable alone
 * (tests/loop-draft.test.ts, tests/manifest-buckets.test.ts), but proving the
 * two agree requires both.
 *
 * tests/loop-draft.test.ts has no such dependency and runs standalone.
 *
 * Run from addons/graph-addon:
 *   npx esbuild tests/roundtrip.test.ts --bundle --platform=node \
 *     --outfile=dist/roundtrip.test.cjs --log-level=error && node dist/roundtrip.test.cjs
 */

import assert from "assert";
import { publishLoop, retractLoopDraft } from "../../loops-addon/src/services/BucketPublisher";
import { validateLoopDraft, LOOP_DRAFT_SCHEMA_VERSION } from "../src/services/loopDraftSchema";
import { readLoopDrafts, isLoopDraftConnectionAvailable } from "../src/services/BucketReader";

let passed = 0;
let failed = 0;

/**
 * Awaits the check. Without this an async body that rejects would return a
 * settled-but-failed promise that `check` counts as a PASS — the failure would
 * be reported as success, which is exactly the defect class this whole task is
 * about. So every assertion here is awaited, and the tally cannot lie.
 */
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  NOT OK  ${name}`);
    console.log(`        ${(e as Error).message}`);
  }
}

// ── A fake host that mirrors the real buckets contract ──────────────────────
const HOST_CAP_ITEMS = 2000;
let storage: { owner: string; bucket: string; items: Array<{ id: string; data: unknown }> } | null = null;
let grants = new Set<string>();
let writeShouldThrow: Error | null = null;

function resetHost() {
  storage = null;
  grants = new Set();
  writeShouldThrow = null;
}

const fakeApi = {
  // The real preload exposes parseError at the top level of addonAPI, outside
  // the buckets namespace (electron/addon-preload.ts). Mirroring that here is
  // what lets these tests assert against Mosaic's boundary: the host's
  // RangeError arrives as Error("[BAD_ARGS] …"), never as a RangeError.
  parseError(err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    const m = /^\[([A-Z_]+)\] ([\s\S]*)$/.exec(raw);
    return m ? { code: m[1], message: m[2] } : { code: "UNKNOWN_ERROR", message: raw };
  },
  buckets: {
    async write(bucketId: string, items: Array<{ id: string; data: unknown }>) {
      if (writeShouldThrow) throw writeShouldThrow;
      if (!Array.isArray(items) || items.length === 0) throw new Error("items must be a non-empty array");
      if (items.length > HOST_CAP_ITEMS) throw new Error(`[BAD_ARGS] Write exceeds the ${HOST_CAP_ITEMS}-item per-bucket cap`);
      if (items.some((i) => i.data === undefined)) throw new Error("items[i].data must be a JSON value");
      if (JSON.stringify(items) === undefined) throw new Error("items must be a JSON value");
      const existing = storage?.bucket === bucketId ? storage.items : [];
      const merged = [...existing];
      for (const it of items) {
        const idx = merged.findIndex((m) => m.id === it.id);
        if (idx >= 0) merged[idx] = it;
        else merged.push(it);
      }
      storage = { owner: "loops-addon", bucket: bucketId, items: merged };
      return { ok: true };
    },
    async clear(bucketId: string, ids?: string[]) {
      if (!storage || storage.bucket !== bucketId) return { ok: true };
      storage = ids
        ? { ...storage, items: storage.items.filter((i) => !ids.includes(i.id)) }
        : { ...storage, items: [] };
      return { ok: true };
    },
    async list() {
      const rows: unknown[] = [];
      if (storage) {
        rows.push({ owner: "loops-addon", bucket: storage.bucket, kind: "loop-draft", label: "Loop drafts", own: true, itemCount: storage.items.length, updatedAt: Date.now() });
      }
      if (grants.has("loops-addon/loop-drafts")) {
        rows.push({ owner: "loops-addon", bucket: "loop-drafts", kind: "loop-draft", label: "Loop drafts", own: false, itemCount: storage?.items.length ?? 0, updatedAt: Date.now() });
      }
      return rows;
    },
    async read(ownerId: string, bucketId: string) {
      // Uniform null — never reveal which case it was.
      if (!grants.has(`${ownerId}/${bucketId}`)) return null;
      if (!storage || storage.owner !== ownerId || storage.bucket !== bucketId) return null;
      return { owner: ownerId, bucket: bucketId, kind: "loop-draft", label: "Loop drafts", items: storage.items };
    },
  },
};

const LOOP = {
  id: "loop-1",
  name: "Deep Research",
  description: "Search broadly, synthesize narrowly.",
  status: "draft" as const,
  tag: "graph-created" as const,
  nodes: [
    { id: "n1", type: "vault-read", label: "Seed Query", sourceId: "box-1" },
    { id: "n2", type: "agent-action", label: "Synthesize", sourceId: "agent-1" },
  ],
  edges: [{ from: "n1", to: "n2" }],
  createdAt: "2026-10-10T00:00:00.000Z",
};

async function main() {
  console.log("\nHappy path — write then read");
  await check("a loop publishes successfully and reports the item id", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    const res = await publishLoop(fakeApi, LOOP);
    assert.strictEqual(res.ok, true);
    if (res.ok) assert.strictEqual(res.itemId, "draft-loop-1");
  });
  await check("Graph reads back exactly what Loops wrote", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    const read = await readLoopDrafts(fakeApi);
    assert.strictEqual(read.state, "connected");
    if (read.state !== "connected") throw new Error("expected connected");
    assert.strictEqual(read.drafts.length, 1);
    assert.strictEqual(read.rejected.length, 0);
    const d = read.drafts[0];
    assert.strictEqual(d.loopId, "loop-1");
    assert.strictEqual(d.name, "Deep Research");
    assert.strictEqual(d.nodes.length, 2);
    assert.strictEqual(d.edges.length, 1);
    assert.strictEqual(d.v, LOOP_DRAFT_SCHEMA_VERSION);
  });

  console.log("\nDenied / not connected");
  // This is the security case: no grant, no data, no error, no discovery.
  await check("without a grant, read reports not-connected rather than an error", async () => {
    resetHost();
    await publishLoop(fakeApi, LOOP);
    const read = await readLoopDrafts(fakeApi);
    assert.strictEqual(read.state, "not-connected");
  });
  await check("read reports not-connected even when nothing was ever published", async () => {
    resetHost();
    const read = await readLoopDrafts(fakeApi);
    assert.strictEqual(read.state, "not-connected");
  });
  await check("the same null arrives whether the bucket is empty or absent", async () => {
    resetHost();
    const empty = await readLoopDrafts(fakeApi);
    await publishLoop(fakeApi, LOOP);
    const absent = await readLoopDrafts(fakeApi); // grant revoked, bucket still there
    assert.strictEqual(empty.state, absent.state);
    assert.strictEqual(empty.state, "not-connected");
  });
  await check("a revoked grant stops the read", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    grants.delete("loops-addon/loop-drafts");
    const read = await readLoopDrafts(fakeApi);
    assert.strictEqual(read.state, "not-connected");
  });
  await check("re-granting restores the read", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    grants.delete("loops-addon/loop-drafts");
    assert.strictEqual((await readLoopDrafts(fakeApi)).state, "not-connected");
    grants.add("loops-addon/loop-drafts");
    const back = await readLoopDrafts(fakeApi);
    assert.strictEqual(back.state, "connected");
  });

  console.log("\nBridge missing");
  await check("a build with no buckets bridge reports bridge-missing, not an error", async () => {
    resetHost();
    const read = await readLoopDrafts({});
    assert.strictEqual(read.state, "bridge-missing");
  });
  await check("publishing without a bridge fails honestly and names the version", async () => {
    const res = await publishLoop({}, LOOP);
    assert.strictEqual(res.ok, false);
    if (!res.ok) {
      assert.strictEqual(res.code, "bridge-missing");
      assert.ok(res.reason.includes("v0.1.13"), "reason should name the version that added buckets");
    }
  });

  console.log("\nHonest failure reporting");
  await check("a host rejection is reported as write-rejected, not success", async () => {
    resetHost();
    writeShouldThrow = new Error("[BAD_ARGS] Write exceeds the 2000-item per-bucket cap");
    const res = await publishLoop(fakeApi, LOOP);
    assert.strictEqual(res.ok, false);
    if (!res.ok) assert.strictEqual(res.code, "write-rejected");
  });
  await check("an unexpected error is reported as write-failed", async () => {
    resetHost();
    writeShouldThrow = new Error("disk unavailable");
    const res = await publishLoop(fakeApi, LOOP);
    assert.strictEqual(res.ok, false);
    if (!res.ok) assert.strictEqual(res.code, "write-failed");
  });
  await check("nothing was written when the write failed", async () => {
    resetHost();
    writeShouldThrow = new Error("disk unavailable");
    await publishLoop(fakeApi, LOOP);
    assert.strictEqual(storage, null);
  });
  await check("a malformed loop is refused before it reaches the host", async () => {
    resetHost();
    const res = await publishLoop(fakeApi, { ...LOOP, id: "../../escape" });
    assert.strictEqual(res.ok, false);
    if (!res.ok) assert.strictEqual(res.code, "validation-failed");
    assert.strictEqual(storage, null, "host must never have been called");
  });

  console.log("\nUpdate flow");
  await check("re-publishing the same loop updates in place, no duplicate", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    await publishLoop(fakeApi, { ...LOOP, name: "Deep Research v2" });
    const read = await readLoopDrafts(fakeApi);
    if (read.state !== "connected") throw new Error("expected connected");
    assert.strictEqual(read.drafts.length, 1);
    assert.strictEqual(read.drafts[0].name, "Deep Research v2");
  });
  await check("retracting a draft removes it from the reader's view", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    await retractLoopDraft(fakeApi, LOOP.id);
    const read = await readLoopDrafts(fakeApi);
    if (read.state !== "connected") throw new Error("expected connected");
    assert.strictEqual(read.drafts.length, 0);
  });

  console.log("\nMalformed data on the reader side");
  await check("a corrupt item is skipped and the good ones survive", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    await publishLoop(fakeApi, { ...LOOP, id: "loop-2", name: "Second" });
    // Simulate corruption on disk / a hand-edited payload.
    storage!.items.push({ id: "draft-evil", data: { v: 1, loopId: "../../etc/passwd" } });
    storage!.items.push({ id: "draft-huge", data: { v: 1, nodes: new Array(5000).fill({ id: "n", type: "agent-action", label: "x" }) } });
    // A REAL payload (loopId, not the Loop fixture's `id`) carrying an XSS-shaped
  // name. It must be ACCEPTED — the string is inert text — so 3 valid, 2 rejected.
  storage!.items.push({
    id: "draft-html",
    data: {
      v: LOOP_DRAFT_SCHEMA_VERSION,
      loopId: "loop-3",
      name: "<script>alert(1)</script>",
      description: "",
      status: "draft",
      tag: "custom",
      nodes: [],
      edges: [],
      createdAt: "t",
      publishedAt: Date.now(),
    },
  });
    const read = await readLoopDrafts(fakeApi);
    if (read.state !== "connected") throw new Error("expected connected");
    assert.strictEqual(read.drafts.length, 3, "three valid drafts should survive");
    assert.strictEqual(read.rejected.length, 2, "two malformed items should be rejected");
  });
  await check("an XSS-shaped name is preserved as inert text, not executed", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, { ...LOOP, name: "<script>alert(1)</script>" });
    const read = await readLoopDrafts(fakeApi);
    if (read.state !== "connected") throw new Error("expected connected");
    assert.strictEqual(read.drafts[0].name, "<script>alert(1)</script>");
    assert.strictEqual((read.drafts[0] as unknown as Record<string, unknown>).constructor, Object);
  });
  await check("a hostile constructor key cannot break the reader", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    // The declared fields are all valid, so this is ACCEPTED — the security
    // property is that the extra `constructor` key cannot pollute or break the
    // built object, not that a valid-shaped payload gets rejected.
    storage!.items.push({
      id: "draft-ctor",
      data: JSON.parse('{"v":1,"loopId":"loop-9","name":"x","description":"","status":"draft","tag":"custom","nodes":[],"edges":[],"createdAt":"t","publishedAt":1,"constructor":{"prototype":{"polluted":true}}}'),
    });
    const read = await readLoopDrafts(fakeApi);
    assert.strictEqual(({} as Record<string, unknown>).polluted, undefined, "Object.prototype was polluted");
    if (read.state !== "connected") throw new Error("expected connected");
    const built = read.drafts.find((d) => d.loopId === "loop-9");
    assert.ok(built, "the valid-shaped item should still be read");
    assert.strictEqual(Object.prototype.hasOwnProperty.call(built as unknown as Record<string, unknown>, "constructor"), false);
  });
  await check("a non-array items payload is a read-failed, not a crash", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    const broken = { buckets: { ...fakeApi.buckets, read: async () => ({ owner: "loops-addon", bucket: "loop-drafts", items: "not-an-array" }) } };
    const read = await readLoopDrafts(broken);
    assert.strictEqual(read.state, "read-failed");
  });
  await check("a throwing read is a read-failed, not a crash", async () => {
    const broken = { buckets: { ...fakeApi.buckets, read: async () => { throw new Error("ipc died"); } } };
    const read = await readLoopDrafts(broken);
    assert.strictEqual(read.state, "read-failed");
  });
  await check("drafts come back newest first", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, { ...LOOP, id: "loop-a", name: "A" });
    await new Promise((r) => setTimeout(r, 2));
    await publishLoop(fakeApi, { ...LOOP, id: "loop-b", name: "B" });
    const read = await readLoopDrafts(fakeApi);
    if (read.state !== "connected") throw new Error("expected connected");
    assert.strictEqual(read.drafts[0].name, "B");
  });

  console.log("\nlist() affordance");
  await check("connection is unavailable without a grant", async () => {
    resetHost();
    assert.strictEqual(await isLoopDraftConnectionAvailable(fakeApi), false);
  });
  await check("own bucket does not count as a readable grant", async () => {
    resetHost();
    await publishLoop(fakeApi, LOOP);
    assert.strictEqual(await isLoopDraftConnectionAvailable(fakeApi), false);
  });
  await check("a grant makes it available", async () => {
    resetHost();
    grants.add("loops-addon/loop-drafts");
    await publishLoop(fakeApi, LOOP);
    assert.strictEqual(await isLoopDraftConnectionAvailable(fakeApi), true);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`harness crashed: ${e}`);
  process.exit(1);
});
