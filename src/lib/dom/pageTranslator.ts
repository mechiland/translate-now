import type { SerializedError } from '../providers/errors';
import type { DisplayMode, TranslationTheme } from '../settings/schema';
import { createBatches } from '../translate/batching';
import type { SegmentResult } from '../translate/translator';
import { shouldSkipLanguage, type LanguageDetector, detectLanguage } from './detect';
import { renderTranslatedContent } from './links';
import { PAGE_CSS } from './pageStyles';
import {
  collectSegments,
  HIDE_ATTR,
  isBlockLevel,
  isInsideInjected,
  isShortSnippet,
  TRANSLATION_TAG,
  UI_TAG,
  type Segment,
} from './segmenter';

type Status = 'idle' | 'queued' | 'loading' | 'done' | 'error' | 'skipped';

interface Unit extends Segment {
  status: Status;
  el?: HTMLElement;
  error?: SerializedError;
  /** Bumped whenever the unit is reset, so stale responses are dropped. */
  gen: number;
}

export interface PageTranslatorConfig {
  targetLang: string;
  neverTranslateLangs: string[];
  displayMode: DisplayMode;
  theme: TranslationTheme;
  maxChars: number;
  maxSegments: number;
}

export interface PageTranslatorDeps {
  translate: (texts: string[]) => Promise<SegmentResult[]>;
  cancel: () => void;
  getConfig: () => PageTranslatorConfig;
  browserDetect?: LanguageDetector;
  /** Localized strings. */
  strings: { error: (message: string) => string; retry: string };
  onChange?: () => void;
  /** Called for errors the user must fix (missing key, invalid key). */
  onFatalError?: (error: SerializedError) => void;
}

const STYLE_ID = 'tn-page-style';

export type ParagraphToggle = 'translated' | 'removed' | 'none';

export class PageTranslator {
  private units = new Map<Text, Unit>();
  private byBlock = new Map<Element, Set<Unit>>();
  private memory = new Map<string, string>();
  private io: IntersectionObserver | undefined;
  private mo: MutationObserver | undefined;
  private queue = new Set<Unit>();
  /** Paragraphs translated on demand (hover) while the page itself is not translated. */
  private pinned = new Set<Unit>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private rescanTimer: ReturnType<typeof setTimeout> | undefined;
  private rescanDeadline = 0;
  private fitQueue = new Set<Unit>();
  private fitTimer: ReturnType<typeof setTimeout> | undefined;
  private _active = false;

  constructor(
    private doc: Document,
    private deps: PageTranslatorDeps,
  ) {}

  get active(): boolean {
    return this._active;
  }

  stats() {
    let done = 0;
    let pending = 0;
    let errors = 0;
    for (const u of this.units.values()) {
      if (u.status === 'done') done++;
      else if (u.status === 'error') errors++;
      else if (u.status === 'queued' || u.status === 'loading') pending++;
    }
    return { total: this.units.size, done, pending, errors };
  }

