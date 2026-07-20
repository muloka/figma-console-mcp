# Releasing (fork)

**Reconstructed 2026-07-20 from `scripts/release.sh`.** The original was lost — it lived
in `.notes/`, which `.gitignore` excludes except for named exceptions, so it never
survived in the repo. This file is now tracked via a `.gitignore` exception so that
cannot happen again.

`CLAUDE.md` points here before any release.

---

## Do not run `scripts/release.sh`

**Verified by dry-run on 2026-07-20 for `--version 0.2.0`.** The script is byte-identical
to upstream's, written for `southleft/figma-console-mcp` publishing `figma-console-mcp`
on a `1.x` line. For this fork it is actively harmful.

It reported **28 file changes, 33 replacements**. The fork's entire delta against its
v1.35.0 base is **20 files**. Of the ~15 files the script touches, only three already
carry fork delta (`package.json`, `README.md`, `package-lock.json`). The rest have
**zero delta today** and would gain some:

```
docs/mint.json    docs/tools.md       docs/architecture.md    docs/setup.md
docs/index.mdx    docs/introduction.md    docs/mode-comparison.md
docs/figma-mcp-vs-figma-console-mcp.md    src/index.ts
src/core/tokens-tools.ts    figma-desktop-bridge/code.js    CHANGELOG.md
```

That roughly doubles the fork's footprint, and the new entries are upstream's
most-churned docs. `UPSTREAM-SYNC.md` states the fork's identity is a small legible
delta; this is the second-most expensive thing that could be done to it, after the
repo-wide biome reformat the CI spec already rejected.

**What a publish actually needs is one line: the `version` field in `package.json`.**
Everything else in the script serves upstream's docs site and release cadence.

Use the **Minimal release** procedure below. The landmine details are kept afterward
because they explain *why*, and because anyone tempted to run the script with flags
should know what each step does.

---

## Minimal release

```sh
# 0. preflight — token expiry is the most common failure, check it first
command npm whoami                       # 401 => see Known issues, stop here

# 1. version
#    breaking (engines narrowing, tool behavior change) => bump minor: 0.1.x -> 0.2.0
#    features / fixes                                   => bump patch: 0.2.0 -> 0.2.1
$EDITOR package.json                     # "version" field only
command npm install --package-lock-only

# 2. confirm nothing else moved
jj diff --stat                           # expect exactly: package.json, package-lock.json
grep -o "var PLUGIN_VERSION = '[0-9.]*'" figma-desktop-bridge/code.js
#    ^ must equal forkedFrom.version (vendored from upstream), NOT the fork version

# 3. verify
command npm test && command npm run build:local

# 4. push, wait for CI green
jj bookmark set main -r @
jj git push --remote origin --bookmark main

# 5. publish
command npm publish --ignore-scripts
command npm view @muloka/figma-console-mcp version dist-tags

# 6. release notes (optional) — on the fork's own repo, written by hand
gh release create v0.2.0 --repo muloka/figma-console-mcp --notes "..."
```

Notes on the non-obvious bits:

- **`command npm`, not `npm`** — a `~/.zshrc` wrapper on this machine has masked npm
  exit codes. Fixed 2026-07-20, but `command npm` is immune regardless.
- **`build:local`, not `build`** — `npm run build` chains `build:cloudflare`, which
  exits 2 on a known upstream type defect, so `&&` short-circuits and tests never run.
- **`--ignore-scripts`** — `prepublishOnly` runs `npm run build`, same failure.
- **Do not add a `CHANGELOG.md` entry.** Both this fork and upstream *prepend* to the
  same location, so any fork entry conflicts on every sync. Put release notes in a
  GitHub Release on `muloka/figma-console-mcp` instead.
- **No `v*` tags are created.** The fork has none, and step 3b of `release.sh` depends
  on them — see landmine 1.

---

## Fork landmines (why the script is unusable)

