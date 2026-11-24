import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import { detectLanguage, shouldSkipLanguage, type LanguageDetector } from '../dom/detect';
import type { SerializedError } from '../providers/errors';
import type { DisplayMode } from '../settings/schema';
import { createBatches } from '../translate/batching';
import type { SegmentResult } from '../translate/translator';
import { ATOM_TAG_RE, parseInlineLinks } from '../dom/links';
import { classifyFont, type FontInfo, type PdfJsFont } from './fonts';
import {
  extractBlocks,
  type FontMetrics,
  type PdfBlock,
  type PdfGlyphs,
  type PdfRect,
  type Separated,
} from './layout';
import { pdfjs, type PDFDocumentProxy, type PDFPageProxy } from './pdfjs';
import {
  buildMarkup,
  cssColor,
  hasProse,
  isTexBody,
  type BlockMarkup,
  type MathSpan,
  type Rgb,
} from './runs';

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
  bg: Rgb;
  /** Body style, styled runs and inline formulas (known once the page has rendered). */
  markup?: BlockMarkup;
  /** Rules (table lines) crossing the patch, in points. */
  rules?: PdfRect[];
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
  /** The page rendered without text. */
  bareUrl?: string;
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
const WHITE: Rgb = [255, 255, 255];
/** pdf.js operators that draw text. */
const TEXT_OPS = new Set<number>([
  pdfjs.OPS.showText,
  pdfjs.OPS.showSpacedText,
  pdfjs.OPS.nextLineShowText,
  pdfjs.OPS.nextLineSetSpacingShowText,
]);

const OPENING_PUNCT = /[（(［[｛{「『“‘《〈【〔]+$/u;
const CLOSING_PUNCT = /^[，。、；：！？）)］\]｝}」』”’》〉】〕,.;:!?%…]+/u;

/**
 * The area a translation covers, in points: the paragraph plus a little margin. A list
 * item's marker stays visible on the page: the patch starts right after it (the translation
 * hangs at the item's text column).
 */
function patchRect(block: PdfBlock): PdfRect {
  const { x, y, w, h } = block.rect;
  const marker = block.marker;
  const left = marker ? Math.min(marker.end + 0.6, marker.textX - PAD) : x - PAD;
  return { x: left, y: y - PAD, w: x + w + PAD - left, h: h + 2 * PAD };
}

