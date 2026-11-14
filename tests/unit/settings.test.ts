import { describe, expect, it } from 'vitest';
import { defaultTargetLang, sameLanguage } from '@/lib/languages';
import { createDefaultSettings, normalizeSettings } from '@/lib/settings/schema';
import { exportSettings, importSettings } from '@/lib/settings/storage';

describe('languages', () => {
  it('picks a target language from the browser language', () => {
    expect(defaultTargetLang('zh-CN')).toBe('zh-CN');
    expect(defaultTargetLang('zh-TW')).toBe('zh-TW');
    expect(defaultTargetLang('zh-Hant-HK')).toBe('zh-TW');
    expect(defaultTargetLang('ja-JP')).toBe('ja');
    expect(defaultTargetLang('xx')).toBe('en');
    expect(defaultTargetLang(undefined)).toBe('en');
  });
  it('compares base languages', () => {
    expect(sameLanguage('zh-CN', 'zh-TW')).toBe(true);
    expect(sameLanguage('en-US', 'en')).toBe(true);
    expect(sameLanguage('en', 'fr')).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeSettings(null, 'zh-CN')).toEqual(createDefaultSettings('zh-CN'));
    expect(normalizeSettings('x', 'en')).toEqual(createDefaultSettings('en'));
  });
  it('merges partial objects and drops wrong types', () => {
    const s = normalizeSettings(
      { targetLang: 'ja', batch: { concurrency: 999 }, displayMode: 42, extra: 1 },
      'en',
    );
    expect(s.targetLang).toBe('ja');
    expect(s.batch).toEqual({ maxChars: 2000, maxSegments: 12, concurrency: 20 });
    expect(s.displayMode).toBe('bilingual');
    expect('extra' in s).toBe(false);
  });
  it('repairs a dangling active provider id', () => {
    const d = createDefaultSettings('en');
    const s = normalizeSettings({ ...d, activeProviderId: 'nope' }, 'en');
    expect(s.activeProviderId).toBe(d.providers[0]!.id);
  });
});

describe('export / import', () => {
  it('strips keys unless asked and keeps existing keys on import', () => {
    const s = createDefaultSettings('en');
    s.providers[0]!.apiKey = 'sk-secret';
    s.targetLang = 'fr';
    const json = exportSettings(s, { includeKeys: false });
    expect(json).not.toContain('sk-secret');
    expect(exportSettings(s, { includeKeys: true })).toContain('sk-secret');
    const imported = importSettings(json, s);
    expect(imported.targetLang).toBe('fr');
    expect(imported.providers[0]!.apiKey).toBe('sk-secret');
  });
  it('throws on invalid JSON', () => {
    expect(() => importSettings('{nope', createDefaultSettings('en'))).toThrow();
  });
});
