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
| `mnklvnvw` | feat: Streamable HTTP MCP transport in local mode | Re-ported onto upstream's refactored local.ts (registerTools takes optional target; instructions hoisted to MCP_SERVER_INSTRUCTIONS; per-request HTTP servers also get wrapServerForIdentity) |
| `yvxwpsul` | fix(bridge): close handler timeout + log dropped responses | ui.html hunks auto-merged; ui-full.html hunks dropped (upstream deleted that file). Completed by `kxmwyluz` |
| `nnqvstvy` | fix(write-tools): VariableID: alias values | Complements upstream v1.34's {brace.reference} aliases — direct-by-id aliasing in batch create + setup_design_tokens value pass, documented in tool schema |
| `kxmwyluz` | fix(bridge): clear handler-timeout timer + tests | Finishes `yvxwpsul`: clears the leaked setTimeout on settle. Adds tests/bridge-handler-dispatch.test.ts (7 tests incl. timeout firing + both dropped-response branches) and tests/plugin-assets-parse.test.ts (parses code.js/ui.html/manifest.json — they're outside the TS build, so a syntax error would otherwise reach Figma undetected) |
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
- **Upstream tickets** now track all three feature deltas: HTTP transport →
  #48, VariableID aliases → #52, close-handler robustness → #94. None are PR'd
  (fork implements locally); they flag the divergence so upstream can adopt if
  it wants.

## Housekeeping

- `.notes/` is gitignored upstream; this file is tracked via an explicit
  `!.notes/UPSTREAM-SYNC.md` exception so the strategy travels with the fork.
- Keep the delta table above current — it makes the next sync's triage step
  trivial.
