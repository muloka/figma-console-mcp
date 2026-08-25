// tests/orphan-node-guards.test.ts
import * as fs from "fs";
import * as path from "path";

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
