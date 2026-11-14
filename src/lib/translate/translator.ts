import type { ChatRequest } from '../providers/client';
import { ProviderError, toProviderError, type SerializedError } from '../providers/errors';
import { getActiveProvider, type ProviderProfile, type Settings } from '../settings/schema';
import { effectiveSiteConfig } from '../settings/siteRules';
import { findStyle } from '../settings/styles';
import { createBatches } from './batching';
import type { TranslationCache } from './cache';
import { cacheKey } from './hash';
import {
  buildPageSystemPrompt,
  buildPageUserPrompt,
  buildSelectionSystemPrompt,
  type PromptContext,
} from './prompt';
import { cleanSelectionOutput, parseSegments } from './parse';
import { Limiter, withRetry, type RetryOptions } from './queue';

export type SegmentResult = { ok: true; text: string } | { ok: false; error: SerializedError };

export interface TranslatorDeps {
  chat: (profile: ProviderProfile, req: ChatRequest) => Promise<string>;
  cache: TranslationCache;
  limiter?: Limiter;
  retry?: Partial<RetryOptions>;
}

export interface PageRequest {
  texts: string[];
  host: string;
  title?: string;
}

export interface SelectionRequest {
  text: string;
  host: string;
  title?: string;
  targetLang?: string;
}

interface Resolved {
  profile: ProviderProfile;
  ctx: PromptContext;
  glossaryKey: string;
}

export class Translator {
  readonly limiter: Limiter;

  constructor(private deps: TranslatorDeps) {
    this.limiter = deps.limiter ?? new Limiter(4);
  }

  private resolve(settings: Settings, host: string, title?: string, targetLang?: string): Resolved {
    const profile = getActiveProvider(settings);
    if (!profile) throw new ProviderError('config', 'No translation service configured');
    const site = effectiveSiteConfig(settings, host);
    const style = findStyle(settings, site.styleId);
    this.limiter.setLimit(settings.batch.concurrency);
    return {
      profile,
      glossaryKey: JSON.stringify(settings.glossary),
      ctx: {
        targetLang: targetLang ?? settings.targetLang,
        styleInstruction: style.instruction,
        glossary: settings.glossary,
        pageTitle: title,
        host,
      },
    };
  }

  private key(r: Resolved, text: string, kind: 'page' | 'selection'): Promise<string> {
    return cacheKey({
      kind,
      text,
      targetLang: r.ctx.targetLang,
      protocol: r.profile.protocol,
      baseURL: r.profile.baseURL,
      model: r.profile.model,
      styleInstruction: r.ctx.styleInstruction,
      glossary: r.glossaryKey,
    });
  }

  private call(r: Resolved, system: string, user: string, signal?: AbortSignal): Promise<string> {
    return withRetry(
      () => this.limiter.run(() => this.deps.chat(r.profile, { system, user, signal }), signal),
      { retries: 3, baseDelayMs: 1000, maxDelayMs: 20_000, ...this.deps.retry, signal },
    );
  }

  async translatePage(
    settings: Settings,
    req: PageRequest,
    signal?: AbortSignal,
  ): Promise<SegmentResult[]> {
    let r: Resolved;
    try {
      r = this.resolve(settings, req.host, req.title);
    } catch (e) {
      const err = toProviderError(e).toJSON();
      return req.texts.map(() => ({ ok: false, error: err }));
    }
    const results: (SegmentResult | undefined)[] = new Array(req.texts.length).fill(undefined);
    const keys = await Promise.all(req.texts.map((t) => this.key(r, t, 'page')));
    const misses: { text: string; data: number }[] = [];
    await Promise.all(
      req.texts.map(async (text, i) => {
        const cached = await this.deps.cache.get(keys[i]!);
        if (cached !== undefined) results[i] = { ok: true, text: cached };
        else misses.push({ text, data: i });
      }),
    );
    misses.sort((a, b) => a.data - b.data);

    const system = buildPageSystemPrompt(r.ctx);
    const translateGroup = async (group: { text: string; data: number }[]): Promise<void> => {
      let parsed: (string | undefined)[];
      try {
        const raw = await this.call(
          r,
          system,
          buildPageUserPrompt(group.map((g) => g.text)),
          signal,
        );
        parsed = parseSegments(raw, group.length);
      } catch (e) {
        const err = toProviderError(e);
        // Only split on errors that a smaller request might fix.
        if (
          group.length > 1 &&
          (err.kind === 'parse' || err.kind === 'bad_request' || err.kind === 'timeout')
        ) {
          await Promise.all(group.map((g) => translateGroup([g])));
          return;
        }
        for (const g of group) results[g.data] = { ok: false, error: err.toJSON() };
        return;
      }
      const missing: { text: string; data: number }[] = [];
      parsed.forEach((value, j) => {
        const g = group[j]!;
        if (value === undefined) {
          missing.push(g);
        } else {
          results[g.data] = { ok: true, text: value };
          void this.deps.cache.set(keys[g.data]!, value);
        }
      });
      if (missing.length === 0) return;
      if (group.length === 1) {
        results[missing[0]!.data] = {
          ok: false,
          error: { kind: 'parse', message: 'The model returned an empty translation' },
        };
        return;
      }
      await Promise.all(missing.map((g) => translateGroup([g])));
    };

    const batches = createBatches(misses, settings.batch.maxChars, settings.batch.maxSegments);
    await Promise.all(batches.map((b) => translateGroup(b)));
    return results.map(
      (res) => res ?? { ok: false, error: { kind: 'parse', message: 'No result' } },
    );
  }

  async translateSelection(
    settings: Settings,
    req: SelectionRequest,
    signal?: AbortSignal,
  ): Promise<string> {
    const r = this.resolve(settings, req.host, req.title, req.targetLang);
    const text = req.text.trim();
    const key = await this.key(r, text, 'selection');
    const cached = await this.deps.cache.get(key);
    if (cached !== undefined) return cached;
    const raw = await this.call(r, buildSelectionSystemPrompt(r.ctx, text), text, signal);
    const out = cleanSelectionOutput(raw);
    if (!out) throw new ProviderError('parse', 'The model returned an empty translation');
    void this.deps.cache.set(key, out);
    return out;
  }
}
