import type { FontFamilyClass, FontInfo } from './fonts';
import { piecesText, type PdfBlock, type PdfGlyphs, type PdfPiece, type PdfRect } from './layout';

/**
 * Inline structure of a paragraph: the style of its body text, plus the runs that differ
 * from it (bold or colored words) and inline formulas.
 *
 * They go to the model with the markers web pages use, so the prompt and the tolerant
 * parsers are shared: styled runs as `<a id="N">...</a>` (translated, then their style is
 * re-applied), formulas as `<m id="N"/>` placeholders (put back exactly as printed).
 */

export type Rgb = readonly [number, number, number];

export interface BaseStyle {
  family: FontFamilyClass;
  bold: boolean;
  color?: Rgb;
}

export interface StyleSpan {
  bold: boolean;
  color?: Rgb;
  mono?: boolean;
  /** Font size relative to the body text, when it differs (inline code is often smaller). */
  size?: number;
}

export interface MathSpan {
  /** Extracted text (what copying the formula from the PDF gives). */
  text: string;
  glyphs: PdfGlyphs[];
  /** Union of the formula's glyph boxes, in points. */
  rect: PdfRect;
  /** Baseline of the line the formula sits on. */
  baseline: number;
}

export interface BlockMarkup {
  base: BaseStyle;
  /**
   * Text sent to the model: `<a id="N">` tags around the runs styled as `styles[N - 1]`,
   * `<m id="N"/>` in place of `formulas[N - 1]`.
   */
  payload: string;
  styles: StyleSpan[];
  formulas: MathSpan[];
}

export interface MarkupOptions {
  /** Ink color of a glyph run, sampled from the rendered page. */
  colorOf?: (g: PdfGlyphs) => Rgb | undefined;
  /** Background behind the paragraph (colors are compared relative to it). */
  bg?: Rgb;
  /** The page's prose is set in TeX's text fonts (see `isTexBody`). */
  texDoc?: boolean;
}

const WHITE: Rgb = [255, 255, 255];

/**
 * Whether two sampled ink colors are the same color. Sampling is approximate: thin glyphs
 * never reach full ink, and canvases may anti-alias text with colored (subpixel) fringes.
 * So colors are compared by direction away from the background, not by distance: black
 * and the dark gray of a thin comma match, black and red or blue don't.
 */
export function sameInk(a: Rgb, b: Rgb, bg: Rgb = WHITE): boolean {
  const va = [a[0] - bg[0], a[1] - bg[1], a[2] - bg[2]];
  const vb = [b[0] - bg[0], b[1] - bg[1], b[2] - bg[2]];
  const la = Math.hypot(va[0]!, va[1]!, va[2]!);
  const lb = Math.hypot(vb[0]!, vb[1]!, vb[2]!);
  if (la < 40 || lb < 40) return Math.abs(la - lb) < 60;
  const cos = (va[0]! * vb[0]! + va[1]! * vb[1]! + va[2]! * vb[2]!) / (la * lb);
  return cos > 0.97;
}

export function cssColor(c: Rgb): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function weight(g: PdfGlyphs): number {
  return g.str.replace(/\s/g, '').length * g.fs;
}

function dominant<T>(items: [T, number][], key: (t: T) => string): T | undefined {
  const sums = new Map<string, { value: T; w: number }>();
  for (const [value, w] of items) {
    const k = key(value);
    const e = sums.get(k);
    if (e) e.w += w;
    else sums.set(k, { value, w });
  }
  let best: { value: T; w: number } | undefined;
  for (const e of sums.values()) if (!best || e.w > best.w) best = e;
  return best?.value;
}

/** Raised or lowered smaller text: sub/superscripts, footnote marks. */
function isScript(g: PdfGlyphs): boolean {
  return g.fs < 0.85 * g.lineFs && Math.abs(g.baseline - g.lineBaseline) > 0.12 * g.lineFs;
}