  start(): void {
    if (this._active) return;
    this._active = true;
    this.injectStyle();
    this.applyDisplay();
    const view = this.doc.defaultView;
    if (view && 'IntersectionObserver' in view) {
      this.io = new view.IntersectionObserver((entries) => this.onIntersect(entries), {
        rootMargin: '600px 0px 600px 0px',
      });
    }
    if (view && 'MutationObserver' in view) {
      this.mo = new view.MutationObserver((records) => this.onMutations(records));
      this.mo.observe(this.doc.body ?? this.doc.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'open', 'style'],
        attributeOldValue: true,
      });
    }
    this.scan();
    this.deps.onChange?.();
  }

  stop(): void {
    if (!this._active && this.pinned.size === 0) return;
    this._active = false;
    this.deps.cancel();
    this.io?.disconnect();
    this.mo?.disconnect();
    this.io = undefined;
    this.mo = undefined;
    clearTimeout(this.flushTimer);
    clearTimeout(this.rescanTimer);
    clearTimeout(this.fitTimer);
    this.fitTimer = undefined;
    this.fitQueue.clear();
    this.queue.clear();
    for (const unit of this.units.values()) this.resetUnit(unit);
    this.units.clear();
    this.byBlock.clear();
    this.pinned.clear();
    const html = this.doc.documentElement;
    html.removeAttribute('data-tn-mode');
    html.removeAttribute('data-tn-theme');
    this.deps.onChange?.();
  }

  toggle(): boolean {
    if (this._active) this.stop();
    else this.start();
    return this._active;
  }

  /** Re-read display mode / theme from config. No network requests. */
  applyDisplay(): void {
    if (!this._active) return;
    const cfg = this.deps.getConfig();
    const html = this.doc.documentElement;
    const modeChanged = html.getAttribute('data-tn-mode') !== cfg.displayMode;
    html.setAttribute('data-tn-mode', cfg.displayMode);
    html.setAttribute('data-tn-theme', cfg.theme);
    // Hiding the original frees room (or the reverse): fit the translations again.
    if (modeChanged) {
      for (const u of this.units.values()) {
        if (!u.el || u.status !== 'done') continue;
        if (u.fullBlock && u.placement === 'after') {
          const text = this.memory.get(u.payload);
          if (text !== undefined) this.renderDone(u, text);
        } else {
          this.scheduleFitCheck(u);
        }
      }
    }
  }

  /** Forget in-memory results (e.g. after the target language changed) and re-translate. */
  restart(): void {
    const was = this._active;
    this.stop();
    this.memory.clear();
    if (was) this.start();
  }

  /**
   * Translate the single paragraph containing `target` without translating the page,
   * or remove that translation again. While the whole page is translated this does
   * nothing (except retrying a failed paragraph), since every paragraph is handled.
   */
  toggleParagraph(target: Node): ParagraphToggle {
    const injected = closestTranslation(target);
    if (injected) {
      const unit = [...this.units.values()].find((u) => u.el === injected);
      if (!unit) return 'none';
      return this.togglePinned(unit);
    }
    const seg = this.segmentAt(target);
    if (!seg) return 'none';
    const existing = this.units.get(seg.textNodes[0]!);
    if (existing && existing.block === seg.block && existing.payload === seg.payload) {
      return this.togglePinned(existing);
    }
    if (existing) this.removeUnit(existing);
    if (this._active) return 'none';

    this.injectStyle();
    // Hover translations always show below the original, in the configured theme.
    this.doc.documentElement.setAttribute('data-tn-theme', this.deps.getConfig().theme);
    const unit: Unit = { ...seg, status: 'idle', gen: 0 };
    this.addUnit(unit);
    this.pinned.add(unit);
    const cached = this.memory.get(unit.payload);
    if (cached !== undefined) this.renderDone(unit, cached);
    else this.enqueue(unit);
    this.deps.onChange?.();
    return 'translated';
  }

  retryErrors(): void {
    for (const unit of this.units.values()) {
      if (unit.status === 'error') {
        this.resetUnit(unit);
        this.enqueue(unit);
      }
    }
  }

  // ---------------------------------------------------------------------------

  private togglePinned(unit: Unit): ParagraphToggle {
    if (unit.status === 'error') {
      this.resetUnit(unit);
      this.enqueue(unit);
      return 'translated';
    }
    if (this._active || !this.pinned.has(unit)) return 'none';
    this.removeUnit(unit);
    if (this.pinned.size === 0) this.doc.documentElement.removeAttribute('data-tn-theme');
    this.deps.onChange?.();
    return 'removed';
  }

  /** The translatable run that contains `target`, in its nearest block-level ancestor. */
  private segmentAt(target: Node): Segment | undefined {
    const body = this.doc.body;
    let el: Element | null = target.nodeType === 1 ? (target as Element) : target.parentElement;
    if (!el || !body?.contains(el) || el === body || isInsideInjected(el)) return undefined;
    while (el && el !== body && !isBlockLevel(el)) el = el.parentElement;
    if (!el || el === body) return undefined;
    const block = el;
    // Segments of nested blocks never contain `target` (it isn't inside them), except an
    // inline box translated as a block of its own (a button), which is what we want then.
    const segments = collectSegments(block);
    return (
      segments.find((s) => s.nodes.some((n) => n === target || n.contains(target))) ??
      // Pointer on the block's padding/margin rather than on its text.
      (target === block ? segments.find((s) => s.block === block) : undefined)
    );
  }

  private addUnit(unit: Unit): void {
    this.units.set(unit.textNodes[0]!, unit);
    let set = this.byBlock.get(unit.block);
    if (!set) this.byBlock.set(unit.block, (set = new Set()));
    set.add(unit);
  }

  private injectStyle(): void {
    if (this.doc.getElementById(STYLE_ID)) return;
    const style = this.doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PAGE_CSS;
    (this.doc.head ?? this.doc.documentElement).appendChild(style);
  }

  private scan(): void {
    if (!this._active) return;
    const root = this.doc.body;
    if (!root) return;
    const segments = collectSegments(root);
    const seen = new Set<Unit>();
    for (const seg of segments) {
      const key = seg.textNodes[0]!;
      const existing = this.units.get(key);
      if (existing && existing.block === seg.block && existing.payload === seg.payload) {
        existing.nodes = seg.nodes;
        existing.textNodes = seg.textNodes;
        existing.fullBlock = seg.fullBlock;
        existing.decor = seg.decor;
        existing.placement = seg.placement;
        if (!sameInlineElements(existing, seg)) {
          existing.marks = seg.marks;
          existing.wrapLink = seg.wrapLink;
          existing.atoms = seg.atoms;
          const cached = this.memory.get(existing.payload);
          if (existing.status === 'done' && cached !== undefined) this.renderDone(existing, cached);
        }
        seen.add(existing);
        continue;
      }
      if (existing) this.removeUnit(existing);
      const unit: Unit = { ...seg, status: 'idle', gen: 0 };
      this.addUnit(unit);
      // (Re-)observing triggers a fresh intersection callback for this block.
      this.io?.unobserve(seg.block);
      this.io?.observe(seg.block);
      seen.add(unit);
      const cached = this.memory.get(unit.payload);
      if (cached !== undefined) this.renderDone(unit, cached);
      else if (!this.io) this.enqueue(unit);
    }
    for (const unit of [...this.units.values()]) {
      if (!seen.has(unit)) this.removeUnit(unit);
    }
    this.deps.onChange?.();
  }

  private removeUnit(unit: Unit): void {
    this.resetUnit(unit);
    this.queue.delete(unit);
    this.pinned.delete(unit);
    const key = unit.textNodes[0];
    if (key && this.units.get(key) === unit) this.units.delete(key);
    const set = this.byBlock.get(unit.block);
    if (set) {
      set.delete(unit);
      if (set.size === 0) {
        this.byBlock.delete(unit.block);
        this.io?.unobserve(unit.block);
      }
    }
  }

  /** Remove anything we injected for this unit and return it to idle. */
  private resetUnit(unit: Unit): void {
    unit.gen++;
    unit.el?.remove();
    unit.el = undefined;
    unit.status = 'idle';
    unit.error = undefined;
    unhide(unit.block);
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const set = this.byBlock.get(entry.target);
      if (!set) continue;
      for (const unit of set) if (unit.status === 'idle') this.enqueue(unit);
    }
  }

  private onMutations(records: MutationRecord[]): void {
    const relevant = records.some((r) => {
      if (isInsideInjected(r.target)) return false;
      if (r.type === 'characterData') return true;
      if (r.type === 'attributes') {
        if (r.attributeName !== 'style') return true;
        const el = r.target as Element;
        // Ignore our custom properties and unrelated inline style changes such as animations.
        return visibilityStyles(r.oldValue) !== visibilityStyles(el.getAttribute('style'));
      }
      const nodes = [...Array.from(r.addedNodes), ...Array.from(r.removedNodes)];
      return nodes.some((n) => {
        if (n.nodeType === 1) {
          const tag = (n as Element).localName;
          return tag !== TRANSLATION_TAG && tag !== UI_TAG && (n as Element).id !== STYLE_ID;
        }
        return n.nodeType === 3;
      });
    });
    if (!relevant) return;
    // Debounce, but never wait more than 1.5s on pages that mutate continuously.
    const now = Date.now();
    if (!this.rescanTimer) this.rescanDeadline = now + 1500;
    clearTimeout(this.rescanTimer);
    const delay = Math.max(0, Math.min(300, this.rescanDeadline - now));
    this.rescanTimer = setTimeout(() => {
      this.rescanTimer = undefined;
      this.scan();
    }, delay);
  }

  private enqueue(unit: Unit): void {
    if (!this._active && !this.pinned.has(unit)) return;
    unit.status = 'queued';
    this.queue.add(unit);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        void this.flush();
      }, 40);
    }
  }

  private async flush(): Promise<void> {
    const units = [...this.queue];
    this.queue.clear();
    if (units.length === 0) return;
    const cfg = this.deps.getConfig();
    const gens = new Map(units.map((u) => [u, u.gen]));
    const fresh = (u: Unit) =>
      (this._active || this.pinned.has(u)) &&
      gens.get(u) === u.gen &&
      this.units.has(u.textNodes[0]!);

    const decisions = await Promise.all(
      units.map(async (u) => {
        const lang = await detectLanguage(u.text, this.deps.browserDetect);
        return shouldSkipLanguage(lang, cfg.targetLang, cfg.neverTranslateLangs);
      }),
    );
    const todo: Unit[] = [];
    units.forEach((u, i) => {
      if (!fresh(u)) return;
      if (decisions[i]) u.status = 'skipped';
      else todo.push(u);
    });
    if (todo.length === 0) {
      this.deps.onChange?.();
      return;
    }
    for (const u of todo) this.renderLoading(u);
    this.deps.onChange?.();

    const batches = createBatches(
      todo.map((u) => ({ text: u.payload, data: u })),
      cfg.maxChars,
      cfg.maxSegments,
    );
    await Promise.all(
      batches.map(async (batch) => {
        let results: SegmentResult[];
        try {
          results = await this.deps.translate(batch.map((b) => b.text));
        } catch (e) {
          const error: SerializedError = {
            kind: 'network',
            message: e instanceof Error ? e.message : String(e),
          };
          results = batch.map(() => ({ ok: false, error }));
        }
        batch.forEach((b, i) => {
          const u = b.data;
          if (!fresh(u)) return;
          const r = results[i];
          if (r?.ok) {
            this.memory.set(u.payload, r.text);
            this.renderDone(u, r.text);
          } else if (r && r.error.kind === 'aborted') {
            this.resetUnit(u);
          } else {
            this.renderError(u, r?.error ?? { kind: 'parse', message: 'No result' });
          }
        });
        const fatal = results.find(
          (r) => !r.ok && (r.error.kind === 'config' || r.error.kind === 'auth'),
        );
        if (fatal && !fatal.ok) this.deps.onFatalError?.(fatal.error);
        this.deps.onChange?.();
      }),
    );
  }

  private ensureEl(unit: Unit): HTMLElement | undefined {
    // Inside the block right after the run, or right after the block itself (row layouts).
    // Right after the text, before trailing icons ("Get started →" keeps its arrow last).
    const lastText = unit.nodes.findLast((n) => !unit.decor.includes(n as Element));
    const outside = this.placeAfter(unit);
    const anchor = outside ? unit.block : lastText;
    const parent = outside ? unit.block.parentNode : unit.block;
    if (!anchor || !parent || anchor.parentNode !== parent) return undefined;
    if (!unit.el) unit.el = this.doc.createElement(TRANSLATION_TAG);
    if (unit.el.previousSibling !== anchor || unit.el.parentNode !== parent) {
      parent.insertBefore(unit.el, anchor.nextSibling);
    }
    unit.el.className = '';
    unit.el.removeAttribute('title');
    unit.el.onclick = null;
    return unit.el;
  }

  private placeAfter(unit: Unit): boolean {
    return (
      unit.placement === 'after' &&
      (!unit.fullBlock ||
        this.doc.documentElement.getAttribute('data-tn-mode') !== 'translation-only')
    );
  }

  private renderLoading(unit: Unit): void {
    unit.status = 'loading';
    const el = this.ensureEl(unit);
    if (!el) return;
    el.className = 'tn-loading';
    el.textContent = '';
  }

  private renderDone(unit: Unit, text: string): void {
    unit.status = 'done';
    // Names, numbers and text already in the target language come back unchanged: showing
    // them twice only adds clutter.
    if (sameText(text, unit.text)) {
      unit.el?.remove();
      unit.el = undefined;
      unhide(unit.block);
      return;
    }
    const el = this.ensureEl(unit);
    if (!el) return;
    const outside = this.placeAfter(unit);
    const inline = !outside && isShortSnippet(unit.text);
    el.className = inline ? 'tn-done tn-inline' : 'tn-done';
    el.removeAttribute('style');
    this.scheduleFitCheck(unit);
    el.setAttribute('lang', this.deps.getConfig().targetLang);
    const span = this.doc.createElement('span');
    span.className = 'tn-text';
    renderTranslatedContent(this.doc, span, text, {
      plainText: unit.text,
      block: unit.block,
      marks: unit.marks,
      wrapLink: unit.wrapLink === unit.block && !outside ? undefined : unit.wrapLink,
      atoms: unit.atoms,
    });
    el.replaceChildren(span);
    const view = this.doc.defaultView;
    if (!view) return;
    // Measure the original as shown, not as hidden by translation-only mode.
    unhide(unit.block);
    // Text wrapped in one styled element (<h2><span class="title">…</span></h2>): the
    // translation sits beside that element, so give it the element's text style.
    // Text that isn't laid out yet (font-size 0 until a script sizes it) has no style to copy.
    const sized = (c: CSSStyleDeclaration) => parseFloat(c.fontSize) >= 2;
    const cs = view.getComputedStyle(unit.block);
    el.classList.toggle('tn-nowrap', cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap');
    const source = textStyleSource(unit);
    let tcs = source === unit.block ? cs : view.getComputedStyle(source);
    if ((tcs !== cs || outside) && sized(tcs)) {
      for (const prop of TEXT_STYLE_PROPS) el.style.setProperty(prop, tcs.getPropertyValue(prop));
    } else {
      tcs = cs;
    }
    if (!unit.fullBlock) return;
    if (sized(tcs)) {
      el.style.setProperty('--tn-fs', tcs.fontSize);
      el.style.setProperty('--tn-lh', tcs.lineHeight);
      el.style.setProperty('--tn-ls', tcs.letterSpacing);
    }
    const block = unit.block as HTMLElement;
    const parent = block.parentElement;
    // Keep ordinary words in the intrinsic width of a flexible title. Allow extreme tokens
    // such as URLs to wrap anywhere so they can't force a whole row off screen.
    if (
      !outside &&
      parent &&
      Number(cs.flexGrow) > 0 &&
      cs.minWidth === 'auto' &&
      !/\S{24}/u.test(span.textContent ?? '')
    ) {
      const row = view.getComputedStyle(parent);
      if (row.display.endsWith('flex') && row.flexDirection.startsWith('row')) {
        el.style.overflowWrap = 'break-word';
      }
    }
    const set = (name: string, value: string) => block.style.setProperty(name, value);
    set('--tn-m', `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`);
    set('--tn-p', `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`);
    // Resolved values: em is converted to px, percentages and keywords stay as they are.
    set('--tn-minw', cs.minWidth);
    set('--tn-maxw', cs.maxWidth);
    set('--tn-minh', cs.minHeight);
    set('--tn-maxh', cs.maxHeight);
    set('--tn-gap', `${cs.rowGap} ${cs.columnGap}`);
    set('--tn-br', borderRadius(cs));
    if (unit.block.localName === 'li') set('--tn-marker-fs', cs.fontSize);
    set('--tn-bfs', cs.fontSize);
    for (const d of unit.decor) if (d.parentNode === unit.block) d.setAttribute('data-tn-keep', '');
    unit.block.setAttribute(HIDE_ATTR, '');
  }

  /** Check translations once laid out; hide the ones squeezed into a narrow box. */
  private scheduleFitCheck(unit: Unit): void {
    this.fitQueue.add(unit);
    if (this.fitTimer) return;
    this.fitTimer = setTimeout(() => {
      this.fitTimer = undefined;
      const units = [...this.fitQueue];
      this.fitQueue.clear();
      for (const u of units) if (u.el) u.el.classList.remove('tn-squeezed');
      // Read all layouts first, then write, to avoid a reflow per unit.
      const squeezed = units.filter((u) => u.status === 'done' && u.el && isSqueezed(u.el));
      for (const u of squeezed) u.el!.classList.add('tn-squeezed');
    }, 60);
  }

  private renderError(unit: Unit, error: SerializedError): void {
    unit.status = 'error';
    unit.error = error;
    const el = this.ensureEl(unit);
    if (!el) return;
    el.className = 'tn-error';
    el.textContent = `⚠ ${this.deps.strings.retry}`;
    el.title = this.deps.strings.error(error.message);
    el.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.resetUnit(unit);
      this.enqueue(unit);
    };
  }
}

