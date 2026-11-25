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

  it('keeps icons and images beside a label as decor of a text-only block', () => {
    const s = segs('<p><img src="x.png"> Caption text here</p>');
    expect(s[0]!.text).toBe('Caption text here');
    expect(s[0]!.fullBlock).toBe(true);
    expect(s[0]!.decor.map((d) => d.localName)).toEqual(['img']);
    const btn = segs('<p>Download app <span class="icon"><svg></svg></span></p>');
    expect(btn[0]!.fullBlock).toBe(true);
    expect(btn[0]!.decor.map((d) => d.className)).toEqual(['icon']);
  });

  it('treats a book-title link inside noindex as text that can be replaced', () => {
    const [title] = segs(
      '<div><noindex><a href="/book">The Story of a Library</a></noindex></div>',
    );
    expect(title?.wrapLink?.getAttribute('href')).toBe('/book');
    expect(title?.fullBlock).toBe(true);
  });

  it('preserves icon-font ligatures beside a readable book title', () => {
    const [title] = segs('<h2><i class="material-icons">auto_stories</i> Featured books</h2>');
    expect(title?.text).toBe('Featured books');
    expect(title?.decor.map((node) => node.textContent)).toEqual(['auto_stories']);
  });

  it('marks blocks with an image inside the sentence as not text-only', () => {
    const s = segs('<p>Caption <span>with <img src="x.png"> inline</span> image</p>');
    expect(s[0]!.fullBlock).toBe(false);
  });

  it('treats inline list items and custom elements as text', () => {
    const s = segs(
      '<ul><li style="display:inline">Archive</li> <li style="display:inline">About us</li></ul>' +
        '<p>Updated <relative-time>Nov 24</relative-time></p>',
    );
    expect(s.map((x) => x.fullBlock)).toEqual([true, true]);
  });

  it('translates inside an inline box that holds the whole run', () => {
    const s = segs(
      '<div><button style="display:inline-flex"><div>Sign up for free</div></button></div>' +
        '<p><a href="/x" style="display:inline-block">Read more</a></p>',
    );
    expect(s.map((x) => [x.block.localName, x.text])).toEqual([
      ['div', 'Sign up for free'],
      ['a', 'Read more'],
    ]);
    const wrapped = segs(
      '<div><a href="/"><button style="display:inline-flex"><svg></svg><div>For You</div></button></a></div>',
    );
    expect(wrapped[0]!.block.localName).toBe('div');
    expect(wrapped[0]!.block.parentElement!.localName).toBe('button');
    expect(s[0]!.block.parentElement!.localName).toBe('button');
    expect(s.every((x) => x.fullBlock)).toBe(true);
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
    expect(s[0]!.fullBlock).toBe(true);
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

  it('captures wrapLink when a flex-row anchor places its translation after itself', () => {
    const s = styled(`
      <div><a href="/story" style="display:flex">A very long headline placed directly inside a flex anchor element</a></div>`);
    expect(s).toHaveLength(1);
    expect(s[0]!.placement).toBe('after');
    expect(s[0]!.payload).toBe('A very long headline placed directly inside a flex anchor element');
    expect(s[0]!.wrapLink?.getAttribute('href')).toBe('/story');
    expect(s[0]!.marks).toEqual([]);
  });
});

