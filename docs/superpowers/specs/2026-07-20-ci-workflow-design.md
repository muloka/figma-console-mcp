# Continuous Integration for the Fork

**Date:** 2026-07-20
**Status:** Approved 2026-07-20 — not yet implemented. Reviewed against the working copy;
all baseline measurements independently reproduced. Node floor corrected 20 → 22 (Node 20
left maintenance 2026-04), ratchet false-green guard added, workflow hardening specified.
**Scope:** One new workflow file under `.github/workflows/`, plus an `engines` bump in
`package.json` and the matching `package-lock.json` regen. No source changes. No formatting
changes. No release automation.

## Problem

This repository has 48 test suites and 1,355 passing tests, a `test:coverage` script, and
three separate TypeScript build targets. **Nothing runs any of it automatically.**
`.github/` contains exactly one file: `FUNDING.yml`.

For a fork specifically, that gap costs more than it would upstream. `UPSTREAM-SYNC.md`
describes a rebased patch-stack: origin `main` is upstream `main` plus a ~1,356-line
delta, rebased forward on every sync. Upstream ships roughly one substantive release per
week (20 releases between 2026-05-16 and 2026-07-16). Every one of those syncs replays the
fork delta onto code that moved underneath it, and the only thing verifying the result is
a human remembering to run two commands.

Worse, the command that step 5 of `UPSTREAM-SYNC.md` prescribes cannot pass:

```
npm run build && npm test
```

`npm run build` chains `build:local && build:cloudflare && build:apps`, and
`build:cloudflare` exits 2 against a known upstream type defect. The `&&` short-circuits,
so **`npm test` never executes**. The documented post-sync verification step has been
silently skipping the test suite. (The same chain is why `CLAUDE.md` prescribes
`npm publish --ignore-scripts` — `prepublishOnly` runs `npm run build`.)

> **Local-shell caveat.** On the maintainer's machine `npm` is a zsh function wrapping
> `command npm` for asdf reshimming. A shell function returns the status of its *last*
> command — the trailing `if` — so every `npm` invocation returns 0 regardless of what the
> real binary did. There, `npm run build && npm test` does *not* short-circuit: the tests
> run, and the build failure is invisible instead. Same broken verification, different
> mechanism. Exit codes quoted throughout this spec were measured with `command npm` to
> bypass that wrapper. CI is unaffected — GitHub Actions does not load the profile.

## Baseline: what is actually green

Measured 2026-07-20 on the current working copy (Node 24.13.0, npm 11.6.2):

| Command | Exit | Notes |
|---|---|---|
| `npm test` | **0** | 48 suites, 1,355 tests, ~33s. `forceExit: true` already set in `jest.config.cjs:28`, so no CI hang from the WebSocket listeners. |
| `npm run build:local` | **0** | Clean. |
| `npx tsc --noEmit` | 2 | 15 errors across 3 files. |
| `npm run build:cloudflare` | 2 | 3 errors, all `src/index.ts`. |
| `npx biome ci .` | 1 | **1,527 errors, 2,571 warnings** across 417 files. |
| `npx biome format .` | 1 | Indentation is split tab/space *within* `src/core/`. |

Error counts for the two typecheck targets:

| Target | File | Errors |
|---|---|---|
| root `tsc --noEmit` | `src/apps/token-browser/ui/mcp-app.ts` | 6 |
| root `tsc --noEmit` | `src/apps/design-system-dashboard/ui/mcp-app.ts` | 6 |
| root `tsc --noEmit` | `src/index.ts` | 3 |
| `tsconfig.cloudflare.json` | `src/index.ts` | 3 |

The cloudflare 3 are the same `Cloudflare.Env` → `browser-manager.Env` cast errors counted
in the root 15; the targets overlap. All 15 are upstream defects in files the fork carries
no delta on, and this fork does not open PRs against upstream, so none of them are going
to be fixed here.

## Goals

1. Guard the fork delta — catch this fork breaking its own ~1,356 lines.
2. Guard the rebase — answer "did upstream v1.37 break our delta?" without a human
   remembering to ask.
3. Add **zero** merge burden to the patch-stack.

Goal 3 is a hard constraint, not a preference. It rules out the obvious "fix the codebase"
moves discussed and rejected below.

## Non-goals

- **`biome` in any form.** 1,527 errors is not a signal, and making it one requires
  reformatting ~46,000 lines of upstream code. A repo-wide reformat touches every line the
  fork delta also touches, which turns every future rebase into conflict resolution. This
  is the single most expensive thing the fork could do to itself. Explicitly rejected.
