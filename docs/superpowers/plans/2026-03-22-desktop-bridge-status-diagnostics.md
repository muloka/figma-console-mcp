# Desktop Bridge Status & Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Figma Desktop Bridge plugin accurate connection status, click-to-reconnect, and diagnostic events — upstream-friendly, preserving multi-connection support.

**Architecture:** Three layers of change: (1) plugin UI (`ui.html`) gets a connection-aware status pill with click-to-reconnect, (2) plugin sends `BRIDGE_DIAGNOSTIC` events over the WebSocket so the server can log them, (3) server-side handler logs diagnostics through the existing logger. All changes are additive — no removal of multi-connection code, no layout overhaul.

**Tech Stack:** Vanilla JS (plugin UI), TypeScript (server), WebSocket protocol, existing Jest test suite.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `figma-desktop-bridge/ui.html` | Modify | Status pill states, click-to-reconnect, diagnostic event sender |
| `src/core/websocket-server.ts` | Modify | Handle incoming `BRIDGE_DIAGNOSTIC` messages, log via existing logger |
| `tests/websocket-bridge.test.ts` | Modify | Test `BRIDGE_DIAGNOSTIC` handler |

---

### Task 1: Status pill — accurate connection states + click-to-reconnect

**Files:**
- Modify: `figma-desktop-bridge/ui.html:231-237` (updateStatus function)
- Modify: `figma-desktop-bridge/ui.html:195-201` (status-container HTML)
- Modify: `figma-desktop-bridge/ui.html` (CSS — add clickable styles)

The current `updateStatus(state, isActive, isError)` function is called in only two places:
- Line 1076: `updateStatus('ready', true, false)` — when VARIABLES_DATA arrives
- Line 1095: `updateStatus('error', false, true)` — when ERROR message arrives

It never reflects WebSocket connection state. Fix: add connection-state calls, a tooltip, click-to-reconnect, and the CSS for the clickable state — all in one task since the `updateStatus` function is the single point of change.

- [ ] **Step 1: Add CSS for clickable disconnected state**

In the `<style>` block, after the `.status-indicator.error` rule (line 56), add:

```css
.bridge-status.clickable {
  cursor: pointer;
}

.bridge-status.clickable:hover {
  border-color: var(--figma-color-text-secondary, rgba(255, 255, 255, 0.5));
}
```

- [ ] **Step 2: Replace updateStatus with connection-aware version**

In `ui.html`, replace the existing `updateStatus` function (lines 231-237) with one that adds tooltip, click-to-reconnect handling:

```javascript
function updateStatus(state, isActive, isError, tooltip) {
  var dot = document.getElementById('status-dot');
  var stateText = document.getElementById('status-state');
  var container = document.getElementById('status-container');

  dot.className = 'status-indicator ' + (isError ? 'error' : (isActive ? 'active' : 'loading'));
  stateText.textContent = state;
  container.title = tooltip || '';

  if (isError && window.__wsManualRescan) {
    container.classList.add('clickable');
    container.onclick = function() {
      container.classList.remove('clickable');
      container.onclick = null;
      window.__wsManualRescan();
    };
  } else {
    container.classList.remove('clickable');
    container.onclick = null;
  }
}
```

- [ ] **Step 3: Expose a rescan function from the IIFE**

At the bottom of the WebSocket IIFE block (line 937, before the closing `})();`), expose a manual rescan function:

```javascript
window.__wsManualRescan = function() {
  initialScanAttempts = 0;
  wsReconnectAttempts = 0;
  wsScanAndConnect();
};
```

- [ ] **Step 4: Add updateStatus calls to WebSocket connection lifecycle**

In the IIFE WebSocket block (`ui.html`), add `updateStatus` calls at these points:

**a) Start of `wsScanAndConnect` (line 701, after `isScanning = true`):**
```javascript
updateStatus('scanning\u2026', false, false, 'Scanning ports ' + WS_PORT_RANGE_START + '-' + WS_PORT_RANGE_END);
```

**b) Successful connection in `wsScanAndConnect` onopen handler (line 728, after the console.log):**
```javascript
updateStatus('connected (' + activeConnections.length + ')', true, false,
  'Port' + (activeConnections.length > 1 ? 's' : '') + ': ' +
  activeConnections.map(function(c) { return c.port; }).join(', '));
```

**c) Retries exhausted — no servers found (line 756, replace the console.log):**
Keep the existing console.log, then add:
```javascript
updateStatus('disconnected', false, true, 'No MCP servers found. Click to rescan.');
```

