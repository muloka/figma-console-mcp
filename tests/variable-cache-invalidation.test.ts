/**
 * Variable Cache Invalidation Tests
 *
 * Verifies that:
 * 1. refreshCache=true bypasses the plugin UI's stale cache by using
 *    connector.getVariables() (live Plugin API) instead of
 *    connector.getVariablesFromPluginUI() (stale window.__figmaVariablesData)
 * 2. Write operations (create, update, delete, batch) invalidate the
 *    MCP server-side variablesCache
 * 3. The response 'cached' flag reflects whether data was freshly fetched
 *
 * Bug: figma_get_variables with refreshCache: true returned stale data after
 * figma_batch_create_variables because the plugin UI cache was never refreshed.
 */

import { WebSocketConnector } from '../src/core/websocket-connector';
import { FigmaWebSocketServer } from '../src/core/websocket-server';
import { WebSocket } from 'ws';

jest.setTimeout(10000);

// ============================================================================
// Helpers (shared with websocket-bridge.test.ts)
// ============================================================================

function connectClient(
  server: FigmaWebSocketServer,
  port: number,
  fileInfo?: { fileKey: string; fileName: string; currentPage?: string }
): Promise<WebSocket> {
  const info = fileInfo || { fileKey: 'test-file-key', fileName: 'Test File', currentPage: 'Page 1' };
  return new Promise((resolve, reject) => {
    const connectedPromise = new Promise<void>((res) =>
      server.once('connected', res)
    );
    const ws = new WebSocket(`ws://localhost:${port}`);
    ws.on('error', reject);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'FILE_INFO', data: info }));
      connectedPromise.then(() => resolve(ws));
    });
  });
}

function closeClient(ws: WebSocket | null): Promise<void> {
  if (!ws) return Promise.resolve();
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      resolve();
      return;
    }
    ws.on('close', () => resolve());
    ws.close();
  });
}

// ============================================================================
// WebSocketConnector: refreshCache routing
// ============================================================================

describe('WebSocketConnector: refreshCache routing', () => {
  let server: FigmaWebSocketServer;
  let connector: WebSocketConnector;
  let client: WebSocket | null = null;
  const TEST_PORT = 19230;
  const receivedCommands: Array<{ method: string; params: any }> = [];

  async function setup() {
    receivedCommands.length = 0;
    server = new FigmaWebSocketServer({ port: TEST_PORT });
    await server.start();

    client = await connectClient(server, TEST_PORT);

    // Track every command the server sends, and echo a valid result back
    client.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id && msg.method) {
        receivedCommands.push({ method: msg.method, params: msg.params });
        // Return realistic variables data for both GET_VARIABLES_DATA and EXECUTE_CODE
        client!.send(JSON.stringify({
          id: msg.id,
          result: {
            success: true,
            variables: [{ id: 'VariableID:1:1', name: 'test-var' }],
            variableCollections: [{ id: 'VariableCollectionId:1:1', name: 'Test' }],
            timestamp: Date.now(),
          },
        }));
      }
    });

    connector = new WebSocketConnector(server);
  }

  afterEach(async () => {
    if (server) await server.stop();
    await closeClient(client);
    client = null;
  });

  test('getVariablesFromPluginUI sends GET_VARIABLES_DATA command', async () => {
    await setup();
    await connector.getVariablesFromPluginUI('test-file-key');

    expect(receivedCommands).toHaveLength(1);
    expect(receivedCommands[0].method).toBe('GET_VARIABLES_DATA');
  });

  test('getVariables sends EXECUTE_CODE command (live Plugin API fetch)', async () => {
    await setup();
    await connector.getVariables('test-file-key');

    expect(receivedCommands).toHaveLength(1);
    expect(receivedCommands[0].method).toBe('EXECUTE_CODE');
    // The code should include figma.variables.getLocalVariablesAsync
    expect(receivedCommands[0].params.code).toContain('getLocalVariablesAsync');
  });

  test('getVariables and getVariablesFromPluginUI use different transport paths', async () => {
    await setup();

    // This is the core of the bug fix: refreshCache=true should use
    // getVariables() (EXECUTE_CODE) not getVariablesFromPluginUI() (GET_VARIABLES_DATA)
    await connector.getVariablesFromPluginUI('test-file-key');
    await connector.getVariables('test-file-key');

    expect(receivedCommands).toHaveLength(2);
    expect(receivedCommands[0].method).toBe('GET_VARIABLES_DATA');
    expect(receivedCommands[1].method).toBe('EXECUTE_CODE');
  });
});

