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
  const status = readStatus(error);
  if (status === 429 || status === 503) return status;
  return undefined;
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
        const status = retryableStatus(error);
        const hasAnotherAttempt = attempt < attempts;
        const hasFallback = nextModel !== undefined;
        if (!status || (!hasAnotherAttempt && !hasFallback)) {
          throw error;
        }
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
