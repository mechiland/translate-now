import { describe, expect, it } from 'vitest';
import { classifyFont, type FontInfo } from '@/lib/pdf/fonts';
import { extractBlocks, type PdfGlyphs, type TextItemLike } from '@/lib/pdf/layout';
import { buildMarkup, hasProse, isTexBody, sameInk, type Rgb } from '@/lib/pdf/runs';

const VT = [1, 0, 0, -1, 0, 792];
const FONTS: Record<string, string> = {
  body: 'AECCXO+NimbusRomNo9L-Regu',
  bold: 'RCUMTF+NimbusRomNo9L-Medi',
  mi: 'LICAEO+CMMI10',
  mi7: 'FRDAXA+CMMI7',
  sy: 'NSOWGJ+CMSY10',
  r: 'FUIULY+CMR10',
  tt: 'XEXHSJ+SFTT1000',
};
const STYLES = Object.fromEntries(
  Object.keys(FONTS).map((k) => [k, { ascent: 0.7, descent: -0.2 }]),
);
const fontOf = (id: string): FontInfo => classifyFont({ name: FONTS[id] ?? id });

/** A text item at PDF coordinates (x, baseline y), ~0.5em per character. */
function item(str: string, x: number, y: number, fs = 10, fontName = 'body'): TextItemLike {
  return { str, transform: [fs, 0, 0, fs, x, y], width: str.length * fs * 0.5, fontName };
}

/**
 * Items laid out left to right on one baseline, a space apart; sub/superscripts (`rise`)
 * and punctuation attach to the run before them.
 */
function line(y: number, runs: [string, string?, number?, number?][], x = 100): TextItemLike[] {
  const out: TextItemLike[] = [];
  for (const [str, font = 'body', fs = 10, rise = 0] of runs) {
    if (out.length > 0 && (rise || /^[,.;:]/.test(str))) x -= 2.5;
    const it = item(str, x, y + rise, fs, font);
    out.push(it);
    x += it.width + 2.5;
  }
  return out;
}

function markup(items: TextItemLike[], opts: Parameters<typeof buildMarkup>[2] = {}) {
  const [block] = extractBlocks(items, STYLES, VT);
  return buildMarkup(block!, fontOf, opts);
}

describe('buildMarkup', () => {
  it('tags a bold run-in heading and keeps the body style', () => {
    const m = markup(line(700, [['Encoder:', 'bold'], ['The encoder is composed of six layers.']]));
    expect(m.base).toEqual({ family: 'serif', bold: false });
    expect(m.payload).toBe('<a id="1">Encoder:</a> The encoder is composed of six layers.');
    expect(m.styles).toEqual([{ bold: true }]);
    expect(m.formulas).toEqual([]);
  });

  it('turns math fonts and subscripts into one formula each', () => {
    const m = markup(
      line(700, [
        ['queries of dimension'],
        ['d', 'mi'],
        ['k', 'mi7', 7, -1.5],
        [', a stack of'],
        ['N', 'mi'],
        ['=', 'r'],
        ['6', 'r'],
        ['identical layers.'],
      ]),
    );
    expect(m.payload).toBe(
      'queries of dimension <m id="1"/>, a stack of <m id="2"/> identical layers.',
    );
    expect(m.formulas.map((f) => f.text)).toEqual(['dk', 'N = 6']);
    const dk = m.formulas[0]!;
    expect(dk.glyphs.map((g: PdfGlyphs) => g.str)).toEqual(['d', 'k']);
    expect(dk.baseline).toBeCloseTo(92);
    expect(dk.rect.x).toBeCloseTo(dk.glyphs[0]!.x0);
  });

  it('treats a raised footnote mark in the text font as a formula', () => {
    const m = markup(
      line(700, [['4', 'body', 7, 3], ['To illustrate why the products get large.']]),
    );
    expect(m.payload).toBe('<m id="1"/> To illustrate why the products get large.');
  });

  it('treats TeX text fonts as prose when the page is set in them', () => {
    const items = line(700, [
      ['The flow exists for all time', 'r'],
      ['t', 'mi'],
      ['here.', 'r'],
    ]);
    const blocks = extractBlocks(items, STYLES, VT);
    expect(isTexBody(blocks, fontOf)).toBe(true);
    const m = buildMarkup(blocks[0]!, fontOf, { texDoc: true });
    expect(m.payload).toBe('The flow exists for all time <m id="1"/> here.');
    expect(m.base.family).toBe('serif');
  });

  it('leaves punctuation set in a math font as text', () => {
    const m = markup(line(700, [['In §2'], [',', 'mi'], ['3 we prove the theorem.']]));
    expect(m.formulas).toEqual([]);
  });

  it('drops the list marker from the text', () => {
    const items = [
      { ...item('• In encoder-decoder attention layers, the queries come', 100, 700), width: 400 },
      item('from the decoder.', 112, 688),
    ];
    const m = markup(items);
    expect(m.payload).toBe(
      'In encoder-decoder attention layers, the queries come from the decoder.',
    );
  });

  it('tags colored runs and inline code; sampling noise is not a color', () => {
    const black: Rgb = [0, 0, 0];
    const red: Rgb = [220, 30, 30];
    const colorOf = (g: PdfGlyphs): Rgb =>
      g.str === 'only transient errors' ? red : g.str === ',' ? [60, 30, 60] : black;
    const m = markup(
      line(700, [
        ['Retries cover'],
        ['only transient errors'],
        [','],
        ['use'],
        ['--config', 'tt', 9],
        ['to change it.'],
      ]),
      { colorOf },
    );
    expect(m.base.color).toEqual(black);
    expect(m.payload).toBe(
      'Retries cover <a id="1">only transient errors</a>, use <a id="2">--config</a> to change it.',
    );
    expect(m.styles).toEqual([
      { bold: false, color: red },
      { bold: false, mono: true, size: 0.9 },
    ]);
  });

  it('sends text that already contains tags as plain text', () => {
    const m = markup(line(700, [['Use the <a id="1"> tag for'], ['x', 'mi'], ['here.']]));
    expect(m.formulas).toEqual([]);
    expect(m.payload).toBe('Use the <a id="1"> tag for x here.');
  });
});

describe('hasProse', () => {
  it('is false when formulas are all there is', () => {
    expect(
      hasProse(
        markup(
          line(700, [
            ['log', 'r'],
            ['p', 'mi'],
            ['(x|y)', 'r'],
          ]),
        ),
      ),
    ).toBe(false);
    expect(hasProse(markup(line(700, [['where'], ['x', 'mi'], ['is the input.']])))).toBe(true);
  });
});

describe('sameInk', () => {
  it('compares colors by hue, not by how much ink a glyph got', () => {
    expect(sameInk([0, 0, 0], [110, 110, 110])).toBe(true);
    expect(sameInk([12, 0, 12], [0, 0, 0])).toBe(true);
    expect(sameInk([0, 0, 0], [255, 0, 0])).toBe(false);
    expect(sameInk([0, 0, 0], [29, 78, 216])).toBe(false);
    expect(sameInk([0, 0, 0], [127, 0, 0])).toBe(false);
    expect(sameInk([255, 255, 255], [250, 250, 250], [0, 0, 0])).toBe(true);
  });
});
