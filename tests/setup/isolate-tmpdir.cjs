/**
 * Jest globalSetup: give the whole test run its own temp directory.
 *
 * Port discovery writes and deletes `<tmpdir>/figma-console-mcp-<port>.json`,
 * and a live sidecar on the same machine advertises itself in exactly those
 * files. Tests sharing the real tmpdir deleted the live sidecar's file (its
 * heartbeat then re-created it without `mcpHttpPort`, so clients could no longer
 * find its HTTP transport), and the stale-instance cleanup tests scanned real
 * sidecars' files too.
 *
 * os.tmpdir() reads TMPDIR on every call, and test workers are started after
 * this hook, so they inherit it.
 */
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

module.exports = async () => {
	const dir = mkdtempSync(join(tmpdir(), 'fcm-jest-'));
	process.env.FCM_JEST_TMPDIR = dir;
	process.env.TMPDIR = dir;
};
