/** Jest globalTeardown: remove the per-run temp directory made by isolate-tmpdir.cjs. */
const { rmSync } = require('node:fs');

module.exports = async () => {
	const dir = process.env.FCM_JEST_TMPDIR;
	if (dir) rmSync(dir, { recursive: true, force: true });
};
