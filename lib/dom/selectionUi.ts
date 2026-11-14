import { LANGUAGES } from '../languages';
import type { SerializedError } from '../providers/errors';
import { UI_TAG } from './segmenter';

export interface SelectionStrings {
  translate: string;
  copy: string;
  copied: string;
  close: string;
  retry: string;
  openSettings: string;
  failed: string;
}

export interface SelectionUiDeps {
  doc: Document;
  isEnabled: () => boolean;
  trigger: () => 'icon' | 'auto';
  targetLang: () => string;
  translate: (
    text: string,
    targetLang: string,
  ) => Promise<{ ok: true; text: string } | { ok: false; error: SerializedError }>;
  openSettings: () => void;
  strings: () => SelectionStrings;
}

const MAX_SELECTION = 5000;

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap {
  --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --border: rgba(31,35,40,.15);
  --accent: #2563eb; --hover: rgba(31,35,40,.06); --err: #c2410c;
  font: 14px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .wrap { --bg: #1f2428; --fg: #e6edf3; --muted: #9198a1; --border: rgba(240,246,252,.16); --accent: #60a5fa; --hover: rgba(240,246,252,.08); --err: #fb923c; }
}
.btn {
  position: fixed; z-index: 2147483647;
  width: 28px; height: 28px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg); color: var(--accent);
  border: 1px solid var(--border);
  box-shadow: 0 2px 8px rgba(0,0,0,.18);
  cursor: pointer; padding: 0;
}
.btn:hover { background: var(--hover); }
.btn svg { width: 16px; height: 16px; }
.card {
  position: fixed; z-index: 2147483647;
  width: min(380px, calc(100vw - 16px));
  max-height: min(60vh, 480px);
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--border); border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0,0,0,.22);
  overflow: hidden;
}
.head {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 8px; border-bottom: 1px solid var(--border);
  cursor: move; user-select: none;
}
.head select {
  font: inherit; font-size: 12px; color: var(--fg); background: transparent;
  border: 1px solid var(--border); border-radius: 6px; padding: 2px 4px; cursor: pointer;
}
.head select option { color: #1f2328; background: #fff; }
.spacer { flex: 1; }
.icon {
  border: 0; background: transparent; color: var(--muted); cursor: pointer;
  border-radius: 6px; padding: 3px 6px; font: inherit; font-size: 12px;
}
.icon:hover { background: var(--hover); color: var(--fg); }
.body { padding: 10px 12px 12px; overflow: auto; }
.src {
  color: var(--muted); font-size: 12px; margin-bottom: 6px;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  white-space: pre-wrap;
}
.out { white-space: pre-wrap; word-break: break-word; user-select: text; }
.err { color: var(--err); }
.err button { margin-top: 6px; margin-right: 6px; }
.link { color: var(--accent); background: none; border: 0; cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
.spin {
  width: 14px; height: 14px; display: inline-block; vertical-align: middle;
  border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%;
  animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.toast {
  position: fixed; z-index: 2147483647; top: 16px; right: 16px;
  max-width: 360px; padding: 10px 14px; border-radius: 8px;
  background: var(--bg); color: var(--fg); border: 1px solid var(--border);
  box-shadow: 0 8px 28px rgba(0,0,0,.22);
}
.toast .link { margin-left: 8px; }
`;

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h8M8 3v2M5.5 5c.8 3 3 5.5 6 7M10.5 5c-.8 3.5-3.2 6.5-6.5 8"/><path d="M13 21l4-9 4 9M14.5 18h5"/></svg>`;

export class SelectionUi {
  private host: HTMLElement;
  private root: ShadowRoot;
  private wrap: HTMLDivElement;
  private button: HTMLButtonElement | undefined;
  private card: HTMLDivElement | undefined;
  private toastEl: HTMLDivElement | undefined;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private lastText = '';
  private lastRect: DOMRect | undefined;
  private requestId = 0;

  constructor(private deps: SelectionUiDeps) {
    const doc = deps.doc;
    this.host = doc.createElement(UI_TAG);
    this.host.setAttribute('translate', 'no');
    this.root = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS;
    this.wrap = doc.createElement('div');
    this.wrap.className = 'wrap';
    this.root.append(style, this.wrap);
    doc.documentElement.appendChild(this.host);

    doc.addEventListener('mouseup', this.onMouseUp, true);
    doc.addEventListener('mousedown', this.onMouseDown, true);
    doc.addEventListener('keydown', this.onKeyDown, true);
  }

  destroy(): void {
    const doc = this.deps.doc;
    doc.removeEventListener('mouseup', this.onMouseUp, true);
    doc.removeEventListener('mousedown', this.onMouseDown, true);
    doc.removeEventListener('keydown', this.onKeyDown, true);
    this.host.remove();
  }

  private isOurs(e: Event): boolean {
    return e.composedPath().includes(this.host);
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.isOurs(e)) return;
    this.hideButton();
    this.hideCard();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this.hideButton();
      this.hideCard();
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (this.isOurs(e) || e.button !== 0) return;
    // Let the browser finalize the selection first.
    setTimeout(() => this.checkSelection(), 10);
  };

  private currentSelection(): { text: string; rect?: DOMRect } {
    const sel = this.deps.doc.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return { text: '' };
    const text = sel.toString().trim();
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    return { text, rect: rect ?? undefined };
  }

  private checkSelection(): void {
    if (!this.deps.isEnabled()) return;
    const active = this.deps.doc.activeElement;
    if (active && (active.localName === 'input' || active.localName === 'textarea')) return;
    const { text, rect } = this.currentSelection();
    if (!text || text.length > MAX_SELECTION || !/\p{L}/u.test(text) || !rect) {
      this.hideButton();
      return;
    }
    this.lastText = text;
    this.lastRect = rect;
    if (this.deps.trigger() === 'auto') {
      this.showCard(text, rect);
    } else {
      this.showButton(rect);
    }
  }

  private showButton(rect: DOMRect): void {
    const doc = this.deps.doc;
    if (!this.button) {
      this.button = doc.createElement('button');
      this.button.className = 'btn';
      const svg = new DOMParser().parseFromString(ICON, 'image/svg+xml').documentElement;
      this.button.appendChild(doc.importNode(svg, true));
      this.button.addEventListener('mousedown', (e) => e.preventDefault());
      this.button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = this.lastRect;
        this.hideButton();
        this.showCard(this.lastText, rect);
      });
      this.wrap.appendChild(this.button);
    }
    this.button.title = this.deps.strings().translate;
    this.button.setAttribute('aria-label', this.deps.strings().translate);
    const view = doc.defaultView!;
    const x = Math.min(view.innerWidth - 36, Math.max(4, rect.right + 4));
    let y = rect.bottom + 6;
    if (y > view.innerHeight - 36) y = Math.max(4, rect.top - 34);
    this.button.style.left = `${x}px`;
    this.button.style.top = `${y}px`;
  }

  private hideButton(): void {
    this.button?.remove();
    this.button = undefined;
  }

  private hideCard(): void {
    this.requestId++;
    this.card?.remove();
    this.card = undefined;
  }

  /** Translate the given text (or current selection) and show it in a card. */
  translate(text?: string): void {
    const sel = this.currentSelection();
    const t = (text ?? sel.text).trim();
    if (!t) return;
    this.hideButton();
    this.showCard(t.slice(0, MAX_SELECTION), sel.text ? sel.rect : undefined);
  }

  private showCard(text: string, rect?: DOMRect): void {
    const doc = this.deps.doc;
    const s = this.deps.strings();
    this.hideCard();
    const card = doc.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'dialog');

    const head = doc.createElement('div');
    head.className = 'head';
    const select = doc.createElement('select');
    for (const lang of LANGUAGES) {
      const opt = doc.createElement('option');
      opt.value = lang.code;
      opt.textContent = lang.name;
      select.appendChild(opt);
    }
    select.value = this.deps.targetLang();
    const spacer = doc.createElement('div');
    spacer.className = 'spacer';
    const copyBtn = doc.createElement('button');
    copyBtn.className = 'icon';
    copyBtn.textContent = s.copy;
    const closeBtn = doc.createElement('button');
    closeBtn.className = 'icon';
    closeBtn.textContent = '✕';
    closeBtn.title = s.close;
    closeBtn.setAttribute('aria-label', s.close);
    head.append(select, spacer, copyBtn, closeBtn);

    const body = doc.createElement('div');
    body.className = 'body';
    const src = doc.createElement('div');
    src.className = 'src';
    src.textContent = text;
    const out = doc.createElement('div');
    out.className = 'out';
    body.append(src, out);
    card.append(head, body);
    this.wrap.appendChild(card);
    this.card = card;
    this.position(card, rect);
    this.makeDraggable(card, head);

    let result = '';
    const run = async () => {
      const id = ++this.requestId;
      result = '';
      out.className = 'out';
      const spin = doc.createElement('span');
      spin.className = 'spin';
      out.replaceChildren(spin);
      const res = await this.deps
        .translate(text, select.value)
        .catch(
          (e: unknown) => ({ ok: false, error: { kind: 'network', message: String(e) } }) as const,
        );
      if (id !== this.requestId || this.card !== card) return;
      if (res.ok) {
        result = res.text;
        out.textContent = res.text;
      } else {
        out.className = 'out err';
        out.textContent = `${s.failed}: ${res.error.message}`;
        out.appendChild(doc.createElement('br'));
        const retry = doc.createElement('button');
        retry.className = 'link';
        retry.textContent = s.retry;
        retry.onclick = () => void run();
        out.appendChild(retry);
        if (res.error.kind === 'config' || res.error.kind === 'auth') {
          const settings = doc.createElement('button');
          settings.className = 'link';
          settings.style.marginLeft = '12px';
          settings.textContent = s.openSettings;
          settings.onclick = () => this.deps.openSettings();
          out.appendChild(settings);
        }
      }
      this.position(card, rect);
    };
    select.onchange = () => void run();
    copyBtn.onclick = () => {
      if (!result) return;
      void navigator.clipboard?.writeText(result).then(() => {
        copyBtn.textContent = s.copied;
        setTimeout(() => (copyBtn.textContent = s.copy), 1200);
      });
    };
    closeBtn.onclick = () => this.hideCard();
    void run();
  }

  private position(card: HTMLElement, rect?: DOMRect): void {
    if (card.dataset.dragged) return;
    const view = this.deps.doc.defaultView!;
    const w = card.offsetWidth || 380;
    const h = card.offsetHeight || 120;
    let x: number;
    let y: number;
    if (rect) {
      x = rect.left;
      y = rect.bottom + 8;
      if (y + h > view.innerHeight - 8) y = rect.top - h - 8;
    } else {
      x = view.innerWidth - w - 16;
      y = 16;
    }
    x = Math.min(Math.max(8, x), view.innerWidth - w - 8);
    y = Math.min(Math.max(8, y), Math.max(8, view.innerHeight - h - 8));
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
  }

  private makeDraggable(card: HTMLElement, handle: HTMLElement): void {
    handle.addEventListener('pointerdown', (e) => {
      if ((e.target as Element).closest('select,button')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const left = card.offsetLeft;
      const top = card.offsetTop;
      const move = (ev: PointerEvent) => {
        card.dataset.dragged = '1';
        card.style.left = `${left + ev.clientX - startX}px`;
        card.style.top = `${top + ev.clientY - startY}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.setPointerCapture(e.pointerId);
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  toast(message: string, action?: { label: string; run: () => void }): void {
    const doc = this.deps.doc;
    this.toastEl?.remove();
    clearTimeout(this.toastTimer);
    const el = doc.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    if (action) {
      const btn = doc.createElement('button');
      btn.className = 'link';
      btn.textContent = action.label;
      btn.onclick = () => {
        action.run();
        el.remove();
      };
      el.appendChild(btn);
    }
    this.wrap.appendChild(el);
    this.toastEl = el;
    this.toastTimer = setTimeout(() => el.remove(), 8000);
  }
}
