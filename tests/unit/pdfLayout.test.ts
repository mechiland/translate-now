import { describe, expect, it } from 'vitest';
import {
  extractBlocks,
  isTranslatableBlock,
  piecesText,
  type TextItemLike,
} from '@/lib/pdf/layout';

/** Viewport transform of a US Letter page at scale 1 (flips y). */
const VT = [1, 0, 0, -1, 0, 792];
const STYLES = { body: { ascent: 0.7, descent: -0.2 }, bold: { ascent: 0.7, descent: -0.2 } };

/** A text item at PDF coordinates (x, baseline y), ~0.5em per character. */
function item(str: string, x: number, y: number, fs = 10, fontName = 'body'): TextItemLike {
  return { str, transform: [fs, 0, 0, fs, x, y], width: str.length * fs * 0.5, fontName };
}

/** Justified lines of a paragraph: every line spans 100..500 except where given. */
function para(lines: string[], top: number, opts: { step?: number; x?: number } = {}) {
  const step = opts.step ?? 12;
  return lines.map((text, i) => {
    const it = item(text, opts.x ?? 100, top - i * step);
    if (i < lines.length - 1) it.width = 400 - ((opts.x ?? 100) - 100);
    return it;
  });
}

const blocks = (items: TextItemLike[]) => extractBlocks(items, STYLES, VT);

