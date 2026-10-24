import { writeSync } from 'node:fs';

export function writeFailure(message: string): void {
  const text = message.endsWith('\n') ? message : `${message}\n`;
  try {
    writeSync(2, text);
  } catch {
    console.error(message);
  }
}

/** Exits even if a socket or a child close hangs after the error was printed. */
export function armForcedExit(code: number, delayMs = 8_000): void {
  const timer = setTimeout(() => {
    process.exit(code);
  }, delayMs);
  timer.unref();
}
