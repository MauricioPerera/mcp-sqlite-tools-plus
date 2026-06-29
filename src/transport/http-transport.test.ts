import { describe, expect, it } from 'vitest';

import { authorize_request, read_http_config } from './http-transport.js';

describe('authorize_request', () => {
	const token = 'super-secret-token';

	it('returns false when the authorization header is missing', () => {
		const request = new Request('http://localhost/mcp', {
			method: 'POST',
		});
		expect(authorize_request(request, token)).toBe(false);
	});

	it('returns false for a non-bearer scheme', () => {
		const request = new Request('http://localhost/mcp', {
			method: 'POST',
			headers: { authorization: 'Basic abcdef' },
		});
		expect(authorize_request(request, token)).toBe(false);
	});

	it('returns false when the bearer token does not match', () => {
		const request = new Request('http://localhost/mcp', {
			method: 'POST',
			headers: { authorization: 'Bearer wrong' },
		});
		expect(authorize_request(request, token)).toBe(false);
	});

	it('returns true when the bearer token matches exactly', () => {
		const request = new Request('http://localhost/mcp', {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(authorize_request(request, token)).toBe(true);
	});
});

describe('read_http_config', () => {
	it('applies defaults for an empty env', () => {
		const config = read_http_config({});
		expect(config).toEqual({
			host: '127.0.0.1',
			port: 3000,
			path: '/mcp',
			token: '',
		});
	});

	it('respects provided values and parses port as a number', () => {
		const config = read_http_config({
			MCP_HTTP_HOST: '0.0.0.0',
			MCP_HTTP_PORT: '8080',
			MCP_HTTP_PATH: '/api',
			MCP_AUTH_TOKEN: 'tok',
		});
		expect(config).toEqual({
			host: '0.0.0.0',
			port: 8080,
			path: '/api',
			token: 'tok',
		});
		expect(typeof config.port).toBe('number');
	});
});