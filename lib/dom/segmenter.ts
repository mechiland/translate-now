/**
 * Find translatable "paragraphs" in a DOM tree.
 *
 * A paragraph is a run of inline content (text + inline elements) directly inside a
 * block-level element, uninterrupted by block-level children. The translation for a
 * run is inserted right after its last top-level node, inside the same block, so it
 * inherits the block's font, color and layout.
 */

export const TRANSLATION_TAG = 'tn-translation';
export const UI_TAG = 'tn-ui';

/** Never descend into these. Their text is not translated. */
const HARD_SKIP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'textarea',
  'input',
  'select',
  'option',
  'button',
  'svg',
  'math',
  'canvas',
  'iframe',
  'frame',
  'object',
  'embed',
  'video',
  'audio',
  'picture',
  'img',
  'pre',
  'code',
  'kbd',
  'samp',
  'var',
  'head',
  'title',
  'nav',
  'meta',
  'link',
]);

/** When these appear inline inside a paragraph, their text is kept verbatim as part of the sentence. */
const KEEP_TEXT_INLINE = new Set(['code', 'kbd', 'samp', 'var']);

/** Elements whose presence means "this block is just text"; used to decide whether translation-only mode may hide the original. */
const TEXT_INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'br',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'time',
  'u',
  'var',
  'wbr',
  TRANSLATION_TAG,
]);

const FALLBACK_BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'caption',
]);

export interface Segment {
  /** The block element that contains the run. */
  block: Element;
  /** Top-level children of `block` that make up the run, in document order. */
  nodes: Node[];
  /** Text nodes contributing to the run (first one is used as identity). */
  textNodes: Text[];
  /** Normalized text sent for translation. */
  text: string;
  /** True when this run is the only content of the block and the block holds only text-level elements. */
  fullBlock: boolean;
}

export interface SegmenterOptions {
  /** Minimum characters for a run to be worth translating. */
  minLength?: number;
  getDisplay?: (el: Element) => string;
}

const BR_MARK = '';

export function normalizeText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\s*\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Has at least one letter, and isn't just a number / date / symbol soup. */
export function isTranslatableText(text: string, minLength = 2): boolean {
  if (text.length < minLength) return false;
  const letters = text.match(/\p{L}/gu);
  if (!letters) return false;
  // Single CJK char or 1-letter strings aren't worth a request.
  if (letters.length < 2) return false;
  // Pure URL or email
  if (/^(https?:\/\/|www\.)\S+$/i.test(text) || /^\S+@\S+\.\S+$/.test(text)) return false;
  return true;
}

function isSkipped(el: Element): boolean {
  if (HARD_SKIP.has(el.localName)) return true;
  if (el.getAttribute('translate') === 'no') return true;
  if (el.classList.contains('notranslate')) return true;
  const ce = el.getAttribute('contenteditable');
  if (ce !== null && ce !== 'false') return true;
  const role = el.getAttribute('role');
  if (role && SKIP_ROLES.has(role)) return true;
  return false;
}

/** UI chrome that is rarely worth translating and whose layout breaks easily. */
const SKIP_ROLES = new Set([
  'button',
  'textbox',
  'searchbox',
  'combobox',
  'navigation',
  'menu',
  'menubar',
  'tablist',
  'toolbar',
  'tooltip',
]);

/**
 * Short snippets (labels, titles, buttons-ish text) get their translation inline,
 * right after the original, instead of on a new line — keeps compact layouts intact.
 */
export function isShortSnippet(text: string): boolean {
  if (text.includes('\n')) return false;
  const cjk = text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length ?? 0;
  if (cjk > 0) return text.length <= 12;
  const words = text.split(/\s+/).filter(Boolean).length;
  return words <= 5 && text.length <= 40;
}

function isBlockDisplay(display: string, el: Element): boolean {
  if (!display) return FALLBACK_BLOCK_TAGS.has(el.localName);
  if (display === 'contents') return false;
  if (display.startsWith('inline')) return false;
  if (display === 'ruby' || display.startsWith('ruby-')) return false;
  return true;
}

/** Is `el` laid out as a block (so it can hold its own paragraph)? */
export function isBlockLevel(el: Element): boolean {
  return isBlockDisplay(defaultGetDisplay(el), el);
}