/** The pieces without the list marker, which stays on the page as printed. */
function bodyPieces(block: PdfBlock): PdfPiece[] {
  const pieces = block.pieces.slice();
  if (!block.marker) return pieces;
  let rest = block.marker.text;
  while (rest && pieces.length > 0) {
    const p = pieces[0]!;
    const str = p.str.replace(/^\s+/, '');
    if (!str) {
      pieces.shift();
      continue;
    }
    if (str.length <= rest.length && rest.startsWith(str)) {
      rest = rest.slice(str.length);
      pieces.shift();
    } else if (str.startsWith(rest)) {
      pieces[0] = { ...p, str: str.slice(rest.length) };
      rest = '';
    } else {
      break;
    }
  }
  return pieces;
}

type Kind =
  { t: 'base' } | { t: 'style'; bold: boolean; color?: Rgb; mono?: boolean } | { t: 'math' };

interface Seg {
  kind: Kind;
  pieces: PdfPiece[];
}

/**
 * Whether the page's prose is set in one of TeX's text fonts (Computer Modern...). Then those
 * fonts are text; otherwise they only show up in formulas ("softmax", digits, parentheses).
 */
export function isTexBody(blocks: PdfBlock[], fontOf: (fontName: string) => FontInfo): boolean {
  const glyphs = blocks.flatMap((b) => b.pieces.flatMap((p) => (p.g ? [p.g] : [])));
  const main = dominant(
    glyphs.map((g) => [g, weight(g)] as [PdfGlyphs, number]),
    (g) => g.fontName,
  );
  return main ? fontOf(main.fontName).tex : false;
}

