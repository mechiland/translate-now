import { describe, expect, it } from 'vitest';
import { detectLanguage, guessScript, shouldSkipLanguage } from '@/lib/dom/detect';

describe('guessScript', () => {
  it.each([
    ['这是一个中文句子。', 'zh'],
    ['使用 React 构建用户界面', 'zh'],
    ['これは日本語の文章です。', 'ja'],
    ['東京は日本の首都です', 'ja'],
    ['東京大学', 'zh'], // kanji only: ambiguous, treated as Han
    ['日本語を勉強しています', 'ja'],
    ['한국어 문장입니다', 'ko'],
    ['Это русский текст', 'ru'],
    ['This is English text', 'latin'],
    ['12345 !!!', 'unknown'],
  ])('%s -> %s', (text, expected) => {
    expect(guessScript(text)).toBe(expected);
  });
});

describe('detectLanguage', () => {
  it('uses script heuristics for CJK without calling the browser', async () => {
    let called = false;
    const browser = async () => {
      called = true;
      return 'en';
    };
    expect(await detectLanguage('这是中文内容', browser)).toBe('zh');
    expect(called).toBe(false);
  });
  it('falls back to the browser detector for Latin text', async () => {
    expect(await detectLanguage('Ceci est une phrase en français.', async () => 'fr')).toBe('fr');
  });
  it('returns undefined for short Latin text or without detector', async () => {
    expect(await detectLanguage('Hello', async () => 'en')).toBeUndefined();
    expect(await detectLanguage('This is English text here')).toBeUndefined();
  });
});

describe('shouldSkipLanguage', () => {
  it('skips target language and never-list', () => {
    expect(shouldSkipLanguage('zh', 'zh-CN', [])).toBe(true);
    expect(shouldSkipLanguage('en', 'zh-CN', [])).toBe(false);
    expect(shouldSkipLanguage('fr', 'zh-CN', ['fr'])).toBe(true);
    expect(shouldSkipLanguage(undefined, 'zh-CN', ['fr'])).toBe(false);
  });
});