describe('extractBlocks', () => {
  it('joins the lines of a paragraph, de-hyphenating split words', () => {
    const out = blocks(
      para(
        [
          'The dominant sequence transduction models are based on complex',
          'recurrent networks. We propose a new simple network archi-',
          'tecture based solely on attention.',
        ],
        700,
      ),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toBe(
      'The dominant sequence transduction models are based on complex recurrent networks. We propose a new simple network architecture based solely on attention.',
    );
    expect(out[0]!.lines).toBe(3);
    expect(out[0]!.fontSize).toBeCloseTo(10);
    // y is measured from the top of the page.
    expect(out[0]!.rect.x).toBe(100);
    expect(out[0]!.rect.y).toBeCloseTo(792 - 700 - 7);
    expect(out[0]!.rect.w).toBeCloseTo(400);
    expect(out[0]!.rect.h).toBeCloseTo(24 + 9);
  });

  it('keeps hyphens in compounds', () => {
    const out = blocks(
      para(['results on the English-', 'to-German task, and Self-', 'attention'], 700),
    );
    expect(out[0]!.text).toBe('results on the English-to-German task, and Self-attention');
  });

  it('splits paragraphs separated by extra space', () => {
    const out = blocks([
      ...para(['First paragraph line one goes here', 'and it ends here.'], 700),
      ...para(['Second paragraph starts after a gap', 'and continues here.'], 670),
    ]);
    expect(out.map((b) => b.text)).toEqual([
      'First paragraph line one goes here and it ends here.',
      'Second paragraph starts after a gap and continues here.',
    ]);
  });

  it('splits on a short last line and on a first-line indent without extra space', () => {
    const out = blocks([
      ...para(['A paragraph whose last line is short and', 'ends early.'], 700),
      ...para(['The next one follows directly below without', 'any extra spacing at all.'], 676),
      { ...item('An indented first line starts a new', 115, 652), width: 385 },
      ...para(['paragraph too, even though the previous line', 'was full.'], 640),
    ]);
    expect(out.map((b) => b.text.split(' ').slice(0, 2).join(' '))).toEqual([
      'A paragraph',
      'The next',
      'An indented',
    ]);
  });

  it('separates headings by font size and keeps superscripts on their line', () => {
    const out = blocks([
      item('1 Introduction', 100, 720, 12, 'bold'),
      item('Recurrent neural networks', 100, 700),
      item('13', 228, 704, 7),
      item('are used widely.', 240, 700),
    ]);
    expect(out.map((b) => b.text)).toEqual([
      '1 Introduction',
      'Recurrent neural networks 13 are used widely.',
    ]);
    expect(out[0]!.fontSize).toBeCloseTo(12);
    expect(out[0]!.fontName).toBe('bold');
  });

  it('splits text that shares a baseline but is far apart (figure labels, table cells)', () => {
    const out = blocks([
      item('Scaled Dot-Product Attention', 148, 700),
      item(' ', 290, 700),
      item('Multi-Head Attention', 364, 700),
    ]);
    expect(out.map((b) => b.text)).toEqual([
      'Scaled Dot-Product Attention',
      'Multi-Head Attention',
    ]);
  });

  it('ignores rotated text such as margin stamps', () => {
    const stamp: TextItemLike = {
      str: 'arXiv:1706.03762v7 [cs.CL] 2 Aug 2023',
      transform: [0, 20, -20, 0, 32, 237],
      width: 341,
      fontName: 'body',
    };
    expect(blocks([stamp])).toEqual([]);
  });

  it('keeps centered lines of different length together', () => {
    const out = blocks([
      item('Provided proper attribution is provided, Google grants', 160, 700),
      item('permission to reproduce the tables.', 210, 688),
    ]);
    expect(out).toHaveLength(1);
  });

  it('starts a new block at each bullet', () => {
    const out = blocks([
      ...para(
        ['• In encoder-decoder attention layers, the queries come', 'from the decoder.'],
        700,
      ),
      ...para(
        ['• The encoder contains self-attention layers in which', 'all keys come from one place.'],
        676,
      ),
    ]);
    expect(out).toHaveLength(2);
  });

  it('keeps the glyph runs behind the text, without the hyphen of a split word', () => {
    const out = blocks(
      para(['We propose a new simple network archi-', 'tecture based solely on attention.'], 700),
    );
    expect(piecesText(out[0]!.pieces)).toBe(out[0]!.text);
    expect(out[0]!.pieces.filter((p) => p.g).map((p) => p.str)).toEqual([
      'We propose a new simple network archi',
      'tecture based solely on attention.',
    ]);
  });

  it('does not let many small subscript characters outvote the line text', () => {
    // "and W^O ∈ R^{d_model × d_v}." as the last line of a paragraph.
    const out = blocks([
      ...para(['Where the projections are parameter matrices for every head and'], 700),
      item('and', 100, 688),
      item('W', 120, 688, 10, 'mi'),
      item('O', 126, 692, 7, 'mi'),
      item('∈ R', 132, 688, 10, 'mi'),
      item('dmodel×dv', 150, 692, 7, 'mi'),
      item('.', 190, 688),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.fontSize).toBeCloseTo(10);
  });

  it('finds a bullet with a hanging indent and keeps the text column', () => {
    const out = blocks([
      { ...item('• In encoder-decoder attention layers, the queries come', 100, 700), width: 400 },
      item('from the decoder.', 112, 688),
      item('•', 100, 670),
      item('The encoder contains self-attention layers.', 111, 670),
    ]);
    expect(out.map((b) => b.marker)).toEqual([
      { text: '•', textX: 112, end: 104.5 },
      { text: '•', textX: 111, end: 105 },
    ]);
  });

  it('splits numbered list items; numbered headings are not list items', () => {
    const out = blocks([
      item('1 Introduction', 100, 730, 12, 'bold'),
      {
        ...item('1. Install the new client library on every worker before the', 100, 700),
        width: 400,
      },
      item('server is upgraded.', 112, 688),
      item('2. Restart the workers one at a time.', 100, 676),
    ]);
    expect(out.map((b) => b.text)).toEqual([
      '1 Introduction',
      '1. Install the new client library on every worker before the server is upgraded.',
      '2. Restart the workers one at a time.',
    ]);
    expect(out[0]!.marker).toBeUndefined();
    expect(out[1]!.marker).toEqual({ text: '1.', textX: 112, end: 110 });
  });

  it('marks centered blocks', () => {
    const out = blocks([
      item('Provided proper attribution is provided, Google grants', 160, 700),
      item('permission to reproduce the tables.', 210, 688),
    ]);
    expect(out[0]!.centered).toBe(true);
    expect(
      blocks(para(['A justified line of text that fills', 'the column.'], 700))[0]!.centered,
    ).toBeUndefined();
  });

  it('starts a new block at each footnote mark', () => {
    const out = blocks([
      item('†', 100, 700, 7),
      item('Work performed while at Google Brain.', 104, 697),
      item('‡', 100, 688, 7),
      item('Work performed while at Google Research.', 104, 685),
    ]);
    expect(out.map((b) => b.text)).toEqual([
      '†Work performed while at Google Brain.',
      '‡Work performed while at Google Research.',
    ]);
  });

  it('splits table cells at a rule, however close they are', () => {
    const cells = [item('Petrov et al. (2006) [29]', 100, 700), item('WSJ only', 230, 700)];
    expect(blocks(cells)).toHaveLength(1);
    const rule = (x0: number, x1: number) => x0 < 228 && x1 > 228;
    const out = extractBlocks(cells, STYLES, VT, rule);
    expect(out.map((b) => b.text)).toEqual(['Petrov et al. (2006) [29]', 'WSJ only']);
  });

  it('joins CJK lines without spaces', () => {
    const out = blocks([
      { ...item('我们提出了一种新的简单网络架构，完全基', 100, 700), width: 400 },
      item('于注意力机制。', 100, 686),
    ]);
    expect(out[0]!.text).toBe('我们提出了一种新的简单网络架构，完全基于注意力机制。');
  });
});

describe('isTranslatableBlock', () => {
  it.each([
    ['We propose a new simple network architecture, the Transformer.', true],
    ['3.2.2 Multi-Head Attention', true],
    ['1 Introduction', true],
    ['Abstract', true],
    ['我们提出了一种新的网络架构', true],
    ['Attention(Q, K, V ) = softmax( QKT √dk )V (1)', false],
    ['FFN(x) = max(0, xW1 + b1)W2 + b2', false],
    ['(1)', false],
    ['2', false],
    ['0.1 100K 4.92', false],
    ['Ashish Vaswani∗ Google Brain avaswani@google.com', false],
    ['[13] Sepp Hochreiter and Jürgen Schmidhuber. Long short-term memory. 1997.', false],
    ['O(n2 · d)', false],
  ])('%s -> %s', (text, expected) => {
    expect(isTranslatableBlock(text)).toBe(expected);
  });
});
