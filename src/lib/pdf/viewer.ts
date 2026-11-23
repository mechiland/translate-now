import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import { detectLanguage, shouldSkipLanguage, type LanguageDetector } from '../dom/detect';
import type { SerializedError } from '../providers/errors';
import type { DisplayMode } from '../settings/schema';
import { createBatches } from '../translate/batching';
import type { SegmentResult } from '../translate/translator';
import { extractBlocks, type FontMetrics, type PdfBlock } from './layout';
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';

/**
 * Side-by-side PDF translation view.
 *
 * Each page is rendered once to a bitmap that both columns share. The left column adds
 * pdf.js's invisible text layer (select, copy, selection translation); the right column
 * covers every translated paragraph with a patch of the page's background color and
 * draws the translation on top, fitted to the paragraph's box. Figures, tables and
 * equations stay untouched, so the translated page keeps the original layout.
 */

type Status = 'idle' | 'queued' | 'loading' | 'done' | 'error' | 'skipped';

interface Unit {
  page: Page;
  block: PdfBlock;
  status: Status;
  el?: HTMLElement;
  /** Background color under the paragraph, sampled from the rendered page. */
  bg: string;
  bold: boolean;
  text?: string;
  error?: SerializedError;
  gen: number;
  needsFit?: boolean;
}

interface Page {
  index: number;
  /** Size in PDF points (viewport at scale 1). */
  w: number;
  h: number;
  row: HTMLElement;
  origImg: HTMLImageElement;
  transImg: HTMLImageElement;
  textLayer: HTMLElement;
  overlay: HTMLElement;
  proxy?: PDFPageProxy;
  textContent?: TextContent;
  units?: Unit[];
  extracting?: Promise<void>;
  renderScale: number;
  rendering?: Promise<void>;
  imgUrl?: string;
  textLayerDone: boolean;
  near: boolean;
}

export interface PdfViewerConfig {
  targetLang: string;
  neverTranslateLangs: string[];
  displayMode: DisplayMode;
  maxChars: number;
  maxSegments: number;
}

export interface PdfViewerDeps {
  translate: (texts: string[]) => Promise<SegmentResult[]>;
  cancel: () => void;
  getConfig: () => PdfViewerConfig;
  browserDetect?: LanguageDetector;
  strings: { error: (message: string) => string; retry: string };
  onChange?: () => void;
  onFatalError?: (error: SerializedError) => void;
}

export interface PdfStats {
  total: number;
  done: number;
  pending: number;
  errors: number;
}

/** Layout units per PDF point in the translation overlay (keeps fitted text crisp). */
const L = 2;
const PAD = 1;
const GAP = 16;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4;
/** CSS px per PDF point when printing: 1pt = 1/72in, 1px = 1/96in. */
const PRINT_ZOOM = 96 / 72;
/** Bold font names: "Times-Bold", "NimbusRomNo9L-Medi", "CMBX10", "Arial-BlackMT"... */
const BOLD_FONT = /bold|black|heavy|demi|medi|cmbx/i;

export class PdfViewer {
  private pages: Page[] = [];
  private container: HTMLElement;
  private io: IntersectionObserver | undefined;
  private ro: ResizeObserver | undefined;
  private queue = new Set<Unit>();
  private memory = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private rerenderTimer: ReturnType<typeof setTimeout> | undefined;
  private idleWaiters: (() => void)[] = [];
  private renderSlots = 2;
  private renderWaiters: (() => void)[] = [];
  private _active = false;
  private _zoom = 1;
  private fit = true;
  private _currentPage = 1;
  private scrollFrame = 0;
  private destroyed = false;

  constructor(
    private scroller: HTMLElement,
    private doc: PDFDocumentProxy,
    private deps: PdfViewerDeps,
  ) {
    this.container = scroller.ownerDocument.createElement('div');
    this.container.className = 'pdf-pages';
    scroller.replaceChildren(this.container);
  }

  get active(): boolean {
    return this._active;
  }
  get zoom(): number {
    return this._zoom;
  }
  get fitWidth(): boolean {
    return this.fit;
  }
  get numPages(): number {
    return this.doc.numPages;
  }
  get currentPage(): number {
    return this._currentPage;
  }