const HIDE_VARS = [
  '--tn-m',
  '--tn-p',
  '--tn-minw',
  '--tn-maxw',
  '--tn-minh',
  '--tn-maxh',
  '--tn-gap',
  '--tn-br',
  '--tn-marker-fs',
  '--tn-bfs',
];

function visibilityStyles(style: string | null): string {
  return (
    (style ?? '')
      .match(/(?:^|;)\s*(?:display|visibility|content-visibility|font-size)\s*:[^;]*/gi)
      ?.join('') ?? ''
  );
}

/** Undo what translation-only mode set on a block. */
function unhide(block: Element): void {
  if (!block.hasAttribute(HIDE_ATTR)) return;
  block.removeAttribute(HIDE_ATTR);
  const style = (block as HTMLElement).style;
  for (const name of HIDE_VARS) style?.removeProperty(name);
  for (const d of Array.from(block.children)) d.removeAttribute('data-tn-keep');
}

/**
 * A translation broken over several lines none of which holds two characters: the box it is
 * in is too narrow for it (a tab, a pill, an avatar) and it would read as a column of glyphs.
 */
function isSqueezed(el: HTMLElement): boolean {
  // Line fragments of the text itself: a block box has one client rect however many lines.
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
  const lines = new Set(rects.map((r) => Math.round(r.top))).size;
  if (lines < 2) return false;
  const fs = parseFloat(el.ownerDocument.defaultView?.getComputedStyle(el).fontSize ?? '') || 16;
  return Math.max(...rects.map((r) => r.width)) < fs * 1.6;
}