`scripts/release.sh` carries **zero fork delta**. It was written for
`southleft/figma-console-mcp` publishing as `figma-console-mcp` on a `1.x` line. This
fork publishes `@muloka/figma-console-mcp` on a `0.x` line. Four consequences:

### 1. It will corrupt `PLUGIN_VERSION` on every fork release

Step 3b decides whether plugin files changed by diffing against the tag
`v$CURRENT_VERSION`:

```sh
if git rev-parse -q --verify "v$CURRENT_VERSION"; then
  if git diff --quiet -I '^var PLUGIN_VERSION' -I '^//' "v$CURRENT_VERSION" -- figma-desktop-bridge/; then
    PLUGIN_FILES_CHANGED=false
  fi
fi
```

**No `v0.*` tags exist in this repo.** Every tag is upstream's `v1.x`. So the lookup
fails, `PLUGIN_FILES_CHANGED` stays `true`, and the script stamps
`PLUGIN_VERSION = '<fork version>'` into `figma-desktop-bridge/code.js` — e.g. `0.2.0`.

That is wrong twice over:

- It decouples the plugin from upstream's lineage. The plugin files are *vendored* from
  upstream; `PLUGIN_VERSION` should track the upstream base
  (`package.json` → `forkedFrom.version`), not the fork's own version.
