export type InlineLinkPart =
  { type: 'text'; text: string } | { type: 'link'; index: number; text: string };

const LINK_ATTRS = [
  'href',
  'target',
  'rel',
  'title',
  'download',
  'hreflang',
  'type',
  'referrerpolicy',
  'ping',
] as const;

const INLINE_STYLE_ATTRS = ['class', 'style'] as const;

const LINK_TAG_RE = /<a\b[^>]*\bid\s*=\s*["']?(\d+)["']?[^>]*>|<\/a>/gi;

/**
 * Parse inline `<a id="N">...</a>` markers returned by the translation model.
 * Tolerates single quotes, unquoted ids, and extra attributes. Never leaks raw
 * marker tags into visible text: invalid or unclosed tags degrade cleanly to plain text.
 */
export function parseInlineLinks(
  text: string,
  linkCount: number,
  preserveLiteralClose = false,
): InlineLinkPart[] {
  if (linkCount <= 0) return text ? [{ type: 'text', text }] : [];
  const parts: InlineLinkPart[] = [];
  const pushText = (t: string) => {
    if (!t) return;
    const prev = parts[parts.length - 1];
    if (prev && prev.type === 'text') prev.text += t;
    else parts.push({ type: 'text', text: t });
  };

  let cursor = 0;
  let openId: number | undefined;
  let openStart = 0;

  LINK_TAG_RE.lastIndex = 0;
  for (const m of text.matchAll(LINK_TAG_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    const idStr = m[1];
    if (idStr !== undefined) {
      // Opening <a id="N">: if a previous tag was left unclosed, flush its inner text as plain text.
      if (openId !== undefined) pushText(text.slice(openStart, start));
      else pushText(text.slice(cursor, start));
      openId = Number(idStr);
      openStart = end;
      cursor = end;
    } else if (openId !== undefined) {
      const inner = text.slice(openStart, start);
      const idx = openId - 1;
      if (idx >= 0 && idx < linkCount && /\S/.test(inner)) {
        parts.push({ type: 'link', index: idx, text: inner });
      } else {
        pushText(inner);
      }
      openId = undefined;
      cursor = end;
    } else {
      pushText(text.slice(cursor, start));
      if (preserveLiteralClose) pushText(m[0]);
      cursor = end;
    }
  }

  if (openId !== undefined) pushText(text.slice(openStart));
  else pushText(text.slice(cursor));

  return parts;
}

/**
 * Create a safe `<a>` mirroring `source`'s navigation attributes (and inline styling when
 * `copyStyle` is true). Unmodified left-clicks delegate to `source.click()` so SPA routers
 * and JS click handlers keep working; modifier/middle/right clicks use the native `href`.
 */
export function createMirrorLink(
  doc: Document,
  source: HTMLAnchorElement,
  text: string,
  copyStyle: boolean,
): HTMLAnchorElement {
  const a = doc.createElement('a');
  for (const attr of LINK_ATTRS) {
    const val = source.getAttribute(attr);
    if (val !== null) a.setAttribute(attr, val);
  }
  if (copyStyle) {
    for (const attr of INLINE_STYLE_ATTRS) {
      const val = source.getAttribute(attr);
      if (val !== null) a.setAttribute(attr, val);
    }
  }
  a.textContent = text;
  a.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    if (!source.isConnected || source.contains(a)) return;
    const sel = doc.defaultView?.getSelection();
    if (sel && !sel.isCollapsed && a.contains(sel.anchorNode) && a.contains(sel.focusNode)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    source.click();
  });
  return a;
}

export interface RenderLinksOptions {
  plainText: string;
  block: Element;
  links: HTMLAnchorElement[];
  wrapLink?: HTMLAnchorElement;
}

/** Populate `container` with translated text, restoring whole-segment or inline links. */
export function renderTranslatedContent(
  doc: Document,
  container: HTMLElement,
  translatedText: string,
  opts: RenderLinksOptions,
): void {
  if (opts.wrapLink) {
    const a = createMirrorLink(doc, opts.wrapLink, translatedText, opts.wrapLink !== opts.block);
    container.replaceChildren(a);
    return;
  }
  if (opts.links.length === 0) {
    container.textContent = translatedText;
    return;
  }
  const preserveLiteralClose = /<\/a>/i.test(opts.plainText);
  const parts = parseInlineLinks(translatedText, opts.links.length, preserveLiteralClose);
  const nodes: Node[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      nodes.push(doc.createTextNode(part.text));
    } else {
      const source = opts.links[part.index]!;
      nodes.push(createMirrorLink(doc, source, part.text, source !== opts.block));
    }
  }
  container.replaceChildren(...nodes);
}
