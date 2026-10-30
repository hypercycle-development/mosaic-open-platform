#!/usr/bin/env node
// ============================================================================
// checks.mjs — the mechanical checks on a submitted add-on that a reviewer was
// otherwise doing by eye.
//
// `adjudicate.mjs` rules on the PATCH: what it touches, whether it applies,
// whether the manifest and the declared dependency ranges conform. This rules
// on the RESULT: the add-on as it sits in the tree, read against the app's own
// published surface and against its own claims.
//
// Run it before you submit. Everything here is deterministic, nothing here
// executes your code, and a gate that fails tells you exactly what to change:
//
//   node scripts/adjudicate/checks.mjs --addon my-addon
//
// Options:
//   --addon <id>       (required) the add-on directory under addons/
//   --src <dir>        tree containing addons/ (default: this repository)
//   --surface <file>   app surface to judge against (default: the vendored
//                      addon-surface.json beside this script)
//   --patch <file>     a `git format-patch` file, to check DCO sign-offs
//   --base-ref <ref>   git ref holding the EXISTING catalogue, for id and
//                      ipcNamespace collisions (e.g. origin/main)
//   --json             append a machine-readable report
//
// GATES block: the submission cannot be merged as it stands. FLAGS are the
// agenda for human review and never affect the exit code. NOTES are context.
//
// Exit 0 if no gate failed, 1 otherwise.
//
// ── the rule this file is built to obey ────────────────────────────────────
// A gate that can block a contributor must derive its expectations from the
// application at a pinned version, never from a mirrored list, and must never
// read a comment as code. Three of the four gate failures on the final round
// of the first two external submissions were defects in our own checking: an
// add-on failed for calling a method that exists, another failed for "needing
// mcp:call" on the strength of a comment explaining why it does not call it. A
// false block costs more than a missed flag, because the contributor can
// neither act on it nor see why. See issue #19 for the measured basis.
// ============================================================================

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadSurface,
  methodIndex,
  namespaceNames,
  memberNames,
  versionFloor,
  isHorizon,
  compareVersions,
  parseVersion,
} from "./surface.mjs";
import { PERMISSION_VOCABULARY, RESERVED_PERMISSIONS, RESERVED_IPC_NAMESPACES } from "./policy.mjs";

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = path.resolve(SELF_DIR, "..", "..");

// ── args ────────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const key = a.slice(2);
  const next = process.argv[i + 1];
  if (next && !next.startsWith("--")) {
    args[key] = next;
    i++;
  } else {
    args[key] = true;
  }
}
if (!args.addon || args.help) {
  console.error(
    "usage: checks.mjs --addon <id> [--src <dir>] [--surface <file>] [--patch <file>] [--base-ref <ref>] [--json]",
  );
  process.exit(args.help ? 0 : 2);
}

const SRC = path.resolve(args.src || DEFAULT_SRC);
const ADDON = args.addon;
const DIR = path.join(SRC, "addons", ADDON);
if (!existsSync(DIR)) {
  console.error(`checks.mjs: no such add-on directory: ${path.relative(process.cwd(), DIR)}`);
  process.exit(2);
}

const surface = loadSurface(typeof args.surface === "string" ? path.resolve(args.surface) : undefined);

// ── report accumulator ──────────────────────────────────────────────────────
const checks = [];
const add = (tier, id, status, title, detail = "") => checks.push({ tier, id, status, title, detail });
const gate = (id, ok, title, detail) => add("gate", id, ok ? "pass" : "fail", title, detail);
const flag = (id, hit, title, detail) => add("flag", id, hit ? "flag" : "pass", title, detail);
const info = (id, title, detail) => add("info", id, "info", title, detail);

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

// ── the add-on's files ──────────────────────────────────────────────────────
// THE SUBMISSION IS WHAT IS COMMITTED, and in a git tree `ls-files` says so
// exactly. Nothing else does.
//
// Reading the directory instead is wrong in a way that only shows up once
// somebody has run a build. `dist/` and a built `renderer/` are untracked
// output, and they contain other people's code: a bundle inlines its
// dependencies, so a test bundle in graph-addon's `dist/` carries
// loops-addon's publisher and a copy of the app's own `manifest.ts`. Scanned,
// that made a clean add-on look like it was calling `buckets.write` without
// declaring `buckets:publish` — a submission whose own tests assert the
// opposite, failed for code it does not contain. And the instruction on this
// tool is "run it before you submit", so a contributor's tree having been
// built is the normal case, not the exception.
//
// A hand-written `renderer/` is kept, because it is tracked. That matters
// independently: `addons/*/renderer/` is gitignored repo-wide, so filtering on
// ignore status would drop it — and for an add-on with no build step it holds
// every line that calls `addonAPI`.
function walkDir(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "dist") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkDir(p, out);
    else out.push(p);
  }
  return out;
}

