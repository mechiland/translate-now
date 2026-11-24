import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildChatRequest,
  chat,
  listModels,
  parseChatResponse,
  resetThinkingOffCache,
} from '@/lib/providers/client';
import {
  ProviderError,
  errorKindForStatus,
  extractErrorMessage,
  parseRetryAfter,
} from '@/lib/providers/errors';
import type { ProviderProfile } from '@/lib/settings/schema';

const openai: ProviderProfile = {
  id: 'a',
  name: 'OpenRouter',
  presetId: 'openrouter',
  protocol: 'openai',
  baseURL: 'https://openrouter.ai/api/v1/',
  apiKey: 'sk-1',
  model: 'm',
};
const anthropic: ProviderProfile = {
  id: 'b',
  name: 'Claude',
  presetId: 'anthropic',
  protocol: 'anthropic',
  baseURL: 'https://api.anthropic.com/v1',
  apiKey: 'sk-ant',
  model: 'claude-x',
  temperature: 0.2,
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

describe('buildChatRequest', () => {
  it('builds an OpenAI-compatible request', () => {
    const r = buildChatRequest(openai, { system: 'S', user: 'U' });
    expect(r.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(r.headers.Authorization).toBe('Bearer sk-1');
    expect(r.headers['X-Title']).toBe('Translate Now');
    const body = JSON.parse(r.body!);
    expect(body).toEqual({
      model: 'm',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'U' },
      ],
      stream: false,
      reasoning: { effort: 'none' },
    });
  });

  it('leaves thinking alone when the profile allows it', () => {
    const r = buildChatRequest({ ...openai, allowThinking: true }, { system: 'S', user: 'U' });
    expect(JSON.parse(r.body!).reasoning).toBeUndefined();
  });

  it('can build a request without the thinking switch', () => {
    const r = buildChatRequest(openai, { system: 'S', user: 'U' }, false);
    expect(JSON.parse(r.body!).reasoning).toBeUndefined();
  });

  it('builds an Anthropic request', () => {
    const r = buildChatRequest(anthropic, { system: 'S', user: 'U' });
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.headers['x-api-key']).toBe('sk-ant');
    expect(r.headers['anthropic-version']).toBe('2023-06-01');
    expect(r.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(r.headers.Authorization).toBeUndefined();
    const body = JSON.parse(r.body!);
    expect(body.system).toBe('S');
    expect(body.messages).toEqual([{ role: 'user', content: 'U' }]);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it('omits Authorization when no key (Ollama)', () => {
    const r = buildChatRequest(
      { ...openai, presetId: 'ollama', apiKey: '' },
      { system: 'S', user: 'U' },
    );
    expect(r.headers.Authorization).toBeUndefined();
  });
});

describe('parseChatResponse', () => {
  it('parses OpenAI responses', () => {
    expect(parseChatResponse(openai, { choices: [{ message: { content: 'hi' } }] })).toBe('hi');
    expect(
      parseChatResponse(openai, {
        choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }],
      }),
    ).toBe('ab');
  });
  it('parses Anthropic responses', () => {
    expect(
      parseChatResponse(anthropic, {
        content: [
          { type: 'thinking', thinking: '...' },
          { type: 'text', text: 'hel' },
          { type: 'text', text: 'lo' },
        ],
      }),
    ).toBe('hello');
  });
  it('throws on unknown shapes', () => {
    expect(() => parseChatResponse(openai, { foo: 1 })).toThrow(ProviderError);
  });
});

describe('chat', () => {
  beforeEach(() => resetThinkingOffCache());

  it('retries without the thinking switch on 400 and remembers it', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      bodies.push(body);
      return 'reasoning' in body
        ? jsonResponse({ error: { message: 'Unrecognized request argument: reasoning' } }, 400)
        : jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    });
    await expect(chat(openai, { system: 's', user: 'u' }, f)).resolves.toBe('ok');
    await expect(chat(openai, { system: 's', user: 'u' }, f)).resolves.toBe('ok');
    expect(bodies.map((b) => 'reasoning' in b)).toEqual([true, false, false]);
  });

  it('does not retry other errors without the thinking switch', async () => {
    const f = vi.fn(async () => jsonResponse({ error: { message: 'bad key' } }, 401));
    await expect(chat(openai, { system: 's', user: 'u' }, f)).rejects.toThrow('bad key');
    expect(f).toHaveBeenCalledOnce();
  });

  it('returns content on success', async () => {
    const f = vi.fn(async () => jsonResponse({ choices: [{ message: { content: '你好' } }] }));
    await expect(chat(openai, { system: 's', user: 'u' }, f)).resolves.toBe('你好');
    expect(f).toHaveBeenCalledOnce();
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not_found'],
    [429, 'rate_limit'],
    [400, 'bad_request'],
    [500, 'server'],
    [503, 'server'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const f = async () =>
      jsonResponse({ error: { message: 'nope' } }, status, { 'retry-after': '2' });
    const err = await chat(openai, { system: 's', user: 'u' }, f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe(kind);
    expect((err as ProviderError).message).toContain('nope');
    if (status === 429) expect((err as ProviderError).retryAfterMs).toBe(2000);
  });

  it('maps fetch TypeError to network', async () => {
    const f = async (): Promise<Response> => {
      throw new TypeError('Failed to fetch');
    };
    const err = (await chat(openai, { system: 's', user: 'u' }, f).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
  });

  it('maps an aborted request to aborted', async () => {
    const ac = new AbortController();
    const f = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const p = chat(openai, { system: 's', user: 'u', signal: ac.signal }, f);
    ac.abort();
    const err = (await p.catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('aborted');
  });

  it('maps a timeout to timeout', async () => {
    const f = (_u: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    const err = (await chat(openai, { system: 's', user: 'u', timeoutMs: 10 }, f).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.kind).toBe('timeout');
  });

  it('rejects missing config before sending', async () => {
    const f = vi.fn();
    const err = (await chat({ ...openai, apiKey: '' }, { system: 's', user: 'u' }, f).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err.kind).toBe('config');
    expect(f).not.toHaveBeenCalled();
    const err2 = (await chat({ ...openai, model: '' }, { system: 's', user: 'u' }, f).catch(
      (e: unknown) => e,
    )) as ProviderError;
    expect(err2.kind).toBe('config');
  });

  it('treats a non-JSON body as parse error', async () => {
    const err = (await chat(openai, { system: 's', user: 'u' }, async () =>
      jsonResponse('<html>'),
    ).catch((e: unknown) => e)) as ProviderError;
    expect(err.kind).toBe('parse');
  });
});

describe('listModels', () => {
  it('lists, de-duplicates, sorts and strips models/ prefix', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://openrouter.ai/api/v1/models');
      return jsonResponse({ data: [{ id: 'b' }, { id: 'models/a' }, { id: 'b' }] });
    });
    await expect(listModels(openai, f)).resolves.toEqual(['a', 'b']);
  });
});

describe('error helpers', () => {
  it('errorKindForStatus', () => {
    expect(errorKindForStatus(408)).toBe('timeout');
    expect(errorKindForStatus(422)).toBe('bad_request');
  });
  it('parseRetryAfter', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter('garbage')).toBeUndefined();
  });
  it('extractErrorMessage', () => {
    expect(extractErrorMessage('{"error":{"message":"bad key"}}')).toBe('bad key');
    expect(extractErrorMessage('{"detail":"x"}')).toBe('x');
    expect(extractErrorMessage('plain text')).toBe('plain text');
  });
});
