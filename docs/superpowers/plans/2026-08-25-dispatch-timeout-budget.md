# Dispatch Timeout Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (via the `workspace-jj:kaisen` override in a jj repo) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ui.html's per-command dispatch timeout honor each command's real budget instead of a fixed 30s, so 60-300s commands (REFRESH_VARIABLES, GET_LOCAL_COMPONENTS, LINT_DESIGN, AUDIT_COMPONENT_ACCESSIBILITY, SET_IMAGE_FILL, CREATE_COMPONENT_SET, large EXECUTE_CODE batches) stop reporting failure while the plugin keeps working.

**Architecture:** Single source of truth: the server already knows every command's budget (`sendCommand`'s `timeoutMs`). Include it in the WS message; the ui.html dispatcher races against `min(timeoutMs + 5000, 310000)` when present, defaulting to the current 30000 when absent. The +5000 margin guarantees the command's own wrapper timeout (which produces a proper, method-specific error) always fires before the dispatch race. Version skew is safe by construction: an old plugin ignores the extra field (status quo); a new plugin with an old server sees no field and defaults to 30s (status quo). The cloud relay forwards the caller's `timeoutMs` in its frame so cloud mode gets the same fix.

**Tech Stack:** TypeScript (server), plain JS (ui.html — outside the TS build), jest; existing harnesses `tests/bridge-handler-dispatch.test.ts` (added by fork change `kxmwyluz`) and `tests/cloud-relay.test.ts`.

**Spec:** https://github.com/muloka/figma-console-mcp/issues/9 including the full-sweep comment (affected-command table, cloud-path confirmation, no-escape proof).

## Global Constraints

- VCS is jj — never run raw git. Commit = `jj describe -m "<msg>" && jj new`.
- `npm` is a zsh wrapper that always exits 0 — use `npx jest ...` or `command npm test`.
- ui.html is plain JS outside the TS build; `tests/plugin-assets-parse.test.ts` guards its syntax — run it after every ui.html edit. Match surrounding `var`/ES5 style.
- This code is fork-owned (changes `yvxwpsul`/`kxmwyluz`) — Task 4 MUST update the `.notes/UPSTREAM-SYNC.md` delta-table notes and the "Watch for next sync" bullet in the same effort.
- Never reference the consumer project by name in commits, issues, or comments.
- Do NOT push and do NOT close issue #9 — final task lists the commands for the user-approved finale.

---

### Task 1: Server includes `timeoutMs` in the WS command frame

**Files:**
- Modify: `src/core/websocket-server.ts` — in `sendCommand`, the line `const message = JSON.stringify({ id, method, params });` (currently :796)
- Test: `tests/websocket-server-timeout-field.test.ts` (create)

**Interfaces:**
- Produces: every command frame is `{id, method, params, timeoutMs}` where `timeoutMs` is the exact value `sendCommand` was called with (default 15000). Task 2's dispatcher reads `message.timeoutMs`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/websocket-server-timeout-field.test.ts
import { FigmaWebSocketServer } from "../src/core/websocket-server";

describe("sendCommand frames carry the caller's timeout budget", () => {
	function serverWithFakeClient() {
		const server = new FigmaWebSocketServer({} as any);
		const send = jest.fn();
		const fakeWs = { readyState: 1, send };
		(server as any).clients = new Map([
			["file-key", { ws: fakeWs, fileInfo: { fileName: "f" }, lastActivity: 0 }],
		]);
		(server as any)._activeFileKey = "file-key";
		return { server, send };
	}

	it("includes timeoutMs verbatim", () => {
		const { server, send } = serverWithFakeClient();
		server.sendCommand("LINT_DESIGN", {}, 120000);
		const frame = JSON.parse(send.mock.calls[0][0]);
		expect(frame.method).toBe("LINT_DESIGN");
		expect(frame.timeoutMs).toBe(120000);
	});

	it("includes the 15000 default when the caller omits it", () => {
		const { server, send } = serverWithFakeClient();
		server.sendCommand("GET_SLOTS", {});
		const frame = JSON.parse(send.mock.calls[0][0]);
		expect(frame.timeoutMs).toBe(15000);
	});
});
```

If `FigmaWebSocketServer`'s constructor requires arguments that make bare construction throw, mirror however `tests/cloud-relay.test.ts` or other existing tests instantiate it; the assertions stay the same. Leave the pending-request timers to leak into jest's force-exit (other suites in this repo already do), or clear them via `(server as any).pendingRequests` cleanup in `afterEach`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/websocket-server-timeout-field.test.ts`
Expected: FAIL — `frame.timeoutMs` is `undefined`.