function defaultGetDisplay(el: Element): string {
  const view = el.ownerDocument.defaultView;
  if (!view) return '';
  try {
    return view.getComputedStyle(el).display;
  } catch {
    return '';
  }
}

interface Run {
  nodes: Node[];
  parts: string[];
  textNodes: Text[];
  textOnly: boolean;
}

export function collectSegments(root: Element, opts: SegmenterOptions = {}): Segment[] {
  const minLength = opts.minLength ?? 2;
  const displayCache = new Map<Element, string>();
  const getDisplay = (el: Element): string => {
    let d = displayCache.get(el);
    if (d === undefined) {
      d = (opts.getDisplay ?? defaultGetDisplay)(el);
      displayCache.set(el, d);
    }
    return d;
  };
  const out: Segment[] = [];

  const scanBlock = (block: Element): void => {
    let run: Run | null = null;
    let runCount = 0;
    let interrupted = false;
    const blockSegments: Segment[] = [];

    const flush = () => {
      if (!run) return;
      const r: Run = run;
      run = null;
      runCount++;
      const text = normalizeText(r.parts.join(''));
      if (r.textNodes.length > 0 && isTranslatableText(text, minLength)) {
        blockSegments.push({
          block,
          nodes: r.nodes,
          textNodes: r.textNodes,
          text,
          fullBlock: r.textOnly,
        });
      }
    };

    const current = (top: Node): Run => {
      if (!run) run = { nodes: [], parts: [], textNodes: [], textOnly: true };
      if (run.nodes[run.nodes.length - 1] !== top) run.nodes.push(top);
      return run;
    };

    const visit = (node: Node, top: Node): void => {
      if (node.nodeType === 3) {
        const data = (node as Text).data;
        if (/\S/.test(data)) {
          const r = current(top);
          r.parts.push(data);
          r.textNodes.push(node as Text);
        } else if (run) {
          run.parts.push(' ');
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      const tag = el.localName;
      if (tag === TRANSLATION_TAG || tag === UI_TAG) return;
      if (tag === 'br') {
        if (run) run.parts.push(BR_MARK);
        return;
      }
      const display = getDisplay(el);
      if (display === 'none') return;
      const block = isBlockDisplay(display, el);
      if (isSkipped(el)) {
        if (block) {
          flush();
          interrupted = true;
          return;
        }
        const keepText =
          KEEP_TEXT_INLINE.has(tag) ||
          el.classList.contains('notranslate') ||
          el.getAttribute('translate') === 'no';
        if (keepText) {
          const t = el.textContent ?? '';
          if (/\S/.test(t)) current(top).parts.push(t);
        } else if (run) {
          // An inline icon/image/button inside the run: keep the run, but the block isn't text-only.
          run.textOnly = false;
        } else {
          current(top).textOnly = false;
        }
        return;
      }
      if (block) {
        flush();
        interrupted = true;
        scanBlock(el);
        return;
      }
      if (!TEXT_INLINE_TAGS.has(tag)) {
        // Unknown inline element (custom element, label, etc.)
        current(top).textOnly = false;
      }
      for (const child of Array.from(el.childNodes)) visit(child, top);
    };

    for (const child of Array.from(block.childNodes)) visit(child, child);
    flush();

    const sole = runCount === 1 && !interrupted;
    for (const seg of blockSegments) {
      seg.fullBlock = seg.fullBlock && sole;
      out.push(seg);
    }
  };

  if (!isSkipped(root) && getDisplay(root) !== 'none') scanBlock(root);
  // Block segments are pushed after their nested blocks; restore document order.
  return out.sort((a, b) => {
    const x = a.textNodes[0]!;
    const y = b.textNodes[0]!;
    if (x === y) return 0;
    return x.compareDocumentPosition(y) & 4 /* FOLLOWING */ ? -1 : 1;
  });
}

/** Is `node` inside an element we injected (translation or UI)? */
export function isInsideInjected(node: Node | null): boolean {
  let n: Node | null = node;
  while (n) {
    if (n.nodeType === 1) {
      const tag = (n as Element).localName;
      if (tag === TRANSLATION_TAG || tag === UI_TAG) return true;
    }
    n = n.parentNode;
  }
  return false;
}
