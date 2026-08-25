# Mode-Limit Handling & Collection Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (via the `workspace-jj:kaisen` override in a jj repo) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make collection-creating tools roll back on mode-limit failure, report the file's real mode ceiling, raise the stale 4-mode schema cap, and give batch-create rows an honest partial-effect contract.

**Architecture:** Two orphan-prone scripts (the `figma_setup_design_tokens` embedded script in `write-tools.ts` and the `CREATE_VARIABLE_COLLECTION` handler in `code.js`) get try/rollback around their `addMode` loops, copying the pattern already proven in `tokens-tools.ts:2143-2155`. The setup script additionally parses Figma's `Limited to N modes only` error into a structured `{planModeLimit, requested, rolledBack}` payload the MCP layer forwards. The zod cap moves from 4 (Figma's pre-raise limit; no current plan has it) to a 40 sanity bound. Batch-create failure rows gain `created/id/valueSet` so a row that failed after `createVariable` succeeded is identifiable.

**Tech Stack:** TypeScript (src), plain ES5-style JS (figma-desktop-bridge/code.js — outside the TS build), zod, jest.

**Spec:** https://github.com/muloka/figma-console-mcp/issues/7 (incl. the call-site sweep comment), https://github.com/muloka/figma-console-mcp/issues/8 (incl. the plan-table comment), https://github.com/muloka/figma-console-mcp/issues/10

## Global Constraints

- VCS is jj — never run raw git. Commit = `jj describe -m "<msg>" && jj new`. Start from an empty working-copy change.
- `npm` is a zsh function that always exits 0 — use `npx jest ...` directly, or `command npm test` for the full suite.
- `code.js` is plain JS outside the TS build; match its `var`/ES5 style. `tests/plugin-assets-parse.test.ts` guards its syntax — run it after every code.js edit.
- `npx tsc --noEmit` has pre-existing errors in `src/apps/*/ui/mcp-app.ts` and `src/index.ts` — those are fine; no NEW errors elsewhere.
- Never reference the consumer project by name in commits, issues, or code comments.
- Do NOT push and do NOT close GitHub issues — the final task lists those commands for the user-approved finale.

---

### Task 1: MCP layer forwards script-reported structured errors (setup_design_tokens)