**d) Disconnect handler in `attachWsHandlers` onclose (line 842, after the console.log on line 842):**
```javascript
if (activeConnections.length === 0) {
  updateStatus('reconnecting\u2026', false, false, 'Lost connection to port ' + port + ', retrying\u2026');
} else {
  updateStatus('connected (' + activeConnections.length + ')', true, false,
    'Port' + (activeConnections.length > 1 ? 's' : '') + ': ' +
    activeConnections.map(function(c) { return c.port; }).join(', '));
}
```

**e) Reconnect retries exhausted (line 856-859, after the existing `if (wsReconnectAttempts <= 5)` block):**
Add an `else` branch:
```javascript
else {
  if (activeConnections.length === 0) {
    updateStatus('disconnected', false, true, 'Lost connection. Click to rescan.');
  }
}
```

**f) Successful reconnect in `wsReconnectPort` onopen (line 783, after the console.log):**
```javascript
wsReconnectAttempts = 0;
updateStatus('connected (' + activeConnections.length + ')', true, false,
  'Port' + (activeConnections.length > 1 ? 's' : '') + ': ' +
  activeConnections.map(function(c) { return c.port; }).join(', '));
```

- [ ] **Step 5: Keep the VARIABLES_DATA "ready" update**

The existing `updateStatus('ready', true, false)` call at line 1076 stays — but update it to include port info in the tooltip:

```javascript
var ports = (window.__wsGetActiveConnections ? window.__wsGetActiveConnections() : [])
  .filter(function(c) { return c.ws.readyState === 1; })
  .map(function(c) { return c.port; });
updateStatus('ready', true, false,
  (ports.length ? 'Connected to port' + (ports.length > 1 ? 's' : '') + ': ' + ports.join(', ') : ''));
```

- [ ] **Step 6: Build locally and verify no syntax errors**

Run: `npm run build:local`
Expected: clean build (no new errors)

- [ ] **Step 7: Commit**

```
feat(bridge): connection-aware status pill with click-to-reconnect

Status pill now reflects scanning/connected/disconnected/reconnecting
states instead of only showing "ready" after variables load. Tooltip
shows connected port(s). Pill becomes clickable in disconnected state
to trigger a fresh port scan.
```

---

### Task 2: Bridge diagnostic events (plugin → server)

**Files:**
- Modify: `figma-desktop-bridge/ui.html` (WebSocket IIFE block)

- [ ] **Step 1: Add a diagnostic sender function inside the IIFE**

After the `broadcastToAll` function (line 879), add:

```javascript
/**
 * Send a diagnostic event to all connected servers.
 * Lightweight — servers log these for debugging connection issues.
 */
function sendDiagnostic(event, detail) {
  broadcastToAll({
    type: 'BRIDGE_DIAGNOSTIC',
    data: {
      event: event,
      detail: detail || {},
      timestamp: new Date().toISOString(),
      activeCount: activeConnections.length,
      ports: activeConnections.map(function(c) { return c.port; })
    }
  });
}
```

- [ ] **Step 2: Emit diagnostics at key lifecycle points**

Add `sendDiagnostic` calls at these locations (all inside the IIFE):

**a) After successful connection in `wsScanAndConnect` onopen (after the `initializeConnection` call):**
```javascript
sendDiagnostic('connected', { port: port });
```

**b) After disconnect in `attachWsHandlers` onclose (after the `removeConnection` call):**
```javascript
sendDiagnostic('disconnected', { port: port, code: event.code, reason: event.reason });
```

**c) After retries exhausted (both initial scan and reconnect) — alongside the `updateStatus('disconnected', ...)` calls:**
```javascript
sendDiagnostic('retries_exhausted', { type: 'initial_scan', attempts: initialScanAttempts });
// or
sendDiagnostic('retries_exhausted', { type: 'reconnect', port: port, attempts: wsReconnectAttempts });
```

Note: `sendDiagnostic` on `retries_exhausted` will be a no-op when `activeConnections` is empty (nothing to broadcast to), which is fine — it's most useful when one server drops but others remain connected.

**d) After successful reconnect in `wsReconnectPort` onopen:**
```javascript
sendDiagnostic('reconnected', { port: port });
```

- [ ] **Step 3: Build and verify**

Run: `npm run build:local`
Expected: clean build

- [ ] **Step 4: Commit**

```
feat(bridge): emit BRIDGE_DIAGNOSTIC events over WebSocket

Plugin sends lightweight diagnostic events (connected, disconnected,
reconnected, retries_exhausted) to connected MCP servers for debugging
connection issues.
```

