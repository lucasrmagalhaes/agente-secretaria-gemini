import { GoogleGenAI, type Content, type FunctionDeclaration } from '@google/genai';
import type { ModelClient } from './messages.js';

export function createGeminiModel(options: {
  apiKey: string;
  model: string;
  tools: FunctionDeclaration[];
}): ModelClient {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    async generate({ contents, systemInstruction }) {
      const response = await ai.models.generateContent({
        model: options.model,
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

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}
