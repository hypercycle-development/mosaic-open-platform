/**
 * Writer-side tests for BucketPublisher.
 *
 * The writer's contract is narrow and load-bearing: it either reports that the
 * write happened, or it reports precisely why it did not. Never a success for
 * a write that did not occur.
 *
 * These run without graph-addon, so PR 1 (Loops) is verifiable on its own.
 * The cross-add-on round trip lives in graph-addon/tests/roundtrip.test.ts and
 * deliberately requires both PRs — see that file's header.
 *
 * Run: npx esbuild tests/publisher.test.ts --bundle --platform=node \
 *        --outfile=dist/publisher.test.cjs --log-level=error && node dist/publisher.test.cjs
 */

import assert from "assert";
import { publishLoop, retractLoopDraft } from "../src/services/BucketPublisher";
import { validateLoopDraft, LOOP_DRAFT_SCHEMA_VERSION } from "../src/services/bucketPayload";

let passed = 0;
let failed = 0;

/** Awaited, so a rejected async body counts as a failure rather than a pass. */
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

/** A host that enforces the real caps and item-id rule. */
function makeHost() {
  const calls: Array<{ bucketId: string; items: unknown[] }> = [];
  const cleared: Array<{ bucketId: string; ids?: string[] }> = [];
  let stored: unknown[] = [];
  let thrower: Error | null = null;
  return {
    calls,
    cleared,
    get stored() { return stored; },
    failWith(e: Error) { thrower = e; },
    api: {
      // The real preload exposes parseError at the TOP level of addonAPI, not
      // inside the buckets namespace (electron/addon-preload.ts). Mirroring
      // that here is what makes these tests assert against Mosaic's boundary
      // instead of against this fake.
      parseError(err: unknown) {
        const raw = err instanceof Error ? err.message : String(err);
        const m = /^\[([A-Z_]+)\] ([\s\S]*)$/.exec(raw);
        return m ? { code: m[1], message: m[2] } : { code: "UNKNOWN_ERROR", message: raw };
      },
      buckets: {
        async write(bucketId: string, items: Array<{ id: string; data: unknown }>) {
          calls.push({ bucketId, items });
          if (thrower) throw thrower;
          if (!Array.isArray(items) || items.length === 0) throw new Error("items must be a non-empty array");
          if (items.some((i) => i.data === undefined)) throw new Error("items[i].data must be a JSON value");
          if (JSON.stringify(items) === undefined) throw new Error("items must be a JSON value");
          for (const it of items) {
            const idx = stored.findIndex((s: any) => s.id === it.id);
            if (idx >= 0) stored[idx] = it;
            else stored.push(it);
          }
          return { ok: true };
        },
        async clear(bucketId: string, ids?: string[]) {
          cleared.push({ bucketId, ids });
          if (thrower) throw thrower;
          stored = ids ? stored.filter((s: any) => !ids.includes(s.id)) : [];
          return { ok: true };
        },
        async list() { return []; },
        async read() { return null; },
      },
    },
  };
}

