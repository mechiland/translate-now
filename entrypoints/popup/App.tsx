import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { createT, type MessageKey } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/languages';
import { sendToBackground, sendToTab, type PageState } from '@/lib/messaging';
import { getPreset } from '@/lib/providers/presets';
import { getActiveProvider, type SiteMode } from '@/lib/settings/schema';
import { effectiveSiteConfig } from '@/lib/settings/siteRules';
import { allStyles } from '@/lib/settings/styles';
import { Logo } from '@/lib/ui/Logo';
import { setDisplayMode, setSiteMode, setSiteSelection, setStyle } from '@/lib/ui/siteActions';
import { useSettings } from '@/lib/ui/useSettings';

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:'
      ? u.hostname
      : undefined;
  } catch {
    return undefined;
  }
}

export default function App() {
  const [settings, update] = useSettings();
  const [tabId, setTabId] = useState<number>();
  const [host, setHost] = useState<string>();
  const [state, setState] = useState<PageState | null>();
  const [shortcut, setShortcut] = useState('');

  const refresh = useCallback(async (id: number) => {
    try {
      setState((await sendToTab(id, { type: 'page:state' })) ?? null);
    } catch {
      setState(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      setTabId(tab?.id);
      setHost(hostOf(tab?.url));
      if (tab?.id !== undefined) await refresh(tab.id);
      else setState(null);
      const cmds = await browser.commands.getAll().catch(() => []);
      setShortcut(cmds.find((c) => c.name === 'toggle-page')?.shortcut ?? '');
    })();
  }, [refresh]);

  // Poll progress while the page is translating.
  useEffect(() => {
    if (tabId === undefined || !state?.translated) return;
    const timer = setInterval(() => void refresh(tabId), 700);
    return () => clearInterval(timer);
  }, [tabId, state?.translated, refresh]);

  if (!settings) return null;
  const t = createT(settings.uiLang);
  const provider = getActiveProvider(settings);
  const preset = provider ? getPreset(provider.presetId) : undefined;
  const missingKey = !provider || !provider.model || (preset?.keyRequired && !provider.apiKey);
  const site = host ? effectiveSiteConfig(settings, host) : undefined;
  const available = state !== null && state !== undefined && host !== undefined;

  const toggle = async () => {
    if (tabId === undefined) return;
    try {
      setState((await sendToTab(tabId, { type: 'page:toggle' })) ?? null);
    } catch {
      setState(null);
    }
  };

  const openOptions = () => void browser.runtime.openOptionsPage().then(() => window.close());

  const siteModes: { mode: SiteMode; key: MessageKey }[] = [
    { mode: 'default', key: 'popupSiteDefault' },
    { mode: 'always', key: 'popupSiteAlways' },
    { mode: 'never', key: 'popupSiteNever' },
  ];

  return (
    <div className="popup">
      <div className="top">
        <Logo />
        <h1>{t('appName')}</h1>
        <button
          className="icon-btn"
          title={t('openSettings')}
          aria-label={t('openSettings')}
          onClick={openOptions}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </div>

      {state === undefined ? (
        <div className="status" />
      ) : available ? (
        <>
          <button
            className={`btn main-btn ${state.translated ? '' : 'primary'}`}
            onClick={() => void toggle()}
          >
            {state.translated ? t('popupShowOriginal') : t('popupTranslatePage')}
          </button>
          <div className="status">
            {state.translated && state.done + state.pending + state.errors > 0 && (
              <span>
                {t('popupProgress', state.done, state.done + state.pending + state.errors)}
              </span>
            )}
            {state.errors > 0 && (
              <>
                <span className="err">{t('popupErrors', state.errors)}</span>
                <button
                  className="link small"
                  onClick={() =>
                    tabId !== undefined &&
                    void sendToTab(tabId, { type: 'page:retry-errors' }).then((s) =>
                      setState(s ?? null),
                    )
                  }
                >
                  {t('popupRetryErrors')}
                </button>
              </>
            )}
            {!state.translated && shortcut && <span>{t('popupShortcut', shortcut)}</span>}
          </div>
        </>
      ) : (
        <div className="unavailable">
          {host &&
          host !== 'chromewebstore.google.com' &&
          host !== 'addons.mozilla.org' &&
          host !== 'microsoftedge.microsoft.com'
            ? t('popupReload')
            : t('popupUnavailable')}
        </div>
      )}

      <div className="rows">
        <div className="row">
          <label htmlFor="target">{t('popupTarget')}</label>
          <select
            id="target"
            value={settings.targetLang}
            onChange={(e) => void update((s) => void (s.targetLang = e.target.value))}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span>{t('popupDisplay')}</span>
          <div className="seg">
            {(['bilingual', 'translation-only'] as const).map((m) => (
              <button
                key={m}
                className={(site?.displayMode ?? settings.displayMode) === m ? 'on' : ''}
                onClick={() =>
                  void update((s) => (host ? setDisplayMode(s, host, m) : void (s.displayMode = m)))
                }
              >
                {m === 'bilingual' ? t('displayBilingual') : t('displayTranslationOnly')}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label htmlFor="style">{t('popupStyle')}</label>
          <select
            id="style"
            value={site?.styleId ?? settings.styleId}
            onChange={(e) =>
              void update((s) =>
                host ? setStyle(s, host, e.target.value) : void (s.styleId = e.target.value),
              )
            }
          >
            {allStyles(settings).map((st) => (
              <option key={st.id} value={st.id}>
                {st.builtin ? t(`style_${st.id}` as MessageKey) : st.name}
              </option>
            ))}
          </select>
        </div>
        {host && site && (
          <>
            <div className="row">
              <span title={host}>{t('popupThisSite')}</span>
              <div className="seg">
                {siteModes.map(({ mode, key }) => (
                  <button
                    key={mode}
                    className={site.mode === mode ? 'on' : ''}
                    onClick={() => void update((s) => setSiteMode(s, host, mode))}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <label htmlFor="sel">{t('popupSelection')}</label>
              <input
                id="sel"
                type="checkbox"
                className="switch"
                checked={site.selectionEnabled}
                onChange={(e) => void update((s) => setSiteSelection(s, host, e.target.checked))}
              />
            </div>
          </>
        )}
      </div>

      <div className="footer">
        <span className="svc">
          {t('popupService')}: {provider?.name ?? '—'}
          {provider?.model ? ` · ${provider.model}` : ''}
        </span>
        {missingKey ? (
          <button className="link small warn" onClick={openOptions}>
            {t('popupNoKey')}
          </button>
        ) : (
          <button
            className="link small"
            onClick={() =>
              void sendToBackground({ type: 'options:open' }).then(() => window.close())
            }
          >
            {t('openSettings')}
          </button>
        )}
      </div>
    </div>
  );
}