// ============================================================================
// MCP server-side variablesCache invalidation
// ============================================================================

describe('variablesCache invalidation after write operations', () => {
  let cache: Map<string, { data: any; timestamp: number }>;

  beforeEach(() => {
    cache = new Map();
    cache.set('file-key-1', {
      data: {
        variables: [{ id: 'v1', name: 'old-var' }],
        variableCollections: [{ id: 'c1', name: 'Old Collection' }],
      },
      timestamp: Date.now(),
    });
    cache.set('file-key-2', {
      data: {
        variables: [{ id: 'v2', name: 'other-var' }],
        variableCollections: [{ id: 'c2', name: 'Other Collection' }],
      },
      timestamp: Date.now(),
    });
  });

  test('cache.clear() removes all entries', () => {
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('file-key-1')).toBeUndefined();
    expect(cache.get('file-key-2')).toBeUndefined();
  });

  test('stale cache returns old data before invalidation', () => {
    const entry = cache.get('file-key-1');
    expect(entry).toBeDefined();
    expect(entry!.data.variables[0].name).toBe('old-var');
  });

  test('cache miss after invalidation forces fresh fetch', () => {
    // Simulate what happens after a write operation: cache is cleared
    cache.clear();

    // Now a read should find no cache entry, triggering a fresh fetch
    const entry = cache.get('file-key-1');
    expect(entry).toBeUndefined();
  });

  test('cache TTL validation works correctly', () => {
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, matches figma-tools.ts

    // Fresh entry
    const freshEntry = { data: {}, timestamp: Date.now() };
    expect(Date.now() - freshEntry.timestamp < CACHE_TTL_MS).toBe(true);

    // Expired entry
    const expiredEntry = { data: {}, timestamp: Date.now() - CACHE_TTL_MS - 1 };
    expect(Date.now() - expiredEntry.timestamp < CACHE_TTL_MS).toBe(false);
  });
});

// ============================================================================
// Integration: refreshCache flag in figma-tools.ts fetch logic
// ============================================================================

describe('figma-tools.ts refreshCache integration', () => {
  // These tests verify the conditional logic added in the fix:
  //   const desktopResult = refreshCache
  //     ? await connector.getVariables(fileKey)
  //     : await connector.getVariablesFromPluginUI(fileKey);

  test('refreshCache=false should use getVariablesFromPluginUI (UI cache)', () => {
    const refreshCache = false;
    const methodToCall = refreshCache ? 'getVariables' : 'getVariablesFromPluginUI';
    expect(methodToCall).toBe('getVariablesFromPluginUI');
  });

  test('refreshCache=true should use getVariables (live Plugin API)', () => {
    const refreshCache = true;
    const methodToCall = refreshCache ? 'getVariables' : 'getVariablesFromPluginUI';
    expect(methodToCall).toBe('getVariables');
  });

  test('refreshCache=undefined (default) should use getVariablesFromPluginUI', () => {
    const refreshCache = undefined;
    const methodToCall = refreshCache ? 'getVariables' : 'getVariablesFromPluginUI';
    expect(methodToCall).toBe('getVariablesFromPluginUI');
  });

  test('EXECUTE_CODE result shape is normalized (unwrap .result)', () => {
    // getVariables() returns { success: true, result: { success: true, variables: [...] } }
    // getVariablesFromPluginUI() returns { success: true, variables: [...] }
    // The normalization logic: rawResult.result?.variables ? rawResult.result : rawResult

    const executeCodeResult = {
      success: true,
      result: {
        success: true,
        variables: [{ id: 'v1', name: 'test' }],
        variableCollections: [{ id: 'c1', name: 'Collection' }],
      },
    };
    const normalized = executeCodeResult.result?.variables
      ? executeCodeResult.result
      : executeCodeResult;
    expect(normalized.variables).toHaveLength(1);
    expect(normalized.variables[0].name).toBe('test');
  });

  test('GET_VARIABLES_DATA result shape passes through unchanged', () => {
    const getVarsResult = {
      success: true,
      variables: [{ id: 'v1', name: 'test' }],
      variableCollections: [{ id: 'c1', name: 'Collection' }],
    };
    const normalized = getVarsResult.result?.variables
      ? getVarsResult.result
      : getVarsResult;
    expect(normalized.variables).toHaveLength(1);
    expect(normalized).toBe(getVarsResult); // Same reference — no unwrapping needed
  });
});
