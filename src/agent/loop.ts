import type { Content, Part } from '@google/genai';
import type { LoopHooks, LoopResult, ModelClient, ToolTrace } from './messages.js';
import { extractFunctionCalls, textFromContent } from './messages.js';
import type { ToolRegistry } from '../tools/registry.js';

export interface RunLoopOptions extends LoopHooks {
  contents: Content[];
  model: ModelClient;
  tools: ToolRegistry;
  systemInstruction?: string;
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 8;

/**
 * ReAct loop from the course: the model reasons, asks for a tool, we run it,
 * we send the observation back, and we repeat until the model answers in text.
 * Several calls in the same turn run together. A later turn can use those results.
 */
export async function runReactLoop(options: RunLoopOptions): Promise<LoopResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const calls: ToolTrace[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const response = await options.model.generate({
      contents: options.contents,
      systemInstruction: options.systemInstruction,
    });
    const content = response.content.role ? response.content : { ...response.content, role: 'model' };
    options.contents.push(content);

    const functionCalls = extractFunctionCalls(content);
    if (functionCalls.length === 0) {
      return {
        text: textFromContent(content),
        steps: step + 1,
        calls,
        limitReached: false,
      };
    }

    const responseParts: Part[] = [];
    for (const call of functionCalls) {
      options.onToolCall?.(call);
      const outcome = await options.tools.execute(call.name, call.args);
      const trace: ToolTrace = {
        name: call.name,
        args: call.args,
        ok: outcome.ok,
        ...(outcome.ok ? {} : { error: outcome.error }),
      };
      calls.push(trace);
      options.onToolResult?.({
        name: call.name,
        ok: outcome.ok,
        ...(outcome.ok ? {} : { error: outcome.error }),
      });
      responseParts.push({
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name: call.name,
          response: outcome.ok ? { result: outcome.data } : { error: outcome.error },
        },
      });
    }

    options.contents.push({ role: 'user', parts: responseParts });
  }

  return {
    text: 'Parei porque o limite de chamadas de ferramenta foi atingido. Tente um pedido menor.',
    steps: maxSteps,
    calls,
    limitReached: true,
  };
}
