// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { collectSegments, isTranslatableText, normalizeText } from '@/lib/dom/segmenter';

const BLOCK = new Set([
  'body',
  'div',
  'p',
  'li',
  'ul',
  'ol',
  'h1',
  'h2',
  'h3',
  'pre',
  'blockquote',
  'section',
  'article',
  'table',
  'tbody',
  'tr',
  'td',
  'th',
  'nav',
  'header',
  'footer',
  'figure',
  'figcaption',
  'dl',
  'dt',
  'dd',
]);

/** Deterministic display: inline style wins, else tag-based defaults. */
function getDisplay(el: Element): string {
  const inline = (el as HTMLElement).style?.display;
  if (inline) return inline;
  return BLOCK.has(el.localName) ? 'block' : 'inline';
}

function segs(html: string) {
  document.body.innerHTML = html;
  return collectSegments(document.body, { getDisplay });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('collectSegments', () => {
  it('finds paragraphs, headings and list items', () => {
    const s = segs(
      '<h1>Title here</h1><p>First paragraph.</p><ul><li>Item one</li><li>Item two</li></ul>',
    );
    expect(s.map((x) => x.text)).toEqual([
      'Title here',
      'First paragraph.',
      'Item one',
      'Item two',
    ]);
    expect(s.every((x) => x.fullBlock)).toBe(true);
  });

  it('treats inline formatting as part of the paragraph', () => {
    const s = segs('<p>Hello <b>bold</b> and <a href="#">a link</a>, plus <code>x = 1</code>.</p>');
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe('Hello bold and a link, plus x = 1.');
    expect(s[0]!.fullBlock).toBe(true);
    expect(s[0]!.nodes.length).toBe(s[0]!.block.childNodes.length);
  });

  it('skips pre, code blocks, scripts, styles, textarea, notranslate and translate=no', () => {
    const s = segs(`
      <pre>const x = "do not translate";</pre>
      <script>var a = "nope";</script>
      <style>.a{}</style>
      <textarea>typed text here</textarea>
      <div class="notranslate">Brand Name Here</div>
      <p translate="no">Keep me as is</p>
      <div contenteditable="true">Editable text here</div>
      <p>Translate me please</p>`);
    expect(s.map((x) => x.text)).toEqual(['Translate me please']);
  });

  it('keeps inline notranslate text verbatim inside a sentence', () => {
    const s = segs('<p>Welcome to <span class="notranslate">Acme Cloud</span> today.</p>');
    expect(s[0]!.text).toBe('Welcome to Acme Cloud today.');
  });

  it('splits mixed content around nested blocks', () => {
    const s = segs('<div>Intro text here <p>Nested paragraph</p> trailing words</div>');
    expect(s.map((x) => x.text)).toEqual(['Intro text here', 'Nested paragraph', 'trailing words']);
    const intro = s[0]!;
    expect(intro.block.localName).toBe('div');
    expect(intro.fullBlock).toBe(false);
    expect(s[1]!.fullBlock).toBe(true);
  });

  it('handles blocks nested inside inline elements', () => {
    const s = segs('<div><a href="#"><div>Card title</div><div>Card body text</div></a></div>');
    expect(s.map((x) => x.text)).toEqual(['Card title', 'Card body text']);
  });

  it('ignores hidden elements and numbers-only text', () => {
    const s = segs(
      '<p style="display:none">Hidden text</p><p>12,345</p><p>2024-01-01</p><p>Visible text</p>',
    );
    expect(s.map((x) => x.text)).toEqual(['Visible text']);
  });

  it('converts <br> into line breaks', () => {
    const s = segs('<p>Line one<br>Line two<br/>  Line three</p>');
    expect(s[0]!.text).toBe('Line one\nLine two\nLine three');
  });

  it('marks blocks with images as not text-only (translation-only must not hide them)', () => {
    const s = segs('<p><img src="x.png"> Caption text here</p>');
    expect(s[0]!.text).toBe('Caption text here');
    expect(s[0]!.fullBlock).toBe(false);
  });

  it('ignores our own injected translation elements', () => {
    const s = segs('<p>Original text<tn-translation>译文</tn-translation></p>');
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe('Original text');
    expect(s[0]!.fullBlock).toBe(true);
  });

  it('returns segments in document order', () => {
    const s = segs('<div>Outer start<div>Inner block</div></div><p>After all</p>');
    expect(s.map((x) => x.text)).toEqual(['Outer start', 'Inner block', 'After all']);
  });

  it('treats table cells as blocks', () => {
    const s = segs('<table><tbody><tr><td>Cell one</td><td>Cell two</td></tr></tbody></table>');
    expect(s.map((x) => x.text)).toEqual(['Cell one', 'Cell two']);
  });
});

describe('text helpers', () => {
  it('normalizeText collapses whitespace', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b');
  });
  it('isTranslatableText', () => {
    expect(isTranslatableText('Hello')).toBe(true);
    expect(isTranslatableText('你好')).toBe(true);
    expect(isTranslatableText('好')).toBe(false);
    expect(isTranslatableText('42%')).toBe(false);
    expect(isTranslatableText('https://example.com/path')).toBe(false);
    expect(isTranslatableText('me@example.com')).toBe(false);
    expect(isTranslatableText('theglobeandmail.com')).toBe(false);
    expect(isTranslatableText('news.bbc.co.uk')).toBe(false);
    expect(isTranslatableText('U.S. officials')).toBe(true);
    expect(isTranslatableText('—')).toBe(false);
  });
});

