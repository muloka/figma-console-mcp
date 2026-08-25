import { registerWriteTools } from "../src/core/write-tools";

interface RegisteredTool {
	name: string;
	description: string;
	schema: any;
	handler: (args: any) => Promise<any>;
}

function createMockServer() {
	const tools: Record<string, RegisteredTool> = {};
	return {
		tool: jest.fn(
			(name: string, description: string, schema: any, handler: any) => {
				tools[name] = { name, description, schema, handler };
			},
		),
		_getTool(name: string): RegisteredTool {
			return tools[name];
		},
	};
}

function body(result: any): any {
	return JSON.parse(result.content[0].text);
}

const SETUP_ARGS = {
	collectionName: "c",
	modes: ["A", "B"],
	tokens: [{ name: "t", resolvedType: "COLOR", values: { A: "#000000" } }],
};

describe("figma_setup_design_tokens structured script errors", () => {
	it("forwards a script-returned error object as isError with its fields", async () => {
		const executeCodeViaUI = jest.fn().mockResolvedValue({
			success: true,
			result: {
				error:
					'Mode "B" could not be added: in addMode: Limited to 10 modes only — collection rolled back, nothing was created.',
				planModeLimit: 10,
				requested: 12,
				rolledBack: true,
			},
		});
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({ executeCodeViaUI }));
		const result = await server
			._getTool("figma_setup_design_tokens")
			.handler(SETUP_ARGS);
		expect(result.isError).toBe(true);
		const b = body(result);
		expect(b.error).toContain("Limited to 10 modes only");
		expect(b.planModeLimit).toBe(10);
		expect(b.requested).toBe(12);
		expect(b.rolledBack).toBe(true);
		expect(b.success).toBeUndefined();
	});

	it("success path is unchanged", async () => {
		const executeCodeViaUI = jest.fn().mockResolvedValue({
			success: true,
			result: {
				collectionId: "VariableCollectionId:1:2",
				collectionName: "c",
				modes: { A: "1:0", B: "1:1" },
				created: 1,
				failed: 0,
				results: [{ success: true, name: "t", id: "VariableID:1:3" }],
				warnings: [],
			},
		});
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({ executeCodeViaUI }));
		const result = await server
			._getTool("figma_setup_design_tokens")
			.handler(SETUP_ARGS);
		expect(result.isError).toBeUndefined();
		expect(body(result).success).toBe(true);
	});

	it("the embedded script rolls back the collection and parses the plan limit", async () => {
		const executeCodeViaUI = jest
			.fn()
			.mockResolvedValue({ success: true, result: { created: 0, failed: 0, results: [], warnings: [] } });
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({ executeCodeViaUI }));
		await server._getTool("figma_setup_design_tokens").handler(SETUP_ARGS);
		const script: string = executeCodeViaUI.mock.calls[0][0];
		expect(script).toContain("collection.remove()");
		expect(script).toContain("planModeLimit");
		expect(script).toContain("Limited to (\\d+) modes");
	});

	it("modes schema allows up to 40 and rejects 41", () => {
		const server = createMockServer();
		registerWriteTools(server as any, async () => ({}));
		const modesSchema = server._getTool("figma_setup_design_tokens").schema
			.modes;
		expect(modesSchema.safeParse(Array(10).fill("m")).success).toBe(true);
		expect(modesSchema.safeParse(Array(40).fill("m")).success).toBe(true);
		expect(modesSchema.safeParse(Array(41).fill("m")).success).toBe(false);
	});
});