  async init(): Promise<void> {
    const d = this.scroller.ownerDocument;
    const proxies = await Promise.all(
      Array.from({ length: this.doc.numPages }, (_, i) => this.doc.getPage(i + 1)),
    );
    if (this.destroyed) return;
    for (const proxy of proxies) {
      const vp = proxy.getViewport({ scale: 1 });
      const row = d.createElement('div');
      row.className = 'pdf-row';
      row.dataset.page = String(proxy.pageNumber);
      row.style.setProperty('--w', String(vp.width));
      row.style.setProperty('--h', String(vp.height));

      const orig = d.createElement('div');
      orig.className = 'pdf-page pdf-original';
      const origImg = d.createElement('img');
      origImg.className = 'pdf-bitmap';
      origImg.alt = '';
      const textLayer = d.createElement('div');
      textLayer.className = 'textLayer';
      orig.append(origImg, textLayer);

      const trans = d.createElement('div');
      trans.className = 'pdf-page pdf-translated';
      const transImg = d.createElement('img');
      transImg.className = 'pdf-bitmap';
      transImg.alt = '';
      const overlay = d.createElement('div');
      overlay.className = 'tn-pdf-overlay';
      overlay.style.width = `${vp.width * L}px`;
      overlay.style.height = `${vp.height * L}px`;
      trans.append(transImg, overlay);

      row.append(orig, trans);
      this.container.append(row);
      this.pages.push({
        index: proxy.pageNumber - 1,
        w: vp.width,
        h: vp.height,
        row,
        origImg,
        transImg,
        textLayer,
        overlay,
        proxy,
        renderScale: 0,
        textLayerDone: false,
        near: false,
      });
    }
    this.applyDisplay();
    this.updateFit();
    const view = d.defaultView!;
    this.io = new view.IntersectionObserver((entries) => this.onIntersect(entries), {
      root: this.scroller,
      rootMargin: '100% 0px 100% 0px',
    });
    for (const p of this.pages) this.io.observe(p.row);
    this.ro = new view.ResizeObserver(() => {
      if (this.fit) this.updateFit();
    });
    this.ro.observe(this.scroller);
    this.scroller.addEventListener('scroll', this.onScroll, { passive: true });
    this.deps.onChange?.();
  }

  destroy(): void {
    this.destroyed = true;
    this.deps.cancel();
    this.io?.disconnect();
    this.ro?.disconnect();
    this.scroller.removeEventListener('scroll', this.onScroll);
    clearTimeout(this.flushTimer);
    clearTimeout(this.rerenderTimer);
    for (const p of this.pages) if (p.imgUrl) URL.revokeObjectURL(p.imgUrl);
    void this.doc.loadingTask.destroy();
  }

  stats(): PdfStats {
    let done = 0;
    let pending = 0;
    let errors = 0;
    for (const p of this.pages) {
      for (const u of p.units ?? []) {
        if (u.status === 'done') done++;
        else if (u.status === 'error') errors++;
        else if (u.status === 'queued' || u.status === 'loading') pending++;
      }
    }
    return { total: done + pending + errors, done, pending, errors };
  }

  // ---- translation on/off ---------------------------------------------------

  start(): void {
    if (this._active) return;
    this._active = true;
    this.applyDisplay();
    if (this.fit) this.updateFit();
    for (const p of this.pages) if (p.near) void this.preparePage(p);
    this.deps.onChange?.();
  }

  /** Show the original only. Finished translations stay in place for a quick switch back. */
  stop(): void {
    if (!this._active) return;
    this._active = false;
    this.deps.cancel();
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    this.queue.clear();
    for (const u of this.units()) {
      if (u.status === 'queued' || u.status === 'loading') this.resetUnit(u);
    }
    this.applyDisplay();
    if (this.fit) this.updateFit();
    this.resolveIdle();
    this.deps.onChange?.();
  }

  toggle(): boolean {
    if (this._active) this.stop();
    else this.start();
    return this._active;
  }

  /** Forget all translations (target language, style or service changed) and start over. */
  restart(): void {
    const was = this._active;
    this.stop();
    this.memory.clear();
    for (const u of this.units()) this.resetUnit(u);
    if (was) this.start();
  }

  retryErrors(): void {
    for (const u of this.units()) {
      if (u.status === 'error') {
        this.resetUnit(u);
        this.enqueue(u);
      }
    }
  }

  /** Re-read the display mode. No network requests. */
  applyDisplay(): void {
    const mode = this.deps.getConfig().displayMode;
    const root = this.scroller;
    const changed = root.dataset.mode !== mode || root.dataset.translated !== String(this._active);
    root.dataset.mode = mode;
    root.dataset.translated = String(this._active);
    if (changed && this.fit) this.updateFit();
    if (this._active) for (const u of this.units()) if (u.needsFit) this.fitUnit(u);
  }

  // ---- zoom & navigation ------------------------------------------------------

  setZoom(zoom: number | 'fit'): void {
    if (zoom === 'fit') {
      this.fit = true;
      this.updateFit();
      return;
    }
    this.fit = false;
    this.applyZoom(zoom);
  }