describe('links', () => {
  it('uses wrapLink without markers when a single link covers the whole segment', () => {
    const s = segs('<h2>  <a href="/post">My great post</a>  </h2>');
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe('My great post');
    expect(s[0]!.payload).toBe('My great post');
    expect(s[0]!.marks).toEqual([]);
    expect(s[0]!.wrapLink?.getAttribute('href')).toBe('/post');
  });

  it('embeds numbered markers for partial or multiple inline links and keeps plain text clean', () => {
    const s = segs(
      '<p>Read<a href="/a">  <b>API</b>   <em>guide</em> </a> and <a href="/b">examples</a>.</p>',
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe('Read API guide and examples.');
    expect(s[0]!.payload).toBe('Read <a id="1">API guide</a> and <a id="2">examples</a>.');
    expect(s[0]!.wrapLink).toBeUndefined();
    expect(s[0]!.marks.map((a: Element) => a.getAttribute('href'))).toEqual(['/a', '/b']);
  });

  it('preserves line breaks inside inline links and links around code or notranslate text', () => {
    const s = segs(
      '<p>Call <a href="/fetch"><code>fetch()</code></a> or <a href="/wxt" class="notranslate">WXT</a><br><a href="/multi">Line 1<br>Line 2</a></p>',
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.payload).toBe(
      'Call <a id="1">fetch()</a> or <a id="2">WXT</a>\n<a id="3">Line 1\nLine 2</a>',
    );
    expect(s[0]!.marks.map((a: Element) => a.getAttribute('href'))).toEqual([
      '/fetch',
      '/wxt',
      '/multi',
    ]);
  });

  it('ignores anchors without href and avoids double-linking blocks already inside an anchor', () => {
    const s = segs(
      '<p>See <a id="sec">section one</a> here.</p><a href="/card"><div>Card heading</div></a>',
    );
    expect(s).toHaveLength(2);
    expect(s[0]!.payload).toBe('See section one here.');
    expect(s[0]!.marks).toEqual([]);
    expect(s[0]!.wrapLink).toBeUndefined();
    expect(s[1]!.payload).toBe('Card heading');
    expect(s[1]!.marks).toEqual([]);
    expect(s[1]!.wrapLink).toBeUndefined();
  });
});

describe('styled text (KEEP_STYLE_SELECTORS)', () => {
  it('marks LaTeXML glossary terms, italics and typewriter text like links', () => {
    const s = segs(
      '<p>Each <abbr class="ltx_glossaryref ltx_missing">MOSA</abbr> runs the <span class="ltx_text ltx_font_italic">sci</span> ' +
        'interferometer in <span class="ltx_text ltx_font_typewriter">lisainstrument</span> (<a href="#b1">Bayle, 2023</a>).</p>',
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe(
      'Each MOSA runs the sci interferometer in lisainstrument (Bayle, 2023).',
    );
    expect(s[0]!.payload).toBe(
      'Each <a id="1">MOSA</a> runs the <a id="2">sci</a> interferometer in <a id="3">lisainstrument</a> (<a id="4">Bayle, 2023</a>).',
    );
    expect(s[0]!.marks.map((el) => el.localName)).toEqual(['abbr', 'span', 'span', 'a']);
    expect(s[0]!.wrapLink).toBeUndefined();
  });

  it('leaves other styled or LaTeXML text alone', () => {
    const s = segs(
      '<p>See <span class="ltx_text ltx_bib_journal">Phys. Rev. D</span> and <em>this</em> <span class="glossaryref">term</span>.</p>',
    );
    expect(s[0]!.payload).toBe('See Phys. Rev. D and this term.');
    expect(s[0]!.marks).toEqual([]);
  });

  it('keeps links clickable inside styled text and styled text plain inside links', () => {
    const s = segs(
      '<p>Read <span class="ltx_font_italic">the <a href="/g">guide</a> first</span> or <a href="/h"><span class="ltx_font_italic">this</span> one</a>.</p>',
    );
    expect(s[0]!.payload).toBe(
      'Read <a id="1">the</a> <a id="2">guide</a> <a id="3">first</a> or <a id="4">this one</a>.',
    );
    expect(s[0]!.marks.map((el) => el.localName)).toEqual(['span', 'a', 'span', 'a']);
  });

  it('wraps a fully styled segment in a marker, not in a link', () => {
    const s = segs('<p><span class="ltx_font_italic">Entirely italic sentence.</span></p>');
    expect(s[0]!.payload).toBe('<a id="1">Entirely italic sentence.</a>');
    expect(s[0]!.wrapLink).toBeUndefined();
  });

  it('keeps styled markers when the translation goes inside a link', () => {
    const s = segs(
      '<a href="/card"><div>A <span class="ltx_font_italic">styled</span> card title</div></a>',
    );
    expect(s[0]!.payload).toBe('A <a id="1">styled</a> card title');
    expect(s[0]!.marks.map((el) => el.localName)).toEqual(['span']);
  });
});

describe('math', () => {
  /** Chromium's computed display for MathML: "math" when inline, "block math" when display=block. */
  const mathDisplay = (el: Element) =>
    el.localName === 'math'
      ? el.getAttribute('display') === 'block'
        ? 'block math'
        : 'math'
      : getDisplay(el);
  const mathSegs = (html: string) => {
    document.body.innerHTML = html;
    return collectSegments(document.body, { getDisplay: mathDisplay });
  };
  const inlineMath = (tex: string, body: string) =>
    `<math display="inline"><semantics>${body}<annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`;

  it('keeps inline formulas inside the sentence as placeholders (arXiv HTML)', () => {
    const s = mathSegs(
      `<p>A triangle of side ${inlineMath('\\sim 2.5', '<mrow><mo>∼</mo><mn>2.5</mn></mrow>')} million kilometres. ` +
        `Another approach, TDI-${inlineMath('\\infty', '<mi>∞</mi>')} <cite>(<a href="#b10">Vallisneri et al., 2021</a>)</cite>, builds on it.</p>`,
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe(
      'A triangle of side ∼2.5 million kilometres. Another approach, TDI-∞ (Vallisneri et al., 2021), builds on it.',
    );
    expect(s[0]!.payload).toBe(
      'A triangle of side <m id="1"/> million kilometres. Another approach, TDI-<m id="2"/> (<a id="1">Vallisneri et al., 2021</a>), builds on it.',
    );
    expect(s[0]!.atoms.map((m) => m.localName)).toEqual(['math', 'math']);
    // Translation-only mode may still hide the original: the formulas are copied over.
    expect(s[0]!.fullBlock).toBe(true);
  });

  it('splits paragraphs around display formulas', () => {
    const s = mathSegs(
      '<p>The likelihood is <math display="block"><mi>L</mi></math> where L is the likelihood.</p>',
    );
    expect(s.map((x) => x.text)).toEqual(['The likelihood is', 'where L is the likelihood.']);
    expect(s.every((x) => x.atoms.length === 0)).toBe(true);
  });

  it('keeps a formula inside a link as plain link text', () => {
    const s = mathSegs(`<p>See <a href="/x">case ${inlineMath('n', '<mi>n</mi>')}</a> below.</p>`);
    expect(s[0]!.payload).toBe('See <a id="1">case n</a> below.');
    expect(s[0]!.atoms).toEqual([]);
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

describe('social posts', () => {
  /** `white-space` and display come from inline styles, like computed styles would. */
  function styled(html: string) {
    document.body.innerHTML = html;
    return collectSegments(document.body, {
      getStyle: (el) => {
        const st = (el as HTMLElement).style;
        const ws = st?.whiteSpace || (el.closest('[style*="pre-wrap"]') ? 'pre-wrap' : '');
        return {
          display: st?.display || getDisplay(el),
          keepsNewlines: /^(pre|break-spaces)/.test(ws),
        };
      },
    });
  }

  it('keeps the line breaks of text shown with white-space: pre-wrap', () => {
    const s = styled(
      '<div style="white-space:pre-wrap"><span>Three things:\n\n- one\n- two</span></div>',
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe('Three things:\n\n- one\n- two');
    expect(s[0]!.payload).toBe('Three things:\n\n- one\n- two');
  });

  it('keeps line breaks around links in pre-wrap text', () => {
    const s = styled(
      '<div style="white-space:pre-wrap"><span>First line\n</span><a href="/x">a link</a><span>\nlast line</span></div>',
    );
    expect(s[0]!.payload).toBe('First line\n<a id="1">a link</a>\nlast line');
  });

  it('treats paragraphs run together inline (clamped previews) as one text-only block', () => {
    const s = styled(
      '<div class="preview"><p style="display:inline">First paragraph.</p><p style="display:inline">Second one.</p></div>',
    );
    expect(s).toHaveLength(1);
    expect(s[0]!.text).toBe('First paragraph.Second one.');
    expect(s[0]!.fullBlock).toBe(true);
  });

  it('still collapses line breaks in normal text', () => {
    const s = styled('<p>Wrapped\nsource\ntext</p>');
    expect(s[0]!.text).toBe('Wrapped source text');
  });

  it('still finds the original text that translation-only mode hides', () => {
    document.documentElement.setAttribute('data-tn-mode', 'translation-only');
    try {
      document.body.innerHTML =
        '<div data-tn-hide><span>Hidden original text</span><tn-translation>译文</tn-translation></div>';
      const s = collectSegments(document.body, {
        getStyle: (el) => ({
          // What our CSS does to the children of a hidden block.
          display:
            el.parentElement?.hasAttribute('data-tn-hide') && el.localName !== 'tn-translation'
              ? 'none'
              : getDisplay(el),
        }),
      });
      expect(s.map((x) => x.text)).toEqual(['Hidden original text']);
      expect(s[0]!.fullBlock).toBe(true);
    } finally {
      document.documentElement.removeAttribute('data-tn-mode');
    }
  });
});
