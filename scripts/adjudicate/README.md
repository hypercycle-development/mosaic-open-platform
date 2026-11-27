# Addon adjudication

A process for assessing a community-contributed addon before it merges into
`mosaic-open-platform`. The goal is to let **scripts make every decision a script can**
(deterministic, repeatable, no judgment) and reserve a human/LLM for the small
set of questions that genuinely need judgment — then, only after both pass, an
isolated runtime test.

The reviewable unit is a **patch** (`git format-patch` / a gist patch / a
branch diff), not a live merge. Never follow a contributor's "add my remote and
`git merge --no-ff && git push`" instructions — that lands unreviewed code and
skips everything below. Ask for, or produce, a patch and run it through this.

## The three tiers

```
Stages 0–5 + 4b   DETERMINISTIC   adjudicate.mjs → PASS / REVIEW / BLOCK
                                  checks.mjs     → the result, vs the app
                                  addon-pr.yml   → both, plus build and test
Stage 6           JUDGMENT        a human/LLM reads only the flagged sites
Stage 7           RUNTIME         isolated build + install, testnet only
```

`adjudicate.mjs` rules on the **patch**: what it touches, whether it applies,
whether the manifest and the declared dependency ranges conform.
`checks.mjs` rules on the **result** — the add-on as it will sit in the tree,
read against the app's own published surface and against its own claims. The
workflow runs both on every pull request touching `addons/**`, then installs,
builds and tests the add-on with nothing else present.

`adjudicate.mjs` prints two blocks: **HARD GATES** (any failure ⇒ `BLOCK`, exit
1) and a **JUDGMENT QUEUE** (file:line hits that a person must rule on; never
affects the exit code). The queue *is* the agenda for Stage 6 — nothing more.

### Deterministic stages (scripted)

| Stage | Gate | Fails when |
|-------|------|-----------|
| 0 | Provenance | not a single logical commit; `--expect-commit` mismatch |
| 1 | Scope containment | any path outside one `addons/<id>/`; touches registry/sig/CI/tooling; exec bit / symlink / submodule |
| 2 | Applies | `git apply --check` fails on the base checkout |
| 3 | Manifest conformance | mirrors the app's `validateManifest` policy subset: bad id/version/namespace, or a permission that is unknown or **reserved** (`wallet:sign`, `vault:*`, …) |
| 4 | Supply chain | **any `scripts` key in the addon's own `package.json` that is not on the allowlist** — `ALLOWED_ADDON_SCRIPTS` in `policy.mjs`, currently build, dev, test, lint, typecheck, format, clean, watch, preview, or any of those with a `:suffix` (the segment before the colon is what is checked, so `pretest:unit` is refused like `pretest`); any dependency specifier that is not a plain registry range — git and tarball URLs, local and workspace paths, `github:`, bare `user/repo`, and `npm:` aliases |
| 4b | Build reproducibility | convention-aware: if `renderer/` is gitignored build output (the mosaic-open-platform model), an absent bundle is correct and this instead flags that a sandboxed build (Stage 7) is required; it only *fails* when the repo tracks bundles and `src/` changed without a matching bundle update |
| 5 | Capability scan | never fails — emits the judgment queue |

> **Stage 4 is an allowlist, and must stay one.** npm chooses which script
> names it runs by itself, and for any script `X` it also runs `preX` and
> `postX`. A denylist of dangerous names is a list of a set npm controls, where
> anything unlisted is safe by default. That failed exactly as you would expect:
> the previous denylist named `prepare` but not `preprepare`/`postprepare`, both
> of which execute on a plain `npm install` — so a submission carrying one got
> `VERDICT: PASS`. **Do not "fix" a future gap by adding a name to
> `INSTALL_LIFECYCLE_SCRIPTS`**; that list is now only used to word the
> rejection message. Add to `ALLOWED_ADDON_SCRIPTS`, deliberately, when a
> submission gives a reason.

### Stage 6 — judgment (human/LLM)

Read *only* the queued sites and the `⚑ ELEVATED` notes and rule on intent:
is native exec / network egress / a `main` module appropriate for what this
addon claims to do? Does it re-introduce a withheld capability (e.g. `wallet:sign`
via a browser-extension bridge) through a side channel? Produce
approve / approve-with-changes / reject with specific asks.

### Stage 7 — runtime (only after 0–6 pass)

Build the tarball from the reviewed source in an isolated environment, install
it into a throwaway app profile, activate, exercise. Two properties matter and
both are deliberate:

- **The bundle that ships is built here, from reviewed source.** A submission's
  own prebuilt `renderer/` output is never accepted or published.
- **Testnet keys only for anything touching a wallet.** Never a funded mainnet
  key, on any host, at any stage.

The runbook and the provisioning scripts are operational and are held with the
rest of the release tooling, not in this repository.

## Usage

```sh
node scripts/adjudicate/adjudicate.mjs \
  --patch <file.patch> \
  [--repo <mosaic-open-platform checkout>]      # default: this repo
  [--expect-commit <sha>]                # assert the patch's From-hash
  [--app-src <mosaic-companion checkout>]# cross-check the mirrored vocabulary
  [--json]                               # append a machine-readable report
```

