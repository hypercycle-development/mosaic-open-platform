/**
 * Manifest validation against the REAL Mosaic validator.
 *
 * ── RUNS WITH THIS ADD-ON ALONE ─────────────────────────────────────────────
 * Only seven checks need loops-addon; they are loaded lazily and report
 * `SKIP — needs loops-addon` when it is absent, counting as neither pass nor
 * failure. The other thirteen run anywhere.
 *
 * ── PINNED TO A RELEASE TAG ─────────────────────────────────────────────────
 * Validated against mosaic-companion **v0.1.13**, the tag that introduced
 * `addonAPI.buckets` — the same code the app runs at that version, so "it
 * loads" is verified rather than assumed. A moving `main` would change under
 * this test without the diff changing.
 *
 * The companion checkout must have its dependencies installed (npm install):
 * manifest.ts imports `semver`, so a bare checkout fails to load before it
 * validates anything. Node 22+ strips TypeScript types, so no compile step is
 * needed.
 *
 * The require() below reads the checkout's working tree, so point it at a
 * checkout sitting on the tag:
 *
 *   git -C /path/to/mosaic-companion checkout v0.1.13 && npm install
 *   MOSAIC_COMPANION=/path/to/mosaic-companion npm run test:manifest
 */

import assert from "assert";
import fs from "fs";
import path from "path";
// mosaic-companion is a SEPARATE repository, so this file cannot import from
// it by relative path. Resolve it from the environment, defaulting to a sibling
// checkout — a hardcoded absolute path would only ever work on the machine
// that wrote it.
const MOSAIC = process.env.MOSAIC_COMPANION
  ?? path.resolve(__dirname, "..", "..", "..", "..", "mosaic-companion");

/**
 * The tag under test. Pinned deliberately: `main` moves under this suite, so a
 * failure would not be attributable to this diff. v0.1.13 is the release that
 * added `addonAPI.buckets`, which is what this add-on depends on.
 */
const MOSAIC_TAG = "v0.1.13";

if (!fs.existsSync(path.join(MOSAIC, "electron", "addons", "manifest.ts"))) {
  console.error(
    `Could not find mosaic-companion at ${MOSAIC}.\n` +
      "Set MOSAIC_COMPANION to a checkout of that repository.\n" +
      "This test validates the add-on manifests against Mosaic's real\n" +
      "validateManifest(); without it there is nothing to compare against.",
  );
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateManifest } = require(path.join(MOSAIC, "electron", "addons", "manifest.ts")) as {
  validateManifest: (json: unknown, dirName: string) =>
    | { valid: true; manifest: { permissions: string[]; buckets: unknown }; errors: [] }
    | { valid: false; manifest?: undefined; errors: string[] };
};
type AddonManifest = unknown;


let passed = 0;
let failed = 0;
let skipped = 0;
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

const ADDONS = path.resolve(__dirname, "..", "..");
const manifests = {
  "graph-addon": JSON.parse(fs.readFileSync(path.join(ADDONS, "graph-addon/manifest.json"), "utf8")),
} as Record<string, any>;

/**
 * Read the writer's manifest lazily.
 *
 * Seven checks below genuinely need loops-addon present. Reading both at module
 * top level meant that with the other add-on absent this file threw ENOENT
 * before the first check ran, losing all twenty — including the thirteen that
 * never touch it. A lazy read keeps those thirteen reachable on this branch
 * alone and makes the suite honest about the seven it skipped.
 */
function loadLoopsManifest(): any | null {
  if ("loops-addon" in manifests) return manifests["loops-addon"];
  try {
    const m = JSON.parse(fs.readFileSync(path.join(ADDONS, "loops-addon/manifest.json"), "utf8"));
    manifests["loops-addon"] = m;
    return m;
  } catch {
    return null;
  }
}

/** A check that needs loops-addon reports SKIP rather than failing or crashing. */
function checkWithLoops(name: string, fn: (loops: any) => void) {
  const loops = loadLoopsManifest();
  if (!loops) {
    skipped++;
    console.log(`  SKIP — needs loops-addon  ${name}`);
    return;
  }
  check(name, () => fn(loops));
}


/** Minimal shape a manifest must carry to reach the bucket rules. */
function valid(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    manifestVersion: 1,
    id: "test-addon",
    version: "1.0.0",
    name: "Test",
    description: "Test addon for bucket validation",
    ipcNamespace: "testns",
    mountPoint: "tab",
    tab: { label: "Test", icon: "server" },
    renderer: { entry: "renderer/index.html" },
    permissions: ["buckets:publish"],
    buckets: { publishes: [{ id: "loop-drafts", kind: "loop-draft" }], reads: [] },
    updates: { checkMode: "manual" },
    linkVisibilityToActivation: false,
    ...overrides,
  };
}

/**
 * Validate a manifest, deriving `dirName` from its own `id` — the real API is
 * `validateManifest(json, dirName)` and requires id === dirName. Deriving it
 * here keeps every case below honest: a manifest whose id and directory
 * disagree would be rejected for the right reason rather than passing by
 * accident.
 */
function checkManifest(m: Record<string, unknown>) {
  return validateManifest(m, String(m.id));
}

console.log("\nThe two real manifests");
// Load the writer's manifest BEFORE iterating, so the loop below validates
// both add-ons when Loops is present. Previously this loop ran first and
// `manifests` still held only graph-addon, so loops-addon's manifest was never
// checked against the real validateManifest() — even with Loops right there.
loadLoopsManifest();