async function main() {
  console.log("\nWrites to the declared bucket");
  await check("publishes to loop-drafts and reports success", async () => {
    const h = makeHost();
    const r = await publishLoop(h.api, LOOP);
    assert.strictEqual(r.ok, true);
    if (r.ok) assert.strictEqual(r.itemId, "draft-loop-1");
  });
  await check("uses the bucket id declared in the manifest", async () => {
    const h = makeHost();
    await publishLoop(h.api, LOOP);
    assert.strictEqual(h.calls[0].bucketId, "loop-drafts");
  });
  await check("derives the item id as draft-<loopId>", async () => {
    const h = makeHost();
    await publishLoop(h.api, LOOP);
    assert.strictEqual((h.calls[0].items[0] as any).id, "draft-loop-1");
  });
  await check("the written payload passes this add-on's own validator", async () => {
    const h = makeHost();
    await publishLoop(h.api, LOOP);
    const written = (h.calls[0].items[0] as any).data;
    const r = validateLoopDraft(written);
    assert.ok(r.ok, `writer emitted something its own validator rejects: ${r.ok ? "" : r.reason}`);
  });
  await check("only the whitelisted fields cross the boundary", async () => {
    const h = makeHost();
    await publishLoop(h.api, { ...LOOP } as any);
    const written = (h.calls[0].items[0] as any).data as Record<string, unknown>;
    const allowed = new Set([
      "v", "loopId", "name", "description", "status", "tag",
      "nodes", "edges", "createdAt", "publishedAt",
    ]);
    for (const k of Object.keys(written)) {
      assert.ok(allowed.has(k), `field "${k}" was published but is not part of the contract`);
    }
  });
  await check("stamps publishedAt", async () => {
    const h = makeHost();
    const before = Date.now();
    await publishLoop(h.api, LOOP);
    const written = (h.calls[0].items[0] as any).data;
    assert.ok(written.publishedAt >= before && written.publishedAt <= Date.now());
    assert.strictEqual(written.v, LOOP_DRAFT_SCHEMA_VERSION);
  });
  await check("re-publishing the same loop does not duplicate", async () => {
    const h = makeHost();
    await publishLoop(h.api, LOOP);
    await publishLoop(h.api, LOOP);
    assert.strictEqual(h.stored.length, 1);
  });
  await check("re-publishing updates the stored value", async () => {
    const h = makeHost();
    await publishLoop(h.api, LOOP);
    await publishLoop(h.api, { ...LOOP, name: "Deep Research v2" });
    assert.strictEqual((h.stored[0] as any).data.name, "Deep Research v2");
  });

  console.log("\nHonest failure reporting");
  await check("a missing bridge fails and names the Mosaic version", async () => {
    const r = await publishLoop({}, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      assert.strictEqual(r.code, "bridge-missing");
      assert.ok(r.reason.includes("v0.1.13"), "reason should name the version that added buckets");
    }
  });
  await check("a missing write method is a bridge problem, not a crash", async () => {
    const r = await publishLoop({ buckets: {} }, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, "bridge-missing");
  });
  await check("a host cap refusal is reported as write-rejected", async () => {
    const h = makeHost();
    // What the host ACTUALLY delivers: the preload turns the RangeError into
    // a plain Error carrying "[BAD_ARGS] …". Asserting on RangeError would be
    // asserting about the mock.
    h.failWith(new Error("[BAD_ARGS] Write exceeds the 2000-item per-bucket cap"));
    const r = await publishLoop(h.api, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, "write-rejected");
  });
  await check("the reason never leaks the raw [CODE] prefix", async () => {
    // The user must see "Write exceeds the 2000-item per-bucket cap", not the
    // wire format "[BAD_ARGS] Write exceeds ...". parseError exists to strip it.
    const h = makeHost();
    h.failWith(new Error("[BAD_ARGS] Write exceeds the 2000-item per-bucket cap"));
    const r = await publishLoop(h.api, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) {
      assert.strictEqual(r.code, "write-rejected");
      assert.ok(!r.reason.includes("[BAD_ARGS]"), `reason leaked the code prefix: ${r.reason}`);
      assert.ok(r.reason.includes("2000-item"), `reason lost the host's message: ${r.reason}`);
    }
  });
  await check("a cap refusal is still classified without a parseError bridge", async () => {
    // Older host / partial bridge: parseError absent. The code must still be
    // recovered from the message, or the branch regresses silently.
    const h = makeHost();
    const api: any = { buckets: h.api.buckets };
    h.failWith(new Error("[BAD_ARGS] Write exceeds the 2000-item per-bucket cap"));
    const r = await publishLoop(api, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, "write-rejected");
  });
  await check("PERMISSION_DENIED is a rejection, not an unexpected failure", async () => {
    const h = makeHost();
    h.failWith(new Error("[PERMISSION_DENIED] not the owner of this bucket"));
    const r = await publishLoop(h.api, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, "write-rejected");
  });
  await check("an unexpected error is reported as write-failed", async () => {
    const h = makeHost();
    h.failWith(new Error("disk unavailable"));
    const r = await publishLoop(h.api, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, "write-failed");
  });
  await check("nothing was stored when the write failed", async () => {
    const h = makeHost();
    h.failWith(new Error("disk unavailable"));
    await publishLoop(h.api, LOOP);
    assert.strictEqual(h.stored.length, 0);
  });
  await check("a failure reason is never empty", async () => {
    const h = makeHost();
    h.failWith(new Error(""));
    const r = await publishLoop(h.api, LOOP);
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.ok(r.reason.length > 0, "an empty reason tells the user nothing");
  });

  console.log("\nRefused before reaching the host");
  await check("a loopId with a path separator never reaches the host", async () => {
    const h = makeHost();
    const r = await publishLoop(h.api, { ...LOOP, id: "../../etc/passwd" });
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, "validation-failed");
    assert.strictEqual(h.calls.length, 0, "the host must never have been called");
  });
  await check("an unknown node type never reaches the host", async () => {
    const h = makeHost();
    const r = await publishLoop(h.api, {
      ...LOOP,
      nodes: [{ id: "n1", type: "rm-rf", label: "x" }],
      edges: [],
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(h.calls.length, 0);
  });
  await check("a dangling edge never reaches the host", async () => {
    const h = makeHost();
    const r = await publishLoop(h.api, { ...LOOP, edges: [{ from: "n1", to: "ghost" }] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(h.calls.length, 0);
  });
  await check("an empty name never reaches the host", async () => {
    const h = makeHost();
    const r = await publishLoop(h.api, { ...LOOP, name: "" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(h.calls.length, 0);
  });
  await check("an oversized topology never reaches the host", async () => {
    const h = makeHost();
    const r = await publishLoop(h.api, {
      ...LOOP,
      nodes: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, type: "agent-action", label: "x" })),
      edges: [],
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(h.calls.length, 0);
  });

  console.log("\nRetraction");
  await check("retracting clears the derived item id", async () => {
    const h = makeHost();
    await publishLoop(h.api, LOOP);
    const r = await retractLoopDraft(h.api, LOOP.id);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(h.stored.length, 0);
  });
  await check("retraction without a bridge fails honestly", async () => {
    const r = await retractLoopDraft({}, "loop-1");
    assert.strictEqual(r.ok, false);
    if (!r.ok) assert.strictEqual(r.code, "bridge-missing");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(`harness crashed: ${e}`);
  process.exit(1);
});