  zoomBy(factor: number): void {
    this.setZoom(Math.round(this._zoom * factor * 20) / 20);
  }

  scrollToPage(n: number): void {
    this.pages[n - 1]?.row.scrollIntoView({ block: 'start' });
  }

  private columns(): number {
    return this._active && this.deps.getConfig().displayMode === 'bilingual' ? 2 : 1;
  }

  private updateFit(): void {
    if (this.pages.length === 0) return;
    const cols = this.columns();
    const maxW = Math.max(...this.pages.map((p) => p.w));
    const avail = this.scroller.clientWidth - 2 * GAP;
    if (avail <= 0) return;
    const z = (avail - (cols - 1) * GAP) / (maxW * cols);
    // Fit, but don't blow a single page up to a full-HD width.
    this.applyZoom(Math.min(z, cols === 1 ? 1.6 : 2));
  }

  private applyZoom(zoom: number): void {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (Math.abs(z - this._zoom) < 0.001 && this.scroller.style.getPropertyValue('--zoom')) return;
    // Keep the same spot of the document in view.
    const ratio = this.scroller.scrollTop / Math.max(1, this.scroller.scrollHeight);
    this._zoom = z;
    this.scroller.style.setProperty('--zoom', String(z));
    this.scroller.scrollTop = ratio * this.scroller.scrollHeight;
    clearTimeout(this.rerenderTimer);
    this.rerenderTimer = setTimeout(() => {
      for (const p of this.pages) if (p.near) void this.preparePage(p);
    }, 200);
    this.deps.onChange?.();
  }