describe('UI chrome', () => {
  it('skips nav, menus, tab lists and toolbars', () => {
    const s = segs(`
      <nav><a href="#">Home page</a></nav>
      <div role="navigation"><span>Products menu</span></div>
      <ul role="tablist"><li role="tab">Code tab</li></ul>
      <div role="toolbar">Bold italic</div>
      <p>Main content here</p>`);
    expect(s.map((x) => x.text)).toEqual(['Main content here']);
  });
});

describe('buttons and widget roles', () => {
  /** Inline styles drive display, flex-direction and visibility, like computed styles would. */
  function styled(html: string) {
    document.body.innerHTML = html;
    return collectSegments(document.body, {
      getStyle: (el) => {
        const st = (el as HTMLElement).style;
        return {
          display: st?.display || getDisplay(el),
          flexDirection: st?.flexDirection || undefined,
          hidden:
            st?.visibility === 'hidden' ||
            (st?.position === 'absolute' && parseFloat(st.width) <= 1),
        };
      },
    });
  }

  it('translates text in buttons and role=button, but not form controls', () => {
    const s = styled(`
      <dl><dd role="button" tabindex="0"><div role="tooltip"><span>Meet the Instructors</span></div></dd></dl>
      <div><button>Back to course</button></div>
      <input value="typed value here"><select><option>Option text</option></select>`);
    expect(s.map((x) => x.text)).toEqual(['Meet the Instructors', 'Back to course']);
    expect(s.every((x) => x.placement === 'inside')).toBe(true);
  });

  it('places a long translation after a flex-row block whose parent stacks vertically', () => {
    const s = styled(`
      <div><button style="display:flex" aria-label="Expand story"><span>FAA reopens US airspace after communications failure halts departures nationwide</span></button></div>`);
    expect(s).toHaveLength(1);
    expect(s[0]!.block.localName).toBe('button');
    expect(s[0]!.placement).toBe('after');
    expect(s[0]!.fullBlock).toBe(false);
  });

  it('keeps translations inside row blocks when short, column-flex, or inside a row parent', () => {
    const s = styled(`
      <div><button style="display:flex"><span>Read more</span></button></div>
      <div><div style="display:flex;flex-direction:column"><span>A long column of text that is certainly not a short label</span></div></div>
      <div style="display:flex"><div style="display:flex"><span>Another long sentence that sits inside a row of cards</span></div></div>`);
    expect(s.map((x) => x.placement)).toEqual(['inside', 'inside', 'inside']);
  });

  it('keeps inline-flex citation buttons inside the sentence', () => {
    const s = styled(`
      <p>Air traffic control was disrupted <button style="display:inline-flex"><span style="display:block">[1]</span></button> and flights stopped.</p>`);
    expect(s.map((x) => x.text)).toEqual([
      'Air traffic control was disrupted [1] and flights stopped.',
    ]);
  });

  it('drops sr-only citation labels without splitting the sentence', () => {
    const s = styled(`
      <p>Air traffic control was disrupted <button><span style="display:block;position:absolute;width:1px">Citation 1 from reuters.com</span><span>[1]</span></button>. The ground stop began.</p>`);
    expect(s.map((x) => x.text)).toEqual([
      'Air traffic control was disrupted [1]. The ground stop began.',
    ]);
  });

  it('skips visually hidden (sr-only and visibility:hidden) text', () => {
    const s = styled(`
      <p>The ground stop began at 3:54 p.m.<button><span style="position:absolute;width:1px">Citation 3 from aljazeera.com</span>3</button></p>
      <dt style="position:absolute;width:1px">Duplicate hidden title</dt>
      <p style="visibility:hidden">Invisible paragraph text</p>`);
    expect(s.map((x) => x.text)).toEqual(['The ground stop began at 3:54 p.m.3']);
  });
});

describe('isShortSnippet', () => {
  it('detects short labels', async () => {
    const { isShortSnippet } = await import('@/lib/dom/segmenter');
    expect(isShortSnippet('Sign in')).toBe(true);
    expect(isShortSnippet('Red fox')).toBe(true);
    expect(isShortSnippet('The quick brown fox jumps over the lazy dog.')).toBe(false);
    expect(isShortSnippet('设置')).toBe(true);
    expect(isShortSnippet('这是一个比较长的中文句子，应该另起一行显示。')).toBe(false);
    expect(isShortSnippet('Line one\nLine two')).toBe(false);
  });
});
