import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from '../config.js';
import { stderrLogger } from '../log.js';
import { createAuthProvider } from '../google/auth.js';
import { createRuntimeTools } from '../tools/build.js';
import { loadMcpHttpConfig } from './http-config.js';
import { startMcpHttpServer } from './http-server.js';
import { createMcpServer } from './register.js';

async function main(): Promise<void> {
  dotenv.config();
  const config = loadConfig();
  const httpConfig = loadMcpHttpConfig();
  const auth = createAuthProvider(config);
  const registry = createRuntimeTools({
    config,
    logger: stderrLogger,
    getClient: () => auth.getClient(),
  });

  const started = await startMcpHttpServer({
    ...httpConfig,
    createServer: () => createMcpServer(registry),
  });

  const where = `${httpConfig.host}:${started.port}${httpConfig.path}`;
  console.error(`MCP HTTP ouvindo em ${where}`);
  if (httpConfig.authToken) {
    console.error('Autenticação Bearer ativa.');
  } else {
    console.error('Sem MCP_AUTH_TOKEN. Aceitando conexões locais sem Bearer.');
  }

  const shutdown = () => {
    void started.close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