export function buildMarkup(
  block: PdfBlock,
  fontOf: (fontName: string) => FontInfo,
  { colorOf = () => undefined, bg = WHITE, texDoc = false }: MarkupOptions = {},
): BlockMarkup {
  const pieces = bodyPieces(block);
  const glyphs = pieces.filter((p) => p.g && /\S/.test(p.str)).map((p) => p.g!);
  const mainFont = dominant(
    glyphs.map((g) => [g, weight(g)] as [PdfGlyphs, number]),
    (g) => g.fontName,
  );
  const isMath = (g: PdfGlyphs) => {
    const f = fontOf(g.fontName);
    return f.math === 'symbol' || (f.math === 'upright' && !texDoc) || isScript(g);
  };

  const text = glyphs.filter((g) => !isMath(g));
  const famOf = dominant(
    text.map((g) => [fontOf(g.fontName).family, weight(g)] as [FontFamilyClass, number]),
    (f) => f,
  );
  const boldOf = dominant(
    text.map((g) => [fontOf(g.fontName).bold, weight(g)] as [boolean, number]),
    String,
  );
  const colorWeights: [Rgb, number][] = [];
  for (const g of text) {
    const c = colorOf(g);
    if (c) colorWeights.push([c, weight(g)]);
  }
  // Group similar colors (anti-aliasing makes every sample a little different).
  const color = dominant(colorWeights, (c) => {
    const near = colorWeights.find(([o]) => sameInk(o, c, bg));
    return near ? near[0].join() : c.join();
  });
  const base: BaseStyle = {
    family: famOf ?? (mainFont ? fontOf(mainFont.fontName).family : 'sans'),
    bold: boldOf ?? false,
    ...(color ? { color } : {}),
  };

  const plain = piecesText(pieces);
  // Text that already contains our tags can't carry markers without ambiguity.
  if (/<\/?[am]\b/i.test(plain)) return { base, payload: plain, styles: [], formulas: [] };

  const kindOf = (g: PdfGlyphs): Kind => {
    if (isMath(g)) return { t: 'math' };
    const f = fontOf(g.fontName);
    const c = colorOf(g);
    const bold = f.bold !== base.bold;
    const colored = !!c && !!base.color && !sameInk(c, base.color, bg);
    // Inline code in a prose paragraph.
    const mono = f.family === 'mono' && base.family !== 'mono';
    if (!bold && !colored && !mono) return { t: 'base' };
    return {
      t: 'style',
      bold: f.bold,
      ...(colored ? { color: c } : {}),
      ...(mono ? { mono } : {}),
    };
  };
  const sameKind = (a: Kind, b: Kind, prev: PdfGlyphs | undefined, g: PdfGlyphs) => {
    if (a.t !== b.t) return false;
    if (a.t === 'math') {
      // Next to each other: same line, or a stacked part (fraction, limits) right beside.
      // A line break jumps back to the left margin and starts a new formula.
      if (!prev) return false;
      const fs = Math.max(g.lineFs, prev.lineFs);
      const gap = g.x0 - prev.x1;
      return gap > -1.5 * fs && gap < fs && Math.abs(prev.lineBaseline - g.lineBaseline) < 1.2 * fs;
    }
    if (a.t === 'style' && b.t === 'style') {
      if (a.bold !== b.bold || !a.color !== !b.color || !a.mono !== !b.mono) return false;
      return !a.color || !b.color || sameInk(a.color, b.color, bg);
    }
    return true;
  };

  const segs: Seg[] = [];
  let pendingWs: PdfPiece[] = [];
  let prevGlyph: PdfGlyphs | undefined;
  for (const p of pieces) {
    if (!p.g || !/\S/.test(p.str)) {
      pendingWs.push(p);
      continue;
    }
    const kind = kindOf(p.g);
    const last = segs[segs.length - 1];
    if (last && sameKind(last.kind, kind, prevGlyph, p.g)) {
      last.pieces.push(...pendingWs, p);
    } else {
      if (last) last.pieces.push(...pendingWs);
      else if (pendingWs.length) segs.push({ kind: { t: 'base' }, pieces: pendingWs });
      segs.push({ kind, pieces: [p] });
    }
    pendingWs = [];
    prevGlyph = p.g;
  }
  segs[segs.length - 1]?.pieces.push(...pendingWs);

  // Punctuation set in a math font ("§2, 3") reads as text: no need for a formula.
  for (const seg of segs) {
    if (
      seg.kind.t === 'math' &&
      !/[^\s.,;:!?'"()[\]§¶-]/.test(seg.pieces.map((p) => p.str).join(''))
    ) {
      seg.kind = { t: 'base' };
    }
  }

  const styles: StyleSpan[] = [];
  const formulas: MathSpan[] = [];
  let out = '';
  for (const seg of segs) {
    const raw = seg.pieces.map((p) => p.str).join('');
    if (seg.kind.t === 'base') {
      out += raw;
      continue;
    }
    const inner = raw.trim();
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const trail = raw.slice(raw.trimEnd().length);
    const gs = seg.pieces.filter((p) => p.g && /\S/.test(p.str)).map((p) => p.g!);
    if (seg.kind.t === 'style') {
      const size = Math.round((Math.max(...gs.map((g) => g.fs)) / block.fontSize) * 100) / 100;
      styles.push({
        bold: seg.kind.bold,
        ...(seg.kind.color ? { color: seg.kind.color } : {}),
        ...(seg.kind.mono ? { mono: true } : {}),
        ...(Math.abs(size - 1) > 0.05 && size > 0.5 && size < 2 ? { size } : {}),
      });
      out += `${lead}<a id="${styles.length}">${inner}</a>${trail}`;
    } else {
      const x0 = Math.min(...gs.map((g) => g.x0));
      const x1 = Math.max(...gs.map((g) => g.x1));
      const top = Math.min(...gs.map((g) => g.top));
      const bottom = Math.max(...gs.map((g) => g.bottom));
      formulas.push({
        text: inner.replace(/\s+/g, ' '),
        glyphs: gs,
        rect: { x: x0, y: top, w: x1 - x0, h: bottom - top },
        baseline: gs[0]!.lineBaseline,
      });
      out += `${lead}<m id="${formulas.length}"/>${trail}`;
    }
  }
  if (styles.length + formulas.length === 0) return { base, payload: plain, styles, formulas };
  return { base, payload: out.replace(/\s+/g, ' ').trim(), styles, formulas };
}

/** Prose left once formulas are taken out: a block that is mostly math needs no translation. */
export function hasProse(markup: BlockMarkup): boolean {
  const text = markup.payload
    .replace(/<m id="\d+"\/>/g, ' ')
    .replace(/<a id="\d+">([\s\S]*?)<\/a>/g, '$1');
  return (text.match(/\p{L}{2,}/gu) ?? []).join('').length >= 4;
}