- [ ] **Step 3: Implement**

```ts
      const message = JSON.stringify({ id, method, params, timeoutMs });
```

(`timeoutMs` is already in scope as the parameter with default 15000.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/websocket-server-timeout-field.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "feat(bridge): include the command timeout budget in WS frames" && jj new
```

---

### Task 2: Dispatcher races against the frame's budget

**Files:**
- Modify: `figma-desktop-bridge/ui.html` — the dispatch block in `attachWsHandlers` (locate `var HANDLER_TIMEOUT_MS = 30000;`, currently :1528)
- Test: extend `tests/bridge-handler-dispatch.test.ts`

**Interfaces:**
- Consumes: `message.timeoutMs` from Task 1.
- Produces: race budget = `Math.min(message.timeoutMs + 5000, 310000)` when `timeoutMs` is a positive finite number, else `30000`.

- [ ] **Step 1: Write the failing tests**

`tests/bridge-handler-dispatch.test.ts` already extracts and exercises the dispatch path with fake timers (it tests the 30s firing today). Follow its existing extraction/harness pattern and add, using whatever helper it uses to deliver a message and register a never-resolving handler:

```ts
	it("honors the frame's timeoutMs budget (+5s margin) instead of the 30s default", () => {
		// message includes timeoutMs: 120000 — handler still pending at 30s
		// must NOT produce a timeout error; at 125s it must.
		// (Use the file's existing sendMessage/fake-timer helpers.)
		deliver({ id: "t1", method: "SLOW_METHOD", params: {}, timeoutMs: 120000 });
		jest.advanceTimersByTime(30001);
		expect(sentFrames.filter((f) => f.id === "t1")).toHaveLength(0);
		jest.advanceTimersByTime(95000); // total 125001 > 120000+5000
		const reply = sentFrames.find((f) => f.id === "t1");
		expect(reply.error).toMatch(/did not respond within 125000ms/);
	});

	it("defaults to 30000 when timeoutMs is absent or invalid", () => {
		deliver({ id: "t2", method: "SLOW_METHOD", params: {} });
		jest.advanceTimersByTime(30001);
		expect(sentFrames.find((f) => f.id === "t2").error).toMatch(/30000ms/);
		deliver({ id: "t3", method: "SLOW_METHOD", params: {}, timeoutMs: -5 });
		jest.advanceTimersByTime(30001);
		expect(sentFrames.find((f) => f.id === "t3").error).toMatch(/30000ms/);
	});

	it("caps a pathological budget at 310000", () => {
		deliver({ id: "t4", method: "SLOW_METHOD", params: {}, timeoutMs: 9999999 });
		jest.advanceTimersByTime(310001);
		expect(sentFrames.find((f) => f.id === "t4").error).toMatch(/310000ms/);
	});
```

Adapt `deliver`/`sentFrames` to the file's real helper names — the behavioral assertions are the contract.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/bridge-handler-dispatch.test.ts`
Expected: new cases FAIL (everything times out at 30s); the 7 existing cases PASS.

- [ ] **Step 3: Implement**

Replace:

```js
            // Call the handler with a safety timeout, then send back the result
            var HANDLER_TIMEOUT_MS = 30000;
```

with:

```js
            // Call the handler with a safety timeout, then send back the result.
            // The server includes each command's real budget as timeoutMs
            // (see websocket-server.ts sendCommand); race against that plus a
            // 5s margin so the command's own wrapper timeout — which produces
            // the method-specific error — always fires first. No field (older
            // server) or an invalid value falls back to the old 30s default.
            var requestedBudget = (typeof message.timeoutMs === 'number' && isFinite(message.timeoutMs) && message.timeoutMs > 0)
              ? message.timeoutMs
              : null;
            var HANDLER_TIMEOUT_MS = requestedBudget ? Math.min(requestedBudget + 5000, 310000) : 30000;
```

The rest of the block (`handlerSettled`, the race, the timer cleanup from `kxmwyluz`) is untouched — it already interpolates `HANDLER_TIMEOUT_MS` into its error string.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/bridge-handler-dispatch.test.ts tests/plugin-assets-parse.test.ts`
Expected: PASS (parse test proves ui.html is still valid).

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(bridge): dispatch race honors the per-command timeout budget (fixes the 30s cap over 60-300s commands)" && jj new
```

---

### Task 3: Cloud relay forwards the budget

**Files:**
- Modify: `src/core/cloud-websocket-relay.ts` — the frame the Durable Object sends to the plugin (locate the command-forwarding around :207-232; find where it builds the object containing `id`/`method`/`params` for `ws.send`)
- Test: extend `tests/cloud-relay.test.ts`

**Interfaces:**
- Consumes: the `timeoutMs` the cloud connector already POSTs (`cloud-websocket-connector.ts:510-528`).
- Produces: the relayed WS frame includes `timeoutMs`, so Task 2's dispatcher sees it identically in cloud mode.

- [ ] **Step 1: Write the failing test**

Follow `tests/cloud-relay.test.ts`'s existing harness for driving the DO's command path (it exists — added with the relay). Add a case that submits a command with `timeoutMs: 120000` and asserts the frame sent over the plugin-side WS contains `timeoutMs: 120000`. If the existing harness asserts frame shape anywhere, extend that assertion; otherwise capture the fake WS `send` mock the harness already uses.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/cloud-relay.test.ts`
Expected: new case FAILS.

- [ ] **Step 3: Implement**

In the DO's forward path, add `timeoutMs` to the frame object beside `id`, `method`, `params` — sourced from the same request field the DO already reads for its own wait timer (default 15000 at :208). One line, mirroring Task 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/cloud-relay.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
jj describe -m "fix(cloud): relay forwards the command timeout budget to the plugin dispatcher" && jj new
```

---

### Task 4: Fork bookkeeping

**Files:**
- Modify: `.notes/UPSTREAM-SYNC.md` — two places.

- [ ] **Step 1: Update the delta-table notes.** In the `yvxwpsul` row, append: "Superseded refinement: the dispatch race now honors a per-command `timeoutMs` carried in the WS frame (+5s margin, 310s cap, 30s default when absent) — see the dispatch-timeout-budget plan." In the `kxmwyluz` row, append: "bridge-handler-dispatch.test.ts extended with budget-honoring cases."

- [ ] **Step 2: Replace the watch bullet.** The "ui.html handler dispatch" bullet under "Watch for next sync" currently warns about the fixed 30s timeout; rewrite its first sentence to: "**ui.html handler dispatch** carries a fork-only delta (per-command budget race — reads `timeoutMs` from the WS frame with a 5s margin, 30s default; plus timer cleanup and dropped-response logging in the WS `onmessage` path)." Keep the rest of the bullet.

- [ ] **Step 3: Run the full suite once**

Run: `command npm test && npx tsc --noEmit`
Expected: all suites pass; tsc shows only known pre-existing errors.

- [ ] **Step 4: Commit**

```bash
jj describe -m "docs(sync): record the dispatch-budget refinement of the handler-timeout patch" && jj new
```

---

### Task 5: Finale (user-approved — do not run unattended)

- [ ] Push: `jj tug && jj git push`
- [ ] Close:

```bash
gh issue close 9 --repo muloka/figma-console-mcp --comment "Fixed on main: WS frames carry the server-side timeoutMs (local + cloud relay), and ui.html's dispatch races against that budget +5s (cap 310s), defaulting to the old 30s when the field is absent. Regression coverage in bridge-handler-dispatch.test.ts and cloud-relay.test.ts."
```
