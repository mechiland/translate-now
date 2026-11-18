// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMirrorLink, parseInlineLinks, renderTranslatedContent } from '@/lib/dom/links';
import { PageTranslator } from '@/lib/dom/pageTranslator';

beforeEach(() => {
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-tn-mode');
  document.documentElement.removeAttribute('data-tn-theme');
});

describe('parseInlineLinks', () => {
  it('parses well-formed single and multiple link markers, including reordered ids', () => {
    expect(parseInlineLinks('请查看<a id="2">示例</a>和<a id="1">文档</a>。', 2)).toEqual([
      { type: 'text', text: '请查看' },
      { type: 'link', index: 1, text: '示例' },
      { type: 'text', text: '和' },
      { type: 'link', index: 0, text: '文档' },
      { type: 'text', text: '。' },
    ]);
  });

  it('tolerates single quotes, unquoted ids, and ignores extra attributes', () => {
    expect(
      parseInlineLinks(
        `See <a id='1'>one</a> and <a href="javascript:alert(1)" id=2 target="_blank">two</a>.`,
        2,
      ),
    ).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', index: 0, text: 'one' },
      { type: 'text', text: ' and ' },
      { type: 'link', index: 1, text: 'two' },
      { type: 'text', text: '.' },
    ]);
  });

  it('allows the same id to appear multiple times', () => {
    expect(parseInlineLinks('<a id="1">这个</a>很棒的<a id="1">链接</a>', 1)).toEqual([
      { type: 'link', index: 0, text: '这个' },
      { type: 'text', text: '很棒的' },
      { type: 'link', index: 0, text: '链接' },
    ]);
  });

  it('degrades out-of-range, empty, and unclosed tags cleanly without leaking raw markup', () => {
    expect(parseInlineLinks('<a id="0">zero</a> <a id="5">five</a> <a id="1"></a>', 2)).toEqual([
      { type: 'text', text: 'zero five ' },
    ]);
    expect(parseInlineLinks('See <a id="1">first and <a id="2">second</a>.', 2)).toEqual([
      { type: 'text', text: 'See first and ' },
      { type: 'link', index: 1, text: 'second' },
      { type: 'text', text: '.' },
    ]);
    expect(parseInlineLinks('See <a id="1">unclosed tail', 1)).toEqual([
      { type: 'text', text: 'See unclosed tail' },
    ]);
  });

  it('strips stray closing tags by default, but preserves literal </a> when requested', () => {
    expect(parseInlineLinks('hello</a> <a id="1">world</a>', 1, false)).toEqual([
      { type: 'text', text: 'hello ' },
      { type: 'link', index: 0, text: 'world' },
    ]);
    expect(parseInlineLinks('Use <a>foo</a> and <a id="1">docs</a>.', 1, true)).toEqual([
      { type: 'text', text: 'Use <a>foo</a> and ' },
      { type: 'link', index: 0, text: 'docs' },
      { type: 'text', text: '.' },
    ]);
  });
});

describe('createMirrorLink & renderTranslatedContent', () => {
  it('copies navigation and inline style attributes, omitting id, aria-label, and inline handlers', () => {
    document.body.innerHTML =
      '<p><a id="orig" href="https://example.com/a" target="_blank" rel="noopener" title="Tip" class="link-blue" style="color: blue" aria-label="English" onclick="return false">Docs</a></p>';
    const source = document.getElementById('orig') as HTMLAnchorElement;
    const mirror = createMirrorLink(document, source, '文档', true);

    expect(mirror.getAttribute('href')).toBe('https://example.com/a');
    expect(mirror.getAttribute('target')).toBe('_blank');
    expect(mirror.getAttribute('rel')).toBe('noopener');
    expect(mirror.getAttribute('title')).toBe('Tip');
    expect(mirror.getAttribute('class')).toBe('link-blue');
    expect(mirror.getAttribute('style')).toBe('color: blue');
    expect(mirror.hasAttribute('id')).toBe(false);
    expect(mirror.hasAttribute('aria-label')).toBe(false);
    expect(mirror.hasAttribute('onclick')).toBe(false);
    expect(mirror.textContent).toBe('文档');
  });

  it('omits block class/style when copyStyle is false', () => {
    document.body.innerHTML = '<a href="/x" class="flex-card" style="display:flex">Card</a>';
    const source = document.querySelector('a') as HTMLAnchorElement;
    const mirror = createMirrorLink(document, source, '卡片', false);
    expect(mirror.getAttribute('href')).toBe('/x');
    expect(mirror.hasAttribute('class')).toBe(false);
    expect(mirror.hasAttribute('style')).toBe(false);
  });

  it('delegates plain left-clicks to the original anchor without double-bubbling', () => {
    document.body.innerHTML = '<div id="wrap"><a id="orig" href="#dest">Link</a></div>';
    const wrap = document.getElementById('wrap')!;
    const source = document.getElementById('orig') as HTMLAnchorElement;
    const mirror = createMirrorLink(document, source, '链接', true);
    wrap.appendChild(mirror);

    const sourceClick = vi.fn((e: Event) => e.preventDefault());
    const wrapClick = vi.fn();
    source.addEventListener('click', sourceClick);
    wrap.addEventListener('click', wrapClick);

    mirror.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(sourceClick).toHaveBeenCalledTimes(1);
    expect(wrapClick).toHaveBeenCalledTimes(1);

    // Modifier clicks (e.g. Ctrl/Cmd+click to open in new tab) are not intercepted.
    mirror.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true }),
    );
    expect(sourceClick).toHaveBeenCalledTimes(1);
  });

  it('renders inline links safely without interpreting arbitrary HTML', () => {
    document.body.innerHTML = '<p>Read <a href="/docs">docs</a></p>';
    const p = document.querySelector('p')!;
    const source = p.querySelector('a') as HTMLAnchorElement;
    const span = document.createElement('span');

    renderTranslatedContent(document, span, '<b>阅读</b><a id="1">文档</a>', {
      plainText: 'Read docs',
      block: p,
      links: [source],
    });
    expect(span.querySelectorAll('b')).toHaveLength(0);
    expect(span.querySelectorAll('a')).toHaveLength(1);
    expect(span.querySelector('a')!.getAttribute('href')).toBe('/docs');
    expect(span.querySelector('a')!.textContent).toBe('文档');
    expect(span.textContent).toBe('<b>阅读</b>文档');
  });
});

