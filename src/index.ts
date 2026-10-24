import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { loadConfig, requireGeminiApiKey } from './config.js';
import { stdoutLogger } from './log.js';
import { createAuthProvider } from './google/auth.js';
import { createRuntimeTools } from './tools/build.js';
import { createGeminiModel } from './agent/gemini.js';
import { runReactLoop } from './agent/loop.js';
import { SYSTEM_PROMPT } from './agent/prompt.js';
import { ReportedChatError, runChat } from './agent/chat.js';
import type { Content } from '@google/genai';
import fs from 'node:fs';

async function main(): Promise<void> {
  dotenv.config();
  const config = loadConfig();
  const rawEmailMode = process.env.EMAIL_MODE?.trim().toLowerCase();
  if (rawEmailMode && rawEmailMode !== 'dry-run' && rawEmailMode !== 'gmail') {
    console.error(`EMAIL_MODE "${rawEmailMode}" não é reconhecido. Usando dry-run.`);
  }
  warnIfCalendarMissing(config.credentialsPath, config.tokenPath);
  if (config.emailMode === 'dry-run') {
    console.log('E-mail em dry-run: as mensagens são impressas e não são enviadas.');
  }

  const apiKey = requireGeminiApiKey(config);
  const auth = createAuthProvider(config);
  const tools = createRuntimeTools({
    config,
    logger: stdoutLogger,
    getClient: () => auth.getClient(),
  });
  const model = createGeminiModel({
    apiKey,
    model: config.model,
    ...(config.fallbackModel ? { fallbackModel: config.fallbackModel } : {}),
    tools: tools.declarations(),
  });
  const contents: Content[] = [];

  await runChat({
    contents,
    respond: async () => {
      const result = await runReactLoop({
        contents,
        model,
        tools,
        systemInstruction: SYSTEM_PROMPT,
        maxSteps: config.maxToolSteps,
        onToolCall: (call) => console.log(`Chamando a função ${call.name}`),
        onToolResult: (event) => {
          if (!event.ok) console.error(`A função ${event.name} falhou: ${event.error}`);
        },
      });
      return result.text;
    },
  });
}

function reportFailure(error: unknown): void {
  if (!(error instanceof ReportedChatError)) {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}

function warnIfCalendarMissing(credentialsPath: string | undefined, tokenPath: string | undefined): void {
  if (!credentialsPath || !tokenPath) {
    console.error('Aviso: defina GOOGLE_CREDENTIALS_PATH e GOOGLE_TOKEN_PATH para usar o Google Calendar.');
    return;
  }
  if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
    console.error('Aviso: credencial ou token do Google não encontrado. Rode npm run auth. Veja o README.');
  }
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error: unknown) => {
    reportFailure(error);
  });
}