  private onScroll = () => {
    if (this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      const top = this.scroller.getBoundingClientRect().top;
      const mid = top + this.scroller.clientHeight / 3;
      let current = this._currentPage;
      for (const p of this.pages) {
        const r = p.row.getBoundingClientRect();
        if (r.top <= mid && r.bottom >= mid) {
          current = p.index + 1;
          break;
        }
      }
      if (current !== this._currentPage) {
        this._currentPage = current;
        this.deps.onChange?.();
      }
    });
  };

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const p = this.pages[Number((entry.target as HTMLElement).dataset.page) - 1];
      if (!p) continue;
      p.near = entry.isIntersecting;
      if (p.near) void this.preparePage(p);
    }
  }

  // ---- pages ----------------------------------------------------------------

  private wantedScale(): number {
    const dpr = this.scroller.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    return Math.min(4, Math.max(1.5, Math.ceil(this._zoom * dpr * 2) / 2));
  }

  private async preparePage(p: Page, minScale = 0): Promise<void> {
    try {
      await this.extract(p);
      const scale = Math.max(minScale, this.wantedScale());
      if (p.renderScale < scale) await this.render(p, scale);
      if (!p.textLayerDone) await this.renderTextLayer(p);
      if (this._active) for (const u of p.units ?? []) if (u.status === 'idle') this.enqueue(u);
    } catch (e) {
      if (!this.destroyed) console.warn('[translate-now] PDF page failed', p.index + 1, e);
    }
  }

  private extract(p: Page): Promise<void> {
    p.extracting ??= (async () => {
      const proxy = p.proxy!;
      const tc = await proxy.getTextContent();
      p.textContent = tc;
      const vp = proxy.getViewport({ scale: 1 });
      const blocks = extractBlocks(
        tc.items.filter((i) => 'str' in i),
        tc.styles as Record<string, FontMetrics>,
        vp.transform,
      );
      p.units = blocks.map((block) => ({
        page: p,
        block,
        status: block.translatable ? 'idle' : 'skipped',
        bg: '#fff',
        bold: false,
        gen: 0,
      }));
    })();
    return p.extracting;
  }

  private async acquireRender(): Promise<void> {
    if (this.renderSlots > 0) {
      this.renderSlots--;
      return;
    }
    await new Promise<void>((r) => this.renderWaiters.push(r));
  }

  private releaseRender(): void {
    const next = this.renderWaiters.shift();
    if (next) next();
    else this.renderSlots++;
  }

  private render(p: Page, scale: number): Promise<void> {
    const run = async () => {
      if (p.renderScale >= scale) return;
      await this.acquireRender();
      try {
        if (this.destroyed || p.renderScale >= scale) return;
        const proxy = p.proxy!;
        const viewport = proxy.getViewport({ scale });
        const canvas = this.scroller.ownerDocument.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await proxy.render({ canvas, viewport }).promise;
        if (p.renderScale === 0) this.sampleBlocks(p, canvas, scale);
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        canvas.width = canvas.height = 0;
        if (!blob || this.destroyed) return;
        const old = p.imgUrl;
        p.imgUrl = URL.createObjectURL(blob);
        p.renderScale = scale;
        p.origImg.src = p.imgUrl;
        p.transImg.src = p.imgUrl;
        if (old) {
          // Revoke once the new bitmap has replaced the old one on screen.
          void p.origImg
            .decode()
            .catch(() => {})
            .finally(() => URL.revokeObjectURL(old));
        }
      } finally {
        this.releaseRender();
      }
    };
    const prev = p.rendering ?? Promise.resolve();
    p.rendering = prev.then(run, run);
    return p.rendering;
  }

  /** Background color around each paragraph and whether its font is bold. */
  private sampleBlocks(p: Page, canvas: HTMLCanvasElement, scale: number): void {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const units = p.units ?? [];
    if (ctx && units.length > 0) {
      const { width, height } = canvas;
      const data = ctx.getImageData(0, 0, width, height).data;
      const px = (x: number, y: number): [number, number, number] | undefined => {
        const ix = Math.round(x * scale);
        const iy = Math.round(y * scale);
        if (ix < 0 || iy < 0 || ix >= width || iy >= height) return undefined;
        const o = (iy * width + ix) * 4;
        return [data[o]!, data[o + 1]!, data[o + 2]!];
      };
      for (const u of units) {
        const { x, y, w, h } = u.block.rect;
        const m = PAD + 1.5;
        const samples = [
          px(x - m, y - m),
          px(x + w + m, y - m),
          px(x - m, y + h + m),
          px(x + w + m, y + h + m),
          px(x + w / 2, y - m),
          px(x + w / 2, y + h + m),
          px(x - m, y + h / 2),
          px(x + w + m, y + h / 2),
        ].filter((s) => s !== undefined);
        if (samples.length === 0) continue;
        const median = (i: number) =>
          samples.map((s) => s[i]!).sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
        u.bg = `rgb(${median(0)}, ${median(1)}, ${median(2)})`;
      }
    }
    // Fonts are loaded once the page has rendered.
    for (const u of units) {
      try {
        const objs = p.proxy!.commonObjs;
        if (!objs.has(u.block.fontName)) continue;
        const font = objs.get(u.block.fontName) as {
          bold?: boolean;
          black?: boolean;
          name?: string;
        } | null;
        u.bold = !!(font?.bold || font?.black || BOLD_FONT.test(font?.name ?? ''));
      } catch {
        // Unknown font: regular weight.
      }
    }
  }

  private async renderTextLayer(p: Page): Promise<void> {
    if (p.textLayerDone || !p.textContent) return;
    p.textLayerDone = true;
    const layer = new pdfjs.TextLayer({
      textContentSource: p.textContent,
      container: p.textLayer,
      viewport: p.proxy!.getViewport({ scale: 1 }),
    });
    await layer.render();
  }

  private *units(): Generator<Unit> {
    for (const p of this.pages) for (const u of p.units ?? []) yield u;
  }

  // ---- translation queue ----------------------------------------------------

  private enqueue(u: Unit): void {
    if (!this._active || u.status !== 'idle') return;
    const cached = this.memory.get(u.block.text);
    if (cached !== undefined) {
      this.renderDone(u, cached);
      return;
    }
    u.status = 'queued';
    this.queue.add(u);
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
    const fresh = (u: Unit) => this._active && gens.get(u) === u.gen;

    const skip = await Promise.all(
      units.map(async (u) => {
        const lang = await detectLanguage(u.block.text, this.deps.browserDetect);
        return shouldSkipLanguage(lang, cfg.targetLang, cfg.neverTranslateLangs);
      }),
    );
    const todo: Unit[] = [];
    units.forEach((u, i) => {
      if (!fresh(u)) return;
      if (skip[i]) u.status = 'skipped';
      else todo.push(u);
    });
    for (const u of todo) this.renderLoading(u);
    this.deps.onChange?.();
    if (todo.length === 0) {
      this.resolveIdle();
      return;
    }

    const batches = createBatches(
      todo.map((u) => ({ text: u.block.text, data: u })),
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
            this.memory.set(u.block.text, r.text);
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
        this.resolveIdle();
      }),
    );
  }

  private resolveIdle(): void {
    if (this.queue.size > 0 || this.stats().pending > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const w of waiters) w();
  }

  private waitIdle(): Promise<void> {
    if (this.queue.size === 0 && this.stats().pending === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  // ---- rendering translations -----------------------------------------------

  private ensureEl(u: Unit): HTMLElement {
    if (!u.el) {
      const el = this.scroller.ownerDocument.createElement('div');
      const { x, y, w, h } = u.block.rect;
      el.style.left = `${(x - PAD) * L}px`;
      el.style.top = `${(y - PAD) * L}px`;
      el.style.width = `${(w + 2 * PAD) * L}px`;
      el.style.height = `${(h + 2 * PAD) * L}px`;
      u.page.overlay.append(el);
      u.el = el;
    }
    u.el.className = 'tn-pdf-block';
    u.el.removeAttribute('title');
    u.el.onclick = null;
    u.el.style.removeProperty('background');
    u.el.replaceChildren();
    return u.el;
  }

  private resetUnit(u: Unit): void {
    u.gen++;
    u.el?.remove();
    u.el = undefined;
    u.error = undefined;
    u.text = undefined;
    u.needsFit = false;
    u.status = u.block.translatable ? 'idle' : 'skipped';
  }

  private renderLoading(u: Unit): void {
    u.status = 'loading';
    this.ensureEl(u).classList.add('tn-pending');
  }

  private renderDone(u: Unit, text: string): void {
    u.status = 'done';
    u.text = text;
    const el = this.ensureEl(u);
    el.classList.add('tn-done');
    el.lang = this.deps.getConfig().targetLang;
    el.style.background = u.bg;
    el.style.fontWeight = u.bold ? '700' : '';
    el.style.textAlign = u.block.lines >= 2 ? 'justify' : '';
    const span = this.scroller.ownerDocument.createElement('span');
    span.textContent = text;
    el.append(span);
    this.fitUnit(u);
  }

  /** Largest font size (up to the original's) at which the translation fits the box. */
  private fitUnit(u: Unit): void {
    const el = u.el;
    if (!el || u.status !== 'done') return;
    const { h } = u.block.rect;
    const boxH = (h + 2 * PAD) * L;
    el.style.height = `${boxH}px`;
    // Not laid out (column hidden): measure when it is shown again.
    if (el.offsetParent === null) {
      u.needsFit = true;
      return;
    }
    u.needsFit = false;
    const max = u.block.fontSize * L;
    const fits = (size: number) => {
      el.style.fontSize = `${size}px`;
      return el.scrollHeight <= boxH + 1;
    };
    if (fits(max)) return;
    let lo = max * 0.5;
    let hi = max;
    if (!fits(lo)) {
      // Even at half size it overflows: let the box grow downwards.
      el.style.height = 'auto';
      el.style.minHeight = `${boxH}px`;
      return;
    }
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    el.style.fontSize = `${lo}px`;
  }

  private renderError(u: Unit, error: SerializedError): void {
    u.status = 'error';
    u.error = error;
    const el = this.ensureEl(u);
    el.classList.add('tn-error');
    const badge = this.scroller.ownerDocument.createElement('button');
    badge.type = 'button';
    badge.className = 'tn-pdf-retry';
    badge.textContent = `⚠ ${this.deps.strings.retry}`;
    badge.title = this.deps.strings.error(error.message);
    badge.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.resetUnit(u);
      this.enqueue(u);
    };
    el.append(badge);
  }

  // ---- export -----------------------------------------------------------------

  /**
   * Translate and render every page at print resolution. Resolves once nothing is pending;
   * `onProgress` gets the number of pages prepared so far.
   */
  async prepareExport(onProgress: (pages: number) => void, signal: AbortSignal): Promise<void> {
    this.start();
    const scale = this.pages.length <= 60 ? 3 : 2;
    let done = 0;
    const next = this.pages[Symbol.iterator]();
    const worker = async () => {
      for (let it = next.next(); !it.done; it = next.next()) {
        if (signal.aborted) return;
        await this.preparePage(it.value, scale);
        onProgress(++done);
      }
    };
    await Promise.all([worker(), worker()]);
    if (signal.aborted) return;
    await Promise.race([
      this.waitIdle(),
      new Promise<void>((r) => signal.addEventListener('abort', () => r(), { once: true })),
    ]);
  }

  /** Open the print dialog with one PDF page per sheet (side by side in bilingual mode). */
  print(): void {
    const d = this.scroller.ownerDocument;
    const first = this.pages[0];
    if (!first) return;
    const cols = this.columns();
    let style = d.getElementById('tn-print-page') as HTMLStyleElement | null;
    if (!style) {
      style = d.createElement('style');
      style.id = 'tn-print-page';
      d.head.append(style);
    }
    style.textContent = `@page { size: ${first.w * cols}pt ${first.h}pt; margin: 0; }
@media print { .pdf-viewer { --zoom: ${PRINT_ZOOM * 0.999} !important; } }`;
    d.defaultView?.print();
  }
}
