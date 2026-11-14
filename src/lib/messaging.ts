import { browser } from 'wxt/browser';
import type { SerializedError } from './providers/errors';
import type { ProviderProfile } from './settings/schema';
import type { SegmentResult } from './translate/translator';

// ---- content / popup / options -> background ----

export type BackgroundMessage =
  | { type: 'translate:page'; texts: string[]; host: string; title?: string }
  | { type: 'translate:selection'; text: string; host: string; title?: string; targetLang?: string }
  | { type: 'cancel' }
  | { type: 'provider:test'; profile: ProviderProfile }
  | { type: 'provider:models'; profile: ProviderProfile }
  | { type: 'cache:clear' }
  | { type: 'cache:count' }
  | { type: 'options:open' };

export type Result<T> = ({ ok: true } & T) | { ok: false; error: SerializedError };

export interface BackgroundResponses {
  'translate:page': { results: SegmentResult[] };
  'translate:selection': Result<{ text: string }>;
  cancel: { ok: true };
  'provider:test': Result<{ sample: string; ms: number }>;
  'provider:models': Result<{ models: string[] }>;
  'cache:clear': { ok: true };
  'cache:count': { count: number };
  'options:open': { ok: true };
}

export function sendToBackground<M extends BackgroundMessage>(
  msg: M,
): Promise<BackgroundResponses[M['type']]> {
  return browser.runtime.sendMessage(msg) as Promise<BackgroundResponses[M['type']]>;
}

// ---- background / popup -> content ----

export interface PageState {
  translated: boolean;
  host: string;
  total: number;
  done: number;
  pending: number;
  errors: number;
}

export type ContentMessage =
  | { type: 'page:toggle' }
  | { type: 'page:set'; on: boolean }
  | { type: 'page:state' }
  | { type: 'page:retry-errors' }
  | { type: 'selection:translate'; text?: string };

export function sendToTab(tabId: number, msg: ContentMessage): Promise<PageState | undefined> {
  return browser.tabs.sendMessage(tabId, msg) as Promise<PageState | undefined>;
}