for (const [id, m] of Object.entries(manifests)) {
  check(`${id}/manifest.json passes validateManifest()`, () => {
    // dirName must equal manifest id — that identity check is part of the schema.
    const r = validateManifest(m, id);
    assert.ok(r.valid, `${id} was rejected: ${r.errors.join("; ")}`);
  });
}

console.log("\nLoops declares the writer contract");
checkWithLoops("loops-addon publishes exactly one bucket", (loops) => {
  assert.strictEqual(loops.buckets.publishes.length, 1);
});
checkWithLoops("the published id is loop-drafts with kind loop-draft", (loops) => {
  const p = loops.buckets.publishes[0];
  assert.strictEqual(p.id, "loop-drafts");
  assert.strictEqual(p.kind, "loop-draft");
});
checkWithLoops("loops-addon holds buckets:publish", (loops) => {
  assert.ok(loops.permissions.includes("buckets:publish"));
});
checkWithLoops("loops-addon reads nothing", (loops) => {
  assert.deepStrictEqual(loops.buckets.reads, []);
});

console.log("\nGraph declares the reader contract");
check("graph-addon reads the loop-draft KIND, not an addon id", () => {
  assert.deepStrictEqual(manifests["graph-addon"].buckets.reads, ["loop-draft"]);
});
check("graph-addon publishes nothing", () => {
  assert.deepStrictEqual(manifests["graph-addon"].buckets.publishes, []);
});
check("graph-addon does NOT hold buckets:publish", () => {
  assert.ok(!manifests["graph-addon"].permissions.includes("buckets:publish"));
});

console.log("\nThe rules that would reject a mistake");
check("publishing without buckets:publish is refused", () => {
  const r = checkManifest(valid({ permissions: [], buckets: { publishes: [{ id: "loop-drafts", kind: "loop-draft" }], reads: [] } }));
  assert.ok(!r.valid, "should have been refused");
  assert.ok(r.errors.some((e) => e.includes("buckets:publish")), r.errors.join("; "));
});
check("buckets:publish with no published bucket is refused", () => {
  const r = checkManifest(valid({ buckets: { publishes: [], reads: [] } }));
  assert.ok(!r.valid, "should have been refused");
  assert.ok(r.errors.some((e) => e.includes("publishes is empty")), r.errors.join("; "));
});
check("a bucket id with uppercase is refused", () => {
  const r = checkManifest(valid({ buckets: { publishes: [{ id: "Loop-Drafts", kind: "loop-draft" }], reads: [] } }));
  assert.ok(!r.valid);
});
check("a kind with uppercase is refused", () => {
  const r = checkManifest(valid({ buckets: { publishes: [{ id: "loop-drafts", kind: "Loop-Draft" }], reads: [] } }));
  assert.ok(!r.valid, `should have been refused, got: ${JSON.stringify(r.errors)}`);
});
check("a kind with an underscore is refused", () => {
  const r = checkManifest(valid({ buckets: { publishes: [{ id: "loop-drafts", kind: "loop_draft" }], reads: [] } }));
  assert.ok(!r.valid, `should have been refused, got: ${JSON.stringify(r.errors)}`);
});
check("an empty kind is refused", () => {
  const r = checkManifest(valid({ buckets: { publishes: [{ id: "loop-drafts", kind: "" }], reads: [] } }));
  assert.ok(!r.valid, `should have been refused, got: ${JSON.stringify(r.errors)}`);
});
// Note: BUCKET_KIND_PATTERN is /^[a-z][a-z0-9-]{1,40}$/ — the same shape as an
// addon id. So a kind that LOOKS like an addon id is syntactically legal. That
// is harmless: a kind is a label, and Graph's read() addresses the bucket by
// owner at call time. This test pins the fact so nobody later mistakes it for a
// missing validation.
check("a kind shaped like an addon id is syntactically legal (pinned, not a bug)", () => {
  const r = checkManifest(valid({ buckets: { publishes: [{ id: "loop-drafts", kind: "loops-addon" }], reads: [] } }));
  assert.ok(r.valid, `expected valid, got: ${r.errors.join("; ")}`);
});
check("reading a kind the addon does not publish is allowed (that is the point)", () => {
  const r = checkManifest(
    valid({ permissions: [], buckets: { publishes: [], reads: ["loop-draft"] } }),
  );
  assert.ok(r.valid, `should be valid, got: ${r.errors.join("; ")}`);
});
checkWithLoops("the two real manifests are complementary — writer kind matches reader", (loops) => {
  const writer = loops.buckets.publishes[0];
  const reader = manifests["graph-addon"].buckets.reads;
  assert.ok(reader.includes(writer.kind), `graph reads [${reader}], loops publishes kind "${writer.kind}"`);
});
checkWithLoops("the reader's owner id matches the writer's addon id", (loops) => {
  assert.strictEqual(loops.id, "loops-addon");
});

console.log("\nNegative controls — these must NOT pass");
check("Graph could not write even if it declared buckets:publish with no publishes", () => {
  const r = checkManifest(
    valid({ id: "graph-addon", ipcNamespace: "graph", permissions: ["buckets:publish"], buckets: { publishes: [], reads: ["loop-draft"] } }),
  );
  assert.ok(!r.valid, "a reader-only addon must not be able to hold buckets:publish");
});

console.log(`\n${passed} passed, ${failed} failed${skipped > 0 ? `, ${skipped} skipped` : ""}`);
if (failed > 0) process.exit(1);