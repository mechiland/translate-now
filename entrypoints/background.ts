import { browser, type Browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { BackgroundMessage, BackgroundResponses } from '@/lib/messaging';
import { chat, listModels } from '@/lib/providers/client';
import { toProviderError } from '@/lib/providers/errors';
import { loadSettings } from '@/lib/settings/storage';
import { IdbCache } from '@/lib/translate/cache';
import { Translator } from '@/lib/translate/translator';

const MENU_PAGE = 'tn-toggle-page';
const MENU_SELECTION = 'tn-translate-selection';

export default defineBackground(() => {
  const cache = new IdbCache();
  const translator = new Translator({ chat: (profile, req) => chat(profile, req), cache });

  /** In-flight requests per tab so a page can cancel its own work. */
  const controllers = new Map<number, Set<AbortController>>();

  function track(tabId: number | undefined): AbortController {
    const ac = new AbortController();
    if (tabId !== undefined) {
      let set = controllers.get(tabId);
      if (!set) controllers.set(tabId, (set = new Set()));
      set.add(ac);
    }
    return ac;
  }

  function untrack(tabId: number | undefined, ac: AbortController) {
    if (tabId === undefined) return;
    const set = controllers.get(tabId);
    set?.delete(ac);
    if (set?.size === 0) controllers.delete(tabId);
  }

  function cancelTab(tabId: number) {
    const set = controllers.get(tabId);
    if (!set) return;
    for (const ac of set) ac.abort();
    controllers.delete(tabId);
  }

  async function handle(
    msg: BackgroundMessage,
    sender: Browser.runtime.MessageSender,
  ): Promise<BackgroundResponses[BackgroundMessage['type']]> {
    const tabId = sender.tab?.id;
    switch (msg.type) {
      case 'translate:page': {
        const settings = await loadSettings();
        const ac = track(tabId);
        try {
          const results = await translator.translatePage(
            settings,
            { texts: msg.texts, host: msg.host, title: msg.title },
            ac.signal,
          );
          return { results };
        } finally {
          untrack(tabId, ac);
        }
      }
      case 'translate:selection': {
        const settings = await loadSettings();
        const ac = track(tabId);
        try {
          const text = await translator.translateSelection(settings, msg, ac.signal);
          return { ok: true, text };
        } catch (e) {
          return { ok: false, error: toProviderError(e).toJSON() };
        } finally {
          untrack(tabId, ac);
        }
      }
      case 'cancel':
        if (tabId !== undefined) cancelTab(tabId);
        return { ok: true };
      case 'provider:test': {
        const started = Date.now();
        try {
          const sample = await chat(msg.profile, {
            system: 'Translate the user text into Simplified Chinese. Output only the translation.',
            user: 'Hello, world!',
            timeoutMs: 30_000,
          });
          return { ok: true, sample: sample.trim().slice(0, 200), ms: Date.now() - started };
        } catch (e) {
          return { ok: false, error: toProviderError(e).toJSON() };
        }
      }
      case 'provider:models':
        try {
          return { ok: true, models: await listModels(msg.profile) };
        } catch (e) {
          return { ok: false, error: toProviderError(e).toJSON() };
        }
      case 'cache:clear':
        await cache.clear();
        return { ok: true };
      case 'cache:count':
        return { count: await cache.count().catch(() => 0) };
      case 'options:open':
        await browser.runtime.openOptionsPage();
        return { ok: true };
    }
  }

  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const msg = message as BackgroundMessage;
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
    handle(msg, sender).then(sendResponse, (e: unknown) =>
      sendResponse({ ok: false, error: toProviderError(e).toJSON() }),
    );
    return true;
  });

  browser.tabs.onRemoved.addListener((tabId) => cancelTab(tabId));

  // ---- context menus (recreated on every startup; works for MV3 and Firefox event pages) ----
  async function setupMenus() {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_PAGE,
      title: browser.i18n.getMessage('menuTogglePage') || 'Translate this page',
      contexts: ['page'],
    });
    browser.contextMenus.create({
      id: MENU_SELECTION,
      title: browser.i18n.getMessage('menuTranslateSelection', ['%s']) || 'Translate "%s"',
      contexts: ['selection'],
    });
  }
  // Runs each time the background starts; removeAll() first makes it idempotent.
  setupMenus().catch((e: unknown) => console.warn('[translate-now] context menu setup failed', e));

  async function sendToTab(tabId: number | undefined, msg: unknown) {
    if (tabId === undefined || tabId < 0) return;
    try {
      await browser.tabs.sendMessage(tabId, msg);
    } catch {
      // No content script on this page (e.g. browser internal pages).
    }
  }

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_PAGE) void sendToTab(tab?.id, { type: 'page:toggle' });
    if (info.menuItemId === MENU_SELECTION) {
      void sendToTab(tab?.id, { type: 'selection:translate', text: info.selectionText });
    }
  });

  browser.commands.onCommand.addListener((command, tab) => {
    const run = async () => {
      const tabId =
        tab?.id ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (command === 'toggle-page') await sendToTab(tabId, { type: 'page:toggle' });
      if (command === 'translate-selection')
        await sendToTab(tabId, { type: 'selection:translate' });
    };
    void run();
  });
});
