import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { cn } from 'cn';
import { browser } from 'wxt/browser';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import Alert02Icon from '@hugeicons/core-free-icons/Alert02Icon';
import AiNetworkIcon from '@hugeicons/core-free-icons/AiNetworkIcon';
import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon';
import CursorTextIcon from '@hugeicons/core-free-icons/CursorTextIcon';
import LanguageSquareIcon from '@hugeicons/core-free-icons/LanguageSquareIcon';
import Layout01Icon from '@hugeicons/core-free-icons/Layout01Icon';
import PaintBrush04Icon from '@hugeicons/core-free-icons/PaintBrush04Icon';
import RepeatIcon from '@hugeicons/core-free-icons/RepeatIcon';
import Settings02Icon from '@hugeicons/core-free-icons/Settings02Icon';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { SimpleSelect } from '@/components/app/simple-select';
import { createT, type MessageKey } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/languages';
import { sendToTab, type PageState } from '@/lib/messaging';
import { getPreset } from '@/lib/providers/presets';
import { getActiveProvider, type DisplayMode, type SiteMode } from '@/lib/settings/schema';
import { effectiveSiteConfig } from '@/lib/settings/siteRules';
import { allStyles } from '@/lib/settings/styles';
import { AppTheme } from '@/components/app/app-theme';
import {
  setDisplayMode,
  setSiteMode,
  setSiteSelection,
  setStyle,
} from '@/lib/settings/site-actions';
import { useSettings } from '@/hooks/use-settings';

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

const STORE_HOSTS = new Set([
  'chromewebstore.google.com',
  'addons.mozilla.org',
  'microsoftedge.microsoft.com',
]);

/** Full-bleed rows with a 20px icon and a 16px inset, like the browser's own menus. */
const ROW = 'min-h-12 gap-4 rounded-none border-0 px-5 py-1.5';

function Row(props: {
  icon: IconSvgElement;
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Item className={ROW}>
      <ItemMedia>
        <HugeiconsIcon icon={props.icon} size={20} className="text-muted-foreground" />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <Label htmlFor={props.htmlFor} className="font-normal">
          {props.label}
        </Label>
      </ItemContent>
      <ItemActions>{props.children}</ItemActions>
    </Item>
  );
}

