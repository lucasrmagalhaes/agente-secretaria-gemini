import { createHash, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  assertMcpHttpBind,
  hostnameFromHostHeader,
  isLoopbackHost,
  type McpHttpConfig,
} from './http-config.js';

export interface McpHttpListenOptions extends McpHttpConfig {
  createServer: () => McpServer;
}

export interface McpHttpHandle {
  port: number;
  close: () => Promise<void>;
}

export async function startMcpHttpServer(options: McpHttpListenOptions): Promise<McpHttpHandle> {
  assertMcpHttpBind(options);
  const server = http.createServer((req, res) => {
    void handleMcpHttpRequest(req, res, options).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      if (!res.headersSent) {
        endJson(req, res, 500, {
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError);
      reject(error);
    };
    server.on('error', onError);
    server.listen(options.port, options.host, () => {
      server.off('error', onError);
      server.on('error', (error) => {
        console.error(error instanceof Error ? error.message : error);
      });
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: McpHttpListenOptions,
): Promise<void> {
  const pathname = pathnameOf(req.url);
  if (req.method === 'GET' && pathname === '/health') {
    endJson(req, res, 200, { ok: true });
    return;
  }

  if (pathname !== options.path) {
    endJson(req, res, 404, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Not found' },
      id: null,
    });
    return;
  }

  if (isLoopbackHost(options.host) && !isLoopbackHost(hostnameFromHostHeader(req.headers.host))) {
    endJson(req, res, 403, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Forbidden' },
      id: null,
    });
    return;
  }

  if (options.authToken && !bearerMatches(req.headers.authorization, options.authToken)) {
    endJson(
      req,
      res,
      401,
      {
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null,
      },
      { 'www-authenticate': 'Bearer' },
    );
    return;
  }

  if (req.method === 'GET' || req.method === 'DELETE') {
    endJson(req, res, 405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
    return;
  }

  if (req.method !== 'POST') {
    endJson(req, res, 405, {
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
    return;
  }

  const mcp = options.createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}

function pathnameOf(url: string | undefined): string {
  const raw = url ?? '/';
  const end = raw.search(/[?#]/);
  return end === -1 ? raw : raw.slice(0, end);
}

function bearerMatches(header: string | string[] | undefined, expected: string): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  const match = value ? /^Bearer\s+(\S+)\s*$/i.exec(value) : null;
  const provided = match?.[1];
  if (!provided) return false;
  const actualHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function endJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
  req.resume();
}
