import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('pipe encerra na hora quando a cota diaria acaba', async () => {
  const mock = await listen((res) => {
    json(res, 429, {
      error: {
        code: 429,
        message: 'You exceeded your current quota, please check your plan and billing details.',
        status: 'RESOURCE_EXHAUSTED',
      },
    });
  });
  try {
    const result = await runCli('src/index.ts', mock.port, 'que dia e hoje?\n');
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cota diária do Gemini acabou/);
    assert.equal(mock.hits(), 1);
  } finally {
    await mock.close();
  }
});

test('pipe encerra depois das tentativas de 503', async () => {
  const mock = await listen((res) => {
    json(res, 503, {
      error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' },
    });
  });
  try {
    const result = await runCli('src/index.ts', mock.port, 'oi\n', 20_000);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /indisponível \(503\) depois de esgotar as tentativas/);
    assert.equal(mock.hits(), 4);
  } finally {
    await mock.close();
  }
});

test('pipe cancela uma chamada que nao responde e encerra', async () => {
  const mock = await listen(() => {
    // Leave the socket open so the client has to abort on its own.
  });
  try {
    const result = await runCli('src/index.ts', mock.port, 'oi\n', 8_000, { GEMINI_HTTP_TIMEOUT_MS: '500' });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /excedeu o tempo limite/);
    assert.equal(mock.hits(), 1);
  } finally {
    await mock.close();
  }
});

test('dev:mcp imprime a cota, sai com erro e fecha o filho', async () => {
  const mock = await listen((res) => {
    json(res, 429, {
      error: {
        code: 429,
        message: 'You exceeded your current quota.',
        status: 'RESOURCE_EXHAUSTED',
      },
    });
  });
  const pidFile = path.join(os.tmpdir(), `secretaria-mcp-${process.pid}-${Date.now()}.pid`);
  try {
    const result = await runCli('src/mcp/agent.ts', mock.port, 'oi\n', 15_000, { MCP_PID_FILE: pidFile });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cota diária do Gemini acabou/);
    assert.equal(mock.hits(), 1);
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    await waitUntil(() => !alive(pid), 3_000);
    assert.equal(alive(pid), false);
  } finally {
    await mock.close();
    fs.rmSync(pidFile, { force: true });
  }
});

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function listen(onRequest: (res: http.ServerResponse) => void): Promise<{ port: number; hits: () => number; close: () => Promise<void> }> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    req.resume();
    onRequest(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        hits: () => hits,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

function runCli(
  script: string,
  port: number,
  stdin: string,
  timeoutMs = 10_000,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const env = { ...process.env, ...extraEnv };
  delete env.GOOGLE_API_KEY;
  env.GEMINI_API_KEY = 'test-key';
  env.GOOGLE_GEMINI_BASE_URL = `http://127.0.0.1:${port}/`;
  env.EMAIL_MODE = 'dry-run';
  delete env.GOOGLE_CREDENTIALS_PATH;
  delete env.GOOGLE_TOKEN_PATH;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, script)], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`o processo nao encerrou\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
