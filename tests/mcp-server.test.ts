import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { childEnv } from '../src/mcp/agent.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('servidor MCP expoe as ferramentas por stdio sem escrever lixo no protocolo', async () => {
  const env = childEnv(process.env);
  delete env.GOOGLE_CREDENTIALS_PATH;
  delete env.GOOGLE_TOKEN_PATH;
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  env.EMAIL_MODE = 'dry-run';
  env.CALENDAR_TIMEZONE = 'UTC';

  let stderr = '';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', path.join(root, 'src/mcp/server.ts')],
    cwd: root,
    env,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      'createEvent',
      'deleteEvent',
      'getTodayDate',
      'listEmails',
      'listEvents',
      'sendEmail',
      'updateEvent',
    ]);

    const today = await client.callTool({ name: 'getTodayDate', arguments: {} });
    const todayText = textOf(today);
    assert.match(todayText, /"date":"\d{4}-\d{2}-\d{2}"/);

    const sent = await client.callTool({
      name: 'sendEmail',
      arguments: { to: 'ana@example.com', subject: 'Oi', message: 'Teste' },
    });
    assert.match(textOf(sent), /dry-run/);
    assert.match(textOf(sent), /não enviado/);

    const invalid = await client.callTool({
      name: 'createEvent',
      arguments: { title: 'X', date: 'amanha', time: '10:00' },
    });
    assert.match(textOf(invalid), /AAAA-MM-DD/);

    assert.match(stderr, /MCP server funcionando/);
  } finally {
    await client.close();
  }
});

function textOf(result: { content?: unknown }): string {
  const content = Array.isArray(result.content) ? result.content : [];
  return content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
    .join('');
}
