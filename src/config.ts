export type EmailMode = 'dry-run' | 'gmail';

export interface AppConfig {
  geminiApiKey: string;
  model: string;
  fallbackModel?: string;
  calendarId: string;
  timeZone: string;
  credentialsPath?: string;
  tokenPath?: string;
  emailMode: EmailMode;
  maxToolSteps: number;
}

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export function scopesFor(emailMode: EmailMode): string[] {
  const scopes = [CALENDAR_SCOPE];
  if (emailMode === 'gmail') {
    scopes.push(GMAIL_READONLY_SCOPE, GMAIL_SEND_SCOPE);
  }
  return scopes;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const emailMode = parseEmailMode(env.EMAIL_MODE);
  const timeZone = env.CALENDAR_TIMEZONE?.trim() || 'America/Sao_Paulo';
  assertTimeZone(timeZone);

  return {
    geminiApiKey: env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || '',
    model: env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
    fallbackModel: blankToUndefined(env.GEMINI_FALLBACK_MODEL),
    calendarId: env.GOOGLE_CALENDAR_ID?.trim() || 'primary',
    timeZone,
    credentialsPath: blankToUndefined(env.GOOGLE_CREDENTIALS_PATH),
    tokenPath: blankToUndefined(env.GOOGLE_TOKEN_PATH),
    emailMode,
    maxToolSteps: readPositiveInt(env.MAX_TOOL_STEPS, 8, 20),
  };
}

export function requireGeminiApiKey(config: AppConfig): string {
  if (!config.geminiApiKey) {
    throw new Error(
      'Defina GEMINI_API_KEY no arquivo .env. Crie uma chave gratuita em https://aistudio.google.com/apikey',
    );
  }
  return config.geminiApiKey;
}

function parseEmailMode(value: string | undefined): EmailMode {
  const raw = value?.trim().toLowerCase();
  if (!raw || raw === 'dry-run') return 'dry-run';
  if (raw === 'gmail') return 'gmail';
  return 'dry-run';
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function readPositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    throw new Error(`CALENDAR_TIMEZONE invalido: ${timeZone}`);
  }
}