- **Fixing the 15 type errors.** Upstream's code, upstream's bug, no PR path.
- **`build:apps`.** Vite build, nothing tests the output.
- **Coverage thresholds.** `jest.config.cjs` declares 70% global but nothing enforces it.
  Turning that on is a separate decision with its own baseline question.
- **Release/publish automation.** Out of scope; `scripts/release.sh` owns that flow.

## Design

### One workflow, three triggers

`.github/workflows/ci.yml`, triggered on:

- `push` to `main`
- `pull_request` targeting `main`
- `workflow_dispatch`

Workflow-level settings, all standard hardening:

| Setting | Value | Why |
|---|---|---|
| `permissions` | `contents: read` | The default `GITHUB_TOKEN` grants more than this workflow needs; it only reads the repo. |
| `timeout-minutes` | `15` per job | Default is 6 hours. The suite runs in ~35s, so anything past 15 min is a hang — plausible given the WebSocket listeners `forceExit` exists to paper over. |
| `concurrency` | group per ref, `cancel-in-progress` on PRs only | Step 6 of `UPSTREAM-SYNC.md` force-pushes `main`; without this, a sync can stack runs. Do **not** cancel in-progress runs on `main` — a cancelled post-sync run is exactly the signal this spec exists to produce. |
| `actions/setup-node` | `cache: npm` | `npm ci` dominates runtime once tests are only ~35s. |

The `push` trigger is what makes this cover goal 2 for free. `UPSTREAM-SYNC.md` step 6
force-pushes origin `main` after every rebase, so a push trigger **fires automatically on
every sync** — no second workflow, no manual step, no discipline required. Non-fast-forward
pushes fire `push` events normally; GitHub does not treat a force-push differently here.

`workflow_dispatch` is the escape hatch for verifying a rebase *before* pushing it.

A two-workflow split (`ci.yml` + `post-sync.yml`) was considered and rejected: both files
would run identical steps today, so it is two things to keep in sync for no present
benefit. Revisit only if post-sync verification grows checks that delta-guarding does not
need — for example, asserting the delta still applies as a clean linear stack.

### Job 1 — `test`

Matrix over Node **22** and **24**. Steps: `npm ci`, `npm test`, `npm run build:local`.

Both commands are green today, so this is a real gate from day one rather than an
aspiration. Runtime is ~35s per leg.

Node 22 is the oldest runtime the fork should claim — it is the current Maintenance LTS
(through 2027-04). Node 24 is the Active LTS and the development runtime. Testing the floor
matters because the fork's entire distribution path is `npx @muloka/figma-console-mcp`, and
a user's Node version is not something the fork controls.

This requires bumping `package.json` `engines.node` from `>=18.0.0` to `>=22.0.0`. Node 18
reached end-of-life in 2025-04 and **Node 20 left maintenance in 2026-04** — as of this
spec's date both are EOL, so declaring either would certify a runtime nobody should be on.
That reasoning is why the floor is 22 rather than 20: an earlier draft of this spec
proposed a 20/24 matrix, which would have committed the exact error it diagnoses in the
current `>=18.0.0`.

`package-lock.json` records the same field at `packages[""].engines` (lockfileVersion 3),
so the bump is **two files, not one** — `npm install --package-lock-only` must run
alongside it to keep `npm ci` from tripping on a package.json/lockfile mismatch. See
"Conflict surface" for the cost.

### Job 2 — `typecheck-ratchet`

Single leg, Node 24. Runs both typecheck targets, counts errors **per file**, and compares
against a baseline committed inline in the workflow.

Failure conditions:

- Any file's error count **exceeds** its baseline.
- Any file **not in** the baseline produces errors at all.

Pass-with-notice condition:

- Any file's count falls **below** baseline — CI passes but logs that the baseline is
  stale and should be lowered. This is how the ratchet tightens when upstream fixes
  something.

Baseline (from the table above):

```
root:       src/apps/token-browser/ui/mcp-app.ts          6
root:       src/apps/design-system-dashboard/ui/mcp-app.ts 6
root:       src/index.ts                                   3
cloudflare: src/index.ts                                   3
```

**Per-file rather than a global total.** A global "15" would let a fork change add an error
to `write-tools.ts` while an upstream sync removes one from `mcp-app.ts` — net zero, gate
passes, regression ships. Per-file catches that. It also means the day upstream fixes the
`Env` cast, CI reports a stale baseline instead of silently over-permitting three errors
forever.

