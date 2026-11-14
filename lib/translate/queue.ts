import { ProviderError, toProviderError } from '../providers/errors';

/** Simple FIFO semaphore. */
export class Limiter {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private limit: number) {}

  setLimit(limit: number): void {
    this.limit = Math.max(1, limit);
    this.drain();
  }

  get pending(): number {
    return this.waiting.length;
  }

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await fn();
    } finally {
      this.active--;
      this.drain();
    }
  }

  private acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted)
      return Promise.reject(new ProviderError('aborted', 'Request was cancelled'));
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        this.active++;
        resolve();
      };
      const onAbort = () => {
        const i = this.waiting.indexOf(grant);
        if (i >= 0) this.waiting.splice(i, 1);
        reject(new ProviderError('aborted', 'Request was cancelled'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(grant);
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.waiting.length > 0) {
      this.waiting.shift()!();
    }
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ProviderError('aborted', 'Request was cancelled'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new ProviderError('aborted', 'Request was cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Retry retryable ProviderErrors (429 / 5xx / network / timeout) with exponential backoff. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const doSleep = opts.sleep ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const err = toProviderError(e);
      if (opts.signal?.aborted) throw new ProviderError('aborted', 'Request was cancelled');
      if (!err.retryable || attempt >= opts.retries) throw err;
      const backoff = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
      const jitter = Math.random() * 0.25 * backoff;
      const wait = Math.min(opts.maxDelayMs, Math.max(err.retryAfterMs ?? 0, backoff + jitter));
      await doSleep(wait, opts.signal);
    }
  }
}
