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

5. **Verify:** `npm run build && npm test`

6. **Push:** `jj git push --remote origin --bookmark main`
   (Non-fast-forward — expected; see above.)

7. **Update the delta list below.**

## Current fork delta

As of 2026-07-12, synced onto upstream v1.35.0:

| Change | What | Notes |
|---|---|---|
| `mnklvnvw` | feat: Streamable HTTP MCP transport in local mode | Re-ported onto upstream's refactored local.ts (registerTools takes optional target; per-request HTTP servers also get wrapServerForIdentity). **This patch owns `MCP_SERVER_INSTRUCTIONS`** — the fork hoisted the handshake instructions into that constant so the stdio and HTTP `McpServer` constructions could share one string. Upstream has no such symbol; it keeps the same content inline at `src/local.ts:156`. Don't assume upstream owns it when reconciling |
| `yvxwpsul` | fix(bridge): close handler timeout + log dropped responses | ui.html hunks auto-merged; ui-full.html hunks dropped (upstream deleted that file). Completed by `kxmwyluz` |
| `nnqvstvy` | fix(write-tools): VariableID: alias values | Complements upstream v1.34's {brace.reference} aliases — direct-by-id aliasing in batch create + setup_design_tokens value pass, documented in tool schema |
| `kxmwyluz` | fix(bridge): clear handler-timeout timer + tests | Finishes `yvxwpsul`: clears the leaked setTimeout on settle. Adds tests/bridge-handler-dispatch.test.ts (7 tests incl. timeout firing + both dropped-response branches) and tests/plugin-assets-parse.test.ts (parses code.js/ui.html/manifest.json — they're outside the TS build, so a syntax error would otherwise reach Figma undetected) |
| `ouvpoytt` | fix(local): un-hardcode serverInfo.version | Both McpServer constructors reported a hardcoded "0.1.0" in the MCP handshake; wired to package.json via PACKAGE_ROOT so version detection (peer_info() / toko figma status) works. Upstream has the same bug at its one stdio constructor → #95 |
| `lqomtprz` | chore: local dev setup (jj workflow, gitignore, notes) | Fork infrastructure |
| `zlkukozk` | docs: this file + gitignore exception | Fork infrastructure |

Dropped in the v1.35.0 sync:
- `a36f23b` feat(bridge): two-state status UI — superseded by upstream
  v1.33's connection UX overhaul (honest status pill, connection count,
  proof-of-life, error recovery, activity log).

The old feature bookmarks (`feature/design-lint-tool`,
`feature/design-system-kit`, `feature/library-component-access`) were fully
merged into upstream and deleted from origin during this sync.

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
