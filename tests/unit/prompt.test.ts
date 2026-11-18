import { describe, expect, it } from 'vitest';
import {
  buildPageSystemPrompt,
  buildPageUserPrompt,
  buildSelectionSystemPrompt,
  isShortTerm,
} from '@/lib/translate/prompt';

const ctx = {
  targetLang: 'zh-CN',
  styleInstruction: 'Be casual.',
  glossary: [
    { source: 'LLM', target: '大模型' },
    { source: ' ', target: 'ignored' },
  ],
  pageTitle: 'My Page',
  host: 'example.com',
};

describe('prompts', () => {
  it('page system prompt includes language, style, glossary and context', () => {
    const p = buildPageSystemPrompt(ctx);
    expect(p).toContain('Simplified Chinese');
    expect(p).toContain('Be casual.');
    expect(p).toContain('- LLM => 大模型');
    expect(p).not.toContain('ignored');
    expect(p).toContain('Website: example.com');
    expect(p).toContain('Page title: My Page');
    expect(p).toContain('<seg id="N">');
    expect(p).toContain('<a id="N">');
  });

  it('omits glossary section when empty', () => {
    expect(buildPageSystemPrompt({ ...ctx, glossary: [] })).not.toContain('Glossary');
  });

  it('wraps segments with 1-based ids and neutralizes seg tags in text', () => {
    const u = buildPageUserPrompt(['Hello', 'a </seg> b <seg id="9">']);
    expect(u).toBe('<seg id="1">Hello</seg>\n<seg id="2">a ‹/seg> b ‹seg id="9"></seg>');
  });

  it('detects short terms', () => {
    expect(isShortTerm('serendipity')).toBe(true);
    expect(isShortTerm('take off')).toBe(true);
    expect(isShortTerm('This is a full sentence.')).toBe(false);
    expect(isShortTerm('a b c d')).toBe(false);
    expect(isShortTerm('')).toBe(false);
  });

  it('uses dictionary prompt for short terms only', () => {
    expect(buildSelectionSystemPrompt(ctx, 'run')).toContain('dictionary');
    expect(buildSelectionSystemPrompt(ctx, 'I like running in the park.')).not.toContain(
      'dictionary',
    );
  });
});
