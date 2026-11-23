import { isTranslatableText } from '../dom/segmenter';

/**
 * Groups pdf.js text items into paragraphs ("blocks") with their position on the page.
 *
 * PDFs have no paragraphs, only positioned glyph runs. Items are first joined into lines
 * (same baseline, continuing to the right), then lines into blocks (same font size, normal
 * line spacing, overlapping horizontally, no paragraph-end cues). Content-stream order is
 * kept, which is reading order for practically every generated PDF (LaTeX, Word, browsers).
 */

/** The parts of a pdf.js `TextItem` we use. */
export interface TextItemLike {
  str: string;
  /** Text-space to user-space matrix [a, b, c, d, e, f]. */
  transform: number[];
  /** Advance width in user-space units. */
  width: number;
  fontName: string;
}

export interface FontMetrics {
  ascent?: number;
  descent?: number;
  vertical?: boolean;
}

/** Rectangle in viewport units at scale 1 (PDF points), y pointing down. */
export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfBlock {
  text: string;
  rect: PdfRect;
  /** Dominant font size, in points. */
  fontSize: number;
  /** pdf.js font id of the dominant font (to look up bold/italic after rendering). */
  fontName: string;
  lines: number;
  /** Prose worth sending to the model (not math, numbers, author/email lines...). */
  translatable: boolean;
}

interface Glyphs {
  str: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  fs: number;
  fontName: string;
}