Getting the patch from a gist: `gh api gists/<id> --jq '.files["<name>.patch"].content' > x.patch`.

```sh
node scripts/adjudicate/checks.mjs \
  --addon <id> \
  [--src <dir>]           # tree containing addons/ — default: this repo
  [--surface <file>]      # default: ./addon-surface.json
  [--patch <file>]        # to check DCO sign-offs
  [--base-ref <ref>]      # e.g. origin/main — for collisions and the test diff
  [--json]
```

`checks.mjs` gates on: a licence that is present, recognised and names a
holder; a lockfile that pins every declared dependency to the public registry
with an integrity hash; no copyleft licence among the dependencies inlined into
the bundle; every `window.addonAPI` call naming a method the app exposes; no
call needing a permission the manifest does not declare; `tab.icon` resolving
to an icon the sidebar can draw; `minAppVersion` being old enough to be true of
the APIs called; and no reference to a host global other than `window.addonAPI`.
It flags, without blocking, an over-broad permission ask, dependencies that run
install scripts, browser storage, cross-frame messaging, unimported source, and
named tests that existed in the previous revision and do not now.

## Where the app's policy comes from

`addon-surface.json` is **mosaic-companion's own description of its add-on
surface**, generated from its source at a named release by its
`scripts/addon-surface.mjs` and attached to that release. It carries the
namespaces and their methods, the permission each one requires, the grantable
and reserved vocabularies, the reserved IPC namespaces, the main-entry
allowlist, the renderable `tab.icon` set, the manifest patterns and limits —
and the app version at which each method and permission first appeared.

Update it from a release, in its own commit, naming the release:

```sh
gh release download vX.Y.Z --repo hypercycle-development/mosaic-companion \
  -p addon-surface.json -O scripts/adjudicate/addon-surface.json
```

Bumping it is a policy change — it can newly accept or newly refuse a
submission.

`policy.mjs` is the older arrangement: a mirror of the same vocabularies,
maintained here by hand, which `adjudicate.mjs` still gates on. `checks.mjs`
compares the two and reports any disagreement **as our defect, in the notes,
never against the pull request**. That replaces `--app-src`, which read the
app's TypeScript with a regex and once reported a drift on an `ipcNamespace`
the app had deliberately freed, because the regex harvested a name out of the
comment recording its removal. Acting on that report would have made the
adjudicator refuse something the app accepts.

### The rule that shapes all of this

**A gate that can block a contributor must derive its expectations from the
application at a pinned version, never from a mirrored list, and must never
read a comment as code.** Three of the four gate failures on the final review
round of the first two external submissions were defects in our own checking,
not in the submission: an add-on was failed for calling `addonAPI.events.on`,
which exists and which our own review had told it to use; another for "needing
`mcp:call`" on the strength of a comment explaining why it does not call it;
and a third because the script allowlist matched exactly and refused
`typecheck:tests` (#14, fixed in #15). A false block costs more than a missed
flag, because the contributor can neither act on it nor see why.

Two more were found by running the promoted checks over the add-ons already in
this catalogue, before any of them ever saw a submission: a `LICENSE` holder
gate written for MIT, which fails every correct Apache-2.0 submission because
that licence carries its notice in a `NOTICE` file; and a lockfile gate applied
to a `package.json` declaring no dependencies at all. Run a new gate over what
is already here before you let it near a pull request.

## What the deterministic stages are, and are not

Worth being plain about, because the failure mode of a tool like this is a
reviewer reading a green result as an assurance it was never able to give.

- **The hard gates are structural.** They answer questions with definite
  answers: does this patch stay inside one addon, does the manifest conform,
  does it declare a dependency that cannot be reviewed, does it add an
  executable bit. A `PASS` means those specific questions came back clean.
- **The judgment queue is an agenda, not a proof of absence.** Stage 5 flags
  patterns worth a human's attention. An empty queue means nothing matched the
  patterns — never that the patch is safe. Do not treat a short queue as a
  reason to look less carefully; the queue exists to make sure the obvious is
  not missed, not to bound what a reviewer reads.
- **Stage 6 is where a submission is actually judged.** Stages 0–5 exist to
  make that judgment cheap and well-aimed, not to replace it.
- **Stage 4b does not run the build.** It reasons about whether the src/bundle
  relationship is coherent. `addon-pr.yml` runs the build itself — `npm ci
  --ignore-scripts` then the add-on's own `npm run build`, exactly as
  publication does — which is the only thing that catches a lockfile `npm ci`
  refuses or a build that does not compile. Both happened.
- **`checks.mjs` reads the code; it does not run it.** It can tell you that a
  method does not exist. It cannot tell you that a button reporting a publish
  performed one, that a "Live" badge is over live data, or that an executor
  returning success did the work. Every finding of that kind this process has
  produced came from a person reading the code against its own claims, and the
  automation exists to make that reading cheap rather than to replace it.
- **Stage 7 is manual.**

The pipeline's own limitations are tracked with the release tooling rather than
listed here, and are reviewed when the process changes.