describe('PageTranslator link preservation', () => {
  function makeTranslator(translate: (texts: string[]) => Promise<string[]>) {
    return new PageTranslator(document, {
      translate: async (texts) => (await translate(texts)).map((text) => ({ ok: true, text })),
      cancel: () => {},
      getConfig: () => ({
        targetLang: 'zh-CN',
        neverTranslateLangs: [],
        displayMode: 'bilingual',
        theme: 'dimmed',
        maxChars: 4000,
        maxSegments: 20,
      }),
      strings: { error: (m) => m, retry: 'Retry' },
    });
  }

  it('preserves inline links, whole-block links, and avoids nesting links inside block anchors', async () => {
    document.body.innerHTML = `
      <h2 id="h"><a href="/post" class="hl">Article headline</a></h2>
      <p id="p">Read the <a href="/docs" class="ext">documentation</a> and <a href="/api">API</a>.</p>
      <a id="card" href="/card" style="display:block"><div>Card title text</div></a>
    `;
    // Stub IntersectionObserver so every observed block reports visible immediately.
    const origIO = window.IntersectionObserver;
    window.IntersectionObserver = class {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(target: Element) {
        this.cb(
          [{ isIntersecting: true, target } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;
    try {
      const sent: string[] = [];
      const pt = makeTranslator(async (texts) => {
        sent.push(...texts);
        return texts.map((t) => `[ZH] ${t}`);
      });
      pt.start();
      await new Promise((r) => setTimeout(r, 80));

      expect(sent).toEqual([
        'Article headline',
        'Read the <a id="1">documentation</a> and <a id="2">API</a>.',
        'Card title text',
      ]);

      // Whole-block link: translation wrapped in mirrored <a>.
      const hLink = document.querySelector('#h > tn-translation a') as HTMLAnchorElement;
      expect(hLink).toBeTruthy();
      expect(hLink.getAttribute('href')).toBe('/post');
      expect(hLink.getAttribute('class')).toBe('hl');
      expect(hLink.textContent).toBe('[ZH] Article headline');

      // Inline links: both links restored inside <tn-translation>.
      const pLinks = [...document.querySelectorAll('#p > tn-translation a')];
      expect(pLinks.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
        ['/docs', 'documentation'],
        ['/api', 'API'],
      ]);
      expect(document.querySelector('#p > tn-translation')!.textContent).toBe(
        '[ZH] Read the documentation and API.',
      );

      // Block inside <a>: no nested <a> inside <tn-translation>.
      expect(document.querySelectorAll('#card tn-translation a')).toHaveLength(0);
      expect(document.querySelector('#card tn-translation')!.textContent).toBe(
        '[ZH] Card title text',
      );
      pt.stop();
    } finally {
      window.IntersectionObserver = origIO;
    }
  });

  it('preserves links for hover-translated paragraphs and toggles them off cleanly', async () => {
    document.body.innerHTML = '<p id="p">See <a href="/guide">the guide</a> for details.</p>';
    const pt = makeTranslator(async (texts) => texts.map((t) => `[ZH] ${t}`));
    expect(pt.toggleParagraph(document.querySelector('#p a')!)).toBe('translated');
    await new Promise((r) => setTimeout(r, 80));

    const link = document.querySelector('#p > tn-translation a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/guide');
    expect(link.textContent).toBe('the guide');

    // Toggling while hovering over the mirrored link inside <tn-translation> removes it.
    expect(pt.toggleParagraph(link)).toBe('removed');
    expect(document.querySelector('#p > tn-translation')).toBeNull();
  });
});
