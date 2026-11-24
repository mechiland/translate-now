/**
 * Find translatable "paragraphs" in a DOM tree.
 *
 * A paragraph is a run of inline content (text + inline elements) directly inside a
 * block-level element, uninterrupted by block-level children. The translation for a
 * run is inserted right after its last top-level node, inside the same block, so it
 * inherits the block's font, color and layout.
 */

import { keepsStyle } from './keepStyle';

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
  // Only reached when laid out inline, e.g. paragraphs run together in a clamped preview.
  'p',
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
  /** Normalized plain text (used for language detection, length checks, and short-snippet detection). */
  text: string;
  /**
   * Text sent for translation. Same as `text` unless inline `<a id="N">...</a>` markers are
   * embedded to preserve links and styled text inside the segment.
   */
  payload: string;
  /**
   * Inline elements referenced by `<a id="1">...</a>`..`<a id="K">...</a>` in `payload`: links
   * (`<a href>`) and styled text (see `KEEP_STYLE_SELECTORS`).
   */
  marks: Element[];
  /**
   * Inline formulas (`<math>`) referenced by `<m id="1"/>`..`<m id="K"/>` in `payload`. They are
   * not translated; the translation gets a copy of each one at the placeholder's position.
   */
  atoms: Element[];
  /**
   * Set when a single `<a href>` covers all text in the segment (and the translation is not
   * already inserted inside a link). In this case `payload === text` and the translated text
   * is wrapped in a clone of this link.
   */
  wrapLink?: HTMLAnchorElement;
  /** True when this run is the only content of the block and the block holds only text-level elements. */
  fullBlock: boolean;
  /**
   * Where the translation goes: inside the block right after the run (default), or right
   * after the block itself when the block lays its children out in a row (flex/grid), where an
   * extra child would end up beside the text instead of below it.
   */
  placement: 'inside' | 'after';
}

/** The parts of an element's computed style the segmenter needs. */
export interface ElementStyle {
  display: string;
  flexDirection?: string;
  /** Visually hidden (visibility: hidden, or an sr-only style 1px/clipped box). */
  hidden?: boolean;
  /** Line breaks in the text are shown (white-space: pre-wrap / pre-line / break-spaces). */
  keepsNewlines?: boolean;
}

export interface SegmenterOptions {
  /** Minimum characters for a run to be worth translating. */
  minLength?: number;
  /** Shorthand for tests: only the display value. */
  getDisplay?: (el: Element) => string;
  getStyle?: (el: Element) => ElementStyle;
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
  // Pure URL, bare domain or email
  if (/^(https?:\/\/|www\.)\S+$/i.test(text) || /^\S+@\S+\.\S+$/.test(text)) return false;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(text)) return false;
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

/**
 * UI chrome that is rarely worth translating and whose layout breaks easily. Buttons and
 * role=button/tooltip are *not* here: sites put real content in them (headlines that expand
 * a story, course outlines, wrappers that merely carry a tooltip).
 */
const SKIP_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'navigation',
  'menu',
  'menubar',
  'tablist',
  'toolbar',
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
  // Multi-keyword values ("block math", "inline flow-root") name the outer display explicitly.
  const words = display.split(/\s+/);
  if (words.includes('inline')) return false;
  if (words.includes('block')) return true;
  // An inner display on its own: "ruby" and "math" (inline <math>) are inline-level, the rest block.
  const inner = words[0]!;
  if (inner === 'math' || inner === 'ruby' || inner.startsWith('ruby-')) return false;
  return true;
}

/** Is `el` laid out as a block (so it can hold its own paragraph)? */
export function isBlockLevel(el: Element): boolean {
  return isBlockDisplay(defaultGetStyle(el).display, el);
}

/** Screen-reader-only text and visibility:hidden boxes are not worth translating. */
function isVisuallyHidden(cs: CSSStyleDeclaration): boolean {
  if (cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
  if (cs.position !== 'absolute' && cs.position !== 'fixed') return false;
  if (parseFloat(cs.width) <= 1 || parseFloat(cs.height) <= 1) return true;
  return /^rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)$/.test(cs.clip);
}

function keepsNewlines(cs: CSSStyleDeclaration): boolean {
  const collapse = cs.getPropertyValue('white-space-collapse');
  if (collapse) return collapse !== 'collapse';
  return /^(pre|break-spaces)/.test(cs.whiteSpace);
}

