# Orphan Node Cleanup (Reduced Cut) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (via the `workspace-jj:kaisen` override in a jj repo) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the highest-likelihood orphan-node-on-throw cases from issue #11's sweep — the deterministic `CREATE_CONNECTOR` orphan, the two densest create-then-configure chains (`ADD_TEXT_TO_SLIDE`, `CREATE_TABLE`), the hidden-orphan `CREATE_STICKIES` rows, and the original `figma_create_child` defects — while deliberately NOT fixing the nine lower-likelihood handlers.

**Architecture:** Two techniques. (1) *Validate-before-create* where the fallible step needs nothing from the created node — `CREATE_CONNECTOR`'s endpoint lookups move above `figma.createConnector()`, eliminating that orphan entirely. (2) *Tracked-node removal in the catch* everywhere else — `var` is function-scoped in code.js's single message handler, so the catch can see the creation variable; `node.remove()` it and suffix the error with "(partially-created node was removed)". `CREATE_STICKIES` instead adds the sticky `id` to its `failed` entries (removal would be wrong — earlier stickies in the batch legitimately persist). **Scope cut rationale:** code.js is upstream-active and the fork's posture is minimal divergence; the remaining nine orphan-capable handlers (APPEND_TO_SLOT, CREATE_STICKY, CREATE_SECTION, CREATE_SHAPE_WITH_TEXT, CREATE_CODE_BLOCK, SET_SLIDE_BACKGROUND, ADD_SHAPE_TO_SLIDE, INSTANTIATE_COMPONENT) have plausible-but-uncommon triggers and stay documented in #11 as the accepted tail.

**Tech Stack:** TypeScript (zod schema in write-tools.ts), plain ES5-style JS (code.js — outside the TS build), jest string-assertion tests in the `tests/plugin-assets-parse.test.ts` style.

**Spec:** https://github.com/muloka/figma-console-mcp/issues/11 including the full class sweep comment (per-handler table with line cites).

## Global Constraints

