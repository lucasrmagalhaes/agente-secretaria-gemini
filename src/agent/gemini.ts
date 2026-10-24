import {
  GoogleGenAI,
  type Content,
  type ContentListUnion,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentResponse,
} from '@google/genai';
import type { ModelClient } from './messages.js';
import { callWithRetry, logRetry, modelSequence, type RetryNotice } from './retry.js';

const DEFAULT_HTTP_TIMEOUT_MS = 60_000;

export function geminiHttpTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GEMINI_HTTP_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_HTTP_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 600_000) return DEFAULT_HTTP_TIMEOUT_MS;
  return parsed;
}

export function geminiCallConfig(config: GenerateContentConfig | undefined, timeoutMs: number): GenerateContentConfig {
  return {
    ...config,
    automaticContinuation: config?.automaticContinuation ?? false,
    httpOptions: {
      ...config?.httpOptions,
      timeout: config?.httpOptions?.timeout ?? timeoutMs,
      retryOptions: config?.httpOptions?.retryOptions ?? { attempts: 1 },
    },
  };
}

export interface GeminiRetryOptions {
  model: string;
  fallbackModel?: string;
  onRetry?: (notice: RetryNotice) => void;
  sleep?: (ms: number) => Promise<void>;
}

export function createGeminiModel(
  options: GeminiRetryOptions & {
    apiKey: string;
    tools: FunctionDeclaration[];
  },
): ModelClient {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    async generate({ contents, systemInstruction }) {
      const response = await generateContentWithRetry(ai, {
        ...options,
        contents,
        config: {
          systemInstruction,
          tools: [{ functionDeclarations: options.tools }],
        },
      });
      const content: Content | undefined = response.candidates?.[0]?.content;
      if (!content) {
        throw new Error('A API do Gemini não retornou conteúdo.');
      }
      return { content };
    },
  };
}

export async function generateContentWithRetry(
  ai: GoogleGenAI,
  options: GeminiRetryOptions & {
    contents: ContentListUnion;
    config?: GenerateContentConfig;
  },
): Promise<GenerateContentResponse> {
  const config = geminiCallConfig(options.config, geminiHttpTimeoutMs());
  return callWithRetry({
    models: modelSequence(options.model, options.fallbackModel),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    onRetry: options.onRetry ?? logRetry,
    run: (model) =>
      ai.models.generateContent({
        model,
        contents: options.contents,
        config,
      }),
  });
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}
