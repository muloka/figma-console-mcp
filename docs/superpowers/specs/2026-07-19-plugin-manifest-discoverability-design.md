# Plugin Manifest Discoverability

**Date:** 2026-07-19 (revised 2026-07-20)
**Status:** Approved 2026-07-20 — not yet implemented
**Scope:** Documentation and agent-instruction only. No CLI changes. No new flags.

## Problem

A user installed the server via `npx @muloka/figma-console-mcp` and could not get the
Figma Desktop Bridge plugin loaded. They went hunting for `manifest.json` inside the npx
cache, which is volatile and effectively unreachable from Figma's plugin importer.

Investigation showed the plumbing already works, and that every mechanism needed to
resolve this **already ships**:

- `setupStablePluginDir()` (`src/local.ts:81`) copies `manifest.json`, `code.js`, and
  `ui.html` to `~/.figma-console-mcp/plugin/` on every server start (`src/local.ts:3637`).
- `--print-path` (`src/local.ts:3968`) resolves and prints that path, and explains the
  Figma import steps on stderr. **Verified working** through the documented npx
  invocation for both `figma-console-mcp` and `@muloka/figma-console-mcp` — exit 0,
  correct path on stdout.
- `figma_get_status` returns the path as a top-level `pluginPath` field
  (`src/local.ts:1369`) and inlines it into its setup instructions (`:1356`, `:1364`).
  **Verified live** — returned `/Users/<user>/.figma-console-mcp/plugin/manifest.json` on
  every call during Desktop Bridge testing.

Nothing is missing from the tooling. What is missing is that **an agent helping a stuck
user has no instruction telling it any of this exists.** `MCP_SERVER_INSTRUCTIONS`
(`src/local.ts:127-188`) ships to every client in the handshake and is entirely
design-workflow guidance — visual validation, component placement, batch operations. It
says nothing about setup or connection. So an agent facing a disconnected bridge has
`pluginPath` sitting in a status response it was never told to read.

That is the whole of this spec's scope.

## Delegated upstream

The documentation defects are upstream's, in files this fork carries **zero delta on**.
Patching locally would create merge burden for changes that should land for everyone.
Filed as **southleft/figma-console-mcp#100**:

- `README.md:657` (upstream numbering), under "Desktop Bridge Plugin (**Recommended
  Connection**)", says *"Select `figma-desktop-bridge/manifest.json` from the
  figma-console-mcp directory"* — the npx cache for anyone who didn't clone. The correct
  instruction is at `README.md:132`, ~500 lines earlier, but the wrong one carries the
  "Recommended" label.
- `--print-path` appears nowhere in `README.md` (the npm landing page).

Also filed as **southleft/figma-console-mcp#101**: no surface that hands out the path —
`--print-path`, `figma_get_status`, the handshake instructions block, or the README —
mentions that the directory is hidden on macOS or how to reach it in Figma's import
dialog. That report proposes the one-sentence ⌘⇧G fix at the source.

Two pre-existing upstream tickets describe the same pain — **#58** (pain point 1: hidden
folders, manifest hard to find) and **#12** (*"How do we find `manifest.json` when
configuring via the NPX method?"*, with a second user confirming). Neither is closed by
this spec.

If upstream acts on #100 and #101, this fork inherits both on the next sync at no cost —
and this spec's remaining scope shrinks to the agent-facing instructions block, which is
fork-specific because the fork extracted `MCP_SERVER_INSTRUCTIONS` to a constant while
upstream keeps it inline at `src/local.ts:156`.

## Goals

- An agent facing a disconnected bridge can resolve it without guessing paths.
- A human who reaches the docs learns how to see a dot-directory in Figma's picker.

## Non-Goals

- **No `--reveal` flag, and no changes to `--print-path`.** An earlier draft proposed a
  flag that was `--print-path` plus one `execFile` call to open the OS file manager. The
  delta did not justify the surface area, and a second flag only helps people who already
  know it exists — the same discoverability trap `--print-path` is already in. Dropped.
- **No README or `docs/setup.md` edits.** Delegated to upstream #100. Both files are
  delta-free in this fork and stay that way.
- **No new MCP tool.** `figma_get_status` already returns `pluginPath`, verified live.
- **No move off `~/.figma-console-mcp`.** Would fix the picker problem at the root but
  break the path already documented for existing users.
- **No change to startup logging.** stdout is the JSON-RPC channel; stderr-to-logfile is
  correct for a sidecar.
- **No change to Cloudflare mode.** Note `src/index.ts` has *no* handshake instructions
  block at all: `new McpServer({...})` at `:79` passes only `name` and `version`. The
  `instructions` fields elsewhere (`:317`, `:332`, `:960`, `:1405`) are tool-response
  payloads. Do not go looking for a cloud equivalent of `MCP_SERVER_INSTRUCTIONS`.

## Design

### 1. Setup section in `MCP_SERVER_INSTRUCTIONS`

`MCP_SERVER_INSTRUCTIONS` (`src/local.ts:127-188`) is the only agent-facing channel that
loads automatically. Add a short section at the **top** — if the bridge is down, nothing
below it is reachable:

