import { browser } from 'wxt/browser';
import { VIEWER_PATH } from './pdf/url';
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
  | { type: 'options:open' }
  | { type: 'pdf:open'; url: string };

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
  'pdf:open': { ok: true };
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
  /** The tab shows a PDF in the browser's own viewer (open ours to translate it). */
  pdf?: boolean;
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

// ---- popup / background -> PDF viewer tab ----
// Extension pages get no tabs.sendMessage, so commands for the viewer go through
// runtime messaging, addressed by tab id.

export interface ViewerMessage {
  type: 'viewer:command';
  tabId: number;
  command: ContentMessage;
}

export function isViewerUrl(url: string | undefined): boolean {
  return !!url && url.startsWith(browser.runtime.getURL(VIEWER_PATH));
}

/** Send a page command to a tab, whether it shows a web page or our PDF viewer. */
export function sendToPage(
  tabId: number,
  url: string | undefined,
  command: ContentMessage,
): Promise<PageState | undefined> {
  if (isViewerUrl(url)) {
    const msg: ViewerMessage = { type: 'viewer:command', tabId, command };
    return browser.runtime.sendMessage(msg) as Promise<PageState | undefined>;
  }
  return sendToTab(tabId, command);
}
