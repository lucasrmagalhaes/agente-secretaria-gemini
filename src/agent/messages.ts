import type { Content } from '@google/genai';

export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  error?: string;
}

export interface LoopResult {
  text: string;
  steps: number;
  calls: ToolTrace[];
  limitReached: boolean;
}

export interface ModelClient {
  generate(input: { contents: Content[]; systemInstruction?: string }): Promise<{ content: Content }>;
}

export interface LoopHooks {
  onToolCall?: (call: ToolCall) => void;
  onToolResult?: (event: { name: string; ok: boolean; error?: string }) => void;
}

export function textFromContent(content: Content | undefined): string {
  if (!content?.parts) return '';
  return content.parts
    .filter((part) => typeof part.text === 'string' && part.thought !== true)
    .map((part) => part.text ?? '')
    .join('');
}

export function extractFunctionCalls(content: Content): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const part of content.parts ?? []) {
    const call = part.functionCall;
    if (!call?.name) continue;
    calls.push({
      id: call.id,
      name: call.name,
      args: call.args ?? {},
    });
  }
  return calls;
}

/**
 * Keeps the chat history after one model turn.
 * The automatic function-calling history already contains the user message,
 * the tool requests and the tool results. The final model message is appended after that.
 */
export function recordModelTurn(
  contents: Content[],
  turn: { history?: Content[] | undefined; modelContent?: Content | undefined },
): void {
  if (turn.history && turn.history.length > 0) {
    contents.splice(0, contents.length, ...turn.history);
  }
  if (turn.modelContent) {
    contents.push(turn.modelContent);
  }
}
