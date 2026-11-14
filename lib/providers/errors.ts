export type ProviderErrorKind =
  | 'config'
  | 'auth'
  | 'rate_limit'
  | 'bad_request'
  | 'not_found'
  | 'server'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'parse';

export interface SerializedError {
  kind: ProviderErrorKind;
  message: string;
  status?: number;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** Milliseconds to wait before retrying, from a Retry-After header. */
  readonly retryAfterMs?: number;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }

  get retryable(): boolean {
    return (
      this.kind === 'rate_limit' ||
      this.kind === 'server' ||
      this.kind === 'network' ||
      this.kind === 'timeout'
    );
  }

  toJSON(): SerializedError {
    return { kind: this.kind, message: this.message, status: this.status };
  }
}

export function errorKindForStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/** Pull a human-readable message out of the many error body shapes providers use. */
export function extractErrorMessage(body: string): string {
  try {
    const json: unknown = JSON.parse(body);
    const pick = (v: unknown): string | undefined => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return pick(o.message) ?? pick(o.error) ?? pick(o.detail) ?? pick(o.msg);
      }
      return undefined;
    };
    const msg = pick(json);
    if (msg) return msg;
  } catch {
    // not JSON
  }
  return body.slice(0, 300);
}

export function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new ProviderError('aborted', 'Request was cancelled');
  }
  if (e instanceof DOMException && e.name === 'TimeoutError') {
    return new ProviderError('timeout', 'Request timed out');
  }
  if (e instanceof TypeError) {
    // fetch() throws TypeError on network failures / CORS / DNS errors
    return new ProviderError('network', e.message || 'Network error');
  }
  return new ProviderError('parse', e instanceof Error ? e.message : String(e));
}

export function deserializeError(e: SerializedError): ProviderError {
  return new ProviderError(e.kind, e.message, { status: e.status });
}
