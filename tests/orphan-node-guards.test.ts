// tests/orphan-node-guards.test.ts
import * as fs from "fs";
import * as path from "path";
import { registerWriteTools } from "../src/core/write-tools";

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
