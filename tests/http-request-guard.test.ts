/**
 * The local Streamable HTTP endpoint (MCP_HTTP_PORT) binds 127.0.0.1, but a
 * web page can still reach it through DNS rebinding: the browser resolves the
 * page's own hostname to 127.0.0.1 and the request arrives same-origin, with
 * the attacker's hostname in Host. The MCP spec requires servers to validate
 * Origin for exactly this reason.
 *
 * These tests drive a real node:http server through the guard with real
 * requests, and check whether the request reached the handler behind it.
 */

import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { guardLocalHttpRequest } from '../src/core/http-request-guard';

const PASSED = 'reached-handler';

let server: Server;
let port: number;

beforeAll(async () => {
  // Node's default server answers 400 to an HTTP/1.1 request without Host
  // before any handler runs. Turning that off makes the no-Host case
  // exercise the guard's own check rather than Node's.
  server = createServer({ requireHostHeader: false }, (req, res) => {
    if (!guardLocalHttpRequest(req, res, port)) return;
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(PASSED);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Send a GET with exactly these headers. `host: null` sends no Host header at all. */
function send(headers: { host: string | null; origin?: string }): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing: Record<string, string> = {};
    if (headers.host !== null) outgoing.host = headers.host;
    if (headers.origin !== undefined) outgoing.origin = headers.origin;
    const req = request(
      { host: '127.0.0.1', port, path: '/mcp', method: 'GET', headers: outgoing, setHost: false },
      (res) => {
        let body = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('guardLocalHttpRequest', () => {
  describe('lets loopback clients through', () => {
    it.each([
      // a non-browser MCP client connecting to http://localhost:{port}/mcp sends no Origin
      ['localhost', () => `localhost:${port}`],
      ['127.0.0.1', () => `127.0.0.1:${port}`],
      ['[::1]', () => `[::1]:${port}`],
      ['upper-case LOCALHOST', () => `LOCALHOST:${port}`],
    ])('Host %s with no Origin', async (_label, host) => {
      const res = await send({ host: host() });
      expect(res).toEqual({ status: 200, body: PASSED });
    });

    it('a browser page served from loopback (e.g. MCP Inspector)', async () => {
      const res = await send({ host: `localhost:${port}`, origin: 'http://localhost:6274' });
      expect(res).toEqual({ status: 200, body: PASSED });
    });
  });

  describe('refuses before the handler runs', () => {
    it.each([
      // DNS rebinding: the attacker's hostname now resolves to 127.0.0.1
      ['a non-loopback hostname', () => `attacker.example:${port}`],
      ['a hostname that only starts with localhost', () => `localhost.attacker.example:${port}`],
      ['a loopback hostname on another port', () => `localhost:${port + 1}`],
      ['a loopback hostname with no port', () => 'localhost'],
    ])('Host with %s', async (_label, host) => {
      const res = await send({ host: host() });
      expect(res.status).toBe(403);
      expect(res.body).not.toBe(PASSED);
    });

    it('a request with no Host header', async () => {
      const res = await send({ host: null });
      expect(res.status).toBe(403);
      expect(res.body).not.toBe(PASSED);
    });

    it.each([
      ['a non-loopback site', 'https://attacker.example'],
      ['a site whose name only starts with localhost', 'http://localhost.attacker.example'],
      // sandboxed iframes and file: pages send the literal string "null"
      ['an opaque "null" origin', 'null'],
    ])('a browser Origin from %s, even with a loopback Host', async (_label, origin) => {
      const res = await send({ host: `localhost:${port}`, origin });
      expect(res.status).toBe(403);
      expect(res.body).not.toBe(PASSED);
    });
  });
});