/**
 * Attribute set on a block whose original text is hidden in translation-only mode. Our CSS
 * gives its children `display: none`, which must not make the segmenter lose the original text.
 */
export const HIDE_ATTR = 'data-tn-hide';

function hiddenByUs(el: Element): boolean {
  const parent = el.parentElement;
  return (
    !!parent?.hasAttribute(HIDE_ATTR) &&
    el.ownerDocument.documentElement.getAttribute('data-tn-mode') === 'translation-only'
  );
}

function defaultGetStyle(el: Element): ElementStyle {
  const view = el.ownerDocument.defaultView;
  if (!view) return { display: '' };
  try {
    const cs = view.getComputedStyle(el);
    return {
      display: cs.display,
      flexDirection: cs.flexDirection,
      hidden: isVisuallyHidden(cs),
      keepsNewlines: keepsNewlines(cs),
    };
  } catch {
    return { display: '' };
  }
}

/** Children laid out side by side: an extra child would sit beside the text, not below it. */
function isRowContainer(style: ElementStyle): boolean {
  const d = style.display;
  if (d === 'grid' || d === 'inline-grid') return true;
  return (d === 'flex' || d === 'inline-flex') && !style.flexDirection?.startsWith('column');
}

/** Children stacked vertically, so a block placed after a child shows up below it. */
function isFlowContainer(style: ElementStyle): boolean {
  const d = style.display;
  if (d === 'block' || d === 'flow-root' || d === 'list-item') return true;
  return (d === 'flex' || d === 'inline-flex') && !!style.flexDirection?.startsWith('column');
}

interface RunPiece {
  text: string;
  /** The link or styled element this text is inside, kept with an `<a id="N">` marker. */
  mark?: Element;
  /** An inline formula kept as a placeholder; `text` is its readable text. */
  atom?: Element;
}

/** Elements kept whole (as a placeholder) inside a translated sentence. */
const ATOM_TAGS = new Set(['math']);
/** Placeholder chars for atoms while the payload is built: one private-use char per atom. */
const ATOM_BASE = 0xe100;
const MAX_ATOMS = 0x100;
const ATOM_CHAR_RE = /[\uE100-\uE1FF]/g;

/** The visible text of a formula, without its TeX/MathML source annotations. */
export function atomText(el: Element): string {
  let out = '';
  const walk = (n: Node) => {
    if (n.nodeType === 3) out += (n as Text).data;
    else if (n.nodeType === 1) {
      const tag = (n as Element).localName;
      if (tag === 'annotation' || tag === 'annotation-xml') return;
      for (const c of Array.from(n.childNodes)) walk(c);
    }
  };
  walk(el);
  return out.replace(/\s+/g, '');
}

interface Run {
  nodes: Node[];
  pieces: RunPiece[];
  textNodes: Text[];
  textOnly: boolean;
}

export function isLinkElement(el: Element): el is HTMLAnchorElement {
  return el.localName === 'a' && el.hasAttribute('href');
}

function buildMarkPayload(
  allPieces: RunPiece[],
  plainText: string,
  alreadyInLink: boolean,
): { payload: string; marks: Element[]; wrapLink?: HTMLAnchorElement } {
  // A translation inserted inside a link can't hold links of its own; styled text is fine.
  const pieces = alreadyInLink
    ? allPieces.map((p) => (p.mark && isLinkElement(p.mark) ? { ...p, mark: undefined } : p))
    : allPieces;

  let hasAnyMark = false;
  let soleMark: Element | undefined;
  let allSameMark = true;
  for (const p of pieces) {
    if (!/[^\s\uE000]/.test(p.text)) continue;
    if (p.mark) {
      hasAnyMark = true;
      if (soleMark === undefined) soleMark = p.mark;
      else if (soleMark !== p.mark) allSameMark = false;
    } else {
      allSameMark = false;
    }
  }
  if (!hasAnyMark) return { payload: plainText, marks: [] };
  if (allSameMark && soleMark && isLinkElement(soleMark)) {
    return { payload: plainText, marks: [], wrapLink: soleMark };
  }

  // Merge consecutive pieces sharing the same element so nested inline tags stay one marker.
  const groups: { mark?: Element; raw: string }[] = [];
  for (const p of pieces) {
    const prev = groups[groups.length - 1];
    if (prev && prev.mark === p.mark) prev.raw += p.text;
    else groups.push({ mark: p.mark, raw: p.text });
  }

  const marks: Element[] = [];
  const out: string[] = [];
  for (const g of groups) {
    if (!g.mark) {
      out.push(g.raw);
      continue;
    }
    const leadBr = /^\s*\uE000/.test(g.raw);
    const leadSpace = !leadBr && /^\s/.test(g.raw);
    const trailBr = /\uE000\s*$/.test(g.raw);
    const trailSpace = !trailBr && /\s$/.test(g.raw);
    const inner = g.raw
      .replace(/\s+/g, ' ')
      .replace(/\s*\uE000\s*/g, BR_MARK)
      .replace(/^(?:\uE000| )+|(?:\uE000| )+$/g, '');
    if (!inner) {
      out.push(g.raw);
      continue;
    }
    marks.push(g.mark);
    const id = marks.length;
    if (leadBr) out.push(BR_MARK);
    else if (leadSpace) out.push(' ');
    out.push(`<a id="${id}">${inner}</a>`);
    if (trailBr) out.push(BR_MARK);
    else if (trailSpace) out.push(' ');
  }
  return {
    payload: marks.length > 0 ? normalizeText(out.join('')) : plainText,
    marks,
  };
}