The setup handler currently checks only the connector-level `result.error`. A script that *returns* `{error, ...}` (which Task 2's rollback will do) falls through to the success path and gets spread into a `success:true` envelope. Fix the forwarding first, test-driven, so Task 2's script change lands on a layer that honors it.

**Files:**
- Modify: `src/core/write-tools.ts` — the `figma_setup_design_tokens` handler, the block after `const result = await connector.executeCodeViaUI(script, ...)` (locate the string `"Design token setup failed during execution"`)
- Test: `tests/write-tools-mode-limit.test.ts` (create)

**Interfaces:**
- Produces: error envelope `{error, planModeLimit?, requested?, rolledBack?, message, hint}` with `isError: true` whenever the script's return value has an `error` field. Task 2 relies on exactly these field names.

- [ ] **Step 1: Write the failing test**

```ts
// tests/write-tools-mode-limit.test.ts
import { registerWriteTools } from "../src/core/write-tools";

interface RegisteredTool {
	name: string;
	description: string;
	schema: any;
	handler: (args: any) => Promise<any>;
}

function createMockServer() {
	const tools: Record<string, RegisteredTool> = {};
	return {
		tool: jest.fn(
			(name: string, description: string, schema: any, handler: any) => {
				tools[name] = { name, description, schema, handler };
			},
		),
		_getTool(name: string): RegisteredTool {
			return tools[name];
		},
	};
}

function body(result: any): any {
	return JSON.parse(result.content[0].text);
}

const SETUP_ARGS = {
	collectionName: "c",
	modes: ["A", "B"],
	tokens: [{ name: "t", resolvedType: "COLOR", values: { A: "#000000" } }],
};

describe("figma_setup_design_tokens structured script errors", () => {
	it("forwards a script-returned error object as isError with its fields", async () => {
		const executeCodeViaUI = jest.fn().mockResolvedValue({
			success: true,
			result: {
				error:
					'Mode "B" could not be added: in addMode: Limited to 10 modes only — collection rolled back, nothing was created.',
				planModeLimit: 10,
				requested: 12,
				rolledBack: true,
			},
		});
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({ executeCodeViaUI }));
		const result = await server
			._getTool("figma_setup_design_tokens")
			.handler(SETUP_ARGS);
		expect(result.isError).toBe(true);
		const b = body(result);
		expect(b.error).toContain("Limited to 10 modes only");
		expect(b.planModeLimit).toBe(10);
		expect(b.requested).toBe(12);
		expect(b.rolledBack).toBe(true);
		expect(b.success).toBeUndefined();
	});

	it("success path is unchanged", async () => {
		const executeCodeViaUI = jest.fn().mockResolvedValue({
			success: true,
			result: {
				collectionId: "VariableCollectionId:1:2",
				collectionName: "c",
				modes: { A: "1:0", B: "1:1" },
				created: 1,
				failed: 0,
				results: [{ success: true, name: "t", id: "VariableID:1:3" }],
				warnings: [],
			},
		});
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({ executeCodeViaUI }));
		const result = await server
			._getTool("figma_setup_design_tokens")
			.handler(SETUP_ARGS);
		expect(result.isError).toBeUndefined();
		expect(body(result).success).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/write-tools-mode-limit.test.ts`
Expected: FAIL — first test gets `isError` undefined (script error spread into a success envelope).

- [ ] **Step 3: Implement the forwarding**

In the setup handler, directly after the existing `if (result.error) { ... }` block (the one whose message is `"Design token setup failed during execution"`), insert:

```ts
				// The script reports handled failures (e.g. mode-limit rollback) by
				// RETURNING an object with `error` — surface it as an error envelope
				// with its structured fields instead of spreading it into a success.
				if (result.result?.error) {
					const r = result.result;
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify({
									error: r.error,
									...(r.planModeLimit !== undefined
										? { planModeLimit: r.planModeLimit }
										: {}),
									...(r.requested !== undefined
										? { requested: r.requested }
										: {}),
									...(r.rolledBack !== undefined
										? { rolledBack: r.rolledBack }
										: {}),
									message: "Design token setup failed",
									hint: "The file's plan limits how many modes a collection can have — see planModeLimit if present.",
								}),
							},
						],
						isError: true,
					};
				}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/write-tools-mode-limit.test.ts tests/write-tools-result-guards.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(write-tools): surface script-returned errors from setup_design_tokens as error envelopes" && jj new
```

---

### Task 2: Rollback + limit parsing in the setup_design_tokens script

**Files:**
- Modify: `src/core/write-tools.ts` — inside the setup script template string, the block starting `// Step 2: Set up modes` (the bare `for (let i = 1; i < modeNames.length; i++)` loop)
- Test: extend `tests/write-tools-mode-limit.test.ts`

**Interfaces:**
- Consumes: Task 1's forwarding of `{error, planModeLimit, requested, rolledBack}`.
- Produces: the script returns exactly that shape on addMode failure, after `collection.remove()`.

- [ ] **Step 1: Write the failing test (script-content capture)**

Append to `tests/write-tools-mode-limit.test.ts`:

```ts
	it("the embedded script rolls back the collection and parses the plan limit", async () => {
		const executeCodeViaUI = jest
			.fn()
			.mockResolvedValue({ success: true, result: { created: 0, failed: 0, results: [], warnings: [] } });
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({ executeCodeViaUI }));
		await server._getTool("figma_setup_design_tokens").handler(SETUP_ARGS);
		const script: string = executeCodeViaUI.mock.calls[0][0];
		expect(script).toContain("collection.remove()");
		expect(script).toContain("planModeLimit");
		expect(script).toContain("Limited to (\\d+) modes");
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/write-tools-mode-limit.test.ts`
Expected: FAIL — script contains none of the three markers.

- [ ] **Step 3: Replace the bare mode loop in the script**

Replace:

```js
for (let i = 1; i < modeNames.length; i++) {
  const newModeId = collection.addMode(modeNames[i]);
  modeMap[modeNames[i]] = newModeId;
}
```

with:

```js
for (let i = 1; i < modeNames.length; i++) {
  try {
    const newModeId = collection.addMode(modeNames[i]);
    modeMap[modeNames[i]] = newModeId;
  } catch (err) {
    // Plan-limit (or other) failure AFTER the collection exists: remove the
    // orphan so a retry cannot create twins, and hand back the ceiling the
    // error names ("in addMode: Limited to N modes only").
    const msg = String(err && err.message || err);
    const m = msg.match(/Limited to (\d+) modes/);
    try { collection.remove(); } catch (removeErr) {}
    return {
      error: 'Mode "' + modeNames[i] + '" could not be added: ' + msg + ' — collection rolled back, nothing was created.',
      planModeLimit: m ? parseInt(m[1], 10) : null,
      requested: modeNames.length,
      rolledBack: true
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/write-tools-mode-limit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(write-tools): setup_design_tokens rolls back the collection on mode-limit failure and reports planModeLimit" && jj new
```

---

### Task 3: Rollback in the CREATE_VARIABLE_COLLECTION plugin handler

Covers the second call site from the issue #7 sweep: `figma_create_variable_collection` with `additionalModes`.

**Files:**
- Modify: `figma-desktop-bridge/code.js` — the `CREATE_VARIABLE_COLLECTION` handler (locate `msg.type === 'CREATE_VARIABLE_COLLECTION'`, currently around :721-758)
- Test: extend `tests/plugin-assets-parse.test.ts`

**Interfaces:**
- Produces: on failure after creation, the handler posts `success:false` with the original error suffixed `" (partially-created collection rolled back)"`. The MCP layer's #6 guard already propagates it.

- [ ] **Step 1: Write the failing test**

Append to `tests/plugin-assets-parse.test.ts` (follow the file's existing pattern of reading `code.js` as a string):

```ts
	it("CREATE_VARIABLE_COLLECTION rolls back the collection on failure", () => {
		const start = codeJs.indexOf("msg.type === 'CREATE_VARIABLE_COLLECTION'");
		const end = codeJs.indexOf("msg.type === 'DELETE_VARIABLE'");
		const handler = codeJs.slice(start, end);
		expect(start).toBeGreaterThan(-1);
		expect(handler).toContain("collection.remove()");
		expect(handler).toContain("partially-created collection rolled back");
	});
```

(If the file names its source variable differently — e.g. `codeJsSource` — match the existing variable name.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/plugin-assets-parse.test.ts`
Expected: the new case FAILS; existing cases PASS.

- [ ] **Step 3: Rework the handler**

Replace the handler body so the created collection is tracked outside the mutation steps and removed in the catch:

```js
  else if (msg.type === 'CREATE_VARIABLE_COLLECTION') {
    var newCollection = null;
    try {
      console.log('🌉 [Desktop Bridge] Creating collection:', msg.name);

      newCollection = figma.variables.createVariableCollection(msg.name);

      // Rename the default mode if a name is provided
      if (msg.initialModeName && newCollection.modes.length > 0) {
        newCollection.renameMode(newCollection.modes[0].modeId, msg.initialModeName);
      }

      // Add additional modes if provided
      if (msg.additionalModes && msg.additionalModes.length > 0) {
        for (var i = 0; i < msg.additionalModes.length; i++) {
          newCollection.addMode(msg.additionalModes[i]);
        }
      }

      console.log('🌉 [Desktop Bridge] Collection created:', newCollection.id);

      figma.ui.postMessage({
        type: 'CREATE_VARIABLE_COLLECTION_RESULT',
        requestId: msg.requestId,
        success: true,
        collection: serializeCollection(newCollection)
      });

    } catch (error) {
      // Mode setup failed after the collection was created — remove the
      // orphan so a retry cannot create twins (mirrors the token-import
      // create phase's rollback).
      var ccRolledBack = false;
      if (newCollection) {
        try { newCollection.remove(); ccRolledBack = true; } catch (removeErr) {}
      }
      console.error('🌉 [Desktop Bridge] Create collection error:', error);
      figma.ui.postMessage({
        type: 'CREATE_VARIABLE_COLLECTION_RESULT',
        requestId: msg.requestId,
        success: false,
        error: (error.message || String(error)) + (ccRolledBack ? ' (partially-created collection rolled back)' : '')
      });
    }
  }
```

Note the rename from `collection` to `newCollection`: other branches of the shared message handler use `var collection`, and `var` is function-scoped — a distinct name avoids cross-branch aliasing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/plugin-assets-parse.test.ts`
Expected: PASS (this also proves code.js still parses).

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(bridge): CREATE_VARIABLE_COLLECTION rolls back the collection when mode setup fails" && jj new
```

---

### Task 4: Raise the modes schema cap and update its one doc restatement

**Files:**
- Modify: `src/core/write-tools.ts` — the setup schema's `modes: z.array(z.string()).min(1).max(4)`
- Modify: `docs/tools.md:1184`
- Test: extend `tests/write-tools-mode-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
	it("modes schema allows up to 40 and rejects 41", () => {
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({}));
		const modesSchema = server._getTool("figma_setup_design_tokens").schema
			.modes;
		expect(modesSchema.safeParse(Array(10).fill("m")).success).toBe(true);
		expect(modesSchema.safeParse(Array(40).fill("m")).success).toBe(true);
		expect(modesSchema.safeParse(Array(41).fill("m")).success).toBe(false);
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/write-tools-mode-limit.test.ts`
Expected: FAIL — 10 modes currently rejected.

- [ ] **Step 3: Change the bound and its description**

```ts
			modes: z
				.array(z.string())
				.min(1)
				.max(40)
				.describe(
					"Mode names (first becomes default). Example: ['Light', 'Dark']. Your Figma plan's per-collection mode limit applies at RUNTIME (e.g. Professional 10, Organization 20) — exceeding it fails cleanly with the file's real ceiling in planModeLimit and no collection left behind.",
				),
```

In `docs/tools.md:1184`, change:

```
- `modes` (required): Array of 1-4 mode names (first becomes default)
```

to:

```
- `modes` (required): Array of 1-40 mode names (first becomes default). The file's plan-tier mode limit applies at runtime; exceeding it returns the real ceiling as `planModeLimit` and rolls the collection back.
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx jest tests/write-tools-mode-limit.test.ts tests/schema-compatibility.test.ts && npx tsc --noEmit`
Expected: jest PASS; tsc shows only the known pre-existing errors.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(write-tools): raise setup_design_tokens modes cap to 40 — runtime plan limit governs, not the schema" && jj new
```

---

### Task 5: Honest partial-effect rows in batch create (and the setup create pass)

**Files:**
- Modify: `src/core/write-tools.ts` — the `figma_batch_create_variables` script's per-row loop, and the setup script's per-token create loop
- Test: extend `tests/write-tools-mode-limit.test.ts`

**Interfaces:**
- Produces: failure rows where `createVariable` succeeded carry `created: true, id, valueSet: false` alongside `success: false, name, error`.

- [ ] **Step 1: Write the failing test (script capture, both tools)**

```ts
	it("batch-create failure rows identify already-created variables", async () => {
		const executeCodeViaUI = jest
			.fn()
			.mockResolvedValue({ success: true, result: { created: 0, failed: 0, results: [] } });
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({ executeCodeViaUI }));
		await server._getTool("figma_batch_create_variables").handler({
			collectionId: "VariableCollectionId:1:2",
			variables: [{ name: "t", resolvedType: "COLOR" }],
		});
		const script: string = executeCodeViaUI.mock.calls[0][0];
		expect(script).toContain("created: true");
		expect(script).toContain("valueSet: false");
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/write-tools-mode-limit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rework both per-row catches**

Batch create — replace:

```js
for (const v of vars) {
  try {
    const variable = figma.variables.createVariable(v.name, collection, v.resolvedType);
```

with:

```js
for (const v of vars) {
  let variable = null;
  try {
    variable = figma.variables.createVariable(v.name, collection, v.resolvedType);
```

and replace its catch:

```js
  } catch (err) {
    results.push({ success: false, name: v.name, error: String(err) });
  }
```

with:

```js
  } catch (err) {
    // If createVariable succeeded before the throw, the variable EXISTS,
    // holding defaults for unset modes — report it so callers can clean
    // up or complete it instead of retrying into a duplicate.
    results.push(variable
      ? { success: false, name: v.name, error: String(err), created: true, id: variable.id, valueSet: false }
      : { success: false, name: v.name, error: String(err) });
  }
```

Setup script — apply the identical `let variable = null;` / conditional-catch transformation to its per-token create loop (the one starting `for (const t of tokenDefs) {` whose catch currently pushes `{ success: false, name: t.name, error: String(err) }`).

- [ ] **Step 4: Run the full relevant set**

Run: `npx jest tests/write-tools-mode-limit.test.ts tests/write-tools-result-guards.test.ts tests/schema-compatibility.test.ts && command npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(write-tools): batch-create failure rows report created variables (created/id/valueSet)" && jj new
```

---

### Task 6: Finale (user-approved — do not run unattended)

- [ ] Push: `jj tug && jj git push`
- [ ] Close with fix references:

```bash
gh issue close 7 --repo muloka/figma-console-mcp --comment "Fixed on main: setup_design_tokens rolls back + reports planModeLimit; CREATE_VARIABLE_COLLECTION rolls back with ' (partially-created collection rolled back)'."
gh issue close 8 --repo muloka/figma-console-mcp --comment "Fixed on main: schema cap raised to a 40 sanity bound; the runtime plan limit is parsed from Figma's error and returned as planModeLimit. docs/tools.md updated."
gh issue close 10 --repo muloka/figma-console-mcp --comment "Fixed on main: failure rows after a successful createVariable now carry created:true/id/valueSet:false in batch create and the setup create pass. Script-level failures still cannot return rows (the script died) — documented as the remaining envelope limitation."
```