interface Line {
  parts: string[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  fs: number;
  fontName: string;
  /** Characters per rounded font size / font, to find the dominant one. */
  weights: Map<string, number>;
  last: Glyphs;
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯＀-￯]/;
const BULLET = /^[•◦▪▫●○■□‣⁃∙·]/;

function multiply(m: number[], n: number[]): number[] {
  return [
    m[0]! * n[0]! + m[2]! * n[1]!,
    m[1]! * n[0]! + m[3]! * n[1]!,
    m[0]! * n[2]! + m[2]! * n[3]!,
    m[1]! * n[2]! + m[3]! * n[3]!,
    m[0]! * n[4]! + m[2]! * n[5]! + m[4]!,
    m[1]! * n[4]! + m[3]! * n[5]! + m[5]!,
  ];
}

function toGlyphs(
  item: TextItemLike,
  styles: Record<string, FontMetrics | undefined>,
  viewportTransform: number[],
): Glyphs | undefined {
  const style = styles[item.fontName];
  if (style?.vertical) return undefined;
  const m = multiply(viewportTransform, item.transform);
  const [a, b, c, d, e, f] = m as [number, number, number, number, number, number];
  // Horizontal, left-to-right text only (skips rotated margin stamps such as arXiv ids).
  if (a <= 0 || Math.abs(b) > Math.abs(a) * 0.05 || Math.abs(c) > Math.abs(d) * 0.05) {
    return undefined;
  }
  const fs = Math.hypot(c, d);
  if (!(fs > 0.5)) return undefined;
  // The viewport may scale; item.width is in user space.
  const sx = Math.hypot(viewportTransform[0]!, viewportTransform[1]!);
  const ascent = Math.min(1, Math.max(0.6, style?.ascent ?? 0.8));
  const descent = Math.min(0.4, Math.max(0.1, Math.abs(style?.descent ?? 0.2)));
  return {
    str: item.str,
    x0: e,
    x1: e + Math.max(0, item.width) * sx,
    top: f - ascent * fs,
    bottom: f + descent * fs,
    baseline: f,
    fs,
    fontName: item.fontName,
  };
}

function newLine(g: Glyphs): Line {
  const line: Line = {
    parts: [g.str],
    x0: g.x0,
    x1: g.x1,
    top: g.top,
    bottom: g.bottom,
    baseline: g.baseline,
    fs: g.fs,
    fontName: g.fontName,
    weights: new Map(),
    last: g,
  };
  weigh(line, g);
  return line;
}

function weigh(line: Line, g: Glyphs) {
  const key = `${Math.round(g.fs * 10)}|${g.fontName}`;
  const n = (line.weights.get(key) ?? 0) + g.str.replace(/\s/g, '').length;
  line.weights.set(key, n);
  let best = 0;
  for (const [k, v] of line.weights) {
    if (v > best) {
      best = v;
      const [size, font] = k.split('|');
      line.fs = Number(size) / 10;
      line.fontName = font!;
    }
  }
  // The baseline of the dominant text (superscripts, roots and fractions sit higher/lower).
  if (Math.abs(g.fs - line.fs) < 0.05 * line.fs && line.fontName === g.fontName) {
    line.baseline = g.baseline;
  }
}

function continuesLine(line: Line, g: Glyphs): boolean {
  const dy = Math.abs(g.baseline - line.baseline);
  if (dy >= 0.8 * Math.max(line.fs, Math.min(g.fs, line.fs * 1.5))) return false;
  const gap = g.x0 - line.x1;
  // Inline fractions step backwards a little; a new line or column jumps back a lot.
  if (gap < -2 * line.fs) return false;
  // Wide gaps separate table cells, figure labels and columns that share a baseline.
  return gap < 1.5 * Math.max(line.fs, g.fs);
}

function addToLine(line: Line, g: Glyphs) {
  const prev = line.parts[line.parts.length - 1] ?? '';
  const gap = g.x0 - line.last.x1;
  const prevChar = prev.slice(-1);
  const nextChar = g.str[0] ?? '';
  if (
    gap > 0.2 * Math.min(line.fs, g.fs) &&
    prevChar &&
    !/\s/.test(prevChar) &&
    !/\s/.test(nextChar) &&
    !(CJK.test(prevChar) && CJK.test(nextChar))
  ) {
    line.parts.push(' ');
  }
  line.parts.push(g.str);
  line.x0 = Math.min(line.x0, g.x0);
  line.x1 = Math.max(line.x1, g.x1);
  line.top = Math.min(line.top, g.top);
  line.bottom = Math.max(line.bottom, g.bottom);
  line.last = g;
  weigh(line, g);
}

/** Join items into lines in content-stream order. */
export function buildLines(
  items: TextItemLike[],
  styles: Record<string, FontMetrics | undefined>,
  viewportTransform: number[],
): Line[] {
  const lines: Line[] = [];
  let line: Line | undefined;
  let pendingSpace = false;
  for (const item of items) {
    if (typeof item.str !== 'string' || item.str === '') continue;
    if (!/\S/.test(item.str)) {
      pendingSpace = true;
      continue;
    }
    const g = toGlyphs(item, styles, viewportTransform);
    if (!g) continue;
    if (line && continuesLine(line, g)) {
      if (pendingSpace && !/\s$/.test(line.parts[line.parts.length - 1] ?? '')) {
        line.parts.push(' ');
      }
      addToLine(line, g);
    } else {
      if (line) lines.push(line);
      line = newLine(g);
    }
    pendingSpace = false;
  }
  if (line) lines.push(line);
  return lines;
}

function lineText(line: Line): string {
  return line.parts.join('').replace(/\s+/g, ' ').trim();
}

function quantile(values: number[], q: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Typical gap between consecutive lines of a paragraph on this page, relative to font size. */
function typicalGap(lines: Line[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i - 1]!;
    const l = lines[i]!;
    if (Math.abs(l.fs - p.fs) > 0.1 * p.fs) continue;
    const step = l.baseline - p.baseline;
    if (step <= 0.5 * p.fs || step > 2.5 * p.fs) continue;
    if (Math.min(l.x1, p.x1) - Math.max(l.x0, p.x0) <= 0) continue;
    gaps.push((l.top - p.bottom) / p.fs);
  }
  return Math.max(0, quantile(gaps, 0.3) ?? 0.25);
}

function joinLines(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  const last = a.slice(-1);
  const first = b[0]!;
  if (CJK.test(last) && CJK.test(first)) return a + b;
  // De-hyphenate "trans- lation", but keep "English- to-German" and "Self- Attention".
  const hyphen = /(\p{L}+)-$/u.exec(a);
  if (hyphen && /^\p{Ll}/u.test(b)) {
    const fragment = hyphen[1]!;
    const nextToken = b.split(/\s/, 1)[0]!;
    if (/^\p{Lu}/u.test(fragment) || nextToken.includes('-')) return a + b;
    return a.slice(0, -1) + b;
  }
  return `${a} ${b}`;
}

/** Group lines into paragraphs. */
export function buildBlocks(lines: Line[]): PdfBlock[] {
  const typ = typicalGap(lines);
  const blocks: PdfBlock[] = [];
  let cur: { lines: Line[]; text: string; fs: number; fontName: string } | undefined;

  const flush = () => {
    if (!cur) return;
    const ls = cur.lines;
    const x0 = Math.min(...ls.map((l) => l.x0));
    const x1 = Math.max(...ls.map((l) => l.x1));
    const top = Math.min(...ls.map((l) => l.top));
    const bottom = Math.max(...ls.map((l) => l.bottom));
    const text = cur.text.trim();
    blocks.push({
      text,
      rect: { x: x0, y: top, w: x1 - x0, h: bottom - top },
      fontSize: cur.fs,
      fontName: cur.fontName,
      lines: ls.length,
      translatable: isTranslatableBlock(text),
    });
    cur = undefined;
  };

  for (const line of lines) {
    const text = lineText(line);
    if (!text) continue;
    if (cur && continuesBlock(cur.lines, cur.fs, line, text, typ)) {
      cur.lines.push(line);
      cur.text = joinLines(cur.text, text);
      continue;
    }
    flush();
    cur = { lines: [line], text, fs: line.fs, fontName: line.fontName };
  }
  flush();
  return blocks;
}

function continuesBlock(ls: Line[], fs: number, line: Line, text: string, typ: number): boolean {
  const prev = ls[ls.length - 1]!;
  if (Math.abs(line.fs - fs) > 0.12 * fs) return false;
  // Must be the next line down, with normal line spacing.
  if (line.baseline - prev.baseline < 0.5 * fs) return false;
  if (line.top - prev.bottom > (typ + 0.4) * fs) return false;
  const x0 = Math.min(...ls.map((l) => l.x0));
  const x1 = Math.max(...ls.map((l) => l.x1));
  if (Math.min(x1, line.x1) - Math.max(x0, line.x0) <= 0) return false;
  if (BULLET.test(text)) return false;
  // Centered text (titles, author blocks, captions): line lengths vary freely.
  const center = (a: number, b: number) => (a + b) / 2;
  const blockCenter = center(x0, x1);
  if (
    Math.abs(center(prev.x0, prev.x1) - blockCenter) < 0.5 * fs &&
    Math.abs(center(line.x0, line.x1) - blockCenter) < 0.5 * fs &&
    Math.abs(line.x1 - line.x0 - (prev.x1 - prev.x0)) > 2 * fs
  ) {
    return true;
  }
  // The previous line ended although the next line's first word would have fit after it:
  // a paragraph break (works for justified and ragged-right text alike).
  const room = Math.max(x1, line.x1) - prev.x1;
  const charW = (line.x1 - line.x0) / Math.max(1, text.length);
  const firstWord = (text.split(' ', 1)[0] ?? '').length * charW;
  if (room > Math.max(firstWord + 0.5 * fs, 1.5 * fs)) return false;
  // Starts far left of the block: a different text column or element.
  if (line.x0 < x0 - 3 * fs) return false;
  // First-line indent of a new paragraph (lines after the first set the body's left edge).
  if (ls.length >= 2) {
    const bodyX0 = Math.min(...ls.slice(1).map((l) => l.x0));
    if (line.x0 > bodyX0 + 0.8 * fs) return false;
  }
  return true;
}

/** Prose worth translating: skips math, numbers, author/email lines and symbol soup. */
export function isTranslatableBlock(text: string): boolean {
  if (!isTranslatableText(text)) return false;
  if (CJK.test(text)) return true;
  if (/^[\d\s.,:;()[\]%+\-–—/×·∗*†‡§]+$/.test(text)) return false;
  // Bibliography entries ("[12] A. Author. Title. Venue, 2017.") gain nothing from translation.
  if (/^\[\d{1,3}\]\s/.test(text)) return false;
  const words = text.match(/\b[A-Za-z][a-z]{2,}\b/g)?.length ?? 0;
  // Author lines: names, affiliations and email addresses.
  if (/\S+@\S+\.\w+/.test(text) && words < 12) return false;
  // Display equations such as "Attention(Q, K, V) = softmax(QKᵀ/√dk)V (1)".
  if (/[=<>≤≥≈∈∑∏∫√]/.test(text) && words < 3) return false;
  const tokens = text.split(/\s+/).filter(Boolean);
  const wordy = tokens.filter(
    (t) => /\p{L}{2,}/u.test(t) && (t.match(/\p{L}/gu)?.length ?? 0) >= t.length * 0.6,
  ).length;
  return words >= 1 && wordy >= tokens.length * 0.5;
}

export function extractBlocks(
  items: TextItemLike[],
  styles: Record<string, FontMetrics | undefined>,
  viewportTransform: number[],
): PdfBlock[] {
  return buildBlocks(buildLines(items, styles, viewportTransform));
}
