# Upstream Sync Strategy

How this fork (origin) stays current with upstream while keeping its own
alterations.

## The two remotes

| Remote | Repo | Role |
|---|---|---|
| `origin` | muloka/figma-console-mcp | **toko-figma-console-mcp** — friendlier for agentic use (e.g. tokotoko) |
| `upstream` | southleft/figma-console-mcp | generic Figma use case; source of releases |

Never open PRs against upstream. Origin is a deliberately divergent fork,
not a contribution staging area.

## The model: rebased patch-stack

**origin `main` = upstream `main` + a small stack of toko-specific commits,
rebased forward on every sync.**

- The fork's identity is its *delta* — keep that delta small and legible.
- Rebase, don't merge: repeated merges bury the delta in topology and make
  "what does toko actually change?" unanswerable. A linear stack on top of
  upstream keeps it one `jj log` away.
- jj makes this cheap: conflicts don't halt a rebase — they're recorded in
  the affected commits and resolved at leisure.
- Consequence: origin `main` history rewrites on every sync (force-push).
  Anything tracking origin must re-sync. Acceptable for this fork.

## Sync procedure

1. **Fetch:** `jj git fetch --remote upstream`

2. **Triage before rebasing.** Compare the fork delta against what upstream
   shipped since the last sync:

   ```
   jj log -r 'main@upstream..main'     # our delta
   jj log -r 'main..main@upstream'     # what upstream added
   ```

   For each fork commit, decide: still unique (keep), superseded by an
   upstream equivalent (abandon), or partially overlapping (expect
   conflicts, plan to re-resolve on top of upstream's version).

3. **Rebase the stack:** `jj rebase -b main -d main@upstream`
   Moves the whole delta onto the new upstream tip and carries the `main`
   bookmark along. Conflicted commits get marked, not blocked.

4. **Resolve or drop each commit:**
   - Conflicts: `jj new <conflicted-change>`, fix, `jj squash`
   - Superseded: `jj abandon <change>` — shrinking the delta is the point
   - Emptied by rebase (upstream took the same fix): jj abandons these
     automatically; verify with `jj log`

5. **Verify:** `npm test && npm run build:local`

   CI runs this plus the typecheck ratchet automatically — the force-push in
   step 6 fires the `push` trigger, so post-sync verification needs no separate
   discipline. To check a rebase *before* pushing, run the workflow manually via
   `workflow_dispatch`.

   > The previous instruction here was `npm run build && npm test`, which could
   > not pass. `npm run build` chains `build:local && build:cloudflare &&
   > build:apps`, and `build:cloudflare` exits 2 on a known upstream type defect
   > — so `&&` short-circuited and **`npm test` never ran**. Use `build:local`;
   > the cloudflare target's errors are covered by the ratchet instead.
   >
   > Note if you are checking exit codes by hand: a shell wrapper around `npm`
   > can mask them. Use `command npm` when the exit status is what you care
   > about.

6. **Push:** `jj git push --remote origin --bookmark main`
   (Non-fast-forward — expected; see above.)

7. **Update the delta list below.**

## Current fork delta

As of 2026-07-20, synced onto upstream **v1.36.0**:

| Change | What | Notes |
|---|---|---|
| `mnklvnvw` | feat: Streamable HTTP MCP transport in local mode | Re-ported onto upstream's refactored local.ts (registerTools takes optional target; per-request HTTP servers also get wrapServerForIdentity). **This patch owns `MCP_SERVER_INSTRUCTIONS`** — the fork hoisted the handshake instructions into that constant so the stdio and HTTP `McpServer` constructions could share one string. Upstream has no such symbol; it keeps the same content inline at `src/local.ts:156`. Don't assume upstream owns it when reconciling |
| `yvxwpsul` | fix(bridge): close handler timeout + log dropped responses | ui.html hunks auto-merged; ui-full.html hunks dropped (upstream deleted that file). Completed by `kxmwyluz` |
| `nnqvstvy` | fix(write-tools): VariableID: alias values | Complements upstream v1.34's {brace.reference} aliases — direct-by-id aliasing in batch create + setup_design_tokens value pass, documented in tool schema |
| `kxmwyluz` | fix(bridge): clear handler-timeout timer + tests | Finishes `yvxwpsul`: clears the leaked setTimeout on settle. Adds tests/bridge-handler-dispatch.test.ts (7 tests incl. timeout firing + both dropped-response branches) and tests/plugin-assets-parse.test.ts (parses code.js/ui.html/manifest.json — they're outside the TS build, so a syntax error would otherwise reach Figma undetected) |
| `ouvpoytt` | fix(local): un-hardcode serverInfo.version | Both McpServer constructors reported a hardcoded "0.1.0" in the MCP handshake; wired to package.json via PACKAGE_ROOT so version detection (peer_info() / toko figma status) works. Upstream has the same bug at its one stdio constructor → #95 |
| `lkvvzxyv` | chore: publish as @muloka/figma-console-mcp (v0.1.0) | Fork identity — scoped package name, `forkedFrom` block, scoped `publishConfig`. Root cause of the recurring `package.json` conflict on every sync |
| `rynzsmvy` | docs: fork notice in README + npm badge fix (v0.1.1) | Fork identity — the install-this-fork banner at README:11. Touches a file upstream edits constantly; expect conflicts |
| `uowxnlqo` | docs(spec): plugin manifest discoverability design | Fork infrastructure — `docs/superpowers/specs/`. **Spec CLOSED**: §1 shipped as `zkvupptq` in v0.2.0, §2 cut, remainder delegated to upstream #100/#101 rather than patching README/setup.md locally (both filed, neither fixed) |
| `uxyxzrkw` | docs(spec): CI workflow design | Fork infrastructure — `docs/superpowers/specs/`. Implemented by `xozospno`/`kpotskxm`/`vlrkronl` |
| `xozospno` | ci: GitHub Actions workflow | **New file** `.github/workflows/ci.yml` — upstream has only `FUNDING.yml` there, so zero conflict surface. Node 22/24 test matrix + per-file typecheck ratchet. `push` on main is the post-sync trigger |
| `kpotskxm` | chore: engines.node >=22, lockfile identity | `package.json` + `package-lock.json`. Both already carry fork delta, so this adds hunks to existing conflicts rather than new ones. Also synced the lockfile's stale `name`/`version` (still said `figma-console-mcp@1.35.0` from before the v0.1.0 rename) |
| `tkywkxyq` | fix(variables): page/pageSize under format=full | **PROVISIONAL — first delta in `src/core/figma-tools.ts`.** Carried only to unblock tokotoko work that cannot be evaluated until paging functions. **Drop when** upstream fixes #98, or the tokotoko use case concludes it is unnecessary. That file saw 11 upstream commits in the 3 months to 2026-07, so expect to re-resolve this on most syncs — weigh dropping it before re-resolving twice. Guarded by 4 tests in `tests/figma-tools.test.ts` |
| `zkvupptq` | feat(local): SETUP section in handshake instructions | Extends the fork-only `MCP_SERVER_INSTRUCTIONS` — see `mnklvnvw`, which owns that constant. ~6 lines telling an agent to read `pluginPath` from `figma_get_status` rather than guess it, and that Figma's import dialog hides the dot-directory on macOS (Cmd+Shift+G to reach it). Upstream's inline instructions at `src/local.ts:156` carry no setup content at all → #101. Implements `uowxnlqo` §1; §2 of that spec was cut |
| `vlrkronl` | ci: fix ratchet under implicit errexit | GitHub's `shell: bash` is `bash --noprofile --norc -e -o pipefail`; `set -uo pipefail` does not undo the `-e`, so the step died at the first (expected) non-zero tsc. Needs explicit `set +e`. Also actions v4 → v5 |
| `lqomtprz` | chore: local dev setup (jj workflow, gitignore, notes) | Fork infrastructure |
| `zlkukozk` | docs: this file + gitignore exception | Fork infrastructure |

Changes whose only content is maintaining *this file* are not listed above —
they would add a row saying they added a row. `zlkukozk` is listed because it
created the file; subsequent table-keeping changes are not. Check
`jj log -r 'main@upstream..main'` if you need the literal stack.

### v1.36.0 sync (2026-07-20)

Upstream shipped one feature: **target lock for multi-file parallel work** —
`figma_navigate` gains a `lock` param pinning the active file so connections,
reconnects, and the user's own selection/page changes elsewhere cannot move it
(upstream #72). Relevant to agent-plus-human parallel work.

Nothing was dropped — the feature is orthogonal to every fork patch. Neither
#98 (pagination) nor #95 (serverInfo.version) was fixed, so `tkywkxyq` and
`ouvpoytt` both stay.

Conflicts were confined to **two files**, both expected:

- `package.json` at `lkvvzxyv` — upstream bumped 1.35.0 → 1.36.0 against the
  fork's scoped identity. Resolved by keeping fork identity and advancing
  `forkedFrom.version` to 1.36.0.
- `package-lock.json` at `kpotskxm` — resolved by taking upstream's tree
  wholesale (`jj file show -r main@upstream package-lock.json`) then re-running
  `npm install --package-lock-only` to re-apply name/version/engines. Do it this
  way rather than regenerating from scratch, which can drift transitive
  versions.

Resolving those two cleared conflict markers from all 18 affected commits.

Verified after: `npm ci` clean, 1367 tests (up from 1360 — upstream's new
`tests/websocket-bridge.test.ts` adds 7), `build:local` clean, and the
**typecheck ratchet baseline unchanged at 6/6/3**, so no baseline edit needed.

`PLUGIN_VERSION` stays at `1.35.0`: upstream's own v1.36.0 still ships that
value because `figma-desktop-bridge/` was untouched in the release. **No plugin
re-import required.**

Dropped in the v1.35.0 sync:
- `a36f23b` feat(bridge): two-state status UI — superseded by upstream
  v1.33's connection UX overhaul (honest status pill, connection count,
  proof-of-life, error recovery, activity log).

The old feature bookmarks (`feature/design-lint-tool`,
`feature/design-system-kit`, `feature/library-component-access`) were fully
merged into upstream and deleted from origin during this sync.

### Where fork-only documents live

Design specs go in **`docs/superpowers/specs/`** — a directory upstream does not have, so
they rebase as clean file-adds indefinitely.

Not `.notes/`: `.gitignore:216` is `.notes/*` with a single exception for
`UPSTREAM-SYNC.md`. That directory is deliberately untracked scratch space, so anything
filed there disappears from the repo. Verified the hard way on 2026-07-20 — moving a spec
into `.notes/specs/` silently emptied its change.

### Watch for next sync

- **ui.html handler dispatch** carries a fork-only delta (30s handler timeout,
  timer cleanup, dropped-response logging in the WS `onmessage` path). If
  upstream ever adds its own handler-timeout/robustness code there, expect a
  conflict — reconcile toward one timeout implementation, not two.
- **Fork-only test files** with no upstream counterpart:
  `tests/bridge-handler-dispatch.test.ts`, `tests/plugin-assets-parse.test.ts`.
  These should rebase cleanly (new files) but will fail if upstream renames or
  restructures `figma-desktop-bridge/` — the source guards assert specific
  strings in `ui.html` and specific `manifest.json` entry points.
- **`src/core/figma-tools.ts` is now a conflict surface** (`tkywkxyq`), where it
  previously had zero delta. Upstream changed that file 11 times in the 3 months
  to 2026-07 — the highest-churn file the fork touches. The patch is small and
  localized (two `if (page !== undefined || pageSize !== undefined)` blocks plus
  the zod schema losing its `.default()`s), but it is deliberately temporary:
  - Re-check `southleft/figma-console-mcp#98` on every sync. If upstream has
    fixed it, **abandon `tkywkxyq`** rather than reconciling.
  - If the tokotoko use case that motivated it concludes paging is not needed,
    abandon it then too. It was carried to make that evaluation possible, not
    because the fork independently needs it.
  - Do NOT extend it to fix #99 (the divergent REST pagination field names).
    That path needs a Figma Enterprise plan, is unreachable from this fork, and
    the REST branch was deliberately left byte-identical.
  - `tests/figma-tools.test.ts` carries 4 fork-only tests guarding this. If the
    patch is dropped, drop them with it — otherwise they fail against upstream's
    (correct-for-upstream) behavior.
- **Typecheck ratchet baseline is a per-sync triage item.** The baseline lives
  inline in `.github/workflows/ci.yml` and currently reads: `mcp-app.ts` 6 + 6,
  `src/index.ts` 3 (root target), `src/index.ts` 3 (cloudflare target) — 15
  errors, all upstream defects in files this fork has no delta on. Any sync
  touching `src/apps/*/ui/mcp-app.ts` or `src/index.ts` can move these:
  - *More* errors, or errors in a file not listed → **CI fails**. Either the
    sync introduced them or the fork did; triage before pushing.
  - *Fewer* errors → CI passes with a `::notice::` saying the baseline is stale.
    Lower it in the same change that syncs.
  - A target reaching **zero** errors → CI fails deliberately, demanding the
    baseline entries for that target be deleted rather than left to rot.
  Treat a baseline edit as part of the sync, not a follow-up.
- **Upstream tickets** now track the fork deltas: HTTP transport → #48,
  VariableID aliases → #52, close-handler robustness → #94, hardcoded
  serverInfo.version → #95. None are PR'd (fork implements locally); they flag
  the divergence so upstream can adopt if it wants. If upstream fixes #95 in its
  stdio constructor, reconcile with the fork's version wiring (which also covers
  the fork-only HTTP constructor) during the next sync.

## Package identity

Origin publishes as **`@muloka/figma-console-mcp`** (scoped), versioned
**independently** of upstream starting at `0.1.0`. Upstream owns the unscoped
`figma-console-mcp` on npm, so the fork cannot publish under that name; a scoped
package also makes `npx @muloka/figma-console-mcp` resolve to the fork rather
than upstream. This is the interim distribution path until upstream lands the
fork's changes (#48/#52/#94) and closes its backlog — which, given the issue
ages, may take a long time.

Versioning is plain semver on its own cadence (`0.1.0 → 0.1.1 → …`), NOT tied to
upstream numbering — prerelease/build-metadata schemes were rejected because a
prerelease version doesn't move npm's `latest` dist-tag, which would break
`npx`. The upstream base is recorded out of band:

- **This doc** (the delta table header: "synced onto upstream vX.Y.Z") is the
  canonical source of the upstream base.
- **`package.json` `forkedFrom`** carries a static machine-readable pointer.
  Update `forkedFrom.version` on every sync — it is also the anchor for the
  plugin-version invariant (see below).

Derived caveats:

- **`forkedFrom.version` is the plugin-lineage anchor.** `PLUGIN_VERSION` in
  `figma-desktop-bridge/code.js` is vendored from upstream, so
  `tests/plugin-version-sync.test.ts` asserts it never exceeds
  `forkedFrom.version` (not the fork's `version`). Bump `forkedFrom.version`
  when you sync, or that test goes stale.
- **`release.sh` stamps `PLUGIN_VERSION = --version`** when plugin files changed
  (line ~279). For a fork release that touches `figma-desktop-bridge/`, that
  would push the plugin version onto the fork's `0.x` scale and decouple it from
  upstream's plugin lineage. Decide the intended behavior before cutting such a
  release; a server-only fork release is unaffected.

## Housekeeping

- `.notes/` is gitignored upstream; this file is tracked via an explicit
  `!.notes/UPSTREAM-SYNC.md` exception so the strategy travels with the fork.
- Keep the delta table above current — it makes the next sync's triage step
  trivial.
- On every sync, update `package.json` `forkedFrom.version` to the new upstream
  base (keeps the plugin-version test and the machine-readable pointer honest).
- Also update the "currently tracking upstream vX.Y.Z" line in the README fork
  notice on each sync — it's the human-facing twin of `forkedFrom.version`.
- npm READMEs are frozen per published version. To get README/metadata changes
  onto the npm page, bump the version and republish (see Package identity).
