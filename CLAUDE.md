<!-- jj-project-setup:start hash:27bab007 -->
## VCS — jj (Jujutsu)

This project uses **jj (Jujutsu)** as its VCS. Never use raw git commands. Use jj equivalents instead (e.g. `jj log`, `jj status`, `jj diff`). The only exceptions are `jj git` subcommands (e.g. `jj git push`) and the `gh` CLI for GitHub operations.

In jj, the working copy IS a commit. There is no uncommitted state. Never ask "want to commit?" or "ready to commit?" — the work is already committed. Use `jj new` to start a new change, `jj describe` to set intent. The only meaningful checkpoint questions are "want to start a new change?", "want to describe this change?", or "want to push?"

### Gotchas that surprise git users

- **Hand revisions between steps as change IDs, not commit IDs.** A change ID (`kouorrnv`) survives `jj squash`, `jj describe` and every other rewrite; a commit ID (`92ef691b`) is replaced by each one, so a value captured before an edit is stale after it. Read one with `jj log -r <rev> --no-graph -T 'change_id.short()'`. Commit IDs are fine for a one-shot query or an immutable record — not for anything held across a step.
- **Abandoning re-parents `@` onto the abandoned change's parent — and `jj git fetch` does the abandoning itself when the remote branch is already gone.** A squash-merge rebuilds your work as a *new* commit, so once the branch is deleted (by hand, or by GitHub's auto-delete-head-branches) the original is unreachable and fetch drops it. Either way `@` lands on the *pre-merge* base and every merged file reads as reverted on disk. Fix with `jj new trunk()`. The work is safe; the working copy is looking at the wrong revision. Corollary: delete the remote branch **last** — while it exists the fetch is inert, and you can still verify the work landed before anything is dropped.
- **Abandoning `@` always leaves a fresh empty change.** You cannot end up with no working copy, so don't chase the new empty change you just created.
- **`--ignore-working-copy` skips the snapshot, so it hides edits you just made.** It is correct for background and concurrent tooling — the `jjctx`/`jjstack`/`jjconflicts` helpers bake it in — and wrong for reviewing your own work: `jj diff --from 'trunk()' --to @ --stat` with the flag can omit your most recent edits and still read as a complete answer. Drop it whenever the answer depends on the current working copy. Unlike the two above, this one fails quietly.

### Superpowers overrides

When superpowers skills reference git-based workflows, use these jj-native replacements:

| Superpowers skill | Use instead | Why |
|---|---|---|
| `finishing-a-development-branch` | `/finish` | jj-native: bookmarks, `jj git push`, workspace cleanup |
| `subagent-driven-development` | `workspace-jj:kaisen` | jj-native: wave-based parallel execution with spec review gates |
<!-- jj-project-setup:end -->

# Figma Console MCP

The most comprehensive MCP server for Figma — design tokens, components, variables, and programmatic design creation.

## Build & Test

```bash
npm run build          # Compiles local + cloudflare + apps
npm run build:local    # Local mode only (use if Cloudflare types fail)
npm test               # Jest test suite
npx tsc --noEmit       # Type-check (pre-existing errors in src/apps/*/ui/mcp-app.ts are expected)
```

## Release Process

Before any release, read `.notes/RELEASING.md` and follow all five phases. Run `scripts/release.sh` for automated version/count updates before manual content edits.

## Known Issues

- **Cloudflare build type error**: `src/index.ts` line ~54 Env type mismatch is pre-existing on main. Does not affect runtime.
- **npm publish**: Use `npm publish --ignore-scripts` if prepublishOnly triggers a build failure.
- **Pre-existing tsc errors**: `src/apps/*/ui/mcp-app.ts` DOM type errors are expected (separate tsconfig files).

## Architecture

- Entry points: `src/local.ts` (local/NPX mode), `src/index.ts` (Cloudflare Workers)
- Tool registration: `registerXxxTools(server, getFigmaAPI, ...)` pattern in `src/tools/`
- Desktop Bridge: WebSocket (`src/core/websocket-server.ts`)
- Schema compatibility: No `z.any()` — Gemini requires strictly typed Zod schemas