- VCS is jj — never run raw git. Commit = `jj describe -m "<msg>" && jj new`.
- `npm` always exits 0 (zsh wrapper) — use `npx jest ...` or `command npm test`.
- code.js is plain JS outside the TS build; match its `var`/ES5 style; run `npx jest tests/plugin-assets-parse.test.ts` after EVERY code.js edit (it's the syntax guard).
- `var` in code.js is function-scoped across the whole message handler's else-if chain — creation variables added for catch-visibility MUST use handler-unique names (e.g. `ctTable`, not `table` if `table` exists elsewhere; check with grep before choosing).
- Growing the code.js fork delta is a deliberate, bounded decision here — Task 5 records it in `.notes/UPSTREAM-SYNC.md`.
- Never reference the consumer project by name in commits, issues, or comments.
- Do NOT push and do NOT close issue #11 — final task lists the commands for the user-approved finale.

---

### Task 1: CREATE_CONNECTOR — validate endpoints before creating

**Files:**
- Modify: `figma-desktop-bridge/code.js` — the `CREATE_CONNECTOR` handler (locate `msg.type === 'CREATE_CONNECTOR'`, currently ~:6069)
- Test: `tests/orphan-node-guards.test.ts` (create)

**Interfaces:**
- Produces: a bad `startNodeId`/`endNodeId` now throws BEFORE `figma.createConnector()` runs — nothing to orphan.

- [ ] **Step 1: Write the failing test**

```ts
// tests/orphan-node-guards.test.ts
import * as fs from "fs";
import * as path from "path";

const codeJs = fs.readFileSync(
	path.join(__dirname, "..", "figma-desktop-bridge", "code.js"),
	"utf8",
);

/** Slice one else-if handler out of the message dispatcher by its marker. */
function handlerSlice(startMarker: string, endMarker: string): string {
	const start = codeJs.indexOf(startMarker);
	const end = codeJs.indexOf(endMarker, start);
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return codeJs.slice(start, end);
}

describe("CREATE_CONNECTOR validates endpoints before creating", () => {
	it("endpoint lookups precede figma.createConnector()", () => {
		const h = handlerSlice(
			"msg.type === 'CREATE_CONNECTOR'",
			"CREATE_CONNECTOR_RESULT",
		);
		const lookup = h.indexOf("getNodeByIdAsync(msg.startNodeId)");
		const create = h.indexOf("figma.createConnector()");
		expect(lookup).toBeGreaterThan(-1);
		expect(create).toBeGreaterThan(-1);
		expect(lookup).toBeLessThan(create);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orphan-node-guards.test.ts`
Expected: FAIL — today `createConnector` (:6076) precedes the lookups (:6079-6083).

- [ ] **Step 3: Reorder the handler**

Replace this sequence:

```js
      var connector = figma.createConnector();

      // Set start and end endpoints
      var startNode = await figma.getNodeByIdAsync(msg.startNodeId);
      var endNode = await figma.getNodeByIdAsync(msg.endNodeId);

      if (!startNode) throw new Error('Start node not found: ' + msg.startNodeId);
      if (!endNode) throw new Error('End node not found: ' + msg.endNodeId);
```

with:

```js
      // Validate endpoints FIRST — a stale nodeId is the most common caller
      // error, and creating the connector before checking guaranteed an
      // endpoint-less orphan on every such call.
      var startNode = await figma.getNodeByIdAsync(msg.startNodeId);
      var endNode = await figma.getNodeByIdAsync(msg.endNodeId);

      if (!startNode) throw new Error('Start node not found: ' + msg.startNodeId);
      if (!endNode) throw new Error('End node not found: ' + msg.endNodeId);

      var connector = figma.createConnector();
```

(The label font-load fallback that follows can still throw after creation — acceptable residual: both fallback fonts are stock, and the tracked-removal pattern isn't worth the extra diff here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orphan-node-guards.test.ts tests/plugin-assets-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(bridge): CREATE_CONNECTOR validates endpoints before creating the connector" && jj new
```

---

### Task 2: figma_create_child — full enum + orphan removal

**Files:**
- Modify: `src/core/write-tools.ts` — the `nodeType` enum (locate `enum(["RECTANGLE", "ELLIPSE", "FRAME", "TEXT", "LINE"])`)
- Modify: `figma-desktop-bridge/code.js` — the `CREATE_CHILD_NODE` handler's catch (~:3752-3761)
- Test: extend `tests/orphan-node-guards.test.ts`

**Interfaces:**
- Produces: zod accepts POLYGON/STAR/VECTOR (plugin already implements them at code.js:3693-3701); a throw after creation removes the node and suffixes the error.

- [ ] **Step 1: Write the failing tests**

```ts
import { registerWriteTools } from "../src/core/write-tools";

describe("figma_create_child", () => {
	it("schema accepts every node type the plugin implements", () => {
		const tools: Record<string, any> = {};
		registerWriteTools(
			{ tool: (n: string, _d: string, s: any, h: any) => (tools[n] = { s, h }) } as any,
			async () => ({}),
		);
		const nodeType = tools["figma_create_child"].s.nodeType;
		for (const t of ["RECTANGLE", "ELLIPSE", "FRAME", "TEXT", "LINE", "POLYGON", "STAR", "VECTOR"]) {
			expect(nodeType.safeParse(t).success).toBe(true);
		}
		expect(nodeType.safeParse("SLIDE").success).toBe(false);
	});

	it("plugin catch removes a partially-created node", () => {
		const h = handlerSlice(
			"msg.type === 'CREATE_CHILD_NODE'",
			"CAPTURE_SCREENSHOT",
		);
		expect(h).toContain("newNode.remove()");
		expect(h).toContain("partially-created node was removed");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orphan-node-guards.test.ts`
Expected: both new cases FAIL.

- [ ] **Step 3: Implement both halves**

write-tools.ts enum:

```ts
			nodeType: z
				.enum(["RECTANGLE", "ELLIPSE", "FRAME", "TEXT", "LINE", "POLYGON", "STAR", "VECTOR"])
				.describe("Type of node to create"),
```

code.js CREATE_CHILD_NODE catch — replace:

```js
    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      console.error('🌉 [Desktop Bridge] Create child node error:', errorMsg);
      figma.ui.postMessage({
        type: 'CREATE_CHILD_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg
      });
    }
```

with:

```js
    } catch (error) {
      var errorMsg = error && error.message ? error.message : String(error);
      // figma.createX() lands the node on the page immediately; a throw from
      // font load / resize / fills / appendChild would otherwise strand it.
      var childRemoved = false;
      if (typeof newNode !== 'undefined' && newNode) {
        try { newNode.remove(); childRemoved = true; } catch (removeErr) {}
      }
      console.error('🌉 [Desktop Bridge] Create child node error:', errorMsg);
      figma.ui.postMessage({
        type: 'CREATE_CHILD_NODE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: errorMsg + (childRemoved ? ' (partially-created node was removed)' : '')
      });
    }
```

(`var newNode` inside the try hoists to the shared handler function scope, so the catch can see it. It is only assigned in this branch, and each message runs exactly one branch, so no cross-branch aliasing.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest tests/orphan-node-guards.test.ts tests/plugin-assets-parse.test.ts tests/schema-compatibility.test.ts && npx tsc --noEmit`
Expected: jest PASS; tsc only known pre-existing errors.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(create-child): expose POLYGON/STAR/VECTOR and remove the partially-created node on failure" && jj new
```

---

### Task 3: ADD_TEXT_TO_SLIDE and CREATE_TABLE — tracked-node removal

**Files:**
- Modify: `figma-desktop-bridge/code.js` — both handlers' catches (`ADD_TEXT_TO_SLIDE` ~:7156-7163, `CREATE_TABLE` ~:6291-6298)
- Test: extend `tests/orphan-node-guards.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("slides/figjam creators clean up on throw", () => {
	it("ADD_TEXT_TO_SLIDE removes the text node", () => {
		const h = handlerSlice("msg.type === 'ADD_TEXT_TO_SLIDE'", "ADD_SHAPE_TO_SLIDE");
		expect(h).toContain("textNode.remove()");
		expect(h).toContain("partially-created node was removed");
	});

	it("CREATE_TABLE removes the table", () => {
		const h = handlerSlice("msg.type === 'CREATE_TABLE'", "CREATE_CODE_BLOCK");
		expect(h).toContain("ctTable.remove()");
		expect(h).toContain("partially-created node was removed");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/orphan-node-guards.test.ts`
Expected: both FAIL.

- [ ] **Step 3: Implement**

ADD_TEXT_TO_SLIDE catch — replace:

```js
    } catch (error) {
      console.error('🌉 [Desktop Bridge] Add text to slide error:', error);
      figma.ui.postMessage({
        type: 'ADD_TEXT_TO_SLIDE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: error.message || String(error)
      });
    }
```

with:

```js
    } catch (error) {
      // createText() lands on the page; ~7 fallible setters (font load,
      // textAlign/textCase enums, resize) run before appendChild moves it to
      // the slide — remove the stranded node on any of their throws.
      var slideTextRemoved = false;
      if (typeof textNode !== 'undefined' && textNode) {
        try { textNode.remove(); slideTextRemoved = true; } catch (removeErr) {}
      }
      console.error('🌉 [Desktop Bridge] Add text to slide error:', error);
      figma.ui.postMessage({
        type: 'ADD_TEXT_TO_SLIDE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: (error.message || String(error)) + (slideTextRemoved ? ' (partially-created node was removed)' : '')
      });
    }
```

CREATE_TABLE — first rename its creation variable for handler-uniqueness (`var table` → `var ctTable`, three uses in the try: creation, `.x`, `.y`, `cellAt`, and the `data:` payload — grep the handler slice and rename every `table` reference within it). Then replace its catch:

```js
    } catch (error) {
      // A font-load failure mid cell-loop leaves a half-populated table.
      var ctTableRemoved = false;
      if (typeof ctTable !== 'undefined' && ctTable) {
        try { ctTable.remove(); ctTableRemoved = true; } catch (removeErr) {}
      }
      console.error('🌉 [Desktop Bridge] Create table error:', error);
      figma.ui.postMessage({
        type: 'CREATE_TABLE_RESULT',
        requestId: msg.requestId,
        success: false,
        error: (error.message || String(error)) + (ctTableRemoved ? ' (partially-created node was removed)' : '')
      });
    }
```

(`textNode` needs no rename — grep confirms it is only used by ADD_TEXT_TO_SLIDE; verify before relying on this, and rename the same way as `ctTable` if that has changed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/orphan-node-guards.test.ts tests/plugin-assets-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(bridge): ADD_TEXT_TO_SLIDE and CREATE_TABLE remove partially-created nodes on failure" && jj new
```

---

### Task 4: CREATE_STICKIES — identify orphans in failed rows

Removal is wrong here (earlier stickies in the batch legitimately persist); the fix is honesty: a failed row whose sticky was already created reports its id.

**Files:**
- Modify: `figma-desktop-bridge/code.js` — the CREATE_STICKIES per-item loop (~:6024-6047)
- Test: extend `tests/orphan-node-guards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
	it("CREATE_STICKIES failed rows carry the created sticky's id", () => {
		const h = handlerSlice("msg.type === 'CREATE_STICKIES'", "CREATE_CONNECTOR");
		expect(h).toMatch(/failed\.push\(\{ index: si, id: batchSticky \? batchSticky\.id : undefined,/);
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/orphan-node-guards.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace the loop body's creation and catch:

```js
      for (var si = 0; si < msg.stickies.length; si++) {
        var batchSticky = null;
        try {
          var spec = msg.stickies[si];
          batchSticky = figma.createSticky();
          if (!stickyFontLoaded) {
            await figma.loadFontAsync(batchSticky.text.fontName);
            stickyFontLoaded = true;
          }
          batchSticky.text.characters = spec.text || '';

          if (typeof spec.x === 'number') batchSticky.x = spec.x;
          if (typeof spec.y === 'number') batchSticky.y = spec.y;

          if (spec.color) {
            var sc = __stickyColors[spec.color.toUpperCase()];
            if (sc) {
              batchSticky.fills = [{ type: 'SOLID', color: sc }];
            }
          }

          created.push({ id: batchSticky.id, type: batchSticky.type, name: batchSticky.name, x: batchSticky.x, y: batchSticky.y });
        } catch (e) {
          // A sticky created before the throw EXISTS on the board but is in
          // neither list — report its id so the caller can find or remove it.
          failed.push({ index: si, id: batchSticky ? batchSticky.id : undefined, error: e.message || String(e) });
        }
      }
```

(Rename `sticky` → `batchSticky` throughout this loop only — the single CREATE_STICKY handler keeps its own `sticky` variable; the rename plus the per-iteration `= null` reset prevents a previous iteration's node leaking into a later row's failure report.)

- [ ] **Step 4: Run tests + full suite**

Run: `npx jest tests/orphan-node-guards.test.ts tests/plugin-assets-parse.test.ts && command npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(bridge): CREATE_STICKIES failed rows report the already-created sticky's id" && jj new
```

---

### Task 5: Record the cut line

**Files:**
- Modify: `.notes/UPSTREAM-SYNC.md` — "Watch for next sync"

- [ ] **Step 1: Add the watch bullet**

```markdown
- **code.js now carries fork-only orphan-cleanup deltas** in five handlers:
  CREATE_CONNECTOR (validate-before-create), CREATE_CHILD_NODE,
  ADD_TEXT_TO_SLIDE, CREATE_TABLE (tracked-node removal in catch),
  CREATE_STICKIES (id in failed rows). The nine remaining orphan-capable
  handlers are deliberately NOT fixed (accepted tail, recorded in origin
  issue #11) to bound divergence. If upstream adds its own cleanup to any
  of these handlers, prefer upstream's version and drop ours.
```

- [ ] **Step 2: Commit**

```bash
jj describe -m "docs(sync): record the code.js orphan-cleanup delta and its accepted tail" && jj new
```

---

### Task 6: Finale (user-approved — do not run unattended)

- [ ] Push: `jj tug && jj git push`
- [ ] Comment + close #11:

```bash
gh issue close 11 --repo muloka/figma-console-mcp --comment "Fixed on main (reduced cut): CREATE_CONNECTOR now validates endpoints before creating; CREATE_CHILD_NODE (with the POLYGON/STAR/VECTOR enum fix), ADD_TEXT_TO_SLIDE, and CREATE_TABLE remove partially-created nodes on failure; CREATE_STICKIES failed rows carry the created sticky's id. The nine lower-likelihood handlers from the sweep are the accepted tail — deliberately unfixed to bound fork divergence in upstream-active code.js; reopen or split a follow-up if any of them bites in practice."
```
