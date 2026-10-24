import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { Content } from '@google/genai';

export async function runChat(options: {
  contents: Content[];
  respond: () => Promise<string>;
}): Promise<void> {
  const rl = readline.createInterface({ input, output });
  console.log('Secretaria virtual. Digite uma mensagem. Para encerrar, escreva sair ou use Ctrl+C.');

  try {
    while (true) {
      let query = '';
      try {
        query = (await rl.question('Você: ')).trim();
      } catch {
        break;
      }
      if (!query) continue;
      if (query.toLowerCase() === 'sair' || query.toLowerCase() === 'exit') break;

      const before = options.contents.length;
      options.contents.push({ role: 'user', parts: [{ text: query }] });
      try {
        const text = await options.respond();
        console.log(`Secretaria: ${text}`);
      } catch (error) {
        if (options.contents.length === before + 1) {
          options.contents.pop();
        }
        const message = error instanceof Error ? error.message : 'Falha ao consultar o modelo.';
        console.error(message);
      }
    }
  } finally {
    rl.close();
  }
}
