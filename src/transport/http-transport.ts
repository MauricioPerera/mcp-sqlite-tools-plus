/**
 * Optional HTTP transport for the SQLite Tools MCP server.
 *
 * Adds a bearer-token-authenticated HTTP transport alongside the default
 * stdio transport. stdio remains the default; HTTP is only enabled when
 * MCP_TRANSPORT=http.
 */
import { HttpTransport } from '@tmcp/transport-http';
import { createRequestListener } from '@remix-run/node-fetch-server';
import * as http from 'node:http';

import type { McpServer } from 'tmcp';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_PATH = '/mcp';
const BEARER_PREFIX = 'Bearer ';

export interface HttpConfig {
	host: string;
	port: number;
	path: string;
	token: string;
}

/**
 * Parse a port string into a positive integer, falling back to the default
 * port when the value is missing or invalid.
 */
function parse_port(raw: string): number {
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/**
 * Authorize a request against the expected bearer token. Pure: no network.
 * Returns true only for an `Authorization: Bearer <token>` header whose token
 * matches exactly; missing, empty, or other schemes return false.
 */
export function authorize_request(
	request: Request,
	token: string,
): boolean {
	const header = request.headers.get('authorization');
	if (!header || !header.startsWith(BEARER_PREFIX)) {
		return false;
	}
	const provided = header.slice(BEARER_PREFIX.length).trim();
	return provided !== '' && provided === token;
}

/**
 * Read HTTP transport config from an env object. Pure: receives env as a
 * parameter (does not read process.env) so it is unit-testable.
 */
export function read_http_config(env: NodeJS.ProcessEnv): HttpConfig {
	const host = env.MCP_HTTP_HOST?.trim() || DEFAULT_HOST;
	const port_raw = env.MCP_HTTP_PORT?.trim();
	const port = port_raw ? parse_port(port_raw) : DEFAULT_PORT;
	const path = env.MCP_HTTP_PATH?.trim() || DEFAULT_PATH;
	const token = env.MCP_AUTH_TOKEN?.trim() ?? '';
	return { host, port, path, token };
}

/**
 * Build the authenticated fetch handler used by the HTTP transport.
 */
function build_handler(
	transport: HttpTransport,
	token: string,
): (request: Request) => Promise<Response> {
	return async (request: Request): Promise<Response> => {
		if (!authorize_request(request, token)) {
			return new Response('Unauthorized', { status: 401 });
		}
		const response = await transport.respond(request);
		if (response === null) {
			return new Response('Not Found', { status: 404 });
		}
		return response;
	};
}

/**
 * Start the HTTP transport: creates the HttpTransport, wraps the bearer-token
 * auth + delegation handler in a node http request listener, listens on the
 * configured host/port, and logs to stderr. Returns the http.Server.
 */
export function start_http_transport(
	server: McpServer<any>,
	config: HttpConfig,
): http.Server {
	const transport = new HttpTransport(server, { path: config.path });
	const handler = build_handler(transport, config.token);
	const http_server = http.createServer(createRequestListener(handler));
	http_server.listen(config.port, config.host);
	console.error(
		`MCP HTTP server listening on http://${config.host}:${config.port} path ${config.path}`,
	);
	return http_server;
}