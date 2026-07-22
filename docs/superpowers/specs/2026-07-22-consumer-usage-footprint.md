# Consumer Footprint — figma-console-mcp's Used Surface

**Date:** 2026-07-22
**Status:** Reference / analysis — NOT a spec to implement. A point-in-time
measurement of how much of the fork's tool surface its real-world usage
actually exercises, kept to inform sync-worth triage (see
`.notes/UPSTREAM-SYNC.md` → "Is a sync worth pulling?") and any future
subtractive re-architecture.
**Snapshot base:** upstream **v1.36.0** (the current fork base). The denominator
(total tool count) grows every time upstream adds a tool — re-measure after a
sync that changes the tool surface.

## TL;DR

figma-console-mcp registers **111 MCP tools**. The fork's real usage exercises
**10** of them (~9%). The other 101 are upstream feature surface the fork
inherited and its usage never touches. `figma_execute` is the backbone; only
the *batch variable* tools do something `figma_execute` can't do cheaply.

## How it's consumed

The fork's consumer drives figma-console-mcp as a **sidecar over the Streamable
HTTP transport** (fork patch `mnklvnvw`, upstream #48) — not over stdio, and not
as an LLM tool-caller. Relevant properties for this analysis:

- It calls a **fixed set of tool names** and does **not** enumerate `tools/list`
  to reason. Registering only the used tools would therefore be transparent to
  it; the other 101 registrations are dead weight over the wire.
- It requires the HTTP transport enabled (`MCP_HTTP_PORT=… npx @muloka/figma-console-mcp`).

## The 10 tools actually called

| Tool | Weight | Notes |
|---|---|---|
| `figma_execute` | heaviest | The universal hatch — carries all style writes and any op without a dedicated tool |
| `figma_get_status` | — | Health probe on connect |
| `figma_rename_node` | — | — |
| `figma_get_variables` | — | Summary format only — never enrich/export |
| `figma_get_styles` | — | Base read, fills enriched via `figma_execute` |
| `figma_batch_create_variables` | — | Batched |
| `figma_batch_update_variables` | — | Batched |
| `figma_delete_variable` | — | — |
| `figma_rename_variable` | — | — |
| `figma_setup_design_tokens` | — | — |

Never touched: slides (17 tools), FigJam (10), annotations (10), version/diff
(12), slots (5), comments (3), library (3), token export/import (2),
deep-component (2), design-code (2), accessibility (1), design-system (1), and
the remaining figma-tools/local read+screenshot+console tools.

## Irreducible dependency

Walk each used tool against "could this just be `figma_execute`?":

- `rename_node`, `rename_variable`, `delete_variable`, `get_styles`,
  `get_variables`, `setup_design_tokens` → all trivially expressible as
  `figma.*` code through the hatch. Convenience, not capability.
- `batch_create_variables`, `batch_update_variables` → **not** trivially
  replaceable. Their reason to exist is collapsing N round-trips into one
  ("10–50× faster"). Replacing them with `execute` means a giant hand-built
  blob or N round-trips — a real regression.

> **Irreducible core = `figma_execute` + a batched-variables write API + `get_status`.**

`figma_execute` is Turing-complete over the Figma plugin API, so removing typed
tools costs ergonomics/verbosity, not capability — the used surface already
leans on `execute` for everything the batch tools don't cover (e.g. style
writes go entirely through `execute`; there is no style-write tool).

## Capability-preserving minimal slice

If the fork ever wants to shed the unused surface (subtractive
re-architecture), this is the cut that loses nothing the current usage relies
on:

**Stays** (3 tool files, trimmed, + transport spine):

| File | Keep | Of | Note |
|---|---|---|---|
| `src/core/write-tools.ts` | 7 | 31 | Imports only `McpServer`+`zod`+`logger`; pure dispatch to the connector |
| `src/core/figma-tools.ts` | 2 | 9 | `get_variables`/`get_styles`; drags `figma-api.js` (REST) + `enrichment/` (only via the unused enrich branch) |
| `src/local.ts` | 1 tool + bootstrap | 16 | `get_status` + transport wiring |

- Transport spine (required by `execute` + writes): `figma-connector.ts`
  (`IFigmaConnector` shrinks **75 → ~12** methods), `websocket-connector.ts`,
  `websocket-server.ts`, the HTTP transport, and the plugin
  (`figma-desktop-bridge/`, untouched — stays the upstream tracking surface).

**Goes** (~90% of `src/core`'s 61k LOC):

- 12 unused tool files (~68 tool registrations)
- Subsystem trees used only by unused tools: `tokens/` (32 files), `diff/` (4),
  `enrichment/` (4 — droppable because `get_variables` is always summary
  format, never enrich)
- `@cloudflare/puppeteer` + `browser-manager` (cloud screenshot),
  `console-monitor` (console tools)
- ~63 of 75 `IFigmaConnector` methods

**Single-plane option:** route `get_variables`/`get_styles` through `execute`
too and the entire REST plane (`figma-api.js`) drops — bridge-only.

## Two paths (if acted on)

- **A — Prune in place.** Delete the unused files/trees, trim the 3 kept files,
  shrink the interface. Safe and consumer-transparent *as long as the 10 tool
  names + param schemas stay identical* (the consumer calls by name, never
  enumerates). Diverges from upstream on exactly the surface upstream rarely
  touches.
- **B — New thin adapter package.** Reuse the plugin as-is, reimplement only the
  ~12 connector methods + `execute` + an HTTP endpoint. Leaves figma-console-mcp
  as legacy.

Neither is scheduled. This doc is the map, not a commitment.

## Method & caveats

- "111 registered" = count of `server.tool(` first-arg names across
  `src/core/*-tools.ts` + `src/local.ts`.
- "10 used" = the distinct tools the consumer invokes, confirmed at its call
  sites (not just source mentions).
- Point-in-time. Upstream adds tools; re-measure the denominator after any sync
  that changes the tool surface. The *used* set changes only when the
  consumer's integration changes.
- `figma_execute` masks specific-tool demand: "unused" specific tools may be
  covered by raw `execute`, which strengthens (not weakens) the case that they
  are unneeded here.
