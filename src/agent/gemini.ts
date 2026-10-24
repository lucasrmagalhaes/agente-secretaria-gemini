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
  return callWithRetry({
    models: modelSequence(options.model, options.fallbackModel),
    ...(options.sleep ? { sleep: options.sleep } : {}),
    onRetry: options.onRetry ?? logRetry,
    run: (model) =>
      ai.models.generateContent({
        model,
        contents: options.contents,
        config: options.config,
      }),
  });
}

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}
