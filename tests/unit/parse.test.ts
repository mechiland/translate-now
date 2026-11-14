import { describe, expect, it } from 'vitest';
import { cleanModelOutput, cleanSelectionOutput, parseSegments } from '@/lib/translate/parse';

describe('parseSegments', () => {
  it('parses well-formed output', () => {
    const raw = '<seg id="1">你好</seg>\n<seg id="2">世界</seg>';
    expect(parseSegments(raw, 2)).toEqual(['你好', '世界']);
  });

  it('handles out-of-order segments', () => {
    const raw = '<seg id="2">B</seg><seg id="1">A</seg>';
    expect(parseSegments(raw, 2)).toEqual(['A', 'B']);
  });

  it('marks missing segments as undefined', () => {
    const raw = '<seg id="1">A</seg><seg id="3">C</seg>';
    expect(parseSegments(raw, 3)).toEqual(['A', undefined, 'C']);
  });

  it('ignores extra / out-of-range segments and duplicates', () => {
    const raw = '<seg id="1">A</seg><seg id="1">A2</seg><seg id="2">B</seg><seg id="9">X</seg>';
    expect(parseSegments(raw, 2)).toEqual(['A', 'B']);
  });

  it('tolerates chatter around the segments and markdown fences', () => {
    const raw =
      'Sure! Here is the translation:\n```xml\n<seg id="1">A</seg>\n<seg id="2">B</seg>\n```';
    expect(parseSegments(raw, 2)).toEqual(['A', 'B']);
  });

  it('tolerates single quotes, unquoted ids and missing closing tags', () => {
    const raw = "<seg id='1'>A<seg id=2>B";
    expect(parseSegments(raw, 2)).toEqual(['A', 'B']);
  });

  it('strips <think> reasoning blocks', () => {
    const raw = '<think>The user wants <seg id="1">x</seg>…</think><seg id="1">好</seg>';
    expect(parseSegments(raw, 1)).toEqual(['好']);
  });

  it('accepts a bare reply for a single segment', () => {
    expect(parseSegments('  你好世界 ', 1)).toEqual(['你好世界']);
  });

  it('does not accept a bare reply for multiple segments', () => {
    expect(parseSegments('你好 世界', 2)).toEqual([undefined, undefined]);
  });

  it('keeps line breaks inside a segment', () => {
    expect(parseSegments('<seg id="1">第一行\n第二行</seg>', 1)).toEqual(['第一行\n第二行']);
  });

  it('treats empty segments as missing', () => {
    expect(parseSegments('<seg id="1"></seg><seg id="2">B</seg>', 2)).toEqual([undefined, 'B']);
  });
});

describe('cleanModelOutput / cleanSelectionOutput', () => {
  it('removes fences', () => {
    expect(cleanModelOutput('```\nhello\n```')).toBe('hello');
  });
  it('removes stray seg tags from selection output', () => {
    expect(cleanSelectionOutput('<seg id="1">你好</seg>')).toBe('你好');
  });
});
