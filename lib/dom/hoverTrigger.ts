import type { HoverModifier } from '../settings/schema';
import { UI_TAG } from './segmenter';

export interface HoverTriggerDeps {
  doc: Document;
  modifier: () => HoverModifier;
  /** Called with the element under the pointer when the modifier is tapped. */
  onTrigger: (target: Element) => void;
  /** A press longer than this is a held key, not a tap. */
  tapMs?: number;
}

const KEY: Record<Exclude<HoverModifier, 'off'>, string> = {
  ctrl: 'Control',
  alt: 'Alt',
  shift: 'Shift',
};

/**
 * Detects a tap of the configured modifier key on its own (press and release with
 * nothing else in between) and reports the element under the mouse pointer.
 *
 * Shortcuts that merely start with the modifier (Ctrl+C, Ctrl+click, Ctrl+scroll),
 * long holds, and typing in editable fields never trigger.
 */
export class HoverTrigger {
  private x = -1;
  private y = -1;
  private armedAt = 0;
  private readonly tapMs: number;

  constructor(private deps: HoverTriggerDeps) {
    this.tapMs = deps.tapMs ?? 600;
    const doc = deps.doc;
    doc.addEventListener('mousemove', this.onMove, { capture: true, passive: true });
    doc.addEventListener('mouseleave', this.onLeave, true);
    doc.addEventListener('keydown', this.onKeyDown, true);
    doc.addEventListener('keyup', this.onKeyUp, true);
    doc.addEventListener('mousedown', this.disarm, true);
    doc.addEventListener('wheel', this.disarm, { capture: true, passive: true });
    doc.defaultView?.addEventListener('blur', this.disarm);
  }

  destroy(): void {
    const doc = this.deps.doc;
    doc.removeEventListener('mousemove', this.onMove, true);
    doc.removeEventListener('mouseleave', this.onLeave, true);
    doc.removeEventListener('keydown', this.onKeyDown, true);
    doc.removeEventListener('keyup', this.onKeyUp, true);
    doc.removeEventListener('mousedown', this.disarm, true);
    doc.removeEventListener('wheel', this.disarm, true);
    doc.defaultView?.removeEventListener('blur', this.disarm);
  }

  private key(): string | undefined {
    const m = this.deps.modifier();
    return m === 'off' ? undefined : KEY[m];
  }

  private onMove = (e: MouseEvent): void => {
    this.x = e.clientX;
    this.y = e.clientY;
  };

  private onLeave = (e: MouseEvent): void => {
    if (e.target === this.deps.doc || e.target === this.deps.doc.documentElement) {
      this.x = this.y = -1;
    }
  };

  private disarm = (): void => {
    this.armedAt = 0;
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const key = this.key();
    if (!key || e.key !== key || e.repeat || isEditable(e.target)) {
      this.armedAt = 0;
      return;
    }
    // Only the modifier itself may be held (Ctrl+Shift is not a Ctrl tap).
    const others =
      Number(e.ctrlKey && key !== 'Control') +
      Number(e.altKey && key !== 'Alt') +
      Number(e.shiftKey && key !== 'Shift') +
      Number(e.metaKey);
    this.armedAt = others === 0 ? Date.now() : 0;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const key = this.key();
    if (!key || e.key !== key) return;
    const armedAt = this.armedAt;
    this.armedAt = 0;
    if (!armedAt || Date.now() - armedAt > this.tapMs) return;
    const target = this.targetUnderPointer();
    if (target) this.deps.onTrigger(target);
  };

  private targetUnderPointer(): Element | undefined {
    if (this.x < 0 || this.y < 0) return undefined;
    const el = this.deps.doc.elementFromPoint(this.x, this.y);
    if (!el || el.localName === UI_TAG) return undefined;
    return el;
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!target || !(target as Node).nodeType || (target as Node).nodeType !== 1) return false;
  const el = target as HTMLElement;
  const tag = el.localName;
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return el.isContentEditable === true;
}
