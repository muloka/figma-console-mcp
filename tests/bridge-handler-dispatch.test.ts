/**
 * Tests for the Desktop Bridge plugin-side handler dispatch
 * (figma-desktop-bridge/ui.html — the WebSocket onmessage path).
 *
 * The dispatch wraps every method handler in a 30s safety timeout via
 * Promise.race, sends the result back only if the socket is still open, and
 * logs a dropped-response warning otherwise. That logic lives inline inside
 * ui.html and can't be imported, so — following the same convention as
 * refresh-cache-iife.test.ts (#68) — we exercise a faithful mirror of it and
 * add a source guard that fails if ui.html drifts from the tested shape.
 */

const HANDLER_TIMEOUT_MS = 30000;

interface FakeWs {
	readyState: number;
	sent: string[];
	send(data: string): void;
}

function makeWs(readyState = 1): FakeWs {
	return {
		readyState,
		sent: [],
		send(data: string) {
			this.sent.push(data);
		},
	};
}

/**
 * Mirror of the ui.html dispatch block. Kept byte-faithful to the real code so
 * the source guard below can assert ui.html still matches. Returns the
 * Promise.race chain so tests can await settlement.
 */
function dispatch(
	handler: (params: any) => any,
	message: { id: number | string; method: string; params?: any },
	activeWs: FakeWs,
	port: number,
	warn: (msg: string) => void,
): { done: Promise<void>; timerCleared: () => boolean } {
	let cleared = false;
	let handlerSettled = false;
	let handlerTimeoutId: ReturnType<typeof setTimeout> | null = null;
	const handlerPromise = Promise.resolve(handler(message.params || {}));
	const timeoutPromise = new Promise((_, reject) => {
		handlerTimeoutId = setTimeout(() => {
			if (!handlerSettled) {
				reject(
					new Error(
						"Handler for " +
							message.method +
							" did not respond within " +
							HANDLER_TIMEOUT_MS +
							"ms",
					),
				);
			}
		}, HANDLER_TIMEOUT_MS);
	});

	const clear = () => {
		if (handlerTimeoutId !== null) {
			clearTimeout(handlerTimeoutId);
			cleared = true;
		}
	};

	const done = Promise.race([handlerPromise, timeoutPromise])
		.then((result) => {
			handlerSettled = true;
			clear();
			if (activeWs.readyState === 1) {
				activeWs.send(JSON.stringify({ id: message.id, result }));
			} else {
				warn(
					"[MCP Bridge] WS:" +
						port +
						": Dropping result for " +
						message.method +
						" (id=" +
						message.id +
						") — socket closed",
				);
			}
		})
		.catch((err: any) => {
			handlerSettled = true;
			clear();
			if (activeWs.readyState === 1) {
				activeWs.send(
					JSON.stringify({
						id: message.id,
						error: err.message || String(err),
					}),
				);
			} else {
				warn(
					"[MCP Bridge] WS:" +
						port +
						": Dropping error for " +
						message.method +
						" (id=" +
						message.id +
						") — socket closed: " +
						(err.message || String(err)),
				);
			}
		});

	return { done, timerCleared: () => cleared };
}