/** Inherited text properties a translation copies from the element its original text is in. */
const TEXT_STYLE_PROPS = [
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'color',
  'letter-spacing',
  'line-height',
  'text-align',
];

/** The innermost element holding all of the unit's text, if it is inside the block. */
function textStyleSource(unit: Segment): Element {
  let common: Element | null = unit.textNodes[0]?.parentElement ?? null;
  for (const t of unit.textNodes) {
    while (common && !common.contains(t)) common = common.parentElement;
  }
  return common && common !== unit.block && unit.block.contains(common) ? common : unit.block;
}

/** The border-radius shorthand of the four computed corners ("10px" or "10px 5px" each). */
function borderRadius(cs: CSSStyleDeclaration): string {
  const corners = [
    cs.borderTopLeftRadius,
    cs.borderTopRightRadius,
    cs.borderBottomRightRadius,
    cs.borderBottomLeftRadius,
  ].map((c) => c.split(/\s+/));
  return `${corners.map((c) => c[0]).join(' ')} / ${corners.map((c) => c[1] ?? c[0]).join(' ')}`;
}

const INLINE_TAGS_RE = /<\/?a(?: id="\d+")?>|<m id="\d+"\/>/g;

/** A translation that only repeats the original. */
function sameText(translated: string, original: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  return norm(translated.replace(INLINE_TAGS_RE, '')) === norm(original);
}

/** Same links, styled text and formulas, so an existing translation still points at the right elements. */
function sameInlineElements(a: Segment, b: Segment): boolean {
  if (a.wrapLink !== b.wrapLink || a.marks.length !== b.marks.length) return false;
  if (a.atoms.length !== b.atoms.length) return false;
  return a.marks.every((el, i) => el === b.marks[i]) && a.atoms.every((el, i) => el === b.atoms[i]);
}

function closestTranslation(node: Node): HTMLElement | undefined {
  let n: Node | null = node;
  while (n) {
    if (n.nodeType === 1 && (n as Element).localName === TRANSLATION_TAG) return n as HTMLElement;
    n = n.parentNode;
  }
  return undefined;
}
