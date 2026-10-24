import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { stderrLogger } from '../log.js';
import { createAuthProvider } from '../google/auth.js';
import { createRuntimeTools } from '../tools/build.js';

function asToolResult(payload: unknown) {
  const structured = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

async function main(): Promise<void> {
  dotenv.config();
  const config = loadConfig();
  const auth = createAuthProvider(config);
  const registry = createRuntimeTools({
    config,
    logger: stderrLogger,
    getClient: () => auth.getClient(),
  });

  const server = new McpServer({ name: 'secretaria', version: '0.1.0' });
  for (const tool of registry.list()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
      },
      async (args) => {
        const outcome = await registry.execute(tool.name, args);
        const payload = outcome.ok ? { result: outcome.data } : { error: outcome.error };
        return asToolResult(payload);
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP server funcionando');
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
