// ============================================================================
// surface.mjs — read the app's published add-on surface.
//
// `addon-surface.json` beside this file is mosaic-companion's own description
// of what an add-on may call, declare and name, generated from its source at a
// named release by its `scripts/addon-surface.mjs`. It is vendored rather than
// fetched so that this repository's checks run offline, run identically for a
// contributor and for CI, and so that the version they are judged against is
// visible in git history instead of being whatever the network returned.
//
// WHY IT IS NOT policy.mjs. `policy.mjs` is a hand-kept mirror of the same
// vocabularies, and mirrors go stale silently. Four review rounds measured the
// cost: three of the four gate failures on the final round were defects in our
// own checking, and a contributor can neither see nor fix one of those. The
// rule that came out of it — a gate that can block a contributor must derive
// its expectations from the application at a pinned version — is what this
// file is for. `policy.mjs` stays for now because `adjudicate.mjs` is built on
// it; everything NEW derives from here.
//
// To update: take the asset from a mosaic-companion release,
//
//   gh release download vX.Y.Z --repo hypercycle-development/mosaic-companion \
//     -p addon-surface.json -O scripts/adjudicate/addon-surface.json
//
// Bumping it is a policy change — it can newly accept or newly refuse a
// submission — so it goes in its own commit, with the release named.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SURFACE_PATH = path.join(SELF_DIR, "addon-surface.json");

export function loadSurface(file = DEFAULT_SURFACE_PATH) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (raw.schema !== 1) {
    throw new Error(`${file}: schema ${raw.schema} is not understood by this version of the adjudicator`);
  }
  return raw;
}

// ── semver, enough of it ────────────────────────────────────────────────────
// Only `major.minor.patch` is ever compared here: every version in play is an
// app release or a manifest's `minAppVersion`, which `validateManifest`
// already requires to be valid semver. Prerelease ordering is deliberately not
// implemented rather than implemented wrongly.
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

/** The newest of the given versions, ignoring anything unparseable. */
export function maxVersion(versions) {
  let best = null;
  for (const v of versions) {
    if (!parseVersion(v)) continue;
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

// ── derived views ───────────────────────────────────────────────────────────

/**
 * `"ns.method"` → `{ permission, since, exposed }` for everything an add-on
 * can call, plus the api methods it cannot.
 *
 * `exposed` is the distinction that matters and the one our own checking got
 * wrong. The real contract is what the preload puts on `window.addonAPI`, not
 * what `addons/api/*.ts` defines: `events.subscribe` exists in the app and the
 * preload calls it for the add-on, but no add-on can call it, while
 * `events.on` is callable and exists only in the preload. Deriving from the
 * api modules failed a submission for using `events.on` — which our own review
 * had told it to use.
 */
export function methodIndex(surface) {
  const index = new Map();
  for (const [ns, spec] of Object.entries(surface.api.namespaces)) {
    for (const [method, m] of Object.entries(spec.methods)) {
      index.set(`${ns}.${method}`, { ...m, exposed: true, namespace: ns, method });
    }
  }
  for (const [key, m] of Object.entries(surface.api.internal ?? {})) {
    const [ns, method] = key.split(".");
    if (index.has(key)) continue;
    index.set(key, { ...m, since: null, exposed: false, namespace: ns, method });
  }
  return index;
}

/** The namespaces an add-on can reach, as a Set. */
export function namespaceNames(surface) {
  return new Set(Object.keys(surface.api.namespaces));
}

/** Top-level `addonAPI.<member>` calls — `init`, `invoke`, `parseError`. */
export function memberNames(surface) {
  return new Set(Object.keys(surface.api.members ?? {}));
}

/**
 * The oldest app version that could run an add-on calling all of `keys`.
 *
 * `null` when nothing in `keys` has a recorded `since` — which is the only
 * honest answer, and the reason this returns rather than guessing: a floor
 * derived from missing data would block a manifest for a claim nobody measured.
 */
export function versionFloor(surface, keys) {
  const index = methodIndex(surface);
  const versions = [];
  for (const key of keys) {
    const entry = index.get(key);
    if (entry?.since) versions.push(entry.since);
  }
  // The bridge itself has a birthday: an add-on calling any method at all
  // cannot run on an app that had no add-ons. That is the floor under the
  // floor, and it holds even for a method whose own `since` is unknown.
  if (!versions.length && keys.length && surface.sinceHorizon) return surface.sinceHorizon;
  return maxVersion(versions);
}

/**
 * Is `since` only a floor rather than a date? A method present in the oldest
 * release the generator could read appeared AT OR BEFORE it, so a check must
 * not report it as "introduced in" that version.
 */
export function isHorizon(surface, version) {
  return Boolean(version) && version === surface.sinceHorizon;
}