> **SETUP — when any tool reports no Figma connection:** Call `figma_get_status` and read
> `pluginPath` from the response. Never guess or hardcode this path. Then tell the user to
> run `npx @muloka/figma-console-mcp --print-path` and import the printed `manifest.json`
> in Figma: Plugins → Development → Import plugin from manifest. **On macOS the folder is
> hidden — in the file dialog press ⌘⇧G and paste the path** (or ⌘⇧. to reveal hidden
> files). On Windows the folder is visible; navigate to it normally.

The ⌘⇧G instruction is the load-bearing part. It turns a known-but-invisible path into
something a user can actually select, and it is absent from every current doc.

**Platform scope.** The dot-prefix hiding convention is Unix-only. On Windows a leading
dot has no meaning on NTFS and `mkdirSync` does not set `FILE_ATTRIBUTE_HIDDEN`, so
`C:\Users\<user>\.figma-console-mcp\plugin\` is an ordinary visible folder — Windows users
need no workaround. Figma Desktop has no Linux client, so macOS and Windows are the only
platforms in scope. ⌘⇧G was verified working in Figma's actual import dialog.

Deliberately short — this block is prepended to every session's context, so length is a
recurring token cost. Target ~6 lines.

Shared by the stdio and HTTP server instances (`src/local.ts:126`); both are local.

### 2. `docs/agent-usage.md`

New page covering:

- **Connection model** — npx sidecar ↔ WebSocket (ports 9223–9232) ↔ Figma plugin.
- **Getting the manifest path** — `--print-path`, and `pluginPath` from
  `figma_get_status`.
- **Importing a hidden path in Figma** — on macOS, ⌘⇧G + paste (or ⌘⇧. to reveal). On
  Windows the folder is visible and no workaround is needed. The single most useful fact
  in the document.
- **Re-import flow** — when it is actually required (Figma caches `code.js` and `ui.html`
  at the application level).
- **Troubleshooting table** — port range exhausted, stale cached plugin, dot-directory
  invisible in the picker.

This is a **fork-only file** in an otherwise upstream-tracked directory. New files rarely
conflict on rebase, so sync cost is minimal — but it is a delta where there was none.
`.notes/` is an alternative home with no upstream overlap.

### 3. Update `.notes/UPSTREAM-SYNC.md`

That file is the canonical record of the fork delta, and step 7 of its own sync procedure
is *"Update the delta list below."* A patch that isn't registered there defeats the file's
purpose. Three edits:

**a. Update this change's existing row in "Current fork delta"** — do not add a second one.
`uowxnlqo` is already listed there as *"design only, implementation not yet landed."* When
the implementation lands, replace that qualifier with the row below rather than appending:

| Change | What | Notes |
|---|---|---|
| `<id>` | docs: agent-facing setup guidance | Adds a SETUP section to the fork-only `MCP_SERVER_INSTRUCTIONS` constant (⌘⇧G hint for the hidden plugin dir on macOS) + `docs/agent-usage.md`. Depends on `mnklvnvw`, which created the constant. Upstream keeps its instructions inline at `src/local.ts:156` → #101 |

**b. Add to "Watch for next sync":**

> **`MCP_SERVER_INSTRUCTIONS` is fork-only.** Upstream has the same content inline at
> `src/local.ts:156` with no shared constant — the hoist came from the HTTP-transport
> patch (`mnklvnvw`), which needed two `McpServer` constructions to share one string, not
> from upstream. If upstream adds its own setup/connection guidance there (the maintainer
> floated `--init` on #12, and #101 proposes a SETUP section), reconcile toward one copy
> rather than two.

**c. Extend the upstream-ticket list** with #100 and #101. Note explicitly that — unlike
every other entry in that list — **neither has a corresponding fork patch**: the
documentation fixes were delegated upstream rather than carried locally. If upstream ships
them, this spec's remaining scope shrinks to the instructions block alone.

**d. Correct the `mnklvnvw` row.** It currently reads *"Re-ported onto upstream's
refactored local.ts (registerTools takes optional target; instructions hoisted to
MCP_SERVER_INSTRUCTIONS; …)"*, which parses as though upstream performed the hoist.
Verified otherwise: upstream has no `MCP_SERVER_INSTRUCTIONS` symbol at all. Reword so the
fork's ownership of that constant is unambiguous — a future sync that assumes upstream
owns it will reconcile in the wrong direction.

## Testing

No unit tests. Neither change is executable logic — one is a string constant, the other a
markdown file. Verification is:

1. `npm run build:local` succeeds.
2. Start the server and confirm the handshake `instructions` contains the SETUP section.
3. Existing suite still passes (`npm test`) — the instructions string is asserted by no
   current test, but confirm none break.

## Risks

- **Instructions-block growth.** Costs tokens in every session. Mitigated by ~6 lines.
- **Upstream may fix #100 differently.** The maintainer floated `--init` on #12. If they
  ship setup guidance of their own, this fork's instructions section may duplicate it.
  Cheap to unwind.

## Note on process

This spec is now two edits: a ~6-line string addition and one markdown file. That is
below the threshold where a separate implementation plan adds value. Recommend
implementing directly from this document rather than generating a plan.
