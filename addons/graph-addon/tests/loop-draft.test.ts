/**
 * Adversarial tests for the loop-draft validator.
 *
 * The validator is the ONLY thing standing between another add-on's data and
 * the graph renderer, so it is tested the way untrusted input actually arrives:
 * wrong types, wrong shapes, hostile strings, boundary sizes, and the cases
 * that would silently corrupt a graph rather than crash it.
 *
 * Run: npx esbuild tests/loop-draft.test.ts --bundle --platform=node \
 *        --outfile=dist/loop-draft.test.cjs --log-level=error \
 *        && node dist/loop-draft.test.cjs
 */

import assert from "assert";
import { validateLoopDraft, LOOP_DRAFT_SCHEMA_VERSION } from "../src/services/loopDraftSchema";
import type { LoopDraftPayload } from "../src/services/loopDraftSchema";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  NOT OK  ${name}`);
    console.log(`        ${(e as Error).message}`);
  }
}

function rejects(name: string, data: unknown, expectSubstring?: string) {
  check(name, () => {
    const r = validateLoopDraft(data);
    assert.strictEqual(r.ok, false, `expected rejection, got accepted: ${describe(data)}`);
    if (expectSubstring) {
      assert.ok(
        r.reason.includes(expectSubstring),
        `reason "${r.reason}" did not mention "${expectSubstring}"`,
      );
    }
  });
}

/** Safe for `undefined` — JSON.stringify(undefined) is undefined, not a string. */
function describe(data: unknown): string {
  try {
    const s = JSON.stringify(data);
    return typeof s === "string" ? s.slice(0, 120) : String(data);
  } catch {
    return String(data);
  }
}

function accepts(name: string, data: unknown) {
  check(name, () => {
    const r = validateLoopDraft(data);
    assert.strictEqual(r.ok, true, `expected acceptance, got: ${r.ok ? "" : r.reason}`);
  });
}

// ── A valid baseline ────────────────────────────────────────────────────────
const VALID: LoopDraftPayload = {
  v: LOOP_DRAFT_SCHEMA_VERSION,
  loopId: "loop-1",
  name: "Deep Research",
  description: "Search broadly, synthesize narrowly.",
  status: "draft",
  tag: "graph-created",
  nodes: [
    { id: "n1", type: "vault-read", label: "Seed Query", sourceId: "box-1" },
    { id: "n2", type: "agent-action", label: "Synthesize" },
  ],
  edges: [{ from: "n1", to: "n2" }],
  createdAt: "2026-10-10T00:00:00.000Z",
  publishedAt: 1_760_000_000_000,
};

console.log("\nBaseline");
accepts("a well-formed draft is accepted", VALID);
check("accepted draft is returned intact", () => {
  const r = validateLoopDraft(VALID);
  assert.ok(r.ok);
  assert.strictEqual(r.value.name, "Deep Research");
  assert.strictEqual(r.value.nodes.length, 2);
  assert.strictEqual(r.value.edges.length, 1);
});
check("omitted sourceId is not invented", () => {
  const r = validateLoopDraft(VALID);
  assert.ok(r.ok);
  assert.strictEqual("sourceId" in r.value.nodes[1], false);
});

console.log("\nWrong types");
rejects("null", null);
rejects("undefined", undefined);
rejects("a string", "loop-drafts");
rejects("a number", 42);
rejects("an array", [VALID]);
rejects("a nested array where an object belongs", { ...VALID, nodes: [[]] });
rejects("a non-object node", { ...VALID, nodes: ["n1"] });
rejects("a non-object edge", { ...VALID, edges: ["n1->n2"] });

console.log("\nSchema version");
rejects("a missing version", { ...VALID, v: undefined }, "unsupported schema version");
rejects("an older version", { ...VALID, v: 0 }, "unsupported schema version");
rejects("a newer version", { ...VALID, v: 2 }, "unsupported schema version");
rejects("a string version", { ...VALID, v: "1" }, "unsupported schema version");

console.log("\nField validation");
rejects("an empty name", { ...VALID, name: "" });
rejects("an oversized name", { ...VALID, name: "x".repeat(201) });
rejects("a non-string name", { ...VALID, name: 123 });
rejects("a missing description", { ...VALID, description: undefined });
rejects("an oversized description", { ...VALID, description: "x".repeat(2001) });
rejects("an unknown status", { ...VALID, status: "exploded" }, "invalid status");
rejects("an unknown tag", { ...VALID, tag: "someone-elses" }, "invalid tag");
rejects("a non-numeric publishedAt", { ...VALID, publishedAt: "now" }, "invalid publishedAt");
rejects("a NaN publishedAt", { ...VALID, publishedAt: Number.NaN }, "invalid publishedAt");
rejects("a zero publishedAt", { ...VALID, publishedAt: 0 }, "invalid publishedAt");
rejects("an oversized createdAt", { ...VALID, createdAt: "x".repeat(65) });

console.log("\nIdentifier safety");
rejects("a loopId with a path separator", { ...VALID, loopId: "../../etc/passwd" }, "invalid loopId");
rejects("a loopId with a script tag", { ...VALID, loopId: "<script>alert(1)</script>" }, "invalid loopId");
rejects("an empty loopId", { ...VALID, loopId: "" });
rejects("a node id with a space", { ...VALID, nodes: [{ id: "a b", type: "agent-action", label: "x" }] }, "invalid node id");
rejects("an oversized node id", { ...VALID, nodes: [{ id: "n".repeat(129), type: "agent-action", label: "x" }] }, "invalid node id");

console.log("\nTopology integrity");
// A dangling edge would draw as a line to nowhere. Rejecting beats silently losing topology.
rejects("an edge from a node that does not exist", { ...VALID, edges: [{ from: "n1", to: "ghost" }] }, "unknown node");
rejects("an edge to a node that does not exist", { ...VALID, edges: [{ from: "ghost", to: "n1" }] }, "unknown node");
rejects("duplicate node ids", {
  ...VALID,
  nodes: [
    { id: "n1", type: "agent-action", label: "a" },
    { id: "n1", type: "agent-action", label: "b" },
  ],
  edges: [],
}, "duplicate node id");
accepts("an empty node list with no edges is valid", { ...VALID, nodes: [], edges: [] });
// A self-edge has both endpoints present, so it passes the endpoint check. The
// validator guarantees "every edge points at a real node" and nothing stronger —
// it does NOT detect cycles or reject self-loops, because that is graph
// semantics, not schema. Anything downstream that needs acyclicity must check
// it itself. Stated here so the gap is a documented boundary, not a surprise.
accepts("a self-edge is accepted — cycle detection is out of scope", { ...VALID, edges: [{ from: "n1", to: "n1" }] });

console.log("\nNode fields");
rejects("an unknown node type", { ...VALID, nodes: [{ id: "n1", type: "rm-rf", label: "x" }] }, "invalid node type");
rejects("a node type that is not a string", { ...VALID, nodes: [{ id: "n1", type: 7, label: "x" }] }, "invalid node type");
rejects("an empty node label", { ...VALID, nodes: [{ id: "n1", type: "agent-action", label: "" }] });
rejects("an oversized node label", { ...VALID, nodes: [{ id: "n1", type: "agent-action", label: "x".repeat(201) }] });
rejects("a non-string sourceId", { ...VALID, nodes: [{ id: "n1", type: "agent-action", label: "x", sourceId: { evil: true } }] }, "invalid sourceId");
rejects("an oversized sourceId", { ...VALID, nodes: [{ id: "n1", type: "agent-action", label: "x", sourceId: "s".repeat(201) }] }, "invalid sourceId");

console.log("\nResource exhaustion");
rejects("an oversized nodes array", {
  ...VALID,
  nodes: Array.from({ length: 201 }, (_, i) => ({ id: `n${i}`, type: "agent-action" as const, label: "x" })),
  edges: [],
}, "oversized nodes");
rejects("an oversized edges array", {
  ...VALID,
  edges: Array.from({ length: 401 }, () => ({ from: "n1", to: "n2" })),
}, "oversized edges");
accepts("exactly 200 nodes is accepted", {
  ...VALID,
  nodes: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, type: "agent-action" as const, label: "x" })),
  edges: [],
});

console.log("\nPrototype-pollution and exotic objects");
// Correct property under test: the validator ALLOWLISTS fields — it builds a
// fresh literal from named reads and never spreads or assigns untrusted input.
// So an unknown key is not an error, it is dropped. Verified: JSON.parse makes
// `__proto__` an OWN property (which does not pollute), and no code path here
// spreads it. The security claim is "extras are ignored", not "extras are
// rejected" — rejecting would be a weaker, unrelated guarantee.
const POLLUTING = JSON.parse(
  '{"v":1,"loopId":"l","name":"x","description":"","status":"draft","tag":"custom","nodes":[],"edges":[],"createdAt":"t","publishedAt":1,"__proto__":{"polluted":true}}',
);
check("a __proto__ key cannot reach Object.prototype", () => {
  const r = validateLoopDraft(POLLUTING);
  assert.strictEqual(({} as Record<string, unknown>).polluted, undefined, "Object.prototype was polluted");
  // Accepted on its declared fields alone; the extra key is dropped.
  if (!r.ok) throw new Error(`expected acceptance, got: ${r.reason}`);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(r.value as object, "__proto__"), false);
});
check("a hijacked constructor key is dropped, not copied", () => {
  const r = validateLoopDraft(
    JSON.parse('{"v":1,"loopId":"l","name":"x","description":"","status":"draft","tag":"custom","nodes":[],"edges":[],"createdAt":"t","publishedAt":1,"constructor":{"prototype":{"polluted":true}}}'),
  );
  assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
  if (!r.ok) throw new Error(`expected acceptance, got: ${r.reason}`);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(r.value as unknown as Record<string, unknown>, "constructor"), false);
});
check("unknown extra fields are ignored rather than carried through", () => {
  const r = validateLoopDraft({ ...VALID, somethingElse: "ignored", nested: { deep: 1 } });
  if (!r.ok) throw new Error(`expected acceptance, got: ${r.reason}`);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(r.value as unknown as Record<string, unknown>, "somethingElse"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(r.value as unknown as Record<string, unknown>, "nested"), false);
});
accepts("every node type in the vocabulary is accepted", {
  ...VALID,
  nodes: [
    { id: "a", type: "vault-read", label: "a" },
    { id: "b", type: "vault-write", label: "b" },
    { id: "c", type: "agent-action", label: "c" },
    { id: "d", type: "mcp-call", label: "d" },
    { id: "e", type: "checkpointer", label: "e" },
    { id: "f", type: "verifier", label: "f" },
  ],
  edges: [],
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);