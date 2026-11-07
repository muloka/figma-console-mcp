/**
 * Request guard for the local Streamable HTTP endpoint (MCP_HTTP_PORT).
 *
 * Binding 127.0.0.1 keeps other machines out, but not web pages: through DNS
 * rebinding a page's own hostname resolves to 127.0.0.1, so the browser sends
 * a same-origin request that carries the page's hostname in Host. The MCP
 * spec requires servers to validate Origin for this reason. Every request
 * must therefore name a loopback Host on this port, and any browser Origin
 * must be loopback too.
 *
 * The rules match upstream's rejectReason() (src/core/http-transport.ts,
 * v1.44.0, southleft#48) minus its optional bearer token.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createChildLogger } from "./logger.js";

const logger = createChildLogger({ component: "http-request-guard" });

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Hostname of a Host header value or URL host, lowercased, IPv6 kept in brackets. */
function hostnameOf(hostPort: string): string {
	const h = hostPort.trim().toLowerCase();
	if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
	return h.split(":")[0];
}

/** Why a request is refused, or null to let it through. */
function refusalFor(headers: IncomingMessage["headers"], port: number): string | null {
	const host = headers.host;
	if (!host || !LOOPBACK_HOSTNAMES.has(hostnameOf(host)) || !host.endsWith(`:${port}`)) {
		return `Host "${host ?? ""}" is not allowed; connect to http://localhost:${port}/mcp`;
	}
	// Non-browser MCP clients send no Origin.
	// Browsers always do; allow loopback pages and refuse the rest, including
	// "null", which does not parse as a URL.
	const origin = headers.origin;
	if (origin !== undefined) {
		let originHost = "";
		try {
			originHost = hostnameOf(new URL(origin).host);
		} catch {
			// Unparseable: refused below.
		}
		if (!LOOPBACK_HOSTNAMES.has(originHost)) {
			return `Origin "${origin}" is not allowed`;
		}
	}
	return null;
}

/**
 * Answer 403 and return false when the request must not reach MCP; otherwise
 * return true and leave the response untouched.
 */
export function guardLocalHttpRequest(req: IncomingMessage, res: ServerResponse, port: number): boolean {
	const refusal = refusalFor(req.headers, port);
	if (refusal === null) return true;
	logger.warn({ host: req.headers.host, origin: req.headers.origin, path: req.url }, "HTTP request refused");
	res.writeHead(403, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: refusal }, id: null }));
	return false;
}
