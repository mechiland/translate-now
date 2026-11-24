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

/** A glyph run (one pdf.js text item) placed on the page. */
export interface PdfGlyphs {
  str: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  fs: number;
  fontName: string;
  /** Baseline and font size of the dominant text of the glyph's line. */
  lineBaseline: number;
  lineFs: number;
}

/** A piece of a block's text: a glyph run, or a space/line join added between runs. */
export interface PdfPiece {
  str: string;
  g?: PdfGlyphs;
}

/** List marker ("•", "1.", "(a)") hanging to the left of the item's text. */
export interface PdfMarker {
  text: string;
  /** Left edge of the item's text (the hanging indent), in points. */
  textX: number;
  /** Right edge of the marker (estimated when it shares a glyph run with the text). */
  end: number;
}

export interface PdfBlock {
  text: string;
  /** The text as glyph runs; joined (and whitespace-collapsed) it is `text`. */
  pieces: PdfPiece[];
  rect: PdfRect;
  /** Dominant font size, in points. */
  fontSize: number;
  /** pdf.js font id of the dominant font (to look up bold/italic after rendering). */
  fontName: string;
  lines: number;
  /** Prose worth sending to the model (not math, numbers, author/email lines...). */
  translatable: boolean;
  marker?: PdfMarker;
  /** Lines of different lengths centered on one axis (titles, notices, captions). */
  centered?: boolean;
}

type Glyphs = PdfGlyphs;

interface Line {
  parts: PdfPiece[];
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  baseline: number;
  fs: number;
  fontName: string;
  /** Weight per rounded font size, and per size and font, to find the dominant ones. */
  weights: Map<string, number>;
  last: Glyphs;
}

const CJK = /[぀-ヿ㐀-鿿豈-﫿가-힯＀-￯]/;
const BULLET = /^[•◦▪▫●○■□‣⁃∙·]/;
/** A list marker at the start of a block: a bullet or an enumerator such as "1." or "(a)". */
const LIST_MARKER =
  /^(?:[•◦▪▫●○■□‣⁃∙·–—]|\d{1,2}[.)]|\((?:\d{1,2}|[a-z]|[ivx]{1,4})\)|[a-z][.)])(?=\s|$)/;

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
    lineBaseline: f,
    lineFs: fs,
  };
}

function newLine(g: Glyphs): Line {
  const line: Line = {
    parts: [{ str: g.str, g }],
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
  // Weighted by area: sub/superscripts ("d_model") must not outvote the text around them.
  // Size first (formulas mix fonts of the text's size), then the main font of that size.
  const w = g.str.replace(/\s/g, '').length * g.fs ** 2;
  const size = String(Math.round(g.fs * 10));
  const add = (key: string) => line.weights.set(key, (line.weights.get(key) ?? 0) + w);
  add(size);
  add(`${size}|${g.fontName}`);
  let best = 0;
  for (const [k, v] of line.weights) {
    if (!k.includes('|') && v > best) {
      best = v;
      line.fs = Number(k) / 10;
    }
  }
  best = 0;
  const prefix = `${Math.round(line.fs * 10)}|`;
  for (const [k, v] of line.weights) {
    if (k.startsWith(prefix) && v > best) {
      best = v;
      line.fontName = k.slice(prefix.length);
    }
  }
  // The baseline of the dominant text (superscripts, roots and fractions sit higher/lower).
  if (Math.abs(g.fs - line.fs) < 0.05 * line.fs && line.fontName === g.fontName) {
    line.baseline = g.baseline;
  }
}

/**
 * Whether something other than text (a table's vertical rule) separates two glyph runs
 * between `x0` and `x1`, over the band `top`..`bottom`. All in points.
 */
export type Separated = (x0: number, x1: number, top: number, bottom: number) => boolean;

function continuesLine(line: Line, g: Glyphs, separated?: Separated): boolean {
  const dy = Math.abs(g.baseline - line.baseline);
  if (dy >= 0.8 * Math.max(line.fs, Math.min(g.fs, line.fs * 1.5))) return false;
  const gap = g.x0 - line.x1;
  // Inline fractions step backwards a little; a new line or column jumps back a lot.
  if (gap < -2 * line.fs) return false;
  // Wide gaps separate table cells, figure labels and columns that share a baseline.
  if (gap >= 1.5 * Math.max(line.fs, g.fs)) return false;
  // So does a rule between table cells, however close they are.
  if (gap > 0.25 * line.fs && separated) {
    const top = Math.max(line.top, g.top);
    const bottom = Math.min(line.bottom, g.bottom);
    if (bottom > top && separated(line.x1, g.x0, top, bottom)) return false;
  }
  return true;
}

function addToLine(line: Line, g: Glyphs) {
  const prev = line.parts[line.parts.length - 1]?.str ?? '';
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
    line.parts.push({ str: ' ' });
  }
  line.parts.push({ str: g.str, g });
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
  separated?: Separated,
): Line[] {
  const lines: Line[] = [];
  let line: Line | undefined;
  let pendingSpace = false;
  const push = (l: Line) => {
    for (const p of l.parts) {
      if (!p.g) continue;
      p.g.lineBaseline = l.baseline;
      p.g.lineFs = l.fs;
    }
    lines.push(l);
  };
  for (const item of items) {
    if (typeof item.str !== 'string' || item.str === '') continue;
    if (!/\S/.test(item.str)) {
      pendingSpace = true;
      continue;
    }
    const g = toGlyphs(item, styles, viewportTransform);
    if (!g) continue;
    if (line && continuesLine(line, g, separated)) {
      if (pendingSpace && !/\s$/.test(line.parts[line.parts.length - 1]?.str ?? '')) {
        line.parts.push({ str: ' ' });
      }
      addToLine(line, g);
    } else {
      if (line) push(line);
      line = newLine(g);
    }
    pendingSpace = false;
  }
  if (line) push(line);
  return lines;
}

