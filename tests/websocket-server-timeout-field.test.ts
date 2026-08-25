import { FigmaWebSocketServer } from "../src/core/websocket-server";

describe("sendCommand frames carry the caller's timeout budget", () => {
	let server: FigmaWebSocketServer | undefined;

	function serverWithFakeClient() {
		server = new FigmaWebSocketServer({} as any);
		const send = jest.fn();
		const fakeWs = { readyState: 1, send };
		(server as any).clients = new Map([
			["file-key", { ws: fakeWs, fileInfo: { fileName: "f" }, lastActivity: 0 }],
		]);
		(server as any)._activeFileKey = "file-key";
		return { server, send };
	}

	afterEach(() => {
		if (server) {
			const pendingRequests = (server as any).pendingRequests as Map<string, { timeoutId: ReturnType<typeof setTimeout> }>;
			if (pendingRequests) {
				for (const { timeoutId } of pendingRequests.values()) {
					clearTimeout(timeoutId);
				}
				pendingRequests.clear();
			}
			server = undefined;
		}
	});

	it("includes timeoutMs verbatim", () => {
		const { server, send } = serverWithFakeClient();
		server.sendCommand("LINT_DESIGN", {}, 120000);
		const frame = JSON.parse(send.mock.calls[0][0]);
		expect(frame.method).toBe("LINT_DESIGN");
		expect(frame.timeoutMs).toBe(120000);
	});

	it("includes the 15000 default when the caller omits it", () => {
		const { server, send } = serverWithFakeClient();
		server.sendCommand("GET_SLOTS", {});
		const frame = JSON.parse(send.mock.calls[0][0]);
		expect(frame.timeoutMs).toBe(15000);
	});
});
