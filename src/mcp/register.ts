import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolRegistry } from '../tools/registry.js';

function asToolResult(payload: unknown) {
  const structured = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

export function createMcpServer(registry: ToolRegistry): McpServer {
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
  return server;
}
