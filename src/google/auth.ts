import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { google } from 'googleapis';
import type { Credentials } from 'google-auth-library';
import { scopesFor, type AppConfig, type EmailMode } from '../config.js';

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

interface InstalledClient {
  client_id: string;
  client_secret: string;
}

export async function createAuthorizedClient(config: AppConfig): Promise<OAuth2Client> {
  if (!config.credentialsPath || !config.tokenPath) {
    throw new Error(
      'Defina GOOGLE_CREDENTIALS_PATH e GOOGLE_TOKEN_PATH no .env. O passo a passo esta no README.',
    );
  }

  const installed = await readOAuthClient(config.credentialsPath);
  const tokenPath = config.tokenPath;
  const saved = await readToken(tokenPath);
  assertScopes(saved, config.emailMode);

  const client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
  client.setCredentials(saved);
  client.on('tokens', (tokens) => {
    const next: Credentials = { ...client.credentials, ...tokens };
    if (!next.refresh_token && saved.refresh_token) {
      next.refresh_token = saved.refresh_token;
    }
    void fs.writeFile(tokenPath, JSON.stringify(next, null, 2), { mode: 0o600 });
  });
  return client;
}

export function createAuthProvider(config: AppConfig): { getClient: () => Promise<OAuth2Client> } {
  let pending: Promise<OAuth2Client> | undefined;
  return {
    getClient() {
      pending ??= createAuthorizedClient(config).catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
      return pending;
    },
  };
}

export async function runDesktopAuthFlow(config: AppConfig): Promise<void> {
  if (!config.credentialsPath || !config.tokenPath) {
    throw new Error('Defina GOOGLE_CREDENTIALS_PATH e GOOGLE_TOKEN_PATH no .env antes de autenticar.');
  }

  const installed = await readOAuthClient(config.credentialsPath);
  const port = await freePort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const client = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirectUri);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopesFor(config.emailMode),
  });

  console.log('Abra este endereço no navegador e autorize com a conta de teste do projeto:');
  console.log(url);
  console.log('Esperando o retorno em 127.0.0.1. O cliente OAuth precisa ser do tipo computador.');

  const code = await waitForAuthCode(port);
  const { tokens } = await client.getToken(code);
  await saveToken(config.tokenPath, tokens);
  console.log(`Token salvo em ${config.tokenPath}`);
  console.log(`Escopos: ${tokens.scope ?? scopesFor(config.emailMode).join(' ')}`);
}

async function readOAuthClient(credentialsPath: string): Promise<InstalledClient> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(credentialsPath, 'utf8')) as unknown;
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code === 'ENOENT') {
      throw new Error(`Arquivo de credenciais nao encontrado: ${credentialsPath}`, { cause: error });
    }
    throw new Error(`Nao foi possivel ler o JSON de credenciais em ${credentialsPath}`, { cause: error });
  }

  const record = isRecord(raw) ? raw : {};
  const installed = isRecord(record.installed) ? record.installed : undefined;
  const web = isRecord(record.web) ? record.web : undefined;
  const source = installed ?? web ?? record;
  const clientId = typeof source.client_id === 'string' ? source.client_id : '';
  const clientSecret = typeof source.client_secret === 'string' ? source.client_secret : '';
  if (!clientId || !clientSecret) {
    throw new Error(
      'JSON de credenciais invalido. Baixe o cliente OAuth do tipo computador no Google Cloud.',
    );
  }
  return { client_id: clientId, client_secret: clientSecret };
}

async function readToken(tokenPath: string): Promise<Credentials> {
  try {
    const parsed = JSON.parse(await fs.readFile(tokenPath, 'utf8')) as Credentials;
    if (!parsed.refresh_token && !parsed.access_token) {
      throw new Error('Token vazio.');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Token nao encontrado em ${tokenPath}. Rode npm run auth.`, { cause: error });
    }
    if (error instanceof Error && error.message === 'Token vazio.') throw error;
    throw new Error(`Nao foi possivel ler o token em ${tokenPath}. Rode npm run auth de novo.`, { cause: error });
  }
}

function assertScopes(credentials: Credentials, emailMode: EmailMode): void {
  const granted = new Set((credentials.scope ?? '').split(/\s+/).filter(Boolean));
  if (granted.size === 0) return;
  const missing = scopesFor(emailMode).filter((scope) => !granted.has(scope));
  if (missing.length === 0) return;
  throw new Error(
    `O token nao tem os escopos: ${missing.join(', ')}. Ajuste EMAIL_MODE e rode npm run auth de novo.`,
  );
}

async function saveToken(tokenPath: string, tokens: Credentials): Promise<void> {
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function waitForAuthCode(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      const oauthError = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (oauthError) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<p>Autorizacao recusada. Pode fechar esta aba.</p>');
        server.close();
        reject(new Error(`Autorizacao recusada: ${oauthError}`));
        return;
      }
      if (!code) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Codigo ausente.');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<p>Autorizacao concluida. Pode fechar esta aba e voltar ao terminal.</p>');
      setTimeout(() => server.close(), 200);
      resolve(code);
    });

    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Tempo esgotado esperando a autorizacao no navegador.'));
    }, 5 * 60 * 1000);

    server.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(port, '127.0.0.1');
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