- The server's `FILE_INFO` handshake compares a connected plugin's reported version
  against this constant. Bumping it falsely marks every connected plugin stale and
  pushes users to re-import for nothing (upstream issue #62 — the exact failure the
  step's own comment warns about).

**Mitigation:** after running the script, verify `PLUGIN_VERSION` is unchanged unless
you genuinely edited `figma-desktop-bridge/`:

```sh
grep -o "var PLUGIN_VERSION = '[0-9.]*'" figma-desktop-bridge/code.js
```

It should equal `forkedFrom.version` (currently `1.35.0`), **not** the fork version.
Revert it if the script moved it. `tests/plugin-version-sync.test.ts` asserts
`PLUGIN_VERSION <= forkedFrom.version`, so a wrong-direction bump to `0.x` still passes
that test — the test cannot catch this. Check by hand.

### 2. It writes upstream URLs into fork artifacts

Step 8 builds the CHANGELOG comparison link from a hardcoded string:

```
https://github.com/southleft/figma-console-mcp/compare/v${CURRENT}...v${VERSION}
```

Those tags do not exist upstream, so the link 404s. Step 9's GitHub Release notes
likewise link to southleft's CHANGELOG. Fix both by hand, or skip step 9 with
`--no-release` and create the release manually.

### 3. It auto-creates a GitHub Release for any `x.Y.0`

`CREATE_RELEASE` defaults to true when the patch part is `0`. So `0.2.0` triggers it,
`0.2.1` does not. Pass `--no-release` to suppress, `--release` to force.

### 4. It rewrites tool counts across upstream's docs

Steps 4–6 rewrite `N+ tools` patterns throughout `README.md`, `docs/`, and
`src/index.ts`. Those files are upstream's, and the fork carries delta only in
`README.md`. Rewriting counts there creates delta in files that currently rebase
cleanly. Prefer `--dry-run` first and review the file list; the tool counts do not
change unless tools were added, which for a fork sync-and-release is rare.

---

## Release procedure

### Phase 0 — preflight

```sh
command npm whoami            # must resolve; see Known issues if 401
jj status                     # working copy should be the change you intend to release
```

Note `command npm`, not `npm` — a shell wrapper on this machine masks npm exit codes.

Decide the version:

- **Breaking** (narrowing `engines`, changing tool behavior users rely on) → bump the
  **minor**: `0.1.x → 0.2.0`. Under `0.x` semver the minor position acts as major, and
  npm resolves `^0.1.2` as `>=0.1.2 <0.2.0`, so this correctly withholds the release
  from anyone on a caret range.
- **Features / fixes** → bump the **patch**: `0.2.0 → 0.2.1`.

### Phase 1 — automated mechanical edits

```sh
./scripts/release.sh --version X.Y.Z --dry-run   # always preview first
./scripts/release.sh --version X.Y.Z
```

What it does (steps numbered as in the script):

| Step | Action |
|---|---|
| 1 | `package.json` version bump (`npm version --no-git-tag-version`) |
| 2 | `docs/mint.json` version sync |
| 3 | `src/index.ts` version strings (3 occurrences) |
| 3c | `MCP_VERSION` in `src/core/tokens-tools.ts` — stamped into DTCG `$extensions.mcpVersion` on every token export |
| 3b | `PLUGIN_VERSION` in `figma-desktop-bridge/code.js` — **see landmine 1** |
| 4–6 | Tool-count rewrites across docs — **see landmine 4** |
| 7 | `npm install --package-lock-only` |
| 8 | `CHANGELOG.md` scaffold (`### Added/Changed/Fixed`) + comparison link — **see landmine 2** |
| 9 | GitHub Release via `gh` — **see landmines 2 and 3** |

Tool counts are auto-detected from source; override with `--local-tools` /
`--remote-tools` / `--cloud-tools`.

### Phase 2 — verify the script's output

```sh
grep -o "var PLUGIN_VERSION = '[0-9.]*'" figma-desktop-bridge/code.js   # landmine 1
jj diff --stat                                                          # review every touched file
```

Revert anything the script changed that it should not have.

### Phase 3 — manual content

The script prints these; they are its own list, adapted:

1. `CHANGELOG.md` — fill in Added/Changed/Fixed. Fix the comparison link to point at
   `muloka/figma-console-mcp`.
2. `README.md` — banner text, feature descriptions, if the release warrants it.
3. `docs/` — only if tools were added. Prefer leaving upstream's docs alone.
4. `.notes/UPSTREAM-SYNC.md` — the delta table, if this release added or dropped patches.

### Phase 4 — build and test

```sh
command npm test && command npm run build:local
```

**Not `npm run build`** — that chains `build:cloudflare`, which exits 2 on a known
upstream type defect, so `&&` short-circuits and the tests never run. CI runs the same
pair plus the typecheck ratchet.

### Phase 5 — publish

```sh
jj bookmark set main -r @
jj git push --remote origin --bookmark main
# wait for CI green
command npm publish --ignore-scripts
```

`--ignore-scripts` is required: `prepublishOnly` runs `npm run build`, which fails on
`build:cloudflare` (same defect as Phase 4).

Verify:

```sh
command npm view @muloka/figma-console-mcp version dist-tags
```

`npx` always resolves `latest`, so a published version reaches users immediately.

---

## Known issues

### npm token rotation

Granular access tokens expire after 90 days. When the token in `~/.npmrc` expires,
`npm whoami` returns 401.

**Hit on 2026-07-20 during the 0.2.0 release** — which is why step 0 of the minimal
procedure checks it before anything else. `release.sh` has the same precheck for the
same reason: without it the failure surfaces at publish time, after version bumps,
CHANGELOG scaffolding, and a GitHub Release have already happened and need manual
cleanup.

Fix: mint a new granular token at npmjs.com with **read and write** on
`@muloka/figma-console-mcp`, then `npm login` or update `~/.npmrc`. It is an
interactive login — an agent cannot do it for you.

Recovering a half-done release: if the version bump is already committed and pushed but
the publish failed, nothing is broken. The repo simply claims a version npm does not
have yet. Rotate the token and run step 5 alone; no need to redo or revert anything.

### `npm` exit codes are masked on this machine

`~/.zshrc` previously defined an `npm()` wrapper whose trailing `if` swallowed the real
exit code, so every `npm` command reported success. Fixed 2026-07-20 with a
`local ec=$?` / `return $ec` pair. If release verification ever looks impossibly clean,
re-check that the wrapper still restores the status, or use `command npm`.

### `build:cloudflare` always fails

Pre-existing upstream type defect in `src/index.ts` (`Cloudflare.Env` cast, 3 errors).
Not fixable here — the fork carries no delta on that file and does not PR upstream. The
typecheck ratchet in CI baselines it at 3.