/** The translation payload of a run: link/style markers plus `<m id="N"/>` formula placeholders. */
function buildPayload(
  pieces: RunPiece[],
  plainText: string,
  alreadyInLink: boolean,
): { payload: string; marks: Element[]; wrapLink?: HTMLAnchorElement; atoms: Element[] } {
  const atoms: Element[] = [];
  for (const p of pieces) {
    if (p.atom && atoms.length < MAX_ATOMS) atoms.push(p.atom);
  }
  if (atoms.length === 0) return { ...buildMarkPayload(pieces, plainText, alreadyInLink), atoms };
  let i = 0;
  const marked = pieces.map((p): RunPiece => {
    if (!p.atom || i >= MAX_ATOMS) return p;
    return { text: String.fromCharCode(ATOM_BASE + i++), mark: p.mark };
  });
  const markedText = normalizeText(marked.map((p) => p.text).join(''));
  const res = buildMarkPayload(marked, markedText, alreadyInLink);
  const payload = res.payload.replace(
    ATOM_CHAR_RE,
    (c) => `<m id="${c.charCodeAt(0) - ATOM_BASE + 1}"/>`,
  );
  return { payload, marks: res.marks, atoms };
}

export function collectSegments(root: Element, opts: SegmenterOptions = {}): Segment[] {
  const minLength = opts.minLength ?? 2;
  const styleCache = new Map<Element, ElementStyle>();
  const readStyle =
    opts.getStyle ??
    (opts.getDisplay ? (el: Element) => ({ display: opts.getDisplay!(el) }) : defaultGetStyle);
  const getStyle = (el: Element): ElementStyle => {
    let st = styleCache.get(el);
    if (st === undefined) {
      st = readStyle(el);
      // Hidden by our translation-only CSS, not by the page. Such a block only ever held
      // inline text (see `fullBlock`), so treat the child as the inline text it was.
      if (st.display === 'none' && el.localName !== TRANSLATION_TAG && hiddenByUs(el)) {
        st = { ...st, display: 'inline' };
      }
      styleCache.set(el, st);
    }
    return st;
  };
  const getDisplay = (el: Element): string => getStyle(el).display;
  const placementFor = (block: Element, text: string): Segment['placement'] => {
    const parent = block.parentElement;
    if (!parent || block.localName === 'body' || isShortSnippet(text)) return 'inside';
    return isRowContainer(getStyle(block)) && isFlowContainer(getStyle(parent))
      ? 'after'
      : 'inside';
  };
  const out: Segment[] = [];

  const scanBlock = (block: Element): void => {
    let run: Run | null = null;
    let runCount = 0;
    let interrupted = false;
    const blockSegments: Segment[] = [];
    const blockLink = isLinkElement(block) ? block : undefined;

    const flush = () => {
      if (!run) return;
      const r: Run = run;
      run = null;
      runCount++;
      const text = normalizeText(r.pieces.map((p) => p.text).join(''));
      if (r.textNodes.length > 0 && isTranslatableText(text, minLength)) {
        const placement = placementFor(block, text);
        const insertionParent = placement === 'after' ? block.parentElement : block;
        const alreadyInLink = Boolean(insertionParent?.closest('a[href]'));
        const { payload, marks, wrapLink, atoms } = buildPayload(r.pieces, text, alreadyInLink);
        blockSegments.push({
          block,
          nodes: r.nodes,
          textNodes: r.textNodes,
          text,
          payload,
          marks,
          atoms,
          wrapLink,
          // Translation-only mode hides the original inside the block; not possible when the
          // translation lives outside it (the block may be a button the user still needs).
          fullBlock: r.textOnly && placement === 'inside',
          placement,
        });
      }
    };

    const current = (top: Node): Run => {
      if (!run) run = { nodes: [], pieces: [], textNodes: [], textOnly: true };
      if (run.nodes[run.nodes.length - 1] !== top) run.nodes.push(top);
      return run;
    };

    /** `flat`: inside an inline-flex/inline-grid element, whose children are only blockified. */
    const visit = (
      node: Node,
      top: Node,
      flat = false,
      activeMark: Element | undefined = undefined,
    ): void => {
      if (node.nodeType === 3) {
        let data = (node as Text).data;
        // Text that shows its line breaks (posts on social sites): keep them as <br>s.
        const parent = node.parentElement;
        if (data.includes('\n') && parent && getStyle(parent).keepsNewlines) {
          data = data.replace(/\r?\n/g, BR_MARK);
        }
        if (/\S/.test(data)) {
          const r = current(top);
          r.pieces.push({ text: data, mark: activeMark });
          r.textNodes.push(node as Text);
        } else if (run) {
          run.pieces.push({ text: data.includes(BR_MARK) ? data : ' ', mark: activeMark });
        }
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node as Element;
      const tag = el.localName;
      if (tag === TRANSLATION_TAG || tag === UI_TAG) return;
      if (tag === 'br') {
        if (run) run.pieces.push({ text: BR_MARK, mark: activeMark });
        return;
      }
      const style = getStyle(el);
      const display = style.display;
      if (display === 'none') return;
      // Children of an inline-flex/inline-grid (e.g. a citation button inside a sentence)
      // compute as blocks, but visually they stay part of the line: don't split the run there.
      const block = !flat && isBlockDisplay(display, el);
      const flatten = flat || display === 'inline-flex' || display === 'inline-grid';
      // Screen-reader-only labels and invisible boxes: not translated, and not a paragraph break
      // either (an sr-only span is position:absolute, which computes as display:block).
      if (style.hidden) return;
      if (isSkipped(el)) {
        if (block) {
          flush();
          interrupted = true;
          return;
        }
        if (ATOM_TAGS.has(tag)) {
          // An inline formula is part of the sentence: keep its place with a placeholder (or,
          // inside a link or styled text, whose text is plain, with its readable text).
          const t = atomText(el);
          if (t)
            current(top).pieces.push({
              text: t,
              mark: activeMark,
              atom: activeMark ? undefined : el,
            });
          return;
        }
        const keepText =
          KEEP_TEXT_INLINE.has(tag) ||
          el.classList.contains('notranslate') ||
          el.getAttribute('translate') === 'no';
        if (keepText) {
          const t = el.textContent ?? '';
          if (/\S/.test(t)) {
            let mark = isLinkElement(el) ? el : activeMark;
            if (!mark) {
              const anchors = el.querySelectorAll('a[href]');
              if (anchors.length === 1 && anchors[0]!.textContent?.trim() === t.trim()) {
                mark = anchors[0] as HTMLAnchorElement;
              }
            }
            current(top).pieces.push({ text: t, mark });
          }
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
      // A link wins over styled text around it; inside a mark, styled text stays plain.
      const nextMark = isLinkElement(el) || (!activeMark && keepsStyle(el)) ? el : activeMark;
      for (const child of Array.from(el.childNodes)) visit(child, top, flatten, nextMark);
    };

    for (const child of Array.from(block.childNodes)) visit(child, child, false, blockLink);
    flush();

    const sole = runCount === 1 && !interrupted;
    for (const seg of blockSegments) {
      seg.fullBlock = seg.fullBlock && sole;
      out.push(seg);
    }
  };

  if (!isSkipped(root) && getDisplay(root) !== 'none' && !getStyle(root).hidden) scanBlock(root);
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
