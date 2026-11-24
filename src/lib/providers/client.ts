import type { ProviderProfile } from '../settings/schema';
import {
  ProviderError,
  errorKindForStatus,
  extractErrorMessage,
  parseRetryAfter,
  toProviderError,
} from './errors';
import { getPreset } from './presets';
import { thinkingOffFields } from './thinking';

export interface ChatRequest {
  system: string;
  user: string;
  signal?: AbortSignal;
  /** Overall timeout in ms (default 90s). */
  timeoutMs?: number;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function trimSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function validate(profile: ProviderProfile, needModel: boolean): void {
  if (!profile.baseURL.trim()) throw new ProviderError('config', 'Base URL is not set');
  if (needModel && !profile.model.trim()) throw new ProviderError('config', 'Model is not set');
  if (getPreset(profile.presetId).keyRequired && !profile.apiKey.trim()) {
    throw new ProviderError('config', 'API key is not set');
  }
}

function baseHeaders(profile: ProviderProfile): Record<string, string> {
  const preset = getPreset(profile.presetId);
  const headers: Record<string, string> = { ...(preset.extraHeaders ?? {}) };
  const key = profile.apiKey.trim();
  if (profile.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    if (key) headers['x-api-key'] = key;
  } else if (key) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}

/**
 * @param withThinkingOff add the vendor-specific fields that switch model thinking off
 *   (unless the profile allows thinking).
 */
export function buildChatRequest(
  profile: ProviderProfile,
  req: ChatRequest,
  withThinkingOff = true,
): HttpRequest {
  const base = trimSlash(profile.baseURL);
  const headers = { ...baseHeaders(profile), 'Content-Type': 'application/json' };
  const temperature = profile.temperature;
  const extra = withThinkingOff ? thinkingOffFields(profile) : {};
  if (profile.protocol === 'anthropic') {
    const body: Record<string, unknown> = {
      model: profile.model.trim(),
      max_tokens: 8192,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
      ...extra,
    };
    if (temperature !== undefined) body.temperature = temperature;
    return { url: `${base}/messages`, method: 'POST', headers, body: JSON.stringify(body) };
  }
  const body: Record<string, unknown> = {
    model: profile.model.trim(),
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    stream: false,
    ...extra,
  };
  if (temperature !== undefined) body.temperature = temperature;
  return { url: `${base}/chat/completions`, method: 'POST', headers, body: JSON.stringify(body) };
}

/** Extract the assistant text from a chat completion response body. */
export function parseChatResponse(profile: ProviderProfile, json: unknown): string {
  const o = json as Record<string, unknown> | null;
  if (profile.protocol === 'anthropic') {
    const content = o?.content;
    if (Array.isArray(content)) {
      return content
        .filter((c) => c && typeof c === 'object' && (c as { type?: string }).type === 'text')
        .map((c) => String((c as { text?: unknown }).text ?? ''))
        .join('');
    }
  } else {
    const choices = o?.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const message = (choices[0] as { message?: { content?: unknown } }).message;
      const content = message?.content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        // Some gateways return content parts.
        return content.map((p) => (typeof p === 'string' ? p : String(p?.text ?? ''))).join('');
      }
      if (content === null || content === undefined) return '';
    }
  }
  throw new ProviderError('parse', 'Unexpected response format from provider');
}

async function send(
  http: HttpRequest,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(http.url, {
      method: http.method,
      headers: http.headers,
      body: http.body,
      signal,
    });
  } catch (e) {
    if (signal.aborted) {
      const reason: unknown = signal.reason;
      if (reason instanceof DOMException && reason.name === 'TimeoutError') {
        throw new ProviderError('timeout', 'Request timed out');
      }
      throw new ProviderError('aborted', 'Request was cancelled');
    }
    throw toProviderError(e);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(
      errorKindForStatus(res.status),
      `HTTP ${res.status}: ${extractErrorMessage(text) || res.statusText}`,
      { status: res.status, retryAfterMs: parseRetryAfter(res.headers.get('retry-after')) },
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError('parse', `Provider returned non-JSON response: ${text.slice(0, 200)}`);
  }
}

/** Like AbortSignal.any([signal, AbortSignal.timeout(ms)]) but works on Firefox < 124. */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(new DOMException('The operation timed out.', 'TimeoutError')),
    timeoutMs,
  );
  const onAbort = () => {
    clearTimeout(timer);
    ac.abort(signal?.reason);
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  ac.signal.addEventListener('abort', () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  });
  return ac.signal;
}

export async function chat(
  profile: ProviderProfile,
  req: ChatRequest,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<string> {
  validate(profile, true);
  const signal = combineSignals(req.signal, req.timeoutMs ?? 90_000);
  const key = `${trimSlash(profile.baseURL)}|${profile.model.trim()}`;
  const tryThinkingOff =
    !thinkingOffRejected.has(key) && Object.keys(thinkingOffFields(profile)).length > 0;
  if (tryThinkingOff) {
    try {
      return await chatOnce(profile, buildChatRequest(profile, req, true), signal, fetchImpl);
    } catch (e) {
      if (!(e instanceof ProviderError) || e.kind !== 'bad_request') throw e;
      // The endpoint may not know the thinking switch: retry without it and, if that works,
      // stop sending it to this model.
      const text = await chatOnce(
        profile,
        buildChatRequest(profile, req, false),
        signal,
        fetchImpl,
      );
      thinkingOffRejected.add(key);
      return text;
    }
  }
  return chatOnce(profile, buildChatRequest(profile, req, false), signal, fetchImpl);
}

/** "baseURL|model" pairs whose endpoint rejected the thinking-off fields. */
const thinkingOffRejected = new Set<string>();

/** For tests. */
export function resetThinkingOffCache(): void {
  thinkingOffRejected.clear();
}

async function chatOnce(
  profile: ProviderProfile,
  http: HttpRequest,
  signal: AbortSignal,
  fetchImpl: FetchLike,
): Promise<string> {
  const json = await send(http, signal, fetchImpl);
  const o = json as { error?: unknown } | null;
  if (o && typeof o === 'object' && o.error && !('choices' in o) && !('content' in o)) {
    throw new ProviderError('bad_request', extractErrorMessage(JSON.stringify(o)));
  }
  return parseChatResponse(profile, json);
}

export async function listModels(
  profile: ProviderProfile,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): Promise<string[]> {
  validate(profile, false);
  const http: HttpRequest = {
    url: `${trimSlash(profile.baseURL)}/models`,
    method: 'GET',
    headers: baseHeaders(profile),
  };
  const json = (await send(http, combineSignals(undefined, 20_000), fetchImpl)) as {
    data?: unknown;
    models?: unknown;
  };
  const list = Array.isArray(json?.data)
    ? json.data
    : Array.isArray(json?.models)
      ? json.models
      : [];
  const ids = list
    .map((m: unknown) =>
      typeof m === 'string'
        ? m
        : ((m as { id?: unknown; name?: unknown })?.id ?? (m as { name?: unknown })?.name),
    )
    .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
    .map((id: string) => id.replace(/^models\//, ''));
  return [...new Set(ids)].sort();
}