function trackedFiles() {
  try {
    const out = execFileSync("git", ["-C", SRC, "ls-files", "-z", "--", `addons/${ADDON}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const list = out.split("\0").filter(Boolean).map((r) => path.join(SRC, r));
    return list.length ? list : null;
  } catch {
    return null; // not a git tree — an extracted tarball, say
  }
}

const tracked = trackedFiles();
// The fallback walk keeps `--src` usable on an extracted tree, which is how
// the operational driver hands over a frozen snapshot of a patch.
const files = tracked ?? walkDir(DIR);
const rel = (p) => path.relative(DIR, p);
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css"]);
const sourceFiles = files.filter((p) => SOURCE_EXT.has(path.extname(p)));

/**
 * Comments removed, line count preserved.
 *
 * Every scan below that can fail a submission runs on this and not on the raw
 * text. A comment mentioning an API is not a call to it, and reading one as a
 * call is how an add-on came to be failed for a method it had deliberately
 * chosen not to use. `://` is left alone so a URL is not read as a comment; a
 * comment-shaped string literal is over-stripped, which costs a match rather
 * than inventing one — the safe direction for a gate.
 */
function stripComments(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split("\n")) {
    let line = "";
    let i = 0;
    while (i < raw.length) {
      if (inBlock) {
        const end = raw.indexOf("*/", i);
        if (end === -1) i = raw.length;
        else {
          inBlock = false;
          i = end + 2;
        }
        continue;
      }
      const blockStart = raw.indexOf("/*", i);
      const lineStart = raw.indexOf("//", i);
      if (lineStart !== -1 && (blockStart === -1 || lineStart < blockStart)) {
        if (raw[lineStart - 1] === ":") {
          line += raw.slice(i, lineStart + 2);
          i = lineStart + 2;
          continue;
        }
        line += raw.slice(i, lineStart);
        i = raw.length;
        continue;
      }
      if (blockStart !== -1) {
        line += raw.slice(i, blockStart);
        i = blockStart + 2;
        inBlock = true;
        continue;
      }
      line += raw.slice(i);
      i = raw.length;
    }
    out.push(line);
  }
  return out.join("\n");
}

const codeOf = new Map(sourceFiles.map((p) => [p, stripComments(readFileSync(p, "utf8"))]));

const manifest = readJson(path.join(DIR, "manifest.json"));
const pkg = readJson(path.join(DIR, "package.json"));

/**
 * The renderer's files — everything except the add-on's main-process module.
 *
 * `window.addonAPI` exists only in the webview. Main-process code is imported
 * straight into the app with full Node access, has no `window` at all, and the
 * permission model does not reach it; scanning it for bridge calls finds
 * nothing but coincidences. It found one: `'https://api.hyperinsight.app/v1'`
 * read as a call to an `api.hyperinsight` namespace.
 *
 * That main code is the part of a submission most in need of a person, which
 * is what `MAIN_ENTRY_ALLOWLIST` is for — not something these scans cover.
 */
const mainDir = typeof manifest?.main?.entry === "string" ? manifest.main.entry.split("/")[0] : null;
const rendererFiles = mainDir
  ? sourceFiles.filter((p) => !rel(p).startsWith(`${mainDir}/`))
  : sourceFiles;
const rendererCode = rendererFiles.map((p) => codeOf.get(p)).join("\n");

info("surface", "judged against app surface", `${surface.app.name} ${surface.app.describe} (${surface.app.version})`);

gate("manifest-present", !!manifest, "manifest.json parses");
if (manifest) {
  gate(
    "manifest-id-matches-dir",
    manifest.id === ADDON,
    "manifest id matches directory name",
    `manifest.id=${JSON.stringify(manifest.id)}, directory=${ADDON}`,
  );
  info(
    "manifest-summary",
    "manifest",
    `name=${manifest.name} version=${manifest.version} ipcNamespace=${manifest.ipcNamespace ?? "(none)"} ` +
      `minAppVersion=${manifest.minAppVersion ?? "(none)"}`,
  );
}

// ── LICENSE ─────────────────────────────────────────────────────────────────
// CONTRIBUTING.md requires one in the add-on directory. LICENSING.md also asks
// for an SPDX id in the manifest, and says in the same breath that the schema
// carries no `license` field yet and it "cannot be validated or required"
// (mosaic-companion#138) — so its absence is reported, never failed.
{
  const licensePath = path.join(DIR, "LICENSE");
  const hasLicense = existsSync(licensePath);
  gate("license-present", hasLicense, "LICENSE present in the add-on directory");
  if (hasLicense) {
    const text = readFileSync(licensePath, "utf8");
    let detected = "unrecognised";
    if (/Permission is hereby granted, free of charge/.test(text) && /THE SOFTWARE IS PROVIDED "AS IS"/.test(text))
      detected = "MIT";
    else if (/Apache License/.test(text) && /Version 2\.0/.test(text)) detected = "Apache-2.0";
    else if (/GNU (GENERAL PUBLIC|LESSER|AFFERO)/.test(text)) detected = "GPL-family";
    else if (/Redistribution and use in source and binary forms/.test(text)) detected = "BSD";
    else if (/Mozilla Public License/.test(text)) detected = "MPL-2.0";

    gate("license-recognised", detected !== "unrecognised", "LICENSE is a recognised OSI text", `reads as ${detected}`);

    // Copyleft for the add-on's OWN code is unanalysed policy, not a defect —
    // LICENSING.md says so in terms. Surface it for a decision.
    flag(
      "license-copyleft",
      detected === "GPL-family" || detected === "MPL-2.0",
      "the add-on's own licence is copyleft (LICENSING.md: position not worked through)",
      detected,
    );

    // A licence with no holder is a contract gap, not a nit: LICENSING.md is
    // explicit that the contributor keeps their copyright.
    //
    // Where the holder goes depends on the licence, and getting that wrong
    // fails a correct submission. MIT and BSD carry the notice in the licence
    // text itself. Apache-2.0 and MPL-2.0 do not — their body is boilerplate
    // whose only holder slot is an appendix most projects leave as a template,
    // and the convention is a NOTICE file alongside. Requiring a
    // `Copyright (c)` line in the LICENSE regardless failed our own
    // Apache-2.0 add-on.
    const NOTICE_IN_TEXT = new Set(["MIT", "BSD", "unrecognised"]);
    const noticeFile = ["NOTICE", "NOTICE.txt", "NOTICE.md", "COPYRIGHT"]
      .map((f) => path.join(DIR, f))
      .find((f) => existsSync(f));
    const holderIn = (s) => {
      const m = s && /Copyright\s*(?:\(c\)|©)?\s*(\d[^\n]*)/i.exec(s);
      return m && !/\[|<|YEAR|NAME|yyyy/i.test(m[1]) ? m[1].trim() : null;
    };
    const holder = holderIn(text) ?? (noticeFile ? holderIn(readFileSync(noticeFile, "utf8")) : null);
    const where = holder && !holderIn(text) ? path.basename(noticeFile) : "LICENSE";
    if (NOTICE_IN_TEXT.has(detected)) {
      gate(
        "license-has-holder",
        !!holder,
        "the licence names a copyright holder",
        holder ? `"${holder}" in ${where}` : `${detected} carries its notice in the licence text, and there is none`,
      );
    } else {
      flag(
        "license-has-holder",
        !holder,
        "no copyright holder found for a licence whose text does not carry one",
        holder
          ? `"${holder}" in ${where}`
          : `${detected}'s body is boilerplate; add a NOTICE file naming the holder ` +
            `(LICENSING.md: the contributor keeps their copyright)`,
      );
    }

    const declared = manifest?.license ?? pkg?.license;
    if (declared) {
      gate(
        "license-matches-declared",
        String(declared).startsWith(detected.replace("-family", "")),
        "declared SPDX id matches the LICENSE text",
        `declared=${declared}, file reads as ${detected}`,
      );
    } else {
      info(
        "license-undeclared",
        "no SPDX id declared",
        `LICENSE reads as ${detected}; the manifest schema has no license field yet ` +
          `(mosaic-companion#138), so this is expected`,
      );
    }
  }
}

// ── DCO ─────────────────────────────────────────────────────────────────────
if (typeof args.patch === "string" && existsSync(args.patch)) {
  const patch = readFileSync(args.patch, "utf8");
  const commits = patch.split(/^From [0-9a-f]{40} /m).slice(1);
  const authors = [...patch.matchAll(/^From: (.+)$/gm)].map((m) => m[1]);
  const signoffs = [...patch.matchAll(/^Signed-off-by: (.+)$/gm)].map((m) => m[1].trim());
  gate(
    "dco-present",
    commits.length > 0 && commits.every((c) => /^Signed-off-by: /m.test(c)),
    "every commit carries Signed-off-by",
    `${commits.length} commit(s), ${signoffs.length} sign-off line(s)`,
  );

  // The DCO is an assertion BY THE AUTHOR. A sign-off from somebody else, with
  // none from the author, is the case worth catching.
  const emailOf = (s) => (s.match(/<([^>]+)>/) || [])[1]?.toLowerCase();
  const authorEmails = new Set(authors.map(emailOf).filter(Boolean));
  const signoffEmails = new Set(signoffs.map(emailOf).filter(Boolean));
  gate(
    "dco-matches-author",
    [...authorEmails].some((e) => signoffEmails.has(e)),
    "a Signed-off-by matches the commit author",
    `author(s)=${[...authorEmails].join(", ")}; sign-off(s)=${[...signoffEmails].join(", ")}`,
  );
}

// ── lockfiles ───────────────────────────────────────────────────────────────
// EVERY npm project in the add-on, not just one at the root. An add-on with no
// npm project at all — a hand-written .mjs renderer, no build step — must not
// be failed for a lockfile it should never have had, and an add-on whose only
// project lives in a subdirectory must not have that project go unexamined.
// PR #9 was both at once.
const projects = [...new Set(files.filter((p) => p.endsWith("package.json")).map(path.dirname))].sort();

if (projects.length === 0) {
  info("lockfile-none", "no npm project in the add-on", "no package.json under the add-on directory, nothing to lock");
}

const rootGate = gate;
const rootFlag = flag;

for (const projDir of projects) {
  const label = path.relative(DIR, projDir) || "root";
  const bare = projects.length === 1 && label === "root";
  const g = (id, ok, title, detail) =>
    rootGate(bare ? id : `${id}:${label}`, ok, bare ? title : `${title} — ${label}/`, detail);
  const f = (id, hit, title, detail) =>
    rootFlag(bare ? id : `${id}:${label}`, hit, bare ? title : `${title} — ${label}/`, detail);

  const projPkg = readJson(path.join(projDir, "package.json"));
  const lock = readJson(path.join(projDir, "package-lock.json"));

  // Everything below is only worth anything because publication runs `npm ci`
  // and not `npm install`: under `install` the lockfile is advisory and all of
  // this describes a file the build then ignores. The two are one decision.
  //
  // Which project needs a lockfile follows from exactly that. `build-addon.mjs`
  // runs `npm ci` in the add-on's ROOT and nowhere else, and `npm ci` fails
  // outright without a lockfile — so a root package.json with none does not
  // merely risk drift, it breaks publication. A package.json in a
  // SUBDIRECTORY is never installed by anything here, and demanding a lockfile
  // for it failed our own add-on, whose `main/package.json` is
  // `{"type": "module"}` and nothing else.
  if (label === "root") {
    g(
      "lockfile-present",
      !!lock,
      "package-lock.json present and parses",
      lock
        ? `lockfileVersion ${lock.lockfileVersion}, ${Object.keys(lock.packages ?? {}).length} package(s)`
        : "publication runs `npm ci`, which fails outright with no lockfile",
    );
  } else if (!lock) {
    info(
      `lockfile-none:${label}`,
      `no lockfile — ${label}/`,
      "publication installs only the add-on root, so nothing here is resolved from this file",
    );
  }
  if (!lock) continue;

  const pkgs = lock.packages ?? {};
  const names = Object.keys(pkgs);
  const entries = names.filter((n) => pkgs[n].resolved);
  const shortName = (n) => n.replace(/^.*node_modules\//, "");

  const nonRegistry = entries.filter((n) => !/^https:\/\/registry\.npmjs\.org\//.test(pkgs[n].resolved));
  g(
    "lock-registry-only",
    nonRegistry.length === 0,
    "every resolved dependency comes from registry.npmjs.org",
    nonRegistry.length
      ? nonRegistry.map((n) => `${n} → ${pkgs[n].resolved}`).join("; ")
      : `${entries.length} resolved entries`,
  );

  const noIntegrity = entries.filter((n) => !pkgs[n].integrity);
  g(
    "lock-integrity",
    noIntegrity.length === 0,
    "every resolved dependency carries an integrity hash",
    noIntegrity.length ? noIntegrity.join(", ") : `${entries.length} entries hashed`,
  );

  g(
    "lock-name-matches",
    !projPkg || !lock.name || lock.name === projPkg.name,
    "lockfile name matches package.json name",
    `lock=${lock.name} package=${projPkg?.name}`,
  );

  if (projPkg) {
    const declared = { ...(projPkg.dependencies ?? {}), ...(projPkg.devDependencies ?? {}) };
    const missing = Object.keys(declared).filter((d) => !pkgs[`node_modules/${d}`]);
    g(
      "lock-covers-declared",
      missing.length === 0,
      "lockfile resolves every declared dependency",
      missing.length ? `missing: ${missing.join(", ")}` : `${Object.keys(declared).length} declared`,
    );
  }

  // The real supply-chain surface: which transitive packages run code at
  // install time. npm records it, so nobody should have to guess.
  const installScripts = names.filter((n) => pkgs[n].hasInstallScript);
  f(
    "lock-install-scripts",
    installScripts.length > 0,
    "transitive dependencies that run install scripts",
    installScripts.length ? [...new Set(installScripts.map(shortName))].sort().join(", ") : "none",
  );

  // An alias installs something other than what its path says. The root entry
  // ("" / the add-on itself) legitimately has an unrelated name.
  const aliased = names.filter(
    (n) => n.includes("node_modules/") && pkgs[n].name && pkgs[n].name !== n.split("node_modules/").pop(),
  );
  f(
    "lock-aliases",
    aliased.length > 0,
    "lockfile entries whose name differs from their path",
    aliased.length ? aliased.map((n) => `${n} → ${pkgs[n].name}`).join(", ") : "none",
  );

  // LICENSING.md, "Copyleft is unanalysed": the release build ships the bundle
  // your own build produced, so a copyleft RUNTIME dependency is inlined into
  // the distributed artifact whatever licence the add-on itself carries — "and
  // nothing currently checks for it". This is that check. Dev dependencies
  // build the bundle but are not in it, so they are reported apart.
  const COPYLEFT = /\b(GPL|LGPL|AGPL|MPL|EPL|CDDL|CPL|OSL|SSPL)\b/i;
  const runtime = names.filter((n) => n.includes("node_modules/") && !pkgs[n].dev);
  const devOnly = names.filter((n) => n.includes("node_modules/") && pkgs[n].dev);

  const runtimeCopyleft = runtime.filter((n) => pkgs[n].license && COPYLEFT.test(String(pkgs[n].license)));
  g(
    "dep-license-runtime",
    runtimeCopyleft.length === 0,
    "no copyleft licence among dependencies inlined into the bundle",
    runtimeCopyleft.length
      ? runtimeCopyleft.map((n) => `${shortName(n)} (${pkgs[n].license})`).join(", ")
      : `${runtime.length} runtime dependencies`,
  );

  const devCopyleft = devOnly.filter((n) => pkgs[n].license && COPYLEFT.test(String(pkgs[n].license)));
  f(
    "dep-license-dev",
    devCopyleft.length > 0,
    "copyleft licence among build-only dependencies (not inlined, but note it)",
    devCopyleft.length ? devCopyleft.map((n) => `${shortName(n)} (${pkgs[n].license})`).join(", ") : "none",
  );

  const unlicensed = [...runtime, ...devOnly].filter((n) => !pkgs[n].license);
  f(
    "dep-license-missing",
    unlicensed.length > 0,
    "dependencies with no licence recorded in the lockfile",
    unlicensed.length ? unlicensed.map(shortName).join(", ") : "none",
  );
}

// ── the app's surface: does this add-on call things that exist? ─────────────
const index = methodIndex(surface);
const namespaces = namespaceNames(surface);
const members = memberNames(surface);
const callable = new Set([...index].filter(([, m]) => m.exposed).map(([k]) => k));

info(
  "bridge-surface",
  "bridge surface",
  `${callable.size} callable method(s) across ${namespaces.size} namespace(s), ` +
    `plus addonAPI.${[...members].join("/")}`,
);

if (mainDir) {
  info(
    "main-entry",
    "⚑ ELEVATED: this add-on ships a main-process module",
    `${mainDir}/ runs outside the webview with full Node access and the permission model does not ` +
      `reach it — read it in full. The addonAPI scans below deliberately skip it.`,
  );
}

/** Is `ns.name` called anywhere in the renderer? `a?.b?.()` counts. */
const calls = (ns, name) => new RegExp(`\\b${ns}\\s*(\\?\\.|\\.)\\s*${name}\\s*(\\?\\.)?\\s*\\(`).test(rendererCode);

{
  // An add-on calling a method the bridge does not expose is not a security
  // problem — it is a silently dead feature, and every claim resting on it is
  // false. Optional chaining makes it invisible at runtime: the call is
  // skipped, a fallback renders, nothing throws. Four such calls shipped in
  // the first two submissions.
  const badCalls = [];
  const methodsOf = (ns) =>
    [...callable]
      .filter((k) => k.startsWith(`${ns}.`))
      .map((k) => k.split(".")[1])
      .sort()
      .join(", ");

  // The root is `addonAPI`, or `window.addonAPI`, or a local alias of it —
  // `const api = window.addonAPI` is the common form. NOT a bare `window.x.y`:
  // `window.location.reload()` is not a bridge call, and reading it as one
  // blocked an add-on for using the DOM. A reference to some OTHER host global
  // is a real concern and has its own targeted check below.
  //
  // The lookbehind keeps a dotted path out of it. Without it the `api` alias
  // matches inside a URL: `'https://api.hyperinsight.app/v1'` was reported as
  // a call to a namespace called "hyperinsight".
  const BRIDGE_CALL =
    /(?<![\w$.\/:-])(?:window\s*\??\.\s*)?(addonAPI|api)\s*\??\.\s*([a-zA-Z_$][\w$]*)\s*\??\.\s*([a-zA-Z_$][\w$]*)\s*\(/g;
  const BRIDGE_PROBE =
    /(?<![\w$.\/:-])(?:window\s*\??\.\s*)?(addonAPI|api)\s*\??\.\s*([a-zA-Z_$][\w$]*)\s*\??\.\s*([a-zA-Z_$][\w$]*)\b(?!\s*\()/g;

  for (const p of rendererFiles) {
    codeOf.get(p).split("\n").forEach((line, i) => {
      const where = `${rel(p)}:${i + 1}`;
      for (const m of line.matchAll(BRIDGE_CALL)) {
        const [, root, ns, name] = m;
        if (namespaces.has(ns)) {
          if (callable.has(`${ns}.${name}`)) continue;
          badCalls.push(
            index.get(`${ns}.${name}`)
              ? `${where}: ${ns}.${name}() — exists in the app but is not on window.addonAPI; ` +
                  `${ns} offers: ${methodsOf(ns)}`
              : `${where}: ${ns}.${name}() — no such method (${ns} has: ${methodsOf(ns)})`,
          );
        } else if (members.has(ns)) {
          // `addonAPI.invoke("x", …)` reaching the add-on's own main handler,
          // or `addonAPI.parseError(e).code` — a member, then a property of
          // whatever it returned. Not a namespace and nothing to check.
          continue;
        } else {
          badCalls.push(
            `${where}: ${root}.${ns}.${name}() — "${ns}" is not an addonAPI namespace ` +
              `(have: ${[...namespaces].sort().join(", ")})`,
          );
        }
      }
      // Bare property probes — `addonAPI?.vault?.getBoxes` used as a truthiness
      // test — never reach the call form above, and were how one dead feature
      // presented itself.
      for (const m of line.matchAll(BRIDGE_PROBE)) {
        const [, , ns, name] = m;
        if (badCalls.some((b) => b.startsWith(where))) continue;
        if (members.has(ns)) continue;
        if (!namespaces.has(ns)) badCalls.push(`${where}: ${ns}.${name} — "${ns}" is not an addonAPI namespace`);
        else if (!callable.has(`${ns}.${name}`)) badCalls.push(`${where}: ${ns}.${name} — no such method on ${ns}`);
      }
    });
  }
  gate(
    "api-methods-exist",
    badCalls.length === 0,
    "every addonAPI call names a method the app exposes",
    badCalls.length ? badCalls.join("\n           ↳ ") : `${callable.size} callable methods`,
  );
}

// ── permission coherence ────────────────────────────────────────────────────
{
  const declared = Array.isArray(manifest?.permissions) ? manifest.permissions : [];
  const usedUndeclared = [];
  const satisfied = new Set();
  for (const [key, m] of index) {
    if (!m.exposed || !m.permission) continue;
    if (!calls(m.namespace, m.method)) continue;
    if (declared.includes(m.permission)) satisfied.add(m.permission);
    else usedUndeclared.push(`${key} needs ${m.permission}`);
  }
  gate(
    "perm-used-undeclared",
    usedUndeclared.length === 0,
    "no API call requires a permission the manifest does not declare",
    usedUndeclared.length ? usedUndeclared.join("; ") : `${declared.length} declared`,
  );

  // Declared but never called: an over-broad ask. A question, never a block —
  // an add-on may legitimately hold a permission for a path this scan cannot
  // see, and refusing it would be refusing a guess.
  const unused = declared.filter((p) => !satisfied.has(p));
  flag(
    "perm-declared-unused",
    unused.length > 0,
    "declared permissions with no corresponding call in the source",
    unused.length ? `${unused.join(", ")} — ask why each is requested` : `all ${declared.length} declared are used`,
  );
}

// ── NEW: does tab.icon resolve to something the sidebar can draw? ──────────
// `validateManifest` checks only that it is a non-empty string, so a name the
// sidebar does not know renders the fallback icon and nothing says so. Two
// add-ons shipped that way and it was found after merge (#17, #18) — "caught
// by nothing at all" in the measurement behind #19.
{
  const icons = surface.tabIcons?.names ?? [];
  const declaredIcon = manifest?.tab?.icon;
  if (!icons.length) {
    info("tab-icon", "tab.icon", "the app surface publishes no icon set; skipped");
  } else if (typeof declaredIcon !== "string" || declaredIcon.length === 0) {
    // adjudicate.mjs stage 3 already fails a manifest with no tab.icon; not
    // this check's business to fail it a second time.
    info("tab-icon", "tab.icon", "not declared — see the stage 3 manifest gates");
  } else {
    const ok = icons.includes(declaredIcon);
    const near = icons.filter((n) => n.toLowerCase() === declaredIcon.toLowerCase());
    gate(
      "tab-icon-renders",
      ok,
      "tab.icon is an icon the sidebar can draw",
      ok
        ? `"${declaredIcon}"`
        : `"${declaredIcon}" is not in the app's icon set, so the tab would render ` +
          `${surface.tabIcons.fallback ? `the ${surface.tabIcons.fallback} fallback` : "a fallback"} instead.` +
          (near.length ? ` Case matters — did you mean "${near[0]}"?` : "") +
          ` Available: ${icons.join(", ")}`,
    );
  }
}

// ── NEW: is minAppVersion consistent with the APIs called? ─────────────────
// Validated as semver and against nothing else, so an add-on can declare a
// floor older than the release that introduced an API it calls. One did:
// `0.1.7` against `addonAPI.buckets`, which arrived in 0.1.13.
{
  const used = [...callable].filter((k) => {
    const m = index.get(k);
    return calls(m.namespace, m.method);
  });
  const floor = versionFloor(surface, used);
  const declaredFloor = manifest?.minAppVersion;

  if (!used.length) {
    info("min-app-version", "minAppVersion", "the add-on calls no addonAPI method, so no floor is implied");
  } else if (!floor) {
    info("min-app-version", "minAppVersion", "the app surface records no version history; skipped");
  } else {
    const basis = used
      .filter((k) => index.get(k).since === floor)
      .sort()
      .join(", ");
    const atHorizon = isHorizon(surface, floor);
    const because = atHorizon
      ? `the add-on bridge itself first shipped in ${floor}`
      : `${basis} ${basis.includes(",") ? "arrived" : "arrived"} in ${floor}`;

    if (typeof declaredFloor !== "string" || !parseVersion(declaredFloor)) {
      // Absent is not wrong — the field is optional, and an absent floor makes
      // no false claim. It does leave a user on an older build to find out by
      // the feature not working, so it is worth asking for.
      flag(
        "min-app-version",
        true,
        "minAppVersion is not declared, and the add-on needs a specific app version",
        `declare "minAppVersion": "${floor}" — ${because}`,
      );
    } else {
      const ok = compareVersions(declaredFloor, floor) >= 0;
      gate(
        "min-app-version",
        ok,
        "minAppVersion is consistent with the APIs the add-on calls",
        ok
          ? `declares ${declaredFloor}, needs at least ${floor}`
          : `declares ${declaredFloor} but needs at least ${floor} — ${because}. ` +
            `On an app older than ${floor} those calls do not exist, and optional chaining ` +
            `means the feature fails silently rather than reporting anything.`,
      );
    }
  }
}

// ── reaching for a host bridge other than addonAPI ─────────────────────────
// `window.addonAPI` is the whole contract. A reference to any other host
// global is either code written against the core renderer, where `electronAPI`
// does exist, or a search for a way round the permission model. Both need
// saying out loud; which one it is, is a judgment call.
{
  const OTHER_BRIDGE =
    /\bwindow\s*\??\.\s*((?:[A-Za-z_$][\w$]*API|mosaic[\w$]*|electron[\w$]*|secureWalletImport|chatAPI|agent|memory))\b/g;
  const probes = [];
  for (const p of sourceFiles) {
    codeOf.get(p).split("\n").forEach((line, i) => {
      for (const m of line.matchAll(OTHER_BRIDGE)) {
        if (m[1] === "addonAPI") continue;
        probes.push(`${rel(p)}:${i + 1}: window.${m[1]} — the add-on bridge is window.addonAPI`);
      }
    });
  }
  gate(
    "no-other-host-bridge",
    probes.length === 0,
    "no reference to a host global other than window.addonAPI",
    probes.length ? probes.join("\n           ↳ ") : "only window.addonAPI",
  );
}

// ── cross-frame messaging ───────────────────────────────────────────────────
// An add-on runs in a <webview>, which is a top-level browsing context: its
// `window.parent` is itself, and the host listens for no `message` events. So
// this is normally a dead feature rather than an escape. It is still ruled on
// every time — a wildcard target origin is the shape a real attempt to talk to
// something outside the sandbox would take.
{
  const hits = [];
  for (const p of sourceFiles) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/\b(parent|top|opener)\s*\??\.\s*postMessage\s*\(|\baddEventListener\s*\(\s*["']message["']/.test(line)) {
        hits.push(`${rel(p)}:${i + 1}: ${line.trim().slice(0, 110)}`);
      }
    });
  }
  flag(
    "cross-frame-messaging",
    hits.length > 0,
    "cross-frame messaging (an add-on webview is top-level; parent is itself)",
    hits.length ? hits.join("\n    ") : "none",
  );
}

// ── storage, against what the submission claims ─────────────────────────────
// An add-on that says it persists "via a bucket" but writes to localStorage is
// making a claim the code does not keep. One did, with a button reporting a
// publish it never performed.
{
  const hits = [];
  for (const p of sourceFiles) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/\b(localStorage|sessionStorage|indexedDB)\b/.test(line)) {
        hits.push(`${rel(p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
  flag(
    "browser-storage",
    hits.length > 0,
    "browser storage used (check it against what the submission claims)",
    hits.length ? hits.join("\n    ") : "none",
  );
}

// ── collisions against the catalogue as it stands ──────────────────────────
// Against a git ref, not the working tree: in a pull-request checkout the
// add-on under review is already present, so "is this id taken" asked of the
// checkout answers yes, every time, about itself.
if (typeof args["base-ref"] === "string") {
  const ref = args["base-ref"];
  const git = (a) =>
    execFileSync("git", ["-C", SRC, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let existing = null;
  try {
    existing = git(["ls-tree", "--name-only", `${ref}:addons`]).split("\n").filter(Boolean);
  } catch {
    info("collision", "catalogue collisions", `could not read addons/ at ${ref}; skipped`);
  }
  if (existing) {
    const isUpdate = existing.includes(ADDON);
    const others = existing.filter((d) => d !== ADDON);
    // Whether this is a new listing or a revision of one changes what the rest
    // of the review is for, and it is not otherwise stated anywhere. It is not
    // a gate: an id "already taken" by the add-on itself is the normal case for
    // every update, and gating on it would fail every revision of every listed
    // add-on — including the ones this pipeline was built reviewing.
    info(
      "listing-kind",
      isUpdate ? `an UPDATE to "${ADDON}", already listed` : `a NEW listing, "${ADDON}"`,
      `catalogue at ${ref}: ${existing.join(", ") || "(empty)"}`,
    );

    const nsInUse = new Map();
    for (const d of others) {
      try {
        const m = JSON.parse(git(["show", `${ref}:addons/${d}/manifest.json`]));
        if (m?.ipcNamespace) nsInUse.set(m.ipcNamespace, d);
      } catch {
        /* an add-on with no readable manifest at that ref claims no namespace */
      }
    }
    const ns = manifest?.ipcNamespace;
    gate(
      "ipcns-unique",
      !ns || !nsInUse.has(ns),
      "ipcNamespace does not collide with another add-on",
      ns ? `${ns}${nsInUse.has(ns) ? ` — taken by ${nsInUse.get(ns)}` : ""}` : "(none declared)",
    );
    // The app refuses an ipcNamespace on its reserved list outright, so this is
    // not a style point; adjudicate.mjs gates it from policy.mjs, and the
    // drift report below is what keeps that list honest.
  }
}

// ── dead source ─────────────────────────────────────────────────────────────
// A file nobody imports is not a defect, but it is reviewer time spent on code
// that cannot run, and it inflates the diff a person has to justify signing.
{
  const entryish = /(^|\/)(main|index|App)\.(t|j)sx?$|\.(html|css)$|\.config\.(t|j)s$|vite-env\.d\.ts$/;
  const unreferenced = [];
  for (const p of sourceFiles) {
    const r = rel(p);
    if (entryish.test(r)) continue;
    const stem = r.replace(/\.(tsx?|jsx?)$/, "").split("/").pop();
    const importedBy = sourceFiles
      .filter((q) => q !== p)
      .some((q) => new RegExp(`from\\s+["'][^"']*${stem}["']|import\\(["'][^"']*${stem}["']`).test(readFileSync(q, "utf8")));
    if (!importedBy) unreferenced.push(`${r} (${readFileSync(p, "utf8").split("\n").length} lines)`);
  }
  flag(
    "unreferenced-source",
    unreferenced.length > 0,
    "source files no other file imports",
    unreferenced.length ? unreferenced.join(", ") : "none",
  );
}

// ── NEW: which tests exist, and which ones stopped existing ────────────────
// A test dropped during a refactor is invisible: the suite still passes, with
// fewer assertions behind it. One was lost this round, and a name-level diff
// by the contributor missed it BECAUSE THE NAME WAS A TEMPLATE — a literal
// comparison of what the run printed could not line the two up.
//
// Read statically, from the test sources rather than from a run, so it costs
// nothing and works on a revision nobody has built. A removed test is a FLAG,
// never a gate: dropping one can be exactly right, and only a person can say.
{
  const isTest = (r) => /(^|\/)tests?\//.test(r) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(r);
  // `check("…")`, `test(…)`, `it(…)`, `describe(…)` — the forms in use here and
  // in every framework anyone is likely to bring.
  const NAME = /\b(?:check|test|it|describe)\s*\(\s*(?:(["'])((?:[^\\]|\\.)*?)\1|`([^`]*)`)/g;
  const namesIn = (text) => {
    const out = new Map(); // name -> templated?
    for (const m of stripComments(text).matchAll(NAME)) {
      if (m[2] !== undefined) out.set(m[2], false);
      else if (m[3] !== undefined) out.set(m[3], /\$\{/.test(m[3]));
    }
    return out;
  };

  const head = new Map();
  for (const p of files) {
    if (!isTest(rel(p)) || !SOURCE_EXT.has(path.extname(p))) continue;
    for (const [name, templated] of namesIn(readFileSync(p, "utf8"))) head.set(name, templated);
  }

  if (!head.size) {
    info("test-inventory", "test inventory", "no test names found — the add-on declares no tests this can read");
  } else {
    const templated = [...head].filter(([, t]) => t).map(([n]) => n);
    info(
      "test-inventory",
      "test inventory",
      `${head.size} named test(s)` +
        (templated.length
          ? `; ${templated.length} built from a template, which is the shape that defeats a by-eye diff: ` +
            templated.join(" | ")
          : ""),
    );

    if (typeof args["base-ref"] === "string") {
      const ref = args["base-ref"];
      const git = (a) =>
        execFileSync("git", ["-C", SRC, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      let base = null;
      try {
        base = new Map();
        for (const r of git(["ls-tree", "-r", "--name-only", `${ref}:addons/${ADDON}`]).split("\n").filter(Boolean)) {
          if (!isTest(r) || !SOURCE_EXT.has(path.extname(r))) continue;
          for (const [name, t] of namesIn(git(["show", `${ref}:addons/${ADDON}/${r}`]))) base.set(name, t);
        }
      } catch {
        base = null; // a new listing has no previous revision to compare with
      }
      if (base === null) {
        info("test-inventory-diff", "test inventory vs the base", `"${ADDON}" has no previous revision at ${ref}`);
      } else {
        const gone = [...base.keys()].filter((n) => !head.has(n));
        const added = [...head.keys()].filter((n) => !base.has(n));
        flag(
          "test-inventory-diff",
          gone.length > 0,
          "named tests present at the base revision and absent now",
          gone.length
            ? `${gone.join(" | ")} — dropped, renamed or templated differently; confirm which, ` +
              `because the suite passes either way`
            : `none dropped; ${added.length} added`,
        );
      }
    }
  }
}

// ── the size of the thing a person has to read ─────────────────────────────
{
  const loc = sourceFiles.reduce((n, p) => n + readFileSync(p, "utf8").split("\n").length, 0);
  const lockLines = projects
    .map((d) => path.join(d, "package-lock.json"))
    .filter((p) => existsSync(p))
    .reduce((n, p) => n + readFileSync(p, "utf8").split("\n").length, 0);
  info(
    "size",
    "size of the reviewable unit",
    `${sourceFiles.length} source file(s), ${loc} lines to read; lockfile a further ${lockLines} lines ` +
      `(machine-checked above)`,
  );
  const biggest = sourceFiles
    .map((p) => ({ p: rel(p), n: readFileSync(p, "utf8").split("\n").length }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);
  info("largest-files", "largest source files", biggest.map((b) => `${b.p} (${b.n})`).join(", "));
}

// ── our own drift, reported and never charged to the submission ────────────
// `policy.mjs` mirrors the app's vocabularies by hand and `adjudicate.mjs`
// gates on it. When the mirror is behind, a clean submission is refused for a
// permission the app accepts — which happened. The surface artifact makes the
// comparison exact, where the old drift check was a regex over the app's
// TypeScript that harvested entries out of comments and reported a namespace
// as missing that the app had deliberately freed.
//
// A tool self-check is NOT a submission gate. It is loud, and it never counts
// against the pull request.
{
  // The two directions are not the same fault and do not have the same fix.
  // BEHIND means the mirror is stale and refuses something the app accepts —
  // that is the one that fails a clean submission, and it is fixed here.
  // AHEAD is usually not a fault at all: a permission merges into `policy.mjs`
  // so the adjudicator will accept it the day the app ships it, and until that
  // release the vendored surface legitimately does not have it. Its fix is to
  // bump the artifact after the release. Saying "fix policy.mjs" in that case
  // would be telling a maintainer to revert work that is deliberately early.
  const diff = (name, mine, theirs) => {
    const a = new Set(mine);
    const b = new Set(theirs);
    const only = (x, y) => [...x].filter((v) => !y.has(v));
    const behind = only(b, a);
    const ahead = only(a, b);
    if (!behind.length && !ahead.length) return null;
    return (
      `${name}: ` +
      [
        behind.length
          ? `policy.mjs is BEHIND the app and does not know ${behind.join(", ")} — ` +
            `add them, or it refuses something the app accepts`
          : null,
        ahead.length
          ? `policy.mjs is AHEAD of ${surface.app.describe} with ${ahead.join(", ")} — ` +
            `expected if those ship in a later release, in which case bump addon-surface.json ` +
            `once it is out; a fault only if they were never in the app`
          : null,
      ]
        .filter(Boolean)
        .join("; ")
    );
  };
  const drifts = [
    diff("PERMISSION_VOCABULARY", PERMISSION_VOCABULARY, Object.keys(surface.permissions.grantable)),
    diff("RESERVED_PERMISSIONS", RESERVED_PERMISSIONS, surface.permissions.reserved),
    diff("RESERVED_IPC_NAMESPACES", RESERVED_IPC_NAMESPACES, surface.reservedIpcNamespaces),
  ].filter(Boolean);
  if (drifts.length) {
    info(
      "policy-drift",
      `⚑ OUR TOOLING, NOT THIS SUBMISSION — policy.mjs and ${surface.app.describe} disagree`,
      drifts.join(" | ") + " — whatever the resolution, do not ask the contributor to change anything",
    );
  } else {
    info("policy-drift", "policy.mjs agrees with the app surface", `checked against ${surface.app.describe}`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => c.tier === "gate" && c.status === "fail");
const flagged = checks.filter((c) => c.status === "flag");

const W = "─".repeat(72);
console.log(`\n${W}\nADD-ON CHECKS — "${ADDON}" against ${surface.app.name} ${surface.app.describe}\n${W}\n`);
console.log("GATES");
for (const c of checks.filter((c) => c.tier === "gate")) {
  console.log(`  ${c.status === "pass" ? "  PASS" : "✗ FAIL"}  ${c.title}`);
  if (c.detail) console.log(`           ↳ ${c.detail}`);
}
console.log("\nFLAGS  (agenda for human review — never affects pass/fail)");
if (!flagged.length) console.log("  (none)");
for (const c of flagged) {
  console.log(`  ⚑ ${c.title}`);
  console.log(`    ${c.detail}`);
}
console.log("\nNOTES");
for (const c of checks.filter((c) => c.tier === "info")) console.log(`  • ${c.title}: ${c.detail}`);

console.log(`\n${W}`);
console.log(
  failed.length
    ? `CHECKS: BLOCK — ${failed.length} gate(s) failed.`
    : `CHECKS: OK — gates pass; ${flagged.length} item(s) for review.`,
);
console.log(`${W}\n`);

if (args.json) console.log(JSON.stringify({ addonId: ADDON, surface: surface.app, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
