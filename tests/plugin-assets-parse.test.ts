/**
 * Standing guard: the Desktop Bridge plugin assets must parse.
 *
 * figma-desktop-bridge/{code.js,ui.html} are raw plugin assets, NOT TypeScript.
 * `npm run build:local` compiles src/*.ts and never touches them, and no other
 * test executes the real files (bridge-handler-dispatch.test.ts exercises a
 * mirror). So a syntax error introduced while editing them would sail through
 * the build and the entire suite undetected — and only surface when Figma tries
 * to load the plugin.
 *
 * This test parses each asset (without executing it) so a broken edit fails CI
 * immediately. vm.Script compiles/parses only — undefined plugin globals like
 * `figma` or `window` are never referenced, so they can't cause failures here.
 */

import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";

const PLUGIN_DIR = path.resolve(__dirname, "..", "figma-desktop-bridge");

/** Compile as a classic script; throws SyntaxError on a parse error, runs nothing. */
function assertParses(code: string, label: string): void {
	expect(() => new vm.Script(code, { filename: label })).not.toThrow();
}

function extractScriptBlocks(html: string): string[] {
	const blocks: string[] = [];
	const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const body = m[1].trim();
		if (body.length > 0) blocks.push(m[1]);
	}
	return blocks;
}

describe("Desktop Bridge plugin assets parse", () => {
	it("code.js is syntactically valid JavaScript", () => {
		const code = fs.readFileSync(path.join(PLUGIN_DIR, "code.js"), "utf8");
		assertParses(code, "figma-desktop-bridge/code.js");
	});

	it("ui.html contains at least one inline <script> block", () => {
		const html = fs.readFileSync(path.join(PLUGIN_DIR, "ui.html"), "utf8");
		expect(extractScriptBlocks(html).length).toBeGreaterThan(0);
	});

	it("every inline <script> block in ui.html is syntactically valid JavaScript", () => {
		const html = fs.readFileSync(path.join(PLUGIN_DIR, "ui.html"), "utf8");
		const blocks = extractScriptBlocks(html);
		blocks.forEach((block, i) => {
			assertParses(block, `figma-desktop-bridge/ui.html#script[${i}]`);
		});
	});

	it("manifest.json is valid JSON with a code + ui entry point", () => {
		const raw = fs.readFileSync(path.join(PLUGIN_DIR, "manifest.json"), "utf8");
		const manifest = JSON.parse(raw);
		expect(manifest.main).toBe("code.js");
		expect(manifest.ui).toBe("ui.html");
	});
});
