import readline from 'node:readline/promises';
import { Readable, Writable } from 'node:stream';
import { stdin, stdout, stderr } from 'node:process';
import type { Content } from '@google/genai';

export interface RunChatOptions {
  contents: Content[];
  respond: () => Promise<string>;
  input?: Readable;
  output?: Writable;
  errorOutput?: Writable;
}

export async function runChat(options: RunChatOptions): Promise<void> {
  const input = options.input ?? stdin;
  const output = options.output ?? stdout;
  const errorOutput = options.errorOutput ?? stderr;
  if (isInteractive(input)) {
    await runInteractive(options, input, output, errorOutput);
    return;
  }
  await runPiped(options, input, output, errorOutput);
}

export class ReportedChatError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'ReportedChatError';
  }
}

export function messagesFromStdin(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function runPiped(
  options: RunChatOptions,
  input: Readable,
  output: Writable,
  errorOutput: Writable,
): Promise<void> {
  const text = await readAll(input);

  for (const query of messagesFromStdin(text)) {
    if (isExitCommand(query)) return;
    writeLine(output, `Você: ${query}`);
    try {
      writeLine(output, `Secretaria: ${await ask(options, query)}`);
    } catch (error) {
      const message = errorText(error);
      writeLine(errorOutput, message);
      throw new ReportedChatError(message, error);
    }
  }
}

async function runInteractive(
  options: RunChatOptions,
  input: Readable,
  output: Writable,
  errorOutput: Writable,
): Promise<void> {
  const rl = readline.createInterface({ input, output, terminal: true });
  writeLine(output, 'Secretaria virtual. Digite uma mensagem. Para encerrar, escreva sair ou use Ctrl+C.');

  try {
    while (true) {
      let query = '';
      try {
        query = (await rl.question('Você: ')).trim();
      } catch (error) {
        const message = errorText(error);
        if (!isClosedInput(message)) writeLine(errorOutput, message);
        break;
      }
      if (!query) continue;
      if (isExitCommand(query)) break;

      try {
        writeLine(output, `Secretaria: ${await ask(options, query)}`);
      } catch (error) {
        writeLine(errorOutput, errorText(error));
      }
    }
  } finally {
    rl.close();
  }
}

async function ask(options: RunChatOptions, query: string): Promise<string> {
  const before = options.contents.length;
  options.contents.push({ role: 'user', parts: [{ text: query }] });
  try {
    return await options.respond();
  } catch (error) {
    if (options.contents.length === before + 1) options.contents.pop();
    throw error;
  }
}

async function readAll(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function isInteractive(input: Readable): boolean {
  return Boolean((input as Readable & { isTTY?: boolean }).isTTY);
}

function isExitCommand(query: string): boolean {
  const normalized = query.toLowerCase();
  return normalized === 'sair' || normalized === 'exit';
}

function isClosedInput(message: string): boolean {
  return /closed|abort|cancel/i.test(message);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Falha ao consultar o modelo.';
}

function writeLine(stream: Writable, line: string): void {
  stream.write(`${line}\n`);
}
