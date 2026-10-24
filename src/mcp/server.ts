import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { stderrLogger } from '../log.js';
import { createAuthProvider } from '../google/auth.js';
import { createRuntimeTools } from '../tools/build.js';
import { createMcpServer } from './register.js';

async function main(): Promise<void> {
  const pidFile = process.env.MCP_PID_FILE?.trim();
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid));
  dotenv.config();
  const config = loadConfig();
  const auth = createAuthProvider(config);
  const registry = createRuntimeTools({
    config,
    logger: stderrLogger,
    getClient: () => auth.getClient(),
  });

  const server = createMcpServer(registry);
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
