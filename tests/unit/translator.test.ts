import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/lib/providers/errors';
import { createDefaultSettings, type Settings } from '@/lib/settings/schema';
import { MemoryCache } from '@/lib/translate/cache';
import { cacheKey } from '@/lib/translate/hash';
import { Limiter, withRetry } from '@/lib/translate/queue';
import { Translator } from '@/lib/translate/translator';

function settings(): Settings {
  const s = createDefaultSettings('zh-CN');
  s.providers[0]!.apiKey = 'k';
  s.providers[0]!.model = 'm';
  return s;
}

/** Echo model: translates each <seg> by prefixing "T:". */
function echo(user: string): string {
  return [...user.matchAll(/<seg id="(\d+)">([\s\S]*?)<\/seg>/g)]
    .map((m) => `<seg id="${m[1]}">T:${m[2]}</seg>`)
    .join('\n');
}

const noSleep = { sleep: async () => {} };

describe('Translator.translatePage', () => {
  it('translates, batches and caches', async () => {
    const chat = vi.fn(async (_p: unknown, req: { user: string }) => echo(req.user));
    const cache = new MemoryCache();
    const tr = new Translator({ chat, cache, retry: noSleep });
    const s = settings();
    s.batch.maxSegments = 2;
    const res = await tr.translatePage(s, { texts: ['a', 'b', 'c'], host: 'x.com' });
    expect(res).toEqual([
      { ok: true, text: 'T:a' },
      { ok: true, text: 'T:b' },
      { ok: true, text: 'T:c' },
    ]);
    expect(chat).toHaveBeenCalledTimes(2);
    await new Promise((r) => setTimeout(r, 0));
    const again = await tr.translatePage(s, { texts: ['a', 'c'], host: 'x.com' });
    expect(again).toEqual([
      { ok: true, text: 'T:a' },
      { ok: true, text: 'T:c' },
    ]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('retries missing segments one by one', async () => {
    let call = 0;
    const chat = vi.fn(async (_p: unknown, req: { user: string }) => {
      call++;
      // First (batched) call drops segment 2.
      if (call === 1) return '<seg id="1">T:a</seg><seg id="3">T:c</seg>';
      return echo(req.user);
    });
    const tr = new Translator({ chat, cache: new MemoryCache(), retry: noSleep });
    const res = await tr.translatePage(settings(), { texts: ['a', 'b', 'c'], host: 'x.com' });
    expect(res.map((r) => r.ok && r.text)).toEqual(['T:a', 'T:b', 'T:c']);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it('reports an error when a single segment comes back empty', async () => {
    const tr = new Translator({ chat: async () => '', cache: new MemoryCache(), retry: noSleep });
    const res = await tr.translatePage(settings(), { texts: ['a'], host: 'x.com' });
    expect(res[0]).toMatchObject({ ok: false, error: { kind: 'parse' } });
  });

  it('retries 429 then succeeds', async () => {
    let n = 0;
    const chat = vi.fn(async (_p: unknown, req: { user: string }) => {
      if (n++ < 2) throw new ProviderError('rate_limit', 'slow down', { status: 429 });
      return echo(req.user);
    });
    const tr = new Translator({ chat, cache: new MemoryCache(), retry: noSleep });
    const res = await tr.translatePage(settings(), { texts: ['a'], host: 'x.com' });
    expect(res[0]).toEqual({ ok: true, text: 'T:a' });
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it('does not retry auth errors and fails every segment', async () => {
    const chat = vi.fn(async () => {
      throw new ProviderError('auth', 'HTTP 401: bad key', { status: 401 });
    });
    const tr = new Translator({ chat, cache: new MemoryCache(), retry: noSleep });
    const res = await tr.translatePage(settings(), { texts: ['a', 'b'], host: 'x.com' });
    expect(res).toEqual([
      { ok: false, error: { kind: 'auth', message: 'HTTP 401: bad key', status: 401 } },
      { ok: false, error: { kind: 'auth', message: 'HTTP 401: bad key', status: 401 } },
    ]);
    expect(chat).toHaveBeenCalledOnce();
  });

  it('returns config errors without calling the provider', async () => {
    const chat = vi.fn();
    const s = createDefaultSettings('en');
    const tr = new Translator({ chat, cache: new MemoryCache(), retry: noSleep });
    // Missing key: chat() itself validates; simulate via the real client contract.
    chat.mockRejectedValue(new ProviderError('config', 'API key is not set'));
    const res = await tr.translatePage(s, { texts: ['a'], host: 'x.com' });
    expect(res[0]).toMatchObject({ ok: false, error: { kind: 'config' } });
  });

  it('uses the site-specific style in the prompt', async () => {
    const chat = vi.fn(async (_p: unknown, req: { system: string; user: string }) =>
      echo(req.user),
    );
    const s = settings();
    s.siteRules = [{ pattern: 'docs.dev', mode: 'default', styleId: 'technical' }];
    const tr = new Translator({ chat, cache: new MemoryCache(), retry: noSleep });
    await tr.translatePage(s, { texts: ['a'], host: 'docs.dev' });
    expect(chat.mock.calls[0]![1].system).toContain('technical documentation');
  });
});

describe('Translator.translateSelection', () => {
  it('returns cleaned output', async () => {
    const tr = new Translator({
      chat: async () => '```\n你好\n```',
      cache: new MemoryCache(),
      retry: noSleep,
    });
    await expect(tr.translateSelection(settings(), { text: 'hello', host: 'x' })).resolves.toBe(
      '你好',
    );
  });
  it('respects targetLang override', async () => {
    const chat = vi.fn(async () => 'こんにちは');
    const tr = new Translator({ chat, cache: new MemoryCache(), retry: noSleep });
    await tr.translateSelection(settings(), { text: 'hello', host: 'x', targetLang: 'ja' });
    expect((chat.mock.calls[0] as unknown as [unknown, { system: string }])[1].system).toContain(
      'Japanese',
    );
  });
});

describe('cacheKey', () => {
  const base = {
    text: 'a',
    targetLang: 'zh-CN',
    protocol: 'openai',
    baseURL: 'https://x/v1',
    model: 'm',
    styleInstruction: 's',
    glossary: '[]',
    kind: 'page',
  };
  it('is stable and sensitive to every part', async () => {
    const k = await cacheKey(base);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(await cacheKey({ ...base, baseURL: 'https://x/v1/' })).toBe(k);
    for (const field of Object.keys(base) as (keyof typeof base)[]) {
      if (field === 'baseURL') continue;
      expect(await cacheKey({ ...base, [field]: `${base[field]}!` })).not.toBe(k);
    }
  });
});

describe('Limiter', () => {
  it('caps concurrency', async () => {
    const lim = new Limiter(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      lim.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all([task(), task(), task(), task(), task()]);
    expect(peak).toBe(2);
  });
  it('rejects queued tasks when aborted', async () => {
    const lim = new Limiter(1);
    let release!: () => void;
    const first = lim.run(() => new Promise<void>((r) => (release = r)));
    const ac = new AbortController();
    const second = lim.run(async () => 'x', ac.signal);
    ac.abort();
    await expect(second).rejects.toMatchObject({ kind: 'aborted' });
    release();
    await first;
    expect(lim.pending).toBe(0);
  });
});

describe('withRetry', () => {
  it('honors retry-after and gives up after N retries', async () => {
    const waits: number[] = [];
    const fn = vi.fn(async () => {
      throw new ProviderError('server', 'boom', { retryAfterMs: 5000 });
    });
    await expect(
      withRetry(fn, {
        retries: 2,
        baseDelayMs: 100,
        maxDelayMs: 10_000,
        sleep: async (ms) => void waits.push(ms),
      }),
    ).rejects.toMatchObject({ kind: 'server' });
    expect(fn).toHaveBeenCalledTimes(3);
    expect(waits.every((w) => w >= 5000)).toBe(true);
  });
});
