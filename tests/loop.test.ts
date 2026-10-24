import assert from 'node:assert/strict';
import test from 'node:test';
import type { Content } from '@google/genai';
import { z } from 'zod';
import { recordModelTurn } from '../src/agent/messages.js';
import { runReactLoop } from '../src/agent/loop.js';
import type { ModelClient } from '../src/agent/messages.js';
import { ToolRegistry, defineTool } from '../src/tools/registry.js';

interface ScriptStep {
  text?: string;
  calls?: Array<{ name: string; args: Record<string, unknown>; id?: string }>;
}

function scriptedModel(steps: Array<(contents: Content[]) => ScriptStep>): ModelClient & { calls: number } {
  let index = 0;
  const model: ModelClient & { calls: number } = {
    calls: 0,
    async generate({ contents }) {
      const step = steps[index];
      index += 1;
      model.calls += 1;
      if (!step) throw new Error('O modelo foi chamado alem do roteiro.');
      const planned = step(contents);
      const calls = planned.calls ?? [];
      const content: Content = {
        role: 'model',
        parts:
          calls.length > 0
            ? calls.map((call) => ({
                functionCall: {
                  name: call.name,
                  args: call.args,
                  ...(call.id ? { id: call.id } : {}),
                },
              }))
            : [{ text: planned.text ?? '' }],
      };
      return { content };
    },
  };
  return model;
}

test('responde em texto quando o modelo nao pede ferramenta', async () => {
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'Oi' }] }];
  const model = scriptedModel([() => ({ text: 'Ola. Como posso ajudar?' })]);
  const tools = new ToolRegistry([]);

  const result = await runReactLoop({ contents, model, tools });

  assert.equal(result.text, 'Ola. Como posso ajudar?');
  assert.equal(result.limitReached, false);
  assert.equal(result.calls.length, 0);
  assert.equal(model.calls, 1);
  assert.equal(contents.length, 2);
  assert.equal(contents[1]?.role, 'model');
});

test('executa uma chamada e devolve o resultado para o modelo', async () => {
  const seen: Content[][] = [];
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'Que dia e hoje?' }] }];
  const model = scriptedModel([
    () => ({ calls: [{ name: 'getTodayDate', args: {}, id: 'call-1' }] }),
    (history) => {
      seen.push(history);
      return { text: 'Hoje e 1 de maio de 2026.' };
    },
  ]);
  const tools = new ToolRegistry([
    defineTool({
      name: 'getTodayDate',
      description: 'data de hoje',
      schema: z.object({}),
      handler: async () => ({ date: '2026-05-01' }),
    }),
  ]);

  const result = await runReactLoop({ contents, model, tools });

  assert.equal(result.text, 'Hoje e 1 de maio de 2026.');
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.name, 'getTodayDate');
  assert.equal(result.calls[0]?.ok, true);
  const functionResponse = seen[0]
    ?.flatMap((message) => message.parts ?? [])
    .find((part) => part.functionResponse);
  assert.equal(functionResponse?.functionResponse?.name, 'getTodayDate');
  assert.equal(functionResponse?.functionResponse?.id, 'call-1');
  assert.deepEqual(functionResponse?.functionResponse?.response, { result: { date: '2026-05-01' } });
});

test('encadeia chamadas: a segunda usa o resultado da primeira', async () => {
  const datesAsked: string[] = [];
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'Quais eventos eu tenho hoje?' }] }];
  const model = scriptedModel([
    () => ({ calls: [{ name: 'getTodayDate', args: {} }] }),
    (history) => {
      const payload = history
        .flatMap((message) => message.parts ?? [])
        .find((part) => part.functionResponse)?.functionResponse?.response as
        | { result?: { date?: string } }
        | undefined;
      const date = payload?.result?.date ?? '';
      return { calls: [{ name: 'listEvents', args: { date } }] };
    },
    () => ({ text: 'Voce tem um almoco as 12:30.' }),
  ]);
  const tools = new ToolRegistry([
    defineTool({
      name: 'getTodayDate',
      description: 'data',
      schema: z.object({}),
      handler: async () => ({ date: '2026-05-01' }),
    }),
    defineTool({
      name: 'listEvents',
      description: 'eventos',
      schema: z.object({ date: z.string() }),
      handler: async ({ date }) => {
        datesAsked.push(date);
        return { events: [{ title: 'Almoco' }] };
      },
    }),
  ]);

  const result = await runReactLoop({ contents, model, tools });

  assert.deepEqual(datesAsked, ['2026-05-01']);
  assert.deepEqual(
    result.calls.map((call) => call.name),
    ['getTodayDate', 'listEvents'],
  );
  assert.equal(result.text, 'Voce tem um almoco as 12:30.');
  assert.equal(result.steps, 3);
});