describe("Desktop Bridge handler dispatch", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it("happy path: sends the handler result back over the open socket", async () => {
		const ws = makeWs(1);
		const warn = jest.fn();
		const { done } = dispatch(
			async () => ({ ok: true, value: 42 }),
			{ id: 1, method: "figma_get_status" },
			ws,
			9223,
			warn,
		);
		await done;

		expect(ws.sent).toHaveLength(1);
		expect(JSON.parse(ws.sent[0])).toEqual({
			id: 1,
			result: { ok: true, value: 42 },
		});
		expect(warn).not.toHaveBeenCalled();
	});

	it("clears the timeout timer once the handler settles (no leaked timer)", async () => {
		const ws = makeWs(1);
		const clearSpy = jest.spyOn(global, "clearTimeout");
		const { done, timerCleared } = dispatch(
			async () => "ok",
			{ id: 2, method: "figma_ping" },
			ws,
			9223,
			jest.fn(),
		);
		await done;

		expect(timerCleared()).toBe(true);
		expect(clearSpy).toHaveBeenCalled();
		clearSpy.mockRestore();
	});

	it("handler rejection: sends the error message back", async () => {
		const ws = makeWs(1);
		const { done } = dispatch(
			async () => {
				throw new Error("boom");
			},
			{ id: 3, method: "figma_execute" },
			ws,
			9223,
			jest.fn(),
		);
		await done;

		expect(JSON.parse(ws.sent[0])).toEqual({ id: 3, error: "boom" });
	});

	it("timeout: a handler that never resolves rejects after 30s with a named error", async () => {
		jest.useFakeTimers();
		const ws = makeWs(1);
		const { done } = dispatch(
			() => new Promise(() => {}), // never settles
			{ id: 4, method: "figma_slow_op" },
			ws,
			9223,
			jest.fn(),
		);

		jest.advanceTimersByTime(HANDLER_TIMEOUT_MS);
		await done;

		expect(ws.sent).toHaveLength(1);
		const payload = JSON.parse(ws.sent[0]);
		expect(payload.id).toBe(4);
		expect(payload.error).toBe(
			"Handler for figma_slow_op did not respond within 30000ms",
		);
	});

	it("dropped result: socket closed before handler settles → logs, sends nothing", async () => {
		const ws = makeWs(3); // CLOSED
		const warn = jest.fn();
		const { done } = dispatch(
			async () => ({ ok: true }),
			{ id: 5, method: "figma_get_selection" },
			ws,
			9224,
			warn,
		);
		await done;

		expect(ws.sent).toHaveLength(0);
		expect(warn).toHaveBeenCalledWith(
			"[MCP Bridge] WS:9224: Dropping result for figma_get_selection (id=5) — socket closed",
		);
	});

	it("dropped error: socket closed and handler rejected → logs the error drop, sends nothing", async () => {
		const ws = makeWs(3); // CLOSED
		const warn = jest.fn();
		const { done } = dispatch(
			async () => {
				throw new Error("kaboom");
			},
			{ id: 6, method: "figma_execute" },
			ws,
			9224,
			warn,
		);
		await done;

		expect(ws.sent).toHaveLength(0);
		expect(warn).toHaveBeenCalledWith(
			"[MCP Bridge] WS:9224: Dropping error for figma_execute (id=6) — socket closed: kaboom",
		);
	});

	// Source guard: fail loudly if ui.html's real dispatch drifts from the shape
	// exercised above (mirrors the #68 connector source guard).
	it("source guard: ui.html dispatch retains timeout, timer cleanup, and drop logging", async () => {
		const fs = await import("fs");
		const path = await import("path");
		const ui = fs.readFileSync(
			path.resolve(__dirname, "..", "figma-desktop-bridge", "ui.html"),
			"utf8",
		);

		expect(ui).toContain("var HANDLER_TIMEOUT_MS = 30000;");
		expect(ui).toContain("Promise.race([handlerPromise, timeoutPromise])");
		// The timer must be captured and cleared on settle (the cleanup this test suite adds).
		expect(ui).toContain("handlerTimeoutId = setTimeout(");
		expect(ui).toMatch(
			/if \(handlerTimeoutId !== null\) clearTimeout\(handlerTimeoutId\);/,
		);
		// Both drop-logging branches must survive.
		expect(ui).toContain("Dropping result for");
		expect(ui).toContain("Dropping error for");
		// clearTimeout must appear in BOTH the .then and .catch branches.
		const clears = ui.match(
			/if \(handlerTimeoutId !== null\) clearTimeout\(handlerTimeoutId\);/g,
		);
		expect(clears).not.toBeNull();
		expect(clears!.length).toBeGreaterThanOrEqual(2);
	});
});
