<!-- jj-project-setup:start hash:422ef786 -->
## VCS — jj (Jujutsu)

This project uses **jj (Jujutsu)** as its VCS. Never use raw git commands. Use jj equivalents instead (e.g. `jj log`, `jj status`, `jj diff`). The only exceptions are `jj git` subcommands (e.g. `jj git push`) and the `gh` CLI for GitHub operations.

### Superpowers overrides

When superpowers skills reference git-based workflows, use these jj-native replacements:

| Superpowers skill | Use instead | Why |
|---|---|---|
| `finishing-a-development-branch` | `/finish` | jj-native: bookmarks, `jj git push`, workspace cleanup |
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
- Desktop Bridge: WebSocket (`src/core/websocket-server.ts`) with CDP fallback
- Schema compatibility: No `z.any()` — Gemini requires strictly typed Zod schemas