function payloadOf(u: Unit): string {
  return u.markup?.payload ?? u.block.text;
}

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
    for (const p of this.pages) {
      if (p.imgUrl) URL.revokeObjectURL(p.imgUrl);
      if (p.bareUrl) URL.revokeObjectURL(p.bareUrl);
    }
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
      p.textContent = await p.proxy!.getTextContent();
    })();
    return p.extracting;
  }

  /**
   * Paragraphs of the page, once it has rendered: the text-free bitmap shows the rules that
   * separate table cells sitting close together.
   */
  private buildUnits(p: Page, bare: HTMLCanvasElement, scale: number): void {
    const tc = p.textContent;
    if (!tc) return;
    const { width, height } = bare;
    const data = bare
      .getContext('2d', { willReadFrequently: true })
      ?.getImageData(0, 0, width, height).data;
    /** A vertical line: a pixel column that is inked over most of the band. */
    const separated: Separated = (x0, x1, top, bottom) => {
      if (!data) return false;
      const cx0 = Math.max(0, Math.ceil(x0 * scale));
      const cx1 = Math.min(width, Math.floor(x1 * scale));
      const cy0 = Math.max(0, Math.ceil(top * scale));
      const cy1 = Math.min(height, Math.floor(bottom * scale));
      if (cx1 <= cx0 || cy1 - cy0 < 3) return false;
      const lum = (x: number, y: number) => {
        const o = (y * width + x) * 4;
        return 0.3 * data[o]! + 0.59 * data[o + 1]! + 0.11 * data[o + 2]!;
      };
      let light = 0;
      for (let y = cy0; y < cy1; y++)
        for (let x = cx0; x < cx1; x++) light = Math.max(light, lum(x, y));
      for (let x = cx0; x < cx1; x++) {
        let inked = 0;
        for (let y = cy0; y < cy1; y++) if (light - lum(x, y) > 60) inked++;
        if (inked >= 0.8 * (cy1 - cy0)) return true;
      }
      return false;
    };
    const blocks = extractBlocks(
      tc.items.filter((i) => 'str' in i),
      tc.styles as Record<string, FontMetrics>,
      p.proxy!.getViewport({ scale: 1 }).transform,
      separated,
    );
    p.units = blocks.map((block) => ({
      page: p,
      block,
      status: block.translatable ? 'idle' : 'skipped',
      bg: WHITE,
      gen: 0,
    }));
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
        // The page without its text: what a translated paragraph is drawn on, so table rules,
        // shading and anything else under the text stay visible.
        const bare = this.scroller.ownerDocument.createElement('canvas');
        bare.width = canvas.width;
        bare.height = canvas.height;
        await proxy.render({
          canvas: bare,
          viewport,
          operationsFilter: (i, ops) => !TEXT_OPS.has(ops.fnArray[i]!),
        }).promise;
        if (p.renderScale === 0) {
          this.buildUnits(p, bare, scale);
          this.sampleBlocks(p, canvas, scale);
          this.findRules(p, bare, scale);
        }
        const toBlob = (c: HTMLCanvasElement) =>
          new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
        const [blob, bareBlob] = await Promise.all([toBlob(canvas), toBlob(bare)]);
        canvas.width = canvas.height = bare.width = bare.height = 0;
        if (!blob || !bareBlob || this.destroyed) return;
        const old = [p.imgUrl, p.bareUrl];
        p.imgUrl = URL.createObjectURL(blob);
        p.bareUrl = URL.createObjectURL(bareBlob);
        p.renderScale = scale;
        p.origImg.src = p.imgUrl;
        p.transImg.src = p.imgUrl;
        // Inline formulas in the translation show the page bitmap, cropped; paragraphs sit
        // on the text-free one.
        p.overlay.style.setProperty('--tn-page', `url("${p.imgUrl}")`);
        p.overlay.style.setProperty('--tn-bare', `url("${p.bareUrl}")`);
        if (old[0]) {
          // Revoke once the new bitmap has replaced the old one on screen.
          void p.origImg
            .decode()
            .catch(() => {})
            .finally(() => old.forEach((u) => u && URL.revokeObjectURL(u)));
        }
      } finally {
        this.releaseRender();
      }
    };
    const prev = p.rendering ?? Promise.resolve();
    p.rendering = prev.then(run, run);
    return p.rendering;
  }

  /**
   * Background color around each paragraph, the color of its glyphs, and its fonts: what
   * the translation needs to look like the original.
   */
  private sampleBlocks(p: Page, canvas: HTMLCanvasElement, scale: number): void {
    const units = p.units ?? [];
    if (units.length === 0) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const { width, height } = canvas;
    const data = ctx?.getImageData(0, 0, width, height).data;
    const px = (x: number, y: number): Rgb | undefined => {
      const ix = Math.round(x * scale);
      const iy = Math.round(y * scale);
      if (!data || ix < 0 || iy < 0 || ix >= width || iy >= height) return undefined;
      const o = (iy * width + ix) * 4;
      return [data[o]!, data[o + 1]!, data[o + 2]!];
    };
    /**
     * Ink color of a glyph run. Anti-aliasing blends the ink with the background, so the
     * average of the inked pixels is extended away from the background as far as the
     * strongest pixel goes (and the RGB range allows).
     */
    const ink = (g: PdfGlyphs, bg: Rgb): Rgb | undefined => {
      if (!data) return undefined;
      const x0 = Math.max(0, Math.floor(g.x0 * scale));
      const x1 = Math.min(width, Math.ceil(g.x1 * scale));
      const y0 = Math.max(0, Math.floor(g.top * scale));
      const y1 = Math.min(height, Math.ceil(g.bottom * scale));
      const step = Math.max(1, Math.round(scale / 2));
      const sum = [0, 0, 0];
      let total = 0;
      let max = 0;
      for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
          const o = (y * width + x) * 4;
          const dr = data[o]! - bg[0];
          const dg = data[o + 1]! - bg[1];
          const db = data[o + 2]! - bg[2];
          const d = Math.hypot(dr, dg, db);
          if (d < 60) continue;
          sum[0]! += dr * d;
          sum[1]! += dg * d;
          sum[2]! += db * d;
          total += d;
          if (d > max) max = d;
        }
      }
      if (total === 0) return undefined;
      const v = sum.map((c) => c / total) as [number, number, number];
      const len = Math.hypot(...v);
      let t = max / len;
      for (let i = 0; i < 3; i++) {
        if (v[i]! > 0) t = Math.min(t, (255 - bg[i]!) / v[i]!);
        else if (v[i]! < 0) t = Math.min(t, -bg[i]! / v[i]!);
      }
      const c = v.map((c, i) => Math.round(bg[i]! + c * t));
      // Nearly neutral: gray (subpixel fringes tint black text slightly).
      if (Math.max(...c) - Math.min(...c) < 24) c.fill(Math.round((c[0]! + c[1]! + c[2]!) / 3));
      return c as unknown as Rgb;
    };
    const fonts = new Map<string, FontInfo>();
    const fontOf = (id: string): FontInfo => {
      let info = fonts.get(id);
      if (!info) {
        let font: PdfJsFont | null = null;
        try {
          // Fonts are loaded once the page has rendered.
          const objs = p.proxy!.commonObjs;
          if (objs.has(id)) font = objs.get(id) as PdfJsFont | null;
        } catch {
          // Unknown font: classified by its (missing) name.
        }
        info = classifyFont(font);
        fonts.set(id, info);
      }
      return info;
    };

    /** Any glyph-colored pixel on row `y` between `x0` and `x1` (points)? */
    const hasInk = (x0: number, x1: number, y: number, bg: Rgb): boolean => {
      if (!data) return true;
      const iy = Math.round(y * scale);
      if (iy < 0 || iy >= height) return false;
      const end = Math.min(width, Math.ceil(x1 * scale));
      for (let ix = Math.max(0, Math.floor(x0 * scale)); ix < end; ix++) {
        const o = (iy * width + ix) * 4;
        const d =
          Math.abs(data[o]! - bg[0]) +
          Math.abs(data[o + 1]! - bg[1]) +
          Math.abs(data[o + 2]! - bg[2]);
        if (d > 60) return true;
      }
      return false;
    };
    const allGlyphs = units.flatMap((u) => u.block.pieces.flatMap((p) => (p.g ? [p.g] : [])));
    const texDoc = isTexBody(
      units.map((u) => u.block),
      fontOf,
    );
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
      if (samples.length > 0) {
        const median = (i: number) =>
          samples.map((s) => s[i]!).sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
        u.bg = [median(0), median(1), median(2)];
      }
      if (!u.block.translatable) continue;
      const colors = new Map<PdfGlyphs, Rgb | undefined>();
      const colorOf = (g: PdfGlyphs) => {
        if (!colors.has(g)) colors.set(g, ink(g, u.bg));
        return colors.get(g);
      };
      u.markup = buildMarkup(u.block, fontOf, { colorOf, bg: u.bg, texDoc });
      if (!hasProse(u.markup) && u.status === 'idle') u.status = 'skipped';
      for (const f of u.markup.formulas) f.rect = this.mathCrop(f, allGlyphs, hasInk, u.bg);
    }
  }

  /**
   * Where to crop an inline formula from the page. Glyph boxes are estimates (a radical's
   * box reaches far above it), so the crop stops at the lines above and below, then shrinks
   * to the rows that have ink.
   */
  private mathCrop(
    span: MathSpan,
    all: PdfGlyphs[],
    hasInk: (x0: number, x1: number, y: number, bg: Rgb) => boolean,
    bg: Rgb,
  ): PdfRect {
    const { x, w } = span.rect;
    const fs = Math.max(...span.glyphs.map((g) => g.lineFs));
    const own = new Set(span.glyphs);
    let top = span.rect.y;
    let bottom = span.rect.y + span.rect.h;
    for (const g of all) {
      if (own.has(g) || g.x1 <= x || g.x0 >= x + w) continue;
      // Glyph boxes are estimates too: allow for deep descenders and tall ascenders.
      if (g.lineBaseline < span.baseline - 0.5 * fs) {
        top = Math.max(top, g.bottom, g.lineBaseline + 0.3 * g.lineFs);
      } else if (g.lineBaseline > span.baseline + 0.5 * fs) {
        bottom = Math.min(bottom, g.top, g.lineBaseline - 0.8 * g.lineFs);
      }
    }
    // Never cut into the line's own ascenders and descenders.
    top = Math.min(top, span.baseline - 0.72 * fs);
    bottom = Math.max(bottom, span.baseline + 0.25 * fs);
    const step = 0.25;
    while (top < span.baseline - 0.4 * fs && !hasInk(x, x + w, top, bg)) top += step;
    while (bottom > span.baseline + 0.05 * fs && !hasInk(x, x + w, bottom, bg)) bottom -= step;
    return { x, y: top, w, h: bottom - top };
  }

  /**
   * Lines of the text-free page that run across a paragraph's whole patch: table rules and
   * frames. Shorter lines (underlines, fraction bars, radicals) belong to the text and stay
   * covered.
   */
  private findRules(p: Page, bare: HTMLCanvasElement, scale: number): void {
    const units = (p.units ?? []).filter((u) => u.status !== 'skipped');
    if (units.length === 0) return;
    const { width, height } = bare;
    const data = bare
      .getContext('2d', { willReadFrequently: true })
      ?.getImageData(0, 0, width, height).data;
    if (!data) return;
    for (const u of units) {
      const r = patchRect(u.block);
      const x0 = Math.max(0, Math.round(r.x * scale));
      const x1 = Math.min(width, Math.round((r.x + r.w) * scale));
      const y0 = Math.max(0, Math.round(r.y * scale));
      const y1 = Math.min(height, Math.round((r.y + r.h) * scale));
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const inked = (x: number, y: number) => {
        const o = (y * width + x) * 4;
        return (
          Math.abs(data[o]! - u.bg[0]) +
            Math.abs(data[o + 1]! - u.bg[1]) +
            Math.abs(data[o + 2]! - u.bg[2]) >
          60
        );
      };
      const rules: PdfRect[] = [];
      const band = (start: number, end: number, horizontal: boolean) => {
        // Half a device pixel of anti-aliasing on each side, but never beyond the patch
        // (that would count as overflow when the translation is fitted).
        const a = Math.max(horizontal ? r.y : r.x, (start - 0.5) / scale);
        const b = Math.min(horizontal ? r.y + r.h : r.x + r.w, (end + 0.5) / scale);
        rules.push(
          horizontal ? { x: r.x, y: a, w: r.w, h: b - a } : { x: a, y: r.y, w: b - a, h: r.h },
        );
      };
      let start = -1;
      for (let y = y0; y <= y1; y++) {
        let n = 0;
        if (y < y1) for (let x = x0; x < x1; x++) if (inked(x, y)) n++;
        const full = y < y1 && n >= 0.9 * (x1 - x0);
        if (full && start < 0) start = y;
        if (!full && start >= 0) {
          band(start, y, true);
          start = -1;
        }
      }
      for (let x = x0; x <= x1; x++) {
        let n = 0;
        if (x < x1) for (let y = y0; y < y1; y++) if (inked(x, y)) n++;
        const full = x < x1 && n >= 0.9 * (y1 - y0);
        if (full && start < 0) start = x;
        if (!full && start >= 0) {
          band(start, x, false);
          start = -1;
        }
      }
      if (rules.length > 0) u.rules = rules;
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
    const cached = this.memory.get(payloadOf(u));
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
      todo.map((u) => ({ text: payloadOf(u), data: u })),
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
            this.memory.set(payloadOf(u), r.text);
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
      const r = patchRect(u.block);
      el.style.left = `${r.x * L}px`;
      el.style.top = `${r.y * L}px`;
      el.style.width = `${r.w * L}px`;
      el.style.height = `${r.h * L}px`;
      const marker = u.block.marker;
      if (marker) el.style.paddingLeft = `${(marker.textX - r.x) * L}px`;
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
    const base = u.markup?.base;
    el.dataset.family = base?.family ?? 'sans';
    el.style.background = cssColor(u.bg);
    // Table rules under the patch stay visible (drawn from the text-free page).
    const box = patchRect(u.block);
    for (const rule of u.rules ?? []) {
      const line = this.scroller.ownerDocument.createElement('span');
      line.className = 'tn-pdf-rule';
      line.style.left = `${(rule.x - box.x) * L}px`;
      line.style.top = `${(rule.y - box.y) * L}px`;
      line.style.width = `${rule.w * L}px`;
      line.style.height = `${rule.h * L}px`;
      line.style.backgroundSize = `${u.page.w * L}px ${u.page.h * L}px`;
      line.style.backgroundPosition = `${-rule.x * L}px ${-rule.y * L}px`;
      el.append(line);
    }
    el.style.color = base?.color ? cssColor(base.color) : '';
    el.style.fontWeight = base?.bold ? '700' : '';
    const { rect } = u.block;
    // A single centered line (a title, a caption) keeps its axis when the translation is
    // shorter: centered on the page, and clearly narrower than a full line of text.
    const centered =
      u.block.centered ||
      (u.block.lines === 1 &&
        rect.x > 0.2 * u.page.w &&
        Math.abs(rect.x + rect.w / 2 - u.page.w / 2) < 0.25 * u.block.fontSize);
    el.style.textAlign = centered ? 'center' : u.block.lines >= 2 ? 'justify' : '';
    const span = this.scroller.ownerDocument.createElement('span');
    this.fillTranslation(span, u, text);
    el.append(span);
    this.fitUnit(u);
  }

  /** The translated text with styled runs and inline formulas put back. */
  private fillTranslation(container: HTMLElement, u: Unit, text: string): void {
    const d = this.scroller.ownerDocument;
    const styles = u.markup?.styles ?? [];
    const formulas = u.markup?.formulas ?? [];
    if (styles.length + formulas.length === 0) {
      container.textContent = text;
      return;
    }
    /** Text with each `<m id="N"/>` placeholder turned back into its formula. */
    const withFormulas = (t: string): (string | HTMLElement)[] => {
      const out: (string | HTMLElement)[] = [];
      let cursor = 0;
      for (const m of t.matchAll(ATOM_TAG_RE)) {
        if (m.index > cursor) out.push(t.slice(cursor, m.index));
        cursor = m.index + m[0].length;
        const f = m[1] === undefined ? undefined : formulas[Number(m[1]) - 1];
        if (f) out.push(this.mathElement(u, f));
      }
      if (cursor < t.length) out.push(t.slice(cursor));
      return out;
    };
    const nodes: (string | HTMLElement)[] = [];
    for (const part of parseInlineLinks(text, styles.length)) {
      if (part.type === 'text') {
        nodes.push(...withFormulas(part.text));
        continue;
      }
      const span = styles[part.index]!;
      const el = d.createElement(span.bold ? 'b' : 'span');
      if (!span.bold) el.style.fontWeight = 'normal';
      if (span.color) el.style.color = cssColor(span.color);
      if (span.mono) el.className = 'tn-pdf-code';
      if (span.size) el.style.fontSize = `${span.size}em`;
      el.append(...withFormulas(part.text));
      nodes.push(el);
    }
    // Keep punctuation on the formula's line: a line must not start with "，" or end with "（".
    for (let i = 0; i < nodes.length; i++) {
      const math = nodes[i];
      if (!math || typeof math === 'string' || !math.classList.contains('tn-pdf-math')) continue;
      const before = nodes[i - 1];
      const after = nodes[i + 1];
      const open = typeof before === 'string' ? (OPENING_PUNCT.exec(before)?.[0] ?? '') : '';
      const close = typeof after === 'string' ? (CLOSING_PUNCT.exec(after)?.[0] ?? '') : '';
      if (!open && !close) continue;
      const group = d.createElement('span');
      group.className = 'tn-pdf-nowrap';
      group.append(open, math, close);
      nodes[i] = group;
      if (open) nodes[i - 1] = (before as string).slice(0, -open.length);
      if (close) nodes[i + 1] = (after as string).slice(close.length);
    }
    container.append(...nodes);
  }

  /**
   * An inline formula, cropped from the page bitmap and sized in em, so it scales with the
   * fitted text. Its extracted text is kept, invisible, for selection and copy.
   */
  private mathElement(u: Unit, span: MathSpan): HTMLElement {
    const d = this.scroller.ownerDocument;
    const page = u.page;
    const em = (pt: number) => `${pt / u.block.fontSize}em`;
    const padX = 0.6;
    const padY = 0.4;
    const x = span.rect.x - padX;
    const y = span.rect.y - padY;
    const w = span.rect.w + 2 * padX;
    const h = span.rect.h + 2 * padY;
    const el = d.createElement('span');
    el.className = 'tn-pdf-math';
    el.style.width = em(w);
    el.style.height = em(h);
    el.style.backgroundSize = `${em(page.w)} ${em(page.h)}`;
    el.style.backgroundPosition = `${em(-x)} ${em(-y)}`;
    el.style.verticalAlign = em(-(y + h - span.baseline));
    el.style.lineHeight = em(h);
    el.textContent = span.text;
    return el;
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
