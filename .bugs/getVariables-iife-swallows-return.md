# `getVariables()` IIFE wrapper swallows return value — `refreshCache: true` always fails via Desktop Bridge

**Repro:** Call `figma_get_variables({ refreshCache: true })` against a file with local variables via Desktop Bridge (no `FIGMA_ACCESS_TOKEN` set).

**Expected:** Variables returned from the Desktop Bridge via live Plugin API fetch.

**Actual:** "Cannot retrieve variables. All methods failed." — the bridge successfully fetches all variables, then silently drops them. The response is `{ success: true }` with no variable data.

## Root cause

`getVariables()` in `websocket-connector.ts:52-71` wraps its script in an async IIFE:

```js
(async () => {
    // ...
    return { success: true, variables: [...] };
})()
```

`code.js:289` wraps all `EXECUTE_CODE` scripts in another async IIFE:

```js
var wrappedCode = "(async function() {\n" + msg.code + "\n})()";
```

The inner `return` returns from the inner function. The outer function returns `undefined`. The plugin fetches all variables, then `result` is `undefined` at `code.js:364`. `handleResult` at `ui-full.html:1152` checks `msg[dataKey] !== undefined` before including it — since `result` is `undefined`, the key is omitted. The check at `figma-tools.ts:1926` (`desktopResult.success && desktopResult.variables`) passes on `success` but fails on `variables` — no error logged, silent fallthrough.

Same code exists in `cloud-websocket-connector.ts:52-71`.

## Impact

Any MCP client using `refreshCache: true` via Desktop Bridge gets no variables. The `refreshCache: false` path is unaffected — it uses `getVariablesFromPluginUI()` which reads `window.__figmaVariablesData` directly, no `EXECUTE_CODE` involved.

## Fix (two parts)

### 1. Remove the IIFE wrapper from the script

In `websocket-connector.ts:52-71` and `cloud-websocket-connector.ts:52-71`, remove the IIFE so the `return` reaches the outer function that `code.js` provides:

```diff
     const code = `
-      (async () => {
-        try {
-          if (typeof figma === 'undefined') {
-            throw new Error('Figma API not available in this context');
-          }
-          const variables = await figma.variables.getLocalVariablesAsync();
-          const collections = await figma.variables.getLocalVariableCollectionsAsync();
-          return {
+      try {
+        if (typeof figma === 'undefined') {
+          throw new Error('Figma API not available in this context');
+        }
+        const variables = await figma.variables.getLocalVariablesAsync();
+        const collections = await figma.variables.getLocalVariableCollectionsAsync();
+        return {
             success: true,
             // ...
-          };
-        } catch (error) {
-          return { success: false, error: error.message };
-        }
-      })()
+        };
+      } catch (error) {
+        return { success: false, error: error.message };
+      }
     `;
```

### 2. Unwrap the `EXECUTE_CODE` response envelope

Even after fix 1, the response is `{ success: true, result: { success: true, variables: [...] } }` because `handleResult` nests the script return value under `result`. The variable extraction at `figma-tools.ts:1926` needs to look there:

```diff
+    const variableData = desktopResult?.result?.variables
+        ? desktopResult.result
+        : desktopResult;
-    if (desktopResult.success && desktopResult.variables) {
+    if (variableData.success && variableData.variables) {
```

Then use `variableData` in place of `desktopResult` for `variables`, `variableCollections`, and `timestamp` in the success block that follows.

## Why not fix `code.js` instead?

The double-wrap is a convention mismatch — `code.js` wraps everything, callers also wrap. A structural fix in `code.js` (e.g., capturing the eval'd expression's return value so both patterns work) would prevent future callers from hitting the same silent-drop. However, every `figma_execute` call from AI agents writes bare `return` statements against the current convention. Changing `code.js`'s wrapping behavior has wider blast radius.
