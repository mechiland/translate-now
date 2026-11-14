// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverTrigger } from '@/lib/dom/hoverTrigger';
import { PageTranslator, type PageTranslatorConfig } from '@/lib/dom/pageTranslator';
import type { HoverModifier } from '@/lib/settings/schema';

const key = (type: 'keydown' | 'keyup', k: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, ...init }));

describe('HoverTrigger', () => {
  let target: HTMLElement;
  let modifier: HoverModifier;
  let hits: Element[];
  let trigger: HoverTrigger;

  beforeEach(() => {
    document.body.innerHTML = '<p id="p">Hello world</p><input id="i" />';
    target = document.getElementById('p')!;
    document.elementFromPoint = () => target;
    modifier = 'ctrl';
    hits = [];
    trigger = new HoverTrigger({
      doc: document,
      modifier: () => modifier,
      onTrigger: (el) => hits.push(el),
    });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
  });
  afterEach(() => {
    trigger.destroy();
    vi.useRealTimers();
  });

  const tapCtrl = () => {
    key('keydown', 'Control', { ctrlKey: true });
    key('keyup', 'Control');
  };

  it('reports the element under the pointer when the modifier is tapped alone', () => {
    tapCtrl();
    expect(hits).toEqual([target]);
  });

  it('ignores shortcuts that start with the modifier', () => {
    key('keydown', 'Control', { ctrlKey: true });
    key('keydown', 'c', { ctrlKey: true });
    key('keyup', 'c', { ctrlKey: true });
    key('keyup', 'Control');
    key('keydown', 'Control', { ctrlKey: true });
    document.dispatchEvent(new MouseEvent('mousedown'));
    key('keyup', 'Control');
    key('keydown', 'Control', { ctrlKey: true, shiftKey: true });
    key('keyup', 'Control');
    expect(hits).toEqual([]);
  });

  it('ignores long holds, auto-repeat and typing in inputs', () => {
    vi.useFakeTimers();
    key('keydown', 'Control', { ctrlKey: true });
    vi.advanceTimersByTime(1000);
    key('keyup', 'Control');
    key('keydown', 'Control', { ctrlKey: true, repeat: true });
    key('keyup', 'Control');
    document
      .getElementById('i')!
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }),
      );
    key('keyup', 'Control');
    expect(hits).toEqual([]);
  });

  it('follows the configured modifier and can be turned off', () => {
    modifier = 'alt';
    tapCtrl();
    key('keydown', 'Alt', { altKey: true });
    key('keyup', 'Alt');
    expect(hits).toEqual([target]);
    modifier = 'off';
    key('keydown', 'Alt', { altKey: true });
    key('keyup', 'Alt');
    expect(hits).toHaveLength(1);
  });

  it('does nothing before the pointer has entered the page', () => {
    trigger.destroy();
    trigger = new HoverTrigger({
      doc: document,
      modifier: () => 'ctrl',
      onTrigger: (el) => hits.push(el),
    });
    tapCtrl();
    expect(hits).toEqual([]);
  });
});

describe('PageTranslator.toggleParagraph', () => {
  const config: PageTranslatorConfig = {
    targetLang: 'zh-CN',
    neverTranslateLangs: [],
    displayMode: 'translation-only',
    theme: 'dimmed',
    maxChars: 2000,
    maxSegments: 12,
  };
  let requests: string[][];
  let page: PageTranslator;

  beforeEach(() => {
    document.documentElement.removeAttribute('data-tn-theme');
    document.documentElement.removeAttribute('data-tn-mode');
    document.body.innerHTML = `
      <p id="p1">The quick brown fox jumps over the lazy dog.</p>
      <p id="p2">Simple tools are often the <b id="b">most useful</b> ones.</p>
      <pre id="code">const x = "not translated";</pre>`;
    requests = [];
    page = new PageTranslator(document, {
      translate: async (texts) => {
        requests.push(texts);
        return texts.map((t) => ({ ok: true as const, text: `[ZH] ${t}` }));
      },
      cancel: () => {},
      getConfig: () => config,
      strings: { error: (m) => m, retry: 'Retry' },
    });
  });

  const translationIn = (id: string) => document.querySelector(`#${id} > tn-translation.tn-done`);
  const settle = () => vi.waitFor(() => expect(document.querySelector('.tn-loading')).toBeNull());

  it('translates only the paragraph under the pointer, below the original', async () => {
    const inner = document.getElementById('b')!.firstChild!;
    expect(page.toggleParagraph(inner)).toBe('translated');
    await vi.waitFor(() => expect(translationIn('p2')).not.toBeNull());
    expect(translationIn('p2')!.textContent).toBe(
      '[ZH] Simple tools are often the most useful ones.',
    );
    expect(translationIn('p1')).toBeNull();
    expect(requests).toEqual([['Simple tools are often the most useful ones.']]);
    expect(page.active).toBe(false);
    // Bilingual even when the page display mode is translation-only.
    expect(document.documentElement.hasAttribute('data-tn-mode')).toBe(false);
    expect(document.documentElement.getAttribute('data-tn-theme')).toBe('dimmed');
  });

  it('removes the translation on a second tap, over the original or the translation', async () => {
    const p1 = document.getElementById('p1')!;
    page.toggleParagraph(p1);
    await vi.waitFor(() => expect(translationIn('p1')).not.toBeNull());
    expect(page.toggleParagraph(translationIn('p1')!.firstChild!)).toBe('removed');
    expect(translationIn('p1')).toBeNull();
    expect(document.documentElement.hasAttribute('data-tn-theme')).toBe(false);

    // Translating again reuses the in-memory result.
    page.toggleParagraph(p1.firstChild!);
    expect(translationIn('p1')).not.toBeNull();
    expect(page.toggleParagraph(p1)).toBe('removed');
    expect(requests).toHaveLength(1);
  });

  it('ignores code blocks and the page body', () => {
    expect(page.toggleParagraph(document.getElementById('code')!.firstChild!)).toBe('none');
    expect(page.toggleParagraph(document.body)).toBe('none');
    expect(requests).toHaveLength(0);
  });

  it('defers to whole-page translation, and showing the original clears hover results', async () => {
    page.toggleParagraph(document.getElementById('p1')!);
    await settle();
    // happy-dom's IntersectionObserver never fires; without it everything is queued at once.
    const win = window as { IntersectionObserver?: unknown };
    const io = win.IntersectionObserver;
    delete win.IntersectionObserver;
    page.start();
    win.IntersectionObserver = io;
    await vi.waitFor(() => expect(translationIn('p2')).not.toBeNull());
    expect(page.toggleParagraph(document.getElementById('p1')!)).toBe('none');
    expect(translationIn('p1')).not.toBeNull();
    page.stop();
    expect(document.querySelectorAll('tn-translation')).toHaveLength(0);
  });

  it('settings changes drop hover translations', async () => {
    page.toggleParagraph(document.getElementById('p1')!);
    await settle();
    page.restart();
    expect(document.querySelectorAll('tn-translation')).toHaveLength(0);
    expect(page.active).toBe(false);
  });
});
