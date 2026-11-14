import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/lib/settings/schema';
import {
  effectiveSiteConfig,
  findSiteRule,
  matchScore,
  normalizePattern,
  upsertSiteRule,
} from '@/lib/settings/siteRules';

describe('normalizePattern', () => {
  it('strips scheme, path, port and case', () => {
    expect(normalizePattern(' https://WWW.Example.com:8080/a/b?x#y ')).toBe('www.example.com');
    expect(normalizePattern('*.example.com')).toBe('*.example.com');
    expect(normalizePattern('=News.example.com/')).toBe('=news.example.com');
  });
});

describe('matchScore', () => {
  it('plain host matches itself and subdomains', () => {
    expect(matchScore('example.com', 'example.com')).toBeGreaterThan(0);
    expect(matchScore('example.com', 'a.b.example.com')).toBeGreaterThan(0);
    expect(matchScore('example.com', 'badexample.com')).toBe(-1);
  });
  it('wildcard matches subdomains only', () => {
    expect(matchScore('*.example.com', 'www.example.com')).toBeGreaterThan(0);
    expect(matchScore('*.example.com', 'example.com')).toBe(-1);
  });
  it('exact matches only that host', () => {
    expect(matchScore('=www.example.com', 'www.example.com')).toBeGreaterThan(0);
    expect(matchScore('=www.example.com', 'a.www.example.com')).toBe(-1);
  });
});

describe('findSiteRule', () => {
  const rules = [
    { pattern: 'example.com', mode: 'always' as const },
    { pattern: '*.example.com', mode: 'never' as const },
    { pattern: 'docs.example.com', mode: 'default' as const },
    { pattern: '=blog.example.com', mode: 'always' as const },
  ];
  it('prefers the most specific rule', () => {
    expect(findSiteRule(rules, 'example.com')?.mode).toBe('always');
    expect(findSiteRule(rules, 'www.example.com')?.pattern).toBe('*.example.com');
    expect(findSiteRule(rules, 'docs.example.com')?.pattern).toBe('docs.example.com');
    expect(findSiteRule(rules, 'blog.example.com')?.pattern).toBe('=blog.example.com');
    expect(findSiteRule(rules, 'other.org')).toBeUndefined();
  });
});

describe('effectiveSiteConfig', () => {
  it('falls back to global settings', () => {
    const s = createDefaultSettings('en-US');
    s.styleId = 'technical';
    const cfg = effectiveSiteConfig(s, 'foo.com');
    expect(cfg).toMatchObject({
      mode: 'default',
      styleId: 'technical',
      displayMode: 'bilingual',
      selectionEnabled: true,
    });
  });
  it('applies rule overrides', () => {
    const s = createDefaultSettings('en-US');
    s.siteRules = [
      {
        pattern: 'foo.com',
        mode: 'always',
        styleId: 'news',
        displayMode: 'translation-only',
        selection: false,
      },
    ];
    expect(effectiveSiteConfig(s, 'www.foo.com')).toMatchObject({
      mode: 'always',
      styleId: 'news',
      displayMode: 'translation-only',
      selectionEnabled: false,
    });
  });
});

describe('upsertSiteRule', () => {
  it('adds, updates and removes empty rules', () => {
    let rules = upsertSiteRule([], 'https://Foo.com/x', { mode: 'always' });
    expect(rules).toEqual([{ pattern: 'foo.com', mode: 'always' }]);
    rules = upsertSiteRule(rules, 'foo.com', { styleId: 'news' });
    expect(rules).toEqual([{ pattern: 'foo.com', mode: 'always', styleId: 'news' }]);
    rules = upsertSiteRule(rules, 'foo.com', { mode: 'default', styleId: undefined });
    expect(rules).toEqual([]);
  });
});