test('executa varias chamadas no mesmo turno', async () => {
  const sent: string[] = [];
  let responseParts = 0;
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'Avise os dois' }] }];
  const model = scriptedModel([
    () => ({
      calls: [
        { name: 'sendEmail', args: { to: 'ana@example.com' } },
        { name: 'sendEmail', args: { to: 'joao@example.com' } },
      ],
    }),
    (history) => {
      const last = history.at(-1);
      responseParts = last?.parts?.length ?? 0;
      return { text: 'Avisei os dois convidados.' };
    },
  ]);
  const tools = new ToolRegistry([
    defineTool({
      name: 'sendEmail',
      description: 'envia',
      schema: z.object({ to: z.string() }),
      handler: async ({ to }) => {
        sent.push(to);
        return { to };
      },
    }),
  ]);

  const result = await runReactLoop({ contents, model, tools });

  assert.deepEqual(sent, ['ana@example.com', 'joao@example.com']);
  assert.equal(responseParts, 2);
  assert.equal(result.text, 'Avisei os dois convidados.');
});

test('argumento invalido volta como erro e a ferramenta nao executa', async () => {
  let executed = false;
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'Liste amanha' }] }];
  const model = scriptedModel([
    () => ({ calls: [{ name: 'listEvents', args: { date: 'amanha' } }] }),
    (history) => {
      const response = history.at(-1)?.parts?.[0]?.functionResponse?.response as { error?: string } | undefined;
      assert.match(response?.error ?? '', /AAAA-MM-DD/);
      return { text: 'Preciso da data no formato certo.' };
    },
  ]);
  const tools = new ToolRegistry([
    defineTool({
      name: 'listEvents',
      description: 'eventos',
      schema: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use AAAA-MM-DD.'),
      }),
      handler: async () => {
        executed = true;
        return { events: [] };
      },
    }),
  ]);

  const result = await runReactLoop({ contents, model, tools });

  assert.equal(executed, false);
  assert.equal(result.calls[0]?.ok, false);
  assert.equal(result.text, 'Preciso da data no formato certo.');
});

test('ferramenta desconhecida vira erro para o modelo', async () => {
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'clima' }] }];
  const model = scriptedModel([
    () => ({ calls: [{ name: 'getWeather', args: {} }] }),
    () => ({ text: 'Nao tenho essa ferramenta.' }),
  ]);

  const result = await runReactLoop({ contents, model, tools: new ToolRegistry([]) });

  assert.equal(result.calls[0]?.ok, false);
  assert.match(result.calls[0]?.error ?? '', /desconhecida/);
  assert.equal(result.text, 'Nao tenho essa ferramenta.');
});

test('para ao atingir o limite de passos', async () => {
  let executions = 0;
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'loop' }] }];
  const model = scriptedModel([
    () => ({ calls: [{ name: 'ping', args: {} }] }),
    () => ({ calls: [{ name: 'ping', args: {} }] }),
    () => ({ text: 'nao deveria chegar aqui' }),
  ]);
  const tools = new ToolRegistry([
    defineTool({
      name: 'ping',
      description: 'ping',
      schema: z.object({}),
      handler: async () => {
        executions += 1;
        return { ok: true };
      },
    }),
  ]);

  const result = await runReactLoop({ contents, model, tools, maxSteps: 2 });

  assert.equal(executions, 2);
  assert.equal(result.limitReached, true);
  assert.match(result.text, /limite/);
  assert.equal(model.calls, 2);
});

test('grava o historico do MCP com as chamadas e a resposta final', () => {
  const contents: Content[] = [{ role: 'user', parts: [{ text: 'oi' }] }];
  const history: Content[] = [
    { role: 'user', parts: [{ text: 'oi' }] },
    { role: 'model', parts: [{ functionCall: { name: 'getTodayDate', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'getTodayDate', response: { result: { date: '2026-05-01' } } } }] },
  ];
  recordModelTurn(contents, {
    history,
    modelContent: { role: 'model', parts: [{ text: 'Hoje e 1 de maio.' }] },
  });

  assert.equal(contents.length, 4);
  assert.equal(contents[3]?.parts?.[0]?.text, 'Hoje e 1 de maio.');
});
