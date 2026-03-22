# Desktop Bridge Two-State UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-state status pill with a two-row display showing Figma Vars and MCP Bridge states independently, plus a visible Reconnect button when the bridge is disconnected.

**Architecture:** The existing single `bridge-status` pill is replaced with two status rows sharing the same dot+label+state pattern. A hidden `<button>` appears below the rows when MCP Bridge enters the disconnected state, triggering `RESIZE_UI` to grow the window. The `updateStatus` function splits into `updateVarsStatus` and `updateBridgeStatus`. `code.js` default window height changes from 50→65px to accommodate the second row. Cloud Mode toggle and its resize logic adjust accordingly.

**Tech Stack:** Vanilla JS/HTML/CSS (plugin UI), Figma plugin API (`code.js`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `figma-desktop-bridge/ui.html` | Modify | Two-row HTML, CSS, split status functions, reconnect button, resize logic |
| `figma-desktop-bridge/ui-full.html` | Modify | Same changes as `ui.html` — this is the full plugin UI served via HTTP by the WebSocket server |
| `figma-desktop-bridge/code.js` | Modify | Default window height 50→65 at all `showUI` call sites |

**Note on `ui-full.html`:** This file is a parallel copy of `ui.html` served by the WebSocket server via HTTP (`src/core/websocket-server.ts:43`). It does NOT have Task 1-3 changes from the previous plan. All changes in Tasks 1-4 below must be applied to BOTH `ui.html` and `ui-full.html`. The plan describes changes relative to `ui.html` (which has the Task 1-3 modifications). For `ui-full.html`, apply the equivalent changes against its current (unmodified) state — the old `updateStatus` function, old HTML structure, and old CSS are all in their original form there.

---

## Current State (after Tasks 1-3)

The plugin UI currently has:
- **HTML (lines 202-209):** Single `bridge-status` div with one dot + "MCP" label + state span
- **CSS (lines 25-64):** `.bridge-status`, `.status-indicator` variants, `.clickable` styles
- **JS (lines 239-259):** Single `updateStatus(state, isActive, isError, tooltip)` function
- **JS (IIFE):** `updateStatus` called at 7 WebSocket lifecycle points + VARIABLES_DATA/ERROR handlers
- **`code.js` (4 locations):** `showUI` with `{ width: 140, height: 50 }`
- **Cloud Mode toggle (line 1024):** Resizes between 130 and 50

---

### Task 1: HTML — two status rows + reconnect button

**Files:**
- Modify: `figma-desktop-bridge/ui.html:202-209` (body content)
- Modify: `figma-desktop-bridge/ui-full.html:195-200` (same HTML structure — apply identical replacement)

- [ ] **Step 1: Replace the single-pill HTML with two rows and a reconnect button**

Replace lines 202-209:

```html
    <div class="bridge-status" id="status-container">
      <div class="status-indicator loading" id="status-dot"></div>
      <div class="status-text">
        <span class="label">MCP</span>
        <span class="state" id="status-state">connecting</span>
      </div>
    </div>
```

With:

```html
    <div class="status-rows" id="status-rows">
      <div class="status-row" id="vars-row">
        <div class="status-indicator loading" id="vars-dot"></div>
        <span class="status-label">Figma Vars</span>
        <span class="status-value" id="vars-state">loading</span>
      </div>
      <div class="status-row" id="bridge-row">
        <div class="status-indicator loading" id="bridge-dot"></div>
        <span class="status-label">MCP Bridge</span>
        <span class="status-value" id="bridge-state">scanning</span>
      </div>
    </div>
    <button class="reconnect-btn" id="reconnect-btn" style="display: none;" onclick="window.__wsManualRescan && window.__wsManualRescan()">↻ Reconnect</button>
```

- [ ] **Step 2: Verify no syntax errors in the HTML**

Check that the outer `<div style="display: flex; flex-direction: column; ...">` wrapper, Cloud Mode toggle, and Cloud Mode section remain intact below the new elements.

---

### Task 2: CSS — status row styles + reconnect button

**Important:** All line numbers below reference the file state BEFORE any Task 2 edits. Use the exact CSS text snippets to locate and replace content, not line numbers — they shift after each edit.

**Files:**
- Modify: `figma-desktop-bridge/ui.html` (CSS block)
- Modify: `figma-desktop-bridge/ui-full.html` (same CSS changes)

- [ ] **Step 1: Replace `.bridge-status` styles with `.status-rows` and `.status-row` styles**

Replace the `.bridge-status` rule (lines 25-34):

```css
    .bridge-status {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: var(--figma-color-bg-secondary, #383838);
      border: 1px solid var(--figma-color-border, #4a4a4a);
      border-radius: 4px;
      white-space: nowrap;
    }
```

With:

```css
    .status-rows {
      display: flex;
      flex-direction: column;
      gap: 4px;
      width: 100%;
    }

    .status-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 4px;
      white-space: nowrap;
    }

    .status-label {
      color: var(--figma-color-text-secondary, rgba(255, 255, 255, 0.7));
      font-weight: 500;
      font-size: 10px;
      letter-spacing: 0.2px;
    }

    .status-value {
      color: var(--figma-color-text, rgba(255, 255, 255, 0.9));
      font-weight: 500;
      font-size: 10px;
      margin-left: auto;
    }
```

- [ ] **Step 2: Remove the old `.bridge-status.clickable` rules**

Remove lines 58-64:

```css
    .bridge-status.clickable {
      cursor: pointer;
    }

    .bridge-status.clickable:hover {
      border-color: var(--figma-color-text-secondary, rgba(255, 255, 255, 0.5));
    }
```

These are replaced by the explicit reconnect button.

- [ ] **Step 3: Remove old `.status-text` rules**

Remove lines 76-88:

```css
    .status-text {
      font-weight: 500;
      letter-spacing: 0.2px;
    }

    .status-text .label {
      color: var(--figma-color-text-secondary, rgba(255, 255, 255, 0.7));
    }

    .status-text .state {
      color: var(--figma-color-text, rgba(255, 255, 255, 0.9));
      margin-left: 4px;
    }
```

These are replaced by `.status-label` and `.status-value`.

- [ ] **Step 4: Add reconnect button CSS**

After the `.status-value` rule, add:

```css
    .reconnect-btn {
      width: 100%;
      background: var(--figma-color-bg-secondary, #383838);
      border: 1px solid var(--figma-color-border, #4a4a4a);
      border-radius: 3px;
      color: var(--figma-color-text, rgba(255, 255, 255, 0.9));
      font-family: inherit;
      font-size: 10px;
      font-weight: 500;
      padding: 4px 8px;
      cursor: pointer;
      margin-top: 2px;
    }

    .reconnect-btn:hover {
      background: var(--figma-color-bg-tertiary, #4a4a4a);
      border-color: var(--figma-color-text-secondary, rgba(255, 255, 255, 0.5));
    }
```

- [ ] **Step 5: Update light theme overrides**

Replace the light theme media query content (lines 182-198) that references `.bridge-status` and `.status-text`:

```css
    @media (prefers-color-scheme: light) {
      body {
        background: #f5f5f5;
        color: #333;
      }
      .status-label {
        color: #666;
      }
      .status-value {
        color: #333;
      }
      .reconnect-btn {
        background: #fff;
        border-color: #e5e5e5;
        color: #333;
      }
      .reconnect-btn:hover {
        background: #f0f0f0;
      }
    }
```

---

### Task 3: JS — split updateStatus into two functions

**Files:**
- Modify: `figma-desktop-bridge/ui.html:239-259` (updateStatus function)
- Modify: `figma-desktop-bridge/ui.html` (IIFE — all updateStatus call sites)
- Modify: `figma-desktop-bridge/ui.html` (VARIABLES_DATA and ERROR handlers)
- Modify: `figma-desktop-bridge/ui-full.html` (same updateStatus split + handler updates)

- [ ] **Step 1: Replace updateStatus with updateVarsStatus and updateBridgeStatus**

Replace the `updateStatus` function (lines 239-259) with two functions:

```javascript
    // Heights for dynamic window resizing
    var HEIGHT_DEFAULT = 65;
    var HEIGHT_RECONNECT = 90;
    var HEIGHT_CLOUD = 145;
    var HEIGHT_CLOUD_RECONNECT = 170;

    function resizePluginWindow() {
      var cloudVisible = document.getElementById('cloud-section').classList.contains('visible');
      var reconnectVisible = document.getElementById('reconnect-btn').style.display !== 'none';
      var height = HEIGHT_DEFAULT;
      if (reconnectVisible && cloudVisible) height = HEIGHT_CLOUD_RECONNECT;
      else if (cloudVisible) height = HEIGHT_CLOUD;
      else if (reconnectVisible) height = HEIGHT_RECONNECT;
      parent.postMessage({ pluginMessage: { type: 'RESIZE_UI', width: 140, height: height } }, '*');
    }

    // Figma Vars status — reflects plugin worker data state
    function updateVarsStatus(state, isActive, isError, tooltip) {
      var dot = document.getElementById('vars-dot');
      var stateText = document.getElementById('vars-state');
      var row = document.getElementById('vars-row');

      dot.className = 'status-indicator ' + (isError ? 'error' : (isActive ? 'active' : 'loading'));
      stateText.textContent = state;
      row.title = tooltip || '';
    }

    // MCP Bridge status — reflects WebSocket connection state
    function updateBridgeStatus(state, isActive, isError, tooltip) {
      var dot = document.getElementById('bridge-dot');
      var stateText = document.getElementById('bridge-state');
      var row = document.getElementById('bridge-row');
      var btn = document.getElementById('reconnect-btn');

      dot.className = 'status-indicator ' + (isError ? 'error' : (isActive ? 'active' : 'loading'));
      stateText.textContent = state;
      row.title = tooltip || '';

      if (isError) {
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }
      resizePluginWindow();
    }
```

- [ ] **Step 2: Update all updateStatus calls in the WebSocket IIFE to use updateBridgeStatus**

Search for every `updateStatus(` call inside the IIFE block (the `(function() { ... })()` block). There are 7 call sites from Task 1. Replace each `updateStatus(` with `updateBridgeStatus(`. The arguments stay the same.

The 7 call sites are:
- `wsScanAndConnect` start: `updateStatus('scanning…', ...)` → `updateBridgeStatus('scanning…', ...)`
- `wsScanAndConnect` onopen: `updateStatus('connected (N)', ...)` → `updateBridgeStatus('connected (N)', ...)`
- Initial scan retries exhausted: `updateStatus('disconnected', ...)` → `updateBridgeStatus('disconnected', ...)`
- `wsReconnectPort` onopen: `updateStatus('connected (N)', ...)` → `updateBridgeStatus('connected (N)', ...)`
- `attachWsHandlers` onclose (no connections left): `updateStatus('reconnecting…', ...)` → `updateBridgeStatus('reconnecting…', ...)`
- `attachWsHandlers` onclose (connections remain): `updateStatus('connected (N)', ...)` → `updateBridgeStatus('connected (N)', ...)`
- Reconnect retries exhausted: `updateStatus('disconnected', ...)` → `updateBridgeStatus('disconnected', ...)`

Total: all occurrences of `updateStatus(` inside the IIFE become `updateBridgeStatus(`.

**For `ui-full.html`:** This file does NOT have the Task 1-3 lifecycle `updateStatus` calls. It only has the original 2 calls (in VARIABLES_DATA and ERROR handlers). These become `updateVarsStatus` in Steps 3-4 below. The IIFE in `ui-full.html` has NO `updateStatus` calls to rename. However, `ui-full.html` still needs the `sendDiagnostic` function, `window.__wsManualRescan`, and the WebSocket lifecycle `updateBridgeStatus` calls added — matching what the previous plan's Tasks 1-2 added to `ui.html`. This is covered in Task 5 below.

- [ ] **Step 3: Update VARIABLES_DATA handler to use updateVarsStatus**

In the `window.onmessage` handler, find the `case 'VARIABLES_DATA':` block. Replace:

```javascript
          var ports = (window.__wsGetActiveConnections ? window.__wsGetActiveConnections() : [])
            .filter(function(c) { return c.ws.readyState === 1; })
            .map(function(c) { return c.port; });
          updateStatus('ready', true, false,
            (ports.length ? 'Connected to port' + (ports.length > 1 ? 's' : '') + ': ' + ports.join(', ') : ''));
```

With:

```javascript
          updateVarsStatus('ready', true, false,
            (msg.data.variables ? msg.data.variables.length + ' variables' : ''));
```

- [ ] **Step 4: Update ERROR handler to use updateVarsStatus**

In the `window.onmessage` handler, find the `case 'ERROR':` block. Replace:

```javascript
          updateStatus('error', false, true);
```

With:

```javascript
          updateVarsStatus('error', false, true, msg.error || 'Plugin error');
```

- [ ] **Step 5: Update toggleCloudSection resize logic**

In the `toggleCloudSection` function, replace:

```javascript
      var height = isExpanding ? 130 : 50;
      parent.postMessage({ pluginMessage: { type: 'RESIZE_UI', width: 140, height: height } }, '*');
```

With:

```javascript
      resizePluginWindow();
```

- [ ] **Step 6: Remove the old clickable class logic from updateBridgeStatus**

The `updateBridgeStatus` function above already replaces the click-to-reconnect with the visible button. Verify that the `.clickable` class is no longer referenced anywhere — it was removed from CSS in Task 2 and from the function in this task. The `window.__wsManualRescan` exposure in the IIFE stays (the button's `onclick` uses it directly).

- [ ] **Step 7: Build and verify**

Run: `npm run build:local`
Expected: clean build

---

### Task 4: code.js — update default window height

**Files:**
- Modify: `figma-desktop-bridge/code.js` (4 `showUI` call sites)

- [ ] **Step 1: Update all showUI height values from 50 to 65**

There are 4 locations in `code.js` where `showUI` is called with `height: 50`:
- Line 14: `figma.showUI(__html__, { width: 140, height: 50, ...`
- Line 204: `figma.showUI(msg.html, { width: 140, height: 50, ...`
- Line 245: `figma.showUI(__html__, { width: 140, height: 50, ...`
- Line 2174: `figma.showUI(__html__, { width: 140, height: 50, ...`

Change all 4 from `height: 50` to `height: 65`.

- [ ] **Step 2: Build and verify**

Run: `npm run build:local`
Expected: clean build

---

### Task 5: ui-full.html — apply all changes from previous plan + this plan

**Files:**
- Modify: `figma-desktop-bridge/ui-full.html`

`ui-full.html` is a parallel copy of `ui.html` that the WebSocket server serves via HTTP. It does NOT have any of the previous plan's Task 1-3 changes (no lifecycle `updateBridgeStatus` calls, no `sendDiagnostic`, no `window.__wsManualRescan`). This task brings it to parity.

- [ ] **Step 1: Apply CSS changes from this plan's Task 2**

Same CSS replacements as Task 2 Steps 1-5, applied to `ui-full.html` against its original CSS (which has the original `.bridge-status`, `.status-text` rules without `.clickable`).

- [ ] **Step 2: Apply HTML changes from this plan's Task 1**

Same HTML replacement as Task 1, applied to `ui-full.html` (its original HTML has the same `bridge-status` structure as `ui.html` had before Tasks 1-3).

- [ ] **Step 3: Apply JS changes — replace updateStatus with two functions + add lifecycle calls**

In `ui-full.html`:
1. Replace the original `updateStatus(state, isActive, isError)` function (3-param version, no tooltip/clickable logic) with the same `resizePluginWindow`, `updateVarsStatus`, and `updateBridgeStatus` functions from this plan's Task 3 Step 1.
2. In the VARIABLES_DATA handler, replace `updateStatus('ready', true, false)` with `updateVarsStatus('ready', true, false, ...)` per Task 3 Step 3.
3. In the ERROR handler, replace `updateStatus('error', false, true)` with `updateVarsStatus('error', false, true, ...)` per Task 3 Step 4.
4. Update `toggleCloudSection` resize logic per Task 3 Step 5.

- [ ] **Step 4: Add WebSocket lifecycle updateBridgeStatus calls**

Add the same 7 `updateBridgeStatus(` calls from the previous plan's Task 1 to the IIFE in `ui-full.html`:
- `wsScanAndConnect` start → `updateBridgeStatus('scanning…', ...)`
- `wsScanAndConnect` onopen → `updateBridgeStatus('connected (N)', ...)`
- Initial scan retries exhausted → `updateBridgeStatus('disconnected', ...)`
- `wsReconnectPort` onopen → `updateBridgeStatus('connected (N)', ...)`
- `attachWsHandlers` onclose (no connections) → `updateBridgeStatus('reconnecting…', ...)`
- `attachWsHandlers` onclose (connections remain) → `updateBridgeStatus('connected (N)', ...)`
- Reconnect retries exhausted → `updateBridgeStatus('disconnected', ...)`

- [ ] **Step 5: Add sendDiagnostic function and calls**

Add the `sendDiagnostic` function (from previous plan's Task 2) after `broadcastToAll` in the IIFE, and the 5 `sendDiagnostic` calls at the same lifecycle points.

- [ ] **Step 6: Add window.__wsManualRescan**

Add the `window.__wsManualRescan` exposure at the bottom of the IIFE (from previous plan's Task 1 / this plan's Task 3).

- [ ] **Step 7: Build and verify**

Run: `npm run build:local`
Expected: clean build

---

### Task 6: Integration verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: 459+ tests pass, no regressions

- [ ] **Step 2: Build**

Run: `npm run build:local`
Expected: clean build

- [ ] **Step 3: Verify the status flow logic**

Read through `ui.html` AND `ui-full.html` and trace the state transitions:

**Figma Vars row:**
- Page load → `loading` (amber pulse) — initial HTML state
- VARIABLES_DATA received → `updateVarsStatus('ready', true, false, ...)` → green glow
- ERROR received → `updateVarsStatus('error', false, true, ...)` → red dot (tooltip: "Reload plugin to retry")

**MCP Bridge row:**
- `wsScanAndConnect()` called → `updateBridgeStatus('scanning…', false, false, ...)` → amber pulse
- WebSocket connects → `updateBridgeStatus('connected (N)', true, false, ...)` → green glow
- WebSocket disconnects, retrying → `updateBridgeStatus('reconnecting…', false, false, ...)` → amber pulse
- Retries exhausted → `updateBridgeStatus('disconnected', false, true, ...)` → red dot + Reconnect button appears + window resizes
- Click Reconnect → `window.__wsManualRescan()` → rescans → goes back to scanning…

**Reconnect button:**
- Only visible when `updateBridgeStatus` is called with `isError = true`
- Hidden whenever `updateBridgeStatus` is called with `isError = false`
- `resizePluginWindow()` called on every `updateBridgeStatus` to adjust window height

**Accepted limitation:** In CDP-only mode (no WebSocket bridge), the MCP Bridge row will show "disconnected" (red) after scan retries exhaust. This is technically correct — there is no WebSocket bridge — but the plugin works fine via CDP. This is acceptable for now.

---

## Summary

| Task | What changes | Risk |
|---|---|---|
| 1. HTML restructure | Two rows + reconnect button in `ui.html` + `ui-full.html` | Low — surgical HTML replacement |
| 2. CSS update | New row/button styles, remove old pill styles in both files | Low — visual only |
| 3. JS split | `updateStatus` → `updateVarsStatus` + `updateBridgeStatus`, resize logic | Medium — touches 9 call sites |
| 4. code.js height | 4 `showUI` height changes | Low — constant change |
| 5. ui-full.html parity | Apply all previous plan + this plan changes to `ui-full.html` | Medium — large but mechanical |
| 6. Integration check | Verify tests + build + state flow in both files | Low — read-only |

Tasks 1-3 modify `ui.html` and must be applied sequentially. Task 4 (`code.js`) is independent. Task 5 brings `ui-full.html` to parity. Task 6 is verification only.
