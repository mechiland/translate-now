import { browser } from 'wxt/browser';
import { defineContentScript } from 'wxt/utils/define-content-script';
import { sameLanguage } from '@/lib/languages';
import { createT, type TFunction } from '@/lib/i18n';
import { sendToBackground, type ContentMessage, type PageState } from '@/lib/messaging';
import { detectLanguage, type LanguageDetector } from '@/lib/dom/detect';
import { HoverTrigger } from '@/lib/dom/hoverTrigger';
import { PageTranslator } from '@/lib/dom/pageTranslator';
import { SelectionUi } from '@/lib/dom/selectionUi';
import { getActiveProvider, type Settings } from '@/lib/settings/schema';
import { effectiveSiteConfig } from '@/lib/settings/siteRules';
import { findStyle } from '@/lib/settings/styles';
import { loadSettings, watchSettings } from '@/lib/settings/storage';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    if (!document.documentElement || !(document instanceof HTMLDocument)) return;
    const host = location.hostname;
    // Chrome shows PDFs in a wrapper document that content scripts can reach (Firefox's
    // viewer runs none). Translating means opening the PDF in our viewer instead.
    const isPdf = document.contentType === 'application/pdf';
    let settings: Settings = await loadSettings();
    let t: TFunction = createT(settings.uiLang);
    const site = () => effectiveSiteConfig(settings, host);

    const browserDetect: LanguageDetector | undefined = browser.i18n?.detectLanguage
      ? async (text) => {
          const res = await browser.i18n.detectLanguage(text);
          const top = res.languages[0];
          if (!res.isReliable || !top || top.percentage < 60 || top.language === 'und')
            return undefined;
          return top.language;
        }
      : undefined;

    let fatalShown = false;
    const page = new PageTranslator(document, {
      translate: async (texts) => {
        const res = await sendToBackground({
          type: 'translate:page',
          texts,
          host,
          title: document.title,
        });
        return res.results;
      },
      cancel: () => void sendToBackground({ type: 'cancel' }).catch(() => {}),
      getConfig: () => ({
        targetLang: settings.targetLang,
        neverTranslateLangs: settings.neverTranslateLangs,
        displayMode: site().displayMode,
        theme: settings.theme,
        maxChars: settings.batch.maxChars,
        maxSegments: settings.batch.maxSegments,
      }),
      browserDetect,
      strings: {
        get retry() {
          return t('retry');
        },
        error: (m) => t('errorTitle', m),
      },
      onFatalError: (error) => {
        if (fatalShown) return;
        fatalShown = true;
        const msg = error.kind === 'config' ? t('toastNeedKey') : t('toastAuth', error.message);
        selection.toast(msg, { label: t('openSettings'), run: openSettings });
      },
    });

    const openSettings = () => void sendToBackground({ type: 'options:open' }).catch(() => {});

    const selection = new SelectionUi({
      doc: document,
      isEnabled: () => site().selectionEnabled,
      trigger: () => settings.selection.trigger,
      targetLang: () => settings.targetLang,
      translate: (text, targetLang) =>
        sendToBackground({
          type: 'translate:selection',
          text,
          targetLang,
          host,
          title: document.title,
        }),
      openSettings,
      strings: () => ({
        translate: t('translate'),
        copy: t('copy'),
        copied: t('copied'),
        close: t('close'),
        retry: t('retry'),
        openSettings: t('openSettings'),
        failed: t('failed'),
      }),
    });

    new HoverTrigger({
      doc: document,
      modifier: () => settings.hover.modifier,
      onTrigger: (target) => {
        fatalShown = false;
        page.toggleParagraph(target);
      },
    });

    const state = (): PageState => ({
      translated: page.active,
      host,
      ...page.stats(),
      ...(isPdf ? { pdf: true } : {}),
    });
    const openPdfViewer = () =>
      void sendToBackground({ type: 'pdf:open', url: location.href }).catch(() => {});

    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      const msg = message as ContentMessage;
      switch (msg?.type) {
        case 'page:toggle':
          if (isPdf) {
            openPdfViewer();
            sendResponse(state());
            return;
          }
          fatalShown = false;
          page.toggle();
          sendResponse(state());
          return;
        case 'page:set':
          if (isPdf) {
            if (msg.on) openPdfViewer();
            sendResponse(state());
            return;
          }
          fatalShown = false;
          if (msg.on) page.start();
          else page.stop();
          sendResponse(state());
          return;
        case 'page:state':
          sendResponse(state());
          return;
        case 'page:retry-errors':
          page.retryErrors();
          sendResponse(state());
          return;
        case 'selection:translate':
          selection.translate(msg.text);
          sendResponse(state());
          return;
      }
    });

    // Re-translate when anything that changes the output changes; just re-style otherwise.
    const fingerprint = (s: Settings) => {
      const p = getActiveProvider(s);
      return JSON.stringify([
        s.targetLang,
        findStyle(s, effectiveSiteConfig(s, host).styleId).instruction,
        s.glossary,
        s.neverTranslateLangs,
        p?.protocol,
        p?.baseURL,
        p?.model,
        p?.apiKey,
      ]);
    };
    watchSettings((next) => {
      const prev = settings;
      settings = next;
      t = createT(next.uiLang);
      const wasNever = effectiveSiteConfig(prev, host).mode === 'never';
      if (fingerprint(prev) !== fingerprint(next)) {
        fatalShown = false;
        page.restart();
      } else {
        page.applyDisplay();
      }
      // A newly added "always" rule takes effect immediately.
      const mode = site().mode;
      if (mode === 'always' && (wasNever || effectiveSiteConfig(prev, host).mode !== 'always'))
        page.start();
    });

    // ---- auto-translate on load ----
    const auto = async (): Promise<boolean> => {
      const cfg = site();
      if (cfg.mode === 'always') return true;
      if (cfg.mode === 'never' || !settings.autoTranslateForeign) return false;
      let lang: string | undefined = document.documentElement.lang || undefined;
      if (!lang) {
        const sample = (document.body?.innerText ?? '').slice(0, 2000);
        lang = await detectLanguage(sample, browserDetect);
      }
      if (!lang) return false;
      if (sameLanguage(lang, settings.targetLang)) return false;
      return !settings.neverTranslateLangs.some((n) => sameLanguage(n, lang));
    };
    if (isPdf) return;
    if (window === window.top && (await auto())) page.start();
  },
});
