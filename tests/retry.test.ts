import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { geminiCallConfig, geminiHttpTimeoutMs } from '../src/agent/gemini.js';
import { callWithRetry, isDailyQuotaError, modelSequence, retryableStatus } from '../src/agent/retry.js';

test('o modelo padrao e gemini-3.8-flash e o reserva e opcional', () => {
  assert.equal(loadConfig({}).model, 'gemini-3.8-flash');
  assert.equal(loadConfig({}).fallbackModel, undefined);
  assert.equal(loadConfig({ GEMINI_FALLBACK_MODEL: 'gemini-flash-reserva' }).fallbackModel, 'gemini-flash-reserva');
  assert.deepEqual(modelSequence('gemini-3.8-flash', 'gemini-3.8-flash'), ['gemini-3.8-flash']);
  assert.deepEqual(modelSequence('gemini-3.8-flash', 'outro'), ['gemini-3.8-flash', 'outro']);
});

test('503 e 429 entram na retentativa e 404 nao', () => {
  assert.equal(retryableStatus(Object.assign(new Error('ocupado'), { status: 503 })), 503);
  assert.equal(retryableStatus(Object.assign(new Error('limite'), { status: 429 })), 429);
  assert.equal(retryableStatus(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}')), 503);
  assert.equal(retryableStatus(Object.assign(new Error('no longer available'), { status: 404 })), undefined);
});

test('repete 503 com espera exponencial e segue para o modelo reserva', async () => {
  const delays: number[] = [];
  const used: string[] = [];
  const notices: string[] = [];

  const result = await callWithRetry({
    models: ['gemini-3.8-flash', 'gemini-flash-reserva'],
    attempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    sleep: async (ms) => {
      delays.push(ms);
    },
    onRetry: (notice) => {
      notices.push(notice.nextModel ? `fallback:${notice.nextModel}` : `${notice.model}:${notice.delayMs}`);
    },
    run: async (model) => {
      used.push(model);
      if (model === 'gemini-3.8-flash') {
        throw Object.assign(new Error('high demand'), { status: 503 });
      }
      return 'ok';
    },
  });

  assert.equal(result, 'ok');
  assert.deepEqual(delays, [1000, 2000]);
  assert.deepEqual(used, ['gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-3.8-flash', 'gemini-flash-reserva']);
  assert.deepEqual(notices, ['gemini-3.8-flash:1000', 'gemini-3.8-flash:2000', 'fallback:gemini-flash-reserva']);
});

test('429 bem sucedido na segunda tentativa nao troca de modelo', async () => {
  let calls = 0;
  const result = await callWithRetry({
    models: ['gemini-3.8-flash', 'reserva'],
    attempts: 4,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    sleep: async () => {},
    run: async (model) => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('rate limit'), { code: 429 });
      return model;
    },
  });

  assert.equal(result, 'gemini-3.8-flash');
  assert.equal(calls, 2);
});

test('cota diaria 429 nao repete e explica em portugues', async () => {
  let calls = 0;
  const quota = Object.assign(
    new Error(
      JSON.stringify({
        error: {
          code: 429,
          message: 'You exceeded your current quota, please check your plan and billing details.',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
    ),
    { status: 429 },
  );
  assert.equal(isDailyQuotaError(quota), true);
  assert.equal(retryableStatus(quota), undefined);

  await assert.rejects(
    () =>
      callWithRetry({
        models: ['gemini-3.8-flash', 'reserva'],
        attempts: 4,
        sleep: async () => {
          throw new Error('nao deveria esperar');
        },
        run: async () => {
          calls += 1;
          throw quota;
        },
      }),
    /cota diária do Gemini acabou/,
  );
  assert.equal(calls, 1);
});

test('503 esgotado vira erro final sem nova espera', async () => {
  const delays: number[] = [];
  let calls = 0;
  await assert.rejects(
    () =>
      callWithRetry({
        models: ['gemini-3.8-flash'],
        attempts: 4,
        baseDelayMs: 1000,
        maxDelayMs: 8000,
        sleep: async (ms) => {
          delays.push(ms);
        },
        run: async () => {
          calls += 1;
          throw Object.assign(new Error('{"error":{"code":503,"status":"UNAVAILABLE","message":"high demand"}}'), {
            status: 503,
          });
        },
      }),
    /indisponível \(503\) depois de esgotar as tentativas/,
  );
  assert.equal(calls, 4);
  assert.deepEqual(delays, [1000, 2000, 4000]);
});

test('tempo esgotado nao entra na retentativa', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      callWithRetry({
        models: ['gemini-3.8-flash', 'reserva'],
        attempts: 4,
        sleep: async () => {
          throw new Error('nao deveria esperar');
        },
        run: async () => {
          calls += 1;
          throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
        },
      }),
    /excedeu o tempo limite/,
  );
  assert.equal(calls, 1);
});

test('cada chamada ao Gemini tem limite de tempo e nao repete dentro do SDK', () => {
  assert.equal(geminiHttpTimeoutMs({}), 60_000);
  assert.equal(geminiHttpTimeoutMs({ GEMINI_HTTP_TIMEOUT_MS: '1500' }), 1500);
  const config = geminiCallConfig({ systemInstruction: 'oi' }, 1500);
  assert.equal(config.automaticContinuation, false);
  assert.equal(config.httpOptions?.timeout, 1500);
  assert.equal(config.httpOptions?.retryOptions?.attempts, 1);
  assert.equal(config.systemInstruction, 'oi');
});

test('404 nao repete e nao usa o modelo reserva', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      callWithRetry({
        models: ['gemini-2.5-flash', 'gemini-3.8-flash'],
        attempts: 4,
        sleep: async () => {
          throw new Error('nao deveria esperar');
        },
        run: async () => {
          calls += 1;
          throw Object.assign(new Error('no longer available to new users'), { status: 404 });
        },
      }),
    /no longer available/,
  );
  assert.equal(calls, 1);
});
