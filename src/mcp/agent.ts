import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import type { Content } from '@google/genai';
import { mcpToTool } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfig, requireGeminiApiKey } from '../config.js';
import { ReportedChatError, runChat } from '../agent/chat.js';
import { createGeminiClient, generateContentWithRetry } from '../agent/gemini.js';
import { recordModelTurn, textFromContent } from '../agent/messages.js';
import { SYSTEM_PROMPT } from '../agent/prompt.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function mcpServerLaunch(): { command: string; args: string[] } {
  const fromEnv = process.env.MCP_SERVER_PATH?.trim();
  if (fromEnv) {
    return { command: process.execPath, args: [path.resolve(fromEnv)] };
  }

  const runningFromDist = here.includes(`${path.sep}dist${path.sep}`);
  if (runningFromDist) {
    return { command: process.execPath, args: [path.resolve(here, 'server.js')] };
  }

  return {
    command: process.execPath,
    args: ['--import', 'tsx', path.resolve(here, 'server.ts')],
  };
}

export function childEnv(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

async function main(): Promise<void> {
  dotenv.config();
  const config = loadConfig();
  const apiKey = requireGeminiApiKey(config);
  const launch = mcpServerLaunch();
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    cwd: process.cwd(),
    env: childEnv(),
    stderr: 'inherit',
  });
  const client = new Client({ name: 'secretaria-client', version: '1.0.0' });
  await client.connect(transport);

  const ai = createGeminiClient(apiKey);
  const contents: Content[] = [];
  console.log('Ferramentas carregadas do servidor MCP local.');

  try {
    await runChat({
      contents,
      respond: async () => {
        const response = await generateContentWithRetry(ai, {
          model: config.model,
          ...(config.fallbackModel ? { fallbackModel: config.fallbackModel } : {}),
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            tools: [mcpToTool(client)],
            automaticFunctionCalling: { maximumRemoteCalls: config.maxToolSteps },
          },
        });
        recordModelTurn(contents, {
          history: response.automaticFunctionCallingHistory,
          modelContent: response.candidates?.[0]?.content,
        });
        if (response.functionCalls && response.functionCalls.length > 0) {
          return 'Parei porque o limite de chamadas de ferramenta foi atingido. Tente um pedido menor.';
        }
        return textFromContent(response.candidates?.[0]?.content) || 'Não consegui formular uma resposta.';
      },
    });
  } finally {
    await client.close();
  }
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch((error: unknown) => {
    if (!(error instanceof ReportedChatError)) {
      console.error(error instanceof Error ? error.message : error);
    }
    process.exit(1);
  });
}
