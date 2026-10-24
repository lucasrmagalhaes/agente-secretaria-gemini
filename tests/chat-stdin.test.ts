import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import test from 'node:test';
import type { Content } from '@google/genai';
import { messagesFromStdin, runChat } from '../src/agent/chat.js';

test('messagesFromStdin guarda a ultima linha mesmo sem quebra final', () => {
  assert.deepEqual(messagesFromStdin('pergunta\n'), ['pergunta']);
  assert.deepEqual(messagesFromStdin('pergunta'), ['pergunta']);
  assert.deepEqual(messagesFromStdin('uma\n\nduas\n'), ['uma', 'duas']);
});

test('stdin encerrado processa a mensagem, imprime a resposta e termina', { timeout: 3_000 }, async () => {
  const contents: Content[] = [];
  const output = collect();
  const errorOutput = collect();
  let calls = 0;

  await runChat({
    contents,
    input: Readable.from(['Que dia é hoje?\n']),
    output: output.stream,
    errorOutput: errorOutput.stream,
    respond: async () => {
      calls += 1;
      assert.equal(contents.at(-1)?.parts?.[0]?.text, 'Que dia é hoje?');
      return 'Hoje é sábado.';
    },
  });

  assert.equal(calls, 1);
  assert.match(output.text(), /Você: Que dia é hoje\?/);
  assert.match(output.text(), /Secretaria: Hoje é sábado\./);
  assert.equal(errorOutput.text(), '');
  assert.equal(contents.length, 1);
});

test('stdin sem quebra de linha ainda e respondido', { timeout: 3_000 }, async () => {
  const output = collect();
  await runChat({
    contents: [],
    input: Readable.from(['pergunta']),
    output: output.stream,
    errorOutput: collect().stream,
    respond: async () => 'resposta pronta',
  });
  assert.match(output.text(), /Secretaria: resposta pronta/);
});

test('erro no modo pipe e impresso e encerra em vez de esperar outro prompt', { timeout: 3_000 }, async () => {
  const output = collect();
  const errorOutput = collect();
  let calls = 0;

  await assert.rejects(
    () =>
      runChat({
        contents: [],
        input: Readable.from(['pergunta\noutra\n']),
        output: output.stream,
        errorOutput: errorOutput.stream,
        respond: async () => {
          calls += 1;
          throw Object.assign(new Error('503 UNAVAILABLE'), { status: 503 });
        },
      }),
    /503 UNAVAILABLE/,
  );

  assert.equal(calls, 1);
  assert.match(errorOutput.text(), /503 UNAVAILABLE/);
  assert.doesNotMatch(output.text(), /outra/);
});

test('duas linhas no pipe viram dois turnos e sair interrompe', { timeout: 3_000 }, async () => {
  const seen: string[] = [];
  const output = collect();
  await runChat({
    contents: [],
    input: Readable.from(['primeira\nsegunda\nsair\nterceira\n']),
    output: output.stream,
    errorOutput: collect().stream,
    respond: async () => {
      seen.push('turno');
      return `ok ${seen.length}`;
    },
  });
  assert.deepEqual(seen, ['turno', 'turno']);
  assert.match(output.text(), /Secretaria: ok 1/);
  assert.match(output.text(), /Secretaria: ok 2/);
  assert.doesNotMatch(output.text(), /terceira/);
});

function collect(): { stream: Writable; text: () => string } {
  let data = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      data += String(chunk);
      callback();
    },
  });
  return { stream, text: () => data };
}