function lineText(line: Line): string {
  return line.parts
    .map((p) => p.str)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
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

type Join = 'concat' | 'dehyphenate' | 'space';

/** How to join two lines of a paragraph. */
function joinKind(a: string, b: string): Join {
  if (!a || !b) return 'concat';
  const last = a.slice(-1);
  const first = b[0]!;
  if (CJK.test(last) && CJK.test(first)) return 'concat';
  // De-hyphenate "trans- lation", but keep "English- to-German" and "Self- Attention".
  const hyphen = /(\p{L}+)-$/u.exec(a);
  if (hyphen && /^\p{Ll}/u.test(b)) {
    const fragment = hyphen[1]!;
    const nextToken = b.split(/\s/, 1)[0]!;
    if (/^\p{Lu}/u.test(fragment) || nextToken.includes('-')) return 'concat';
    return 'dehyphenate';
  }
  return 'space';
}

function joinLines(a: string, b: string, kind: Join): string {
  if (kind === 'dehyphenate') return a.slice(0, -1) + b;
  return kind === 'space' ? `${a} ${b}` : a + b;
}

/** Apply a line join to the glyph pieces (drops the trailing hyphen when de-hyphenating). */
function joinPieces(pieces: PdfPiece[], next: PdfPiece[], kind: Join) {
  while (pieces.length > 0 && !/\S/.test(pieces[pieces.length - 1]!.str)) pieces.pop();
  if (kind === 'dehyphenate') {
    const last = pieces[pieces.length - 1];
    if (last) {
      const str = last.str.replace(/-\s*$/, '');
      pieces[pieces.length - 1] = { ...last, str };
    }
  } else if (kind === 'space') {
    pieces.push({ str: ' ' });
  }
  pieces.push(...next);
}

/** Text of joined pieces, whitespace collapsed like `PdfBlock.text`. */
export function piecesText(pieces: PdfPiece[]): string {
  return pieces
    .map((p) => p.str)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A leading list marker with a hanging indent: the item's text starts right of the marker
 * on every line. Bullets always count; dashes and enumerators ("1.", "(a)") only with a
 * visible hanging indent, so numbered headings ("1. Introduction") stay plain text.
 */
function findMarker(lines: Line[], text: string, fs: number): PdfMarker | undefined {
  const m = LIST_MARKER.exec(text);
  if (!m) return undefined;
  const first = lines[0]!;
  const bullet = BULLET.test(text);
  let textX: number | undefined;
  if (lines.length >= 2) {
    const bodyX0 = Math.min(...lines.slice(1).map((l) => l.x0));
    if (bodyX0 - first.x0 > 0.3 * fs && bodyX0 - first.x0 < 4 * fs) textX = bodyX0;
    else if (!bullet) return undefined;
  } else if (!bullet) {
    return undefined;
  }
  // The marker is its own glyph run, or shares one with the text that follows.
  const runs = first.parts.filter((p) => p.g && /\S/.test(p.str)).map((p) => p.g!);
  const head = runs[0];
  const own = !!head && head.str.trim() === m[0] && !!runs[1];
  textX ??= own ? runs[1]!.x0 : first.x0 + 1.1 * fs;
  const end = own ? head.x1 : first.x0 + (bullet ? 0.45 : 0.5 * m[0].length) * fs;
  return { text: m[0], textX, end: Math.min(end, textX) };
}

/** Group lines into paragraphs. */
export function buildBlocks(lines: Line[]): PdfBlock[] {
  const typ = typicalGap(lines);
  const blocks: PdfBlock[] = [];
  let cur:
    { lines: Line[]; text: string; pieces: PdfPiece[]; fs: number; fontName: string } | undefined;

  const flush = () => {
    if (!cur) return;
    const ls = cur.lines;
    const x0 = Math.min(...ls.map((l) => l.x0));
    const x1 = Math.max(...ls.map((l) => l.x1));
    const top = Math.min(...ls.map((l) => l.top));
    const bottom = Math.max(...ls.map((l) => l.bottom));
    const text = cur.text.trim();
    const marker = findMarker(ls, text, cur.fs);
    const mid = (x0 + x1) / 2;
    const centered =
      ls.length >= 2 &&
      ls.every((l) => Math.abs((l.x0 + l.x1) / 2 - mid) < 0.5 * cur!.fs) &&
      Math.max(...ls.map((l) => l.x1 - l.x0)) - Math.min(...ls.map((l) => l.x1 - l.x0)) >
        2 * cur.fs;
    blocks.push({
      text,
      pieces: cur.pieces,
      rect: { x: x0, y: top, w: x1 - x0, h: bottom - top },
      fontSize: cur.fs,
      fontName: cur.fontName,
      lines: ls.length,
      translatable: isTranslatableBlock(text),
      ...(marker ? { marker } : {}),
      ...(centered ? { centered } : {}),
    });
    cur = undefined;
  };

  for (const line of lines) {
    const text = lineText(line);
    if (!text) continue;
    if (cur && continuesBlock(cur.lines, cur.fs, line, text, typ, cur.text)) {
      const kind = joinKind(cur.text, text);
      cur.lines.push(line);
      cur.text = joinLines(cur.text, text, kind);
      joinPieces(cur.pieces, line.parts, kind);
      continue;
    }
    flush();
    cur = { lines: [line], text, pieces: [...line.parts], fs: line.fs, fontName: line.fontName };
  }
  flush();
  return blocks;
}

function continuesBlock(
  ls: Line[],
  fs: number,
  line: Line,
  text: string,
  typ: number,
  blockText: string,
): boolean {
  const prev = ls[ls.length - 1]!;
  if (Math.abs(line.fs - fs) > 0.12 * fs) return false;
  // Must be the next line down, with normal line spacing.
  if (line.baseline - prev.baseline < 0.5 * fs) return false;
  if (line.top - prev.bottom > (typ + 0.4) * fs) return false;
  const x0 = Math.min(...ls.map((l) => l.x0));
  const x1 = Math.max(...ls.map((l) => l.x1));
  if (Math.min(x1, line.x1) - Math.max(x0, line.x0) <= 0) return false;
  if (BULLET.test(text)) return false;
  // A footnote starts with a raised mark ("†Work performed while at...").
  const head = line.parts.find((p) => p.g && /\S/.test(p.str))?.g;
  if (head && head.fs < 0.85 * line.fs && line.baseline - head.baseline > 0.12 * line.fs) {
    return false;
  }
  // The next item of a numbered list.
  if (LIST_MARKER.test(text) && LIST_MARKER.test(blockText)) return false;
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
  separated?: Separated,
): PdfBlock[] {
  return buildBlocks(buildLines(items, styles, viewportTransform, separated));
}