Counting is `tsc` output filtered to lines matching `error TS`, grouped by the leading file
path. Both targets are run with `continue-on-error` at the step level so a non-zero `tsc`
exit does not abort before the comparison runs; the comparison itself is what sets job
status.

**Guard against a false green.** Parsing alone is not sufficient. If `tsc` fails to *start*
— malformed config, OOM, missing dependency — it emits no `path(line,col): error TS` lines
at all. Every file then counts 0, every count reads "below baseline", and the job passes
with a stale-baseline notice while nothing was actually typechecked. Config-level failures
like `TS5083` (cannot read file) carry no file prefix, so the grouping drops them too.

The step must therefore assert that `tsc` **exited exactly 2** (the "type errors present"
code). Exit 0 with a non-empty baseline means the baseline is stale across the board;
exits 1 or 8 mean the compiler crashed and the run is invalid. Both must fail the job
rather than pass it. Equivalently: if exit is non-zero and the parsed error count is zero,
fail — that combination can only mean output the parser did not understand.

### Baseline storage

Inline in `ci.yml` as a literal map, not a separate `ci-baseline.json`.

Only this workflow reads it, and keeping it in the one new file preserves the
zero-conflict-surface property described below. A second file would add a second thing to
rebase for no gain.

## Conflict surface

`.github/workflows/ci.yml` is a **new file** in a directory where upstream has only
`FUNDING.yml`. It rebases cleanly and indefinitely. `jj rebase` will never see a conflict
on a path upstream does not touch.

The `engines` bump is the exception, and it costs more than one line:

- **`package.json`** already carries fork delta (`name`, `version`, `forkedFrom`, scoped
  `publishConfig`), so it is already conflict-prone on every sync and that resolution cost
  is already being paid. One more line inside a block upstream rarely edits is marginally
  free.
- **`package-lock.json`** is the real cost. Upstream churns it on every dependency bump,
  and it is 314KB. The fork already carries a 34-line delta there, so this adds a hunk to
  an existing conflict rather than creating a new one — but it is a hunk in the noisiest
  file in the repo. Resolution strategy on conflict: take upstream's lockfile wholesale and
  re-run `npm install --package-lock-only`, rather than hand-merging.

Net: the fork delta grows by one new file (zero conflict surface) plus one line in each of
two already-conflicting files.

If that lockfile hunk proves annoying in practice, the fallback is to drop the `engines`
bump and run the matrix on 22/24 anyway — the matrix does not depend on the declaration.
That leaves `engines` dishonest but costs nothing. The bump is worth doing; it is not worth
defending through three painful syncs.

## Documentation changes

`UPSTREAM-SYNC.md` step 5 currently reads:

> 5. **Verify:** `npm run build && npm test`

Replace with a form that actually runs, and that points at CI as the authority:

> 5. **Verify:** `npm test && npm run build:local`. CI runs this plus the typecheck
>    ratchet automatically on push to `main` — the force-push in step 6 triggers it.

Add to the "Watch for next sync" list: **if a sync changes the typecheck error counts, the
ratchet baseline in `.github/workflows/ci.yml` needs updating.** A sync that fixes errors
makes CI report a stale baseline; a sync that introduces new ones fails the job. Both are
intended, and both are triage items for the sync, not surprises.

`CLAUDE.md` "Known Issues" should note that the 15 typecheck errors are baselined in CI
rather than merely tolerated, so a contributor who adds a sixteenth learns it from a failed
job rather than from nothing.

## Success criteria

1. A pull request against origin `main` that breaks any of the 1,355 tests fails CI.
2. A pull request that adds a new TypeScript error to any currently-clean file fails CI.
3. A push to `main` following an upstream rebase runs the full suite without anyone
   invoking anything.
4. CI is green on the current working copy at time of merge, with no source or formatting
   changes required to make it so.
5. `jj rebase -b main -d main@upstream` reports no conflict on `.github/workflows/ci.yml`.
   *(Manual, verified at sync time — not something CI can assert about itself.)*

Criterion 4 is the one that matters most. A CI system that lands red teaches everyone to
ignore it.

## Open questions

None blocking. Deferred decisions, recorded so they are not re-litigated:

- **Coverage enforcement** — `jest.config.cjs` declares 70% thresholds that nothing runs.
  Enabling them needs a measured baseline first; it is not part of this spec.
- **`build:apps` in CI** — worth adding if the MCP Apps ever get test coverage. They have
  none today.
- **Dependency audit** — `npm audit` as a non-blocking informational job was considered and
  left out to keep the first iteration to checks that are green and actionable.