function SectionTitle(props: { title: string; description?: string }) {
  return (
    <div className="px-5 pt-3 pb-1">
      <h2 className="m-0 text-sm font-semibold">{props.title}</h2>
      {props.description && (
        <p className="m-0 mt-0.5 truncate text-sm text-muted-foreground">{props.description}</p>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppTheme className="w-[360px]">
      <Popup />
    </AppTheme>
  );
}

function Popup() {
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

  // Swap the static loading surface for the fully configured UI in the same
  // frame, after the theme's portal has initialized during the settings read.
  useLayoutEffect(() => {
    if (settings) document.getElementById('popup-loading')?.remove();
  }, [settings]);

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
  const retryErrors = () =>
    tabId !== undefined &&
    void sendToTab(tabId, { type: 'page:retry-errors' }).then((s) => setState(s ?? null));
  const openOptions = (hash?: string) =>
    void (
      hash
        ? browser.tabs.create({ url: browser.runtime.getURL(`/options.html${hash}`) })
        : browser.runtime.openOptionsPage()
    ).then(() => window.close());

  const total = state ? state.done + state.pending + state.errors : 0;

  return (
    // Browser popups are at most 600px tall: header and footer stay put, the middle scrolls.
    <div className="flex max-h-[600px] flex-col pb-1">
      {/* Header, like the browser's own menus: title, current site, close. */}
      <header className="shrink-0 flex items-start gap-2 pt-4 pr-3 pb-2 pl-5">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-xl leading-7 font-normal">{t('appName')}</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          color="gray"
          aria-label={t('close')}
          title={t('close')}
          onClick={() => window.close()}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={20} />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {/* Main action. */}
        <div className="flex flex-col gap-2 px-5 pt-1 pb-3">
          {state === undefined ? (
            <div className="flex h-10 items-center justify-center">
              <Spinner />
            </div>
          ) : available ? (
            <>
              <Button
                size="3"
                variant={state.translated ? 'soft' : 'solid'}
                className="main-btn w-full"
                onClick={() => void toggle()}
              >
                {state.translated ? t('popupShowOriginal') : t('popupTranslatePage')}
              </Button>
              <div className="flex min-h-5 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {state.translated && total > 0 && (
                  <span>{t('popupProgress', state.done, total)}</span>
                )}
                {state.errors > 0 && (
                  <>
                    <span className="text-destructive">{t('popupErrors', state.errors)}</span>
                    <Button variant="link" size="1" onClick={retryErrors}>
                      {t('popupRetryErrors')}
                    </Button>
                  </>
                )}
                {!state.translated && shortcut && <span>{t('popupShortcut', shortcut)}</span>}
              </div>
            </>
          ) : (
            <p className="unavailable m-0 text-sm text-muted-foreground">
              {host && !STORE_HOSTS.has(host) ? t('popupReload') : t('popupUnavailable')}
            </p>
          )}
          {missingKey && (
            <Alert>
              <HugeiconsIcon icon={Alert02Icon} />
              <AlertDescription>{t('popupNoKeyHint')}</AlertDescription>
              <AlertAction>
                <Button size="1" variant="soft" onClick={() => openOptions('#providers')}>
                  {t('popupSetUp')}
                </Button>
              </AlertAction>
            </Alert>
          )}
        </div>

        <SectionTitle title={t('popupTranslation')} />
        <Row icon={LanguageSquareIcon} label={t('popupTarget')} htmlFor="target">
          <SimpleSelect
            id="target"
            size="sm"
            value={settings.targetLang}
            options={LANGUAGES.map((l) => ({ value: l.code, label: l.name }))}
            onChange={(v) => void update((s) => void (s.targetLang = v))}
          />
        </Row>
        <Row icon={Layout01Icon} label={t('popupDisplay')} htmlFor="display">
          <SimpleSelect
            id="display"
            size="sm"
            value={site?.displayMode ?? settings.displayMode}
            options={[
              { value: 'bilingual', label: t('displayBilingual') },
              { value: 'translation-only', label: t('displayTranslationOnly') },
            ]}
            onChange={(v) =>
              void update((s) =>
                host
                  ? setDisplayMode(s, host, v as DisplayMode)
                  : void (s.displayMode = v as DisplayMode),
              )
            }
          />
        </Row>
        <Row icon={PaintBrush04Icon} label={t('popupStyle')} htmlFor="style">
          <SimpleSelect
            id="style"
            size="sm"
            value={site?.styleId ?? settings.styleId}
            options={allStyles(settings).map((st) => ({
              value: st.id,
              label: st.builtin ? t(`style_${st.id}` as MessageKey) : st.name,
            }))}
            onChange={(v) =>
              void update((s) => (host ? setStyle(s, host, v) : void (s.styleId = v)))
            }
          />
        </Row>

        {host && site && (
          <>
            <SectionTitle title={t('popupThisSite')} description={host} />
            <Row icon={RepeatIcon} label={t('popupSiteMode')} htmlFor="site-mode">
              <SimpleSelect
                id="site-mode"
                size="sm"
                value={site.mode}
                options={[
                  { value: 'default', label: t('popupSiteDefault') },
                  { value: 'always', label: t('popupSiteAlways') },
                  { value: 'never', label: t('popupSiteNever') },
                ]}
                onChange={(v) => void update((s) => setSiteMode(s, host, v as SiteMode))}
              />
            </Row>
            <Row icon={CursorTextIcon} label={t('popupSelection')} htmlFor="sel">
              <Switch
                id="sel"
                checked={site.selectionEnabled}
                onCheckedChange={(on) => void update((s) => setSiteSelection(s, host, on))}
              />
            </Row>
          </>
        )}
      </div>

      {/* Footer, like "Manage extensions". */}
      <Separator />
      <div className="shrink-0 pt-1">
        <FooterRow
          icon={AiNetworkIcon}
          label={t('popupService')}
          detail={
            missingKey
              ? t('popupNoKey')
              : `${provider?.name ?? '—'}${provider?.model ? ` · ${provider.model}` : ''}`
          }
          warn={missingKey}
          onClick={() => openOptions('#providers')}
        />
        <FooterRow
          icon={Settings02Icon}
          label={t('popupSettings')}
          onClick={() => openOptions()}
          className="settings-btn"
        />
      </div>
    </div>
  );
}

function FooterRow(props: {
  icon: IconSvgElement;
  label: string;
  detail?: string;
  warn?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Item
      render={<button type="button" onClick={props.onClick} />}
      className={cn(ROW, 'cursor-pointer bg-transparent text-left hover:bg-muted', props.className)}
    >
      <ItemMedia>
        <HugeiconsIcon icon={props.icon} size={20} className="text-muted-foreground" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="font-normal">{props.label}</ItemTitle>
      </ItemContent>
      {props.detail && (
        <ItemActions
          className={cn(
            'min-w-0 max-w-[60%] truncate text-sm',
            props.warn ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          <span className="truncate">{props.detail}</span>
        </ItemActions>
      )}
    </Item>
  );
}
