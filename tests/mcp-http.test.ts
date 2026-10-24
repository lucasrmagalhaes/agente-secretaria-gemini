import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DryRunEmailGateway } from '../src/email/gateway.js';
import type { CalendarGateway } from '../src/google/calendar-gateway.js';
import { assertMcpHttpBind, loadMcpHttpConfig } from '../src/mcp/http-config.js';
import { startMcpHttpServer } from '../src/mcp/http-server.js';
import { createMcpServer } from '../src/mcp/register.js';
import { silentLogger } from '../src/log.js';
import { buildToolRegistry } from '../src/tools/build.js';

test('configuracao HTTP tem porta e caminho padrao e exige token fora do localhost', () => {
  const defaults = loadMcpHttpConfig({});
  assert.deepEqual(defaults, { host: '127.0.0.1', port: 3333, path: '/mcp' });
  assert.equal(loadMcpHttpConfig({ MCP_PATH: 'mcp', MCP_PORT: '4000' }).path, '/mcp');
  assert.equal(loadMcpHttpConfig({ MCP_PORT: '4000' }).port, 4000);
  assert.throws(() => loadMcpHttpConfig({ MCP_PORT: 'oitenta' }), /MCP_PORT/);
  assert.throws(() => assertMcpHttpBind({ host: '0.0.0.0' }), /MCP_AUTH_TOKEN/);
  assert.doesNotThrow(() => assertMcpHttpBind({ host: '0.0.0.0', authToken: 'segredo' }));
  assert.doesNotThrow(() => assertMcpHttpBind({ host: '::1' }));
});

test('HTTP Streamable lista ferramentas, exige bearer e recusa Host externo no localhost', async () => {
  const calls: string[] = [];
  const calendar: CalendarGateway = {
    async listEvents(input) {
      calls.push(`${input.startDate}:${input.endDate}`);
      return { events: [], truncated: false };
    },
    async createEvent() {
      throw new Error('rede');
    },
    async updateEvent() {
      throw new Error('rede');
    },
    async deleteEvent() {
      throw new Error('rede');
    },
  };
  const registry = buildToolRegistry({
    calendar,
    email: new DryRunEmailGateway(silentLogger),
    timeZone: 'UTC',
    now: () => new Date('2026-05-01T15:04:00.000Z'),
  });
  const started = await startMcpHttpServer({
    host: '127.0.0.1',
    port: 0,
    path: '/mcp',
    authToken: 'segredo',
    createServer: () => createMcpServer(registry),
  });

  try {
    const base = `http://127.0.0.1:${started.port}`;
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const missing = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(missing.status, 401);
    const wrong = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer outro' },
      body: '{}',
    });
    assert.equal(wrong.status, 401);

    const forbidden = await postWithHost(started.port, 'evil.example', 'segredo');
    assert.equal(forbidden, 403);

    const client = new Client({ name: 'test-http', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer segredo' } },
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      assert.ok(names.includes('listEvents'));
      const listTool = listed.tools.find((tool) => tool.name === 'listEvents');
      assert.match(listTool?.description ?? '', /única chamada/);

      const today = await client.callTool({ name: 'getTodayDate', arguments: {} });
      assert.match(textOf(today), /2026-05-01/);

      const ranged = await client.callTool({
        name: 'listEvents',
        arguments: { timeMin: '2026-05-01', timeMax: '2026-05-07' },
      });
      assert.match(textOf(ranged), /2026-05-07/);
      assert.deepEqual(calls, ['2026-05-01:2026-05-07']);
    } finally {
      await client.close();
    }
  } finally {
    await started.close();
  }
});

function textOf(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
    .join('');
}

function postWithHost(port: number, host: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/mcp',
        method: 'POST',
        headers: {
          host,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'content-length': '2',
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}