---

### Task 3: Server-side diagnostic handler

**Files:**
- Modify: `src/core/websocket-server.ts:370-443` (handleMessage method, inside the `if (message.type)` block)
- Modify: `tests/websocket-bridge.test.ts`

**Important:** The `handleMessage` method has an `if (message.type) { ... return; }` block (lines 371-442) that catches all typed messages. The `BRIDGE_DIAGNOSTIC` handler must go **inside** this block (before the `this.emit('pluginMessage', message)` at line 441) — NOT after it at line 445, which only handles messages without a `type` field.

- [ ] **Step 1: Write the failing test**

In `tests/websocket-bridge.test.ts`, add a test in the `FigmaWebSocketServer` describe block. Use the existing `TEST_PORT` constant and `connectClient` helper (which returns `Promise<WebSocket>`, not `{ ws }`):

```typescript
it('handles BRIDGE_DIAGNOSTIC without emitting pluginMessage', async () => {
  server = new FigmaWebSocketServer({ port: TEST_PORT });
  await server.start();

  const ws = await connectClient(server, TEST_PORT);

  // Listen for pluginMessage — diagnostics should NOT trigger this
  const pluginMessages: any[] = [];
  server.on('pluginMessage', (msg: any) => pluginMessages.push(msg));

  // Send a diagnostic event
  ws.send(JSON.stringify({
    type: 'BRIDGE_DIAGNOSTIC',
    data: {
      event: 'connected',
      detail: { port: TEST_PORT },
      timestamp: new Date().toISOString(),
      activeCount: 1,
      ports: [TEST_PORT]
    }
  }));

  // Give the server a moment to process
  await new Promise(resolve => setTimeout(resolve, 100));

  // Diagnostic should be handled silently, not forwarded as pluginMessage
  expect(pluginMessages.filter(m => m.type === 'BRIDGE_DIAGNOSTIC')).toHaveLength(0);

  await closeClient(ws);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/websocket-bridge.test.ts -t "handles BRIDGE_DIAGNOSTIC" --verbose`
Expected: FAIL — without the handler, `BRIDGE_DIAGNOSTIC` falls through to `this.emit('pluginMessage', message)` at line 441, so `pluginMessages` will contain the diagnostic.

- [ ] **Step 3: Add BRIDGE_DIAGNOSTIC handler inside the `if (message.type)` block**

In `src/core/websocket-server.ts`, inside the `handleMessage` method, add a handler **after** the CONSOLE_CAPTURE block (line 439) and **before** `this.emit('pluginMessage', message)` (line 441):

```typescript
      // Bridge diagnostic events — log for debugging connection issues
      if (message.type === 'BRIDGE_DIAGNOSTIC') {
        const data = message.data || {};
        const detail = data.detail || {};
        const detailStr = Object.keys(detail).length > 0
          ? ' ' + JSON.stringify(detail)
          : '';
        this.logger.info(
          `Bridge diagnostic: ${data.event || 'unknown'}${detailStr} (${data.activeCount ?? '?'} active connections)`
        );
        return;
      }
```

The `return` before `this.emit('pluginMessage', message)` ensures diagnostics don't trigger `pluginMessage` listeners.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/websocket-bridge.test.ts -t "handles BRIDGE_DIAGNOSTIC" --verbose`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All existing tests pass, no regressions

- [ ] **Step 6: Build and verify**

Run: `npm run build:local`
Expected: clean build

- [ ] **Step 7: Commit**

```
feat(bridge): handle BRIDGE_DIAGNOSTIC messages server-side

Server logs diagnostic events from the plugin (connected, disconnected,
reconnected, retries_exhausted) through the existing websocket-server
logger. Diagnostics are handled before pluginMessage emit so they don't
trigger downstream listeners.
```

---

## Summary

| Task | What changes | Risk |
|---|---|---|
| 1. Status pill + click-to-reconnect | `ui.html` — updateStatus, CSS, lifecycle calls, rescan function | Low — additive, no logic changes |
| 2. Diagnostic events (client) | `ui.html` — broadcastToAll diagnostic payloads | Low — no-op when no connections |
| 3. Diagnostic handler (server) | `websocket-server.ts` + test | Low — single if-branch addition |

Tasks 2 and 3 are independent of each other and of Task 1. Task 1 is self-contained. The plugin UI remains minimal — same layout, same size, no new DOM elements (except cursor/hover CSS). Multi-connection architecture is untouched.
