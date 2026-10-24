import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig } from './config.js';
import { runDesktopAuthFlow } from './google/auth.js';

async function main(): Promise<void> {
  dotenv.config();
  const config = loadConfig();
  if (config.emailMode === 'gmail') {
    console.log('EMAIL_MODE=gmail: o token vai incluir leitura e envio do Gmail, além do Calendar.');
  } else {
    console.log('EMAIL_MODE=dry-run: o token inclui apenas o Google Calendar.');
  }
  await runDesktopAuthFlow(config);
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
