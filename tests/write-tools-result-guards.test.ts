/**
 * Result-envelope guards for the single-op variable/collection/mode tools.
 *
 * The Desktop Bridge resolves plugin failures as `{success:false, error}`
 * objects (ui.html handleResult) rather than rejecting, so every tool handler
 * must check `result.success` before dereferencing result fields. Historically
 * the eight single-op variable tools did not (issue #6): four returned
 * success:true with the payload field undefined (false success), and four
 * threw a TypeError while building the success message, masking the plugin's
 * real error text ("Cannot read properties of undefined (reading 'name')").
 *
 * These tests pin the honest behavior: a plugin-side failure surfaces as
 * isError:true with the plugin's error text propagated verbatim.
 */

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

/** Parse the JSON body every write tool returns in content[0].text. */
function body(result: any): any {
	return JSON.parse(result.content[0].text);
}

function setup(connector: Record<string, jest.Mock>) {
	const server = createMockServer();
	registerWriteTools(server as any, async () => connector);
	return server;
}

// The exact error text Figma's Plugin API produced in live testing — the
// guard's job is to deliver this string, not a reporting TypeError.
const PLAN_LIMIT_ERROR = "in addMode: Limited to 10 modes only";
const NOT_FOUND_ERROR = "Variable not found: VariableID:9:99";

const fail = (error: string) => ({ success: false, error });

describe("plugin failures surface as isError with the real error text", () => {
	it("figma_update_variable — value update fails", async () => {
		const server = setup({
			updateVariable: jest.fn().mockResolvedValue(fail(NOT_FOUND_ERROR)),
			setVariableDescription: jest.fn(),
		});
		const result = await server
			._getTool("figma_update_variable")
			.handler({ variableId: "VariableID:9:99", modeId: "1:0", value: "#FF0000" });
		expect(result.isError).toBe(true);
		expect(body(result).error).toContain(NOT_FOUND_ERROR);
	});

	it("figma_update_variable — value applies, then description fails", async () => {
		const server = setup({
			updateVariable: jest
				.fn()
				.mockResolvedValue({ success: true, variable: { name: "x" } }),
			setVariableDescription: jest
				.fn()
				.mockResolvedValue(fail(NOT_FOUND_ERROR)),
		});
		const result = await server
			._getTool("figma_update_variable")
			.handler({
				variableId: "VariableID:9:99",
				modeId: "1:0",
				value: "#FF0000",
				description: "d",
			});
		expect(result.isError).toBe(true);
		expect(body(result).error).toContain(NOT_FOUND_ERROR);
	});

	it("figma_create_variable", async () => {
		const server = setup({
			createVariable: jest
				.fn()
				.mockResolvedValue(fail("Collection not found: VariableCollectionId:1:2")),
		});
		const result = await server
			._getTool("figma_create_variable")
			.handler({ name: "t", collectionId: "VariableCollectionId:1:2", resolvedType: "COLOR" });
		expect(result.isError).toBe(true);
		expect(body(result).error).toContain("Collection not found");
	});

	it("figma_create_variable_collection", async () => {
		const server = setup({
			createVariableCollection: jest
				.fn()
				.mockResolvedValue(fail(PLAN_LIMIT_ERROR)),
		});
		const result = await server
			._getTool("figma_create_variable_collection")
			.handler({ name: "c", additionalModes: ["m2"] });
		expect(result.isError).toBe(true);
		expect(body(result).error).toContain(PLAN_LIMIT_ERROR);
	});

	it("figma_delete_variable", async () => {
		const server = setup({
			deleteVariable: jest.fn().mockResolvedValue(fail(NOT_FOUND_ERROR)),
		});
		const result = await server
			._getTool("figma_delete_variable")
			.handler({ variableId: "VariableID:9:99" });
		expect(result.isError).toBe(true);
		const b = body(result);
		expect(b.error).toContain(NOT_FOUND_ERROR);
		expect(b.error).not.toContain("reading 'name'");
	});

	it("figma_delete_variable_collection", async () => {
		const server = setup({
			deleteVariableCollection: jest
				.fn()
				.mockResolvedValue(fail("Collection not found: VariableCollectionId:1:2")),
		});
		const result = await server
			._getTool("figma_delete_variable_collection")
			.handler({ collectionId: "VariableCollectionId:1:2" });
		expect(result.isError).toBe(true);
		const b = body(result);
		expect(b.error).toContain("Collection not found");
		expect(b.error).not.toContain("reading 'name'");
	});

	it("figma_rename_variable", async () => {
		const server = setup({
			renameVariable: jest.fn().mockResolvedValue(fail(NOT_FOUND_ERROR)),
		});
		const result = await server
			._getTool("figma_rename_variable")
			.handler({ variableId: "VariableID:9:99", newName: "n" });
		expect(result.isError).toBe(true);
		const b = body(result);
		expect(b.error).toContain(NOT_FOUND_ERROR);
		expect(b.error).not.toContain("reading 'name'");
	});

	it("figma_add_mode — plan-limit error text survives", async () => {
		const server = setup({
			addMode: jest.fn().mockResolvedValue(fail(PLAN_LIMIT_ERROR)),
		});
		const result = await server
			._getTool("figma_add_mode")
			.handler({ collectionId: "VariableCollectionId:1:2", modeName: "zm11" });
		expect(result.isError).toBe(true);
		const b = body(result);
		expect(b.error).toContain(PLAN_LIMIT_ERROR);
		expect(b.error).not.toContain("reading 'name'");
	});

	it("figma_rename_mode", async () => {
		const server = setup({
			renameMode: jest.fn().mockResolvedValue(fail("Mode not found: 1:99")),
		});
		const result = await server
			._getTool("figma_rename_mode")
			.handler({ collectionId: "VariableCollectionId:1:2", modeId: "1:99", newName: "n" });
		expect(result.isError).toBe(true);
		expect(body(result).error).toContain("Mode not found");
	});
});

describe("success paths still work", () => {
	it("figma_add_mode", async () => {
		const server = setup({
			addMode: jest.fn().mockResolvedValue({
				success: true,
				collection: { name: "Tokens" },
				newMode: { modeId: "1:1", name: "Dark" },
			}),
		});
		const result = await server
			._getTool("figma_add_mode")
			.handler({ collectionId: "VariableCollectionId:1:2", modeName: "Dark" });
		expect(result.isError).toBeUndefined();
		const b = body(result);
		expect(b.success).toBe(true);
		expect(b.message).toContain("Tokens");
	});

	it("figma_update_variable — value + description", async () => {
		const server = setup({
			updateVariable: jest
				.fn()
				.mockResolvedValue({ success: true, variable: { name: "x" } }),
			setVariableDescription: jest
				.fn()
				.mockResolvedValue({ success: true, variable: { name: "x" } }),
		});
		const result = await server
			._getTool("figma_update_variable")
			.handler({
				variableId: "VariableID:1:2",
				modeId: "1:0",
				value: "#FF0000",
				description: "d",
			});
		expect(result.isError).toBeUndefined();
		expect(body(result).success).toBe(true);
	});
});
