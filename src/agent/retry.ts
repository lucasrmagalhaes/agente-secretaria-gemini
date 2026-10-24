export const DEFAULT_MODEL_ATTEMPTS = 4;
export const DEFAULT_RETRY_BASE_MS = 1000;
export const DEFAULT_RETRY_MAX_MS = 8000;

export interface RetryNotice {
  model: string;
  attempt: number;
  attempts: number;
  delayMs: number;
  status: 429 | 503;
  nextModel?: string;
}

export interface RetryOptions<T> {
  models: string[];
  run: (model: string) => Promise<T>;
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (notice: RetryNotice) => void;
}

export function modelSequence(model: string, fallbackModel?: string): string[] {
  const primary = model.trim();
  const models = primary ? [primary] : [];
  const fallback = fallbackModel?.trim();
  if (fallback && fallback !== primary) models.push(fallback);
  return models;
}

export function retryableStatus(error: unknown): 429 | 503 | undefined {
  if (isDailyQuotaError(error) || isTimeoutError(error)) return undefined;
  const status = readStatus(error);
  if (status === 429 || status === 503) return status;
  return undefined;
}

export function isDailyQuotaError(error: unknown): boolean {
  const blob = errorBlob(error);
  const quota =
    /RESOURCE_EXHAUSTED/.test(blob) ||
    /quota exceeded/i.test(blob) ||
    /exceeded your current quota/i.test(blob);
  if (!quota) return false;
  const status = readStatus(error);
  return status === undefined || status === 429;
}

export function isTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { name?: unknown; message?: unknown; cause?: unknown; code?: unknown };
    if (record.name === 'AbortError' || record.name === 'TimeoutError') return true;
    if (record.code === 'ABORT_ERR' || record.code === 20) return true;
    if (typeof record.message === 'string' && /operation was aborted|request timed out|The user aborted/i.test(record.message)) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export function quotaFailure(cause: unknown): Error {
  return new Error(
    'A cota diária do Gemini acabou (RESOURCE_EXHAUSTED). A chamada não será repetida. Espere a renovação ou use outra chave gratuita do AI Studio.',
    cause === undefined ? undefined : { cause },
  );
}

export function timeoutFailure(cause: unknown): Error {
  return new Error('A chamada ao Gemini excedeu o tempo limite e foi cancelada.', cause === undefined ? undefined : { cause });
}

export function exhaustedFailure(status: 429 | 503, cause: unknown): Error {
  const reason = status === 503 ? 'O Gemini está indisponível (503)' : `O Gemini retornou ${status}`;
  return new Error(`${reason} depois de esgotar as tentativas. Tente de novo mais tarde.`, cause === undefined ? undefined : { cause });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function logRetry(notice: RetryNotice): void {
  if (notice.nextModel) {
    console.error(
      `Gemini retornou ${notice.status} no modelo ${notice.model}. Tentando o modelo reserva ${notice.nextModel}.`,
    );
    return;
  }
  const seconds = notice.delayMs / 1000;
  console.error(
    `Gemini retornou ${notice.status} no modelo ${notice.model}. Nova tentativa ${notice.attempt + 1} de ${notice.attempts} em ${seconds}s.`,
  );
}

/**
 * Repeats a model call when the API is busy (429 or 503).
 * The wait doubles each time. After the attempts for one model, the next model in the list is used.
 */
export async function callWithRetry<T>(options: RetryOptions<T>): Promise<T> {
  const models = unique(options.models.map((model) => model.trim()).filter(Boolean));
  if (models.length === 0) {
    throw new Error('Nenhum modelo Gemini foi configurado.');
  }

  const attempts = options.attempts ?? DEFAULT_MODEL_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_BASE_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_RETRY_MAX_MS;
  const wait = options.sleep ?? sleep;
  let lastError: unknown;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex] ?? '';
    const nextModel = models[modelIndex + 1];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await options.run(model);
      } catch (error) {
        lastError = error;
        if (isDailyQuotaError(error)) throw quotaFailure(error);
        if (isTimeoutError(error)) throw timeoutFailure(error);
        const status = retryableStatus(error);
        const hasAnotherAttempt = attempt < attempts;
        const hasFallback = nextModel !== undefined;
        if (!status) throw error;
        if (!hasAnotherAttempt && !hasFallback) throw exhaustedFailure(status, error);
        if (!hasAnotherAttempt) {
          options.onRetry?.({
            model,
            attempt,
            attempts,
            delayMs: 0,
            status,
            nextModel,
          });
          break;
        }
        const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
        options.onRetry?.({ model, attempt, attempts, delayMs, status });
        await wait(delayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Falha ao consultar o modelo.');
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function readStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as {
    status?: unknown;
    code?: unknown;
    message?: unknown;
    error?: { code?: unknown; status?: unknown };
  };
  const direct = asStatusCode(record.status) ?? asStatusCode(record.code);
  if (direct) return direct;
  if (record.status === 'UNAVAILABLE') return 503;
  if (record.error && typeof record.error === 'object') {
    const nested = asStatusCode(record.error.code) ?? asStatusCode(record.error.status);
    if (nested) return nested;
    if (record.error.status === 'UNAVAILABLE') return 503;
  }
  if (typeof record.message === 'string') return statusFromMessage(record.message);
  if (error instanceof Error) return statusFromMessage(error.message);
  return undefined;
}

function asStatusCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  return undefined;
}

function errorBlob(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as { message?: unknown; status?: unknown; code?: unknown; cause?: unknown; error?: unknown };
    if (typeof record.message === 'string') parts.push(record.message);
    if (typeof record.status === 'string') parts.push(record.status);
    if (typeof record.code === 'string') parts.push(record.code);
    if (record.error && typeof record.error === 'object') parts.push(JSON.stringify(record.error));
    current = record.cause;
  }
  if (error instanceof Error && parts.length === 0) parts.push(error.message);
  return parts.join('\n');
}

function statusFromMessage(message: string): number | undefined {
  const trimmed = message.trim();
  if (trimmed.startsWith('{')) {
    try {
      return readStatus(JSON.parse(trimmed) as unknown);
    } catch {
      return undefined;
    }
  }
  if (/\b503\b/.test(message) || /\bUNAVAILABLE\b/i.test(message)) return 503;
  if (/\b429\b/.test(message) || /\bRESOURCE_EXHAUSTED\b/.test(message)) return 429;
  return undefined;
}
