import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import { browser } from 'wxt/browser';
import { HugeiconsIcon } from '@hugeicons/react';
import FileUploadIcon from '@hugeicons/core-free-icons/FileUploadIcon';
import MinusSignIcon from '@hugeicons/core-free-icons/MinusSignIcon';
import PlusSignIcon from '@hugeicons/core-free-icons/PlusSignIcon';
import Settings02Icon from '@hugeicons/core-free-icons/Settings02Icon';
import { AppTheme } from '@/components/app/app-theme';
import { Choice } from '@/components/app/choice';
import { Logo } from '@/components/app/logo';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { useSettings } from '@/hooks/use-settings';
import type { LanguageDetector } from '@/lib/dom/detect';
import { SelectionUi } from '@/lib/dom/selectionUi';
import { createT, type TFunction } from '@/lib/i18n';
import {
  sendToBackground,
  type ContentMessage,
  type PageState,
  type ViewerMessage,
} from '@/lib/messaging';
import { openPdf } from '@/lib/pdf/pdfjs';
import { pdfFileName } from '@/lib/pdf/url';
import { PdfViewer } from '@/lib/pdf/viewer';
import { getActiveProvider, type DisplayMode, type Settings } from '@/lib/settings/schema';
import { setDisplayMode } from '@/lib/settings/site-actions';
import { effectiveSiteConfig } from '@/lib/settings/siteRules';
import { findStyle } from '@/lib/settings/styles';

export default function App() {
  return (
    <AppTheme className="pdf-app flex h-screen flex-col">
      <Viewer />
    </AppTheme>
  );
}

type Phase = 'empty' | 'loading' | 'ready' | 'error';

interface Source {
  name: string;
  host: string;
}

const browserDetect: LanguageDetector | undefined = browser.i18n?.detectLanguage
  ? async (text) => {
      const res = await browser.i18n.detectLanguage(text);
      const top = res.languages[0];
      if (!res.isReliable || !top || top.percentage < 60 || top.language === 'und')
        return undefined;
      return top.language;
    }
  : undefined;

/** Settings that change the translation output (vs. only how it is shown). */
function fingerprint(s: Settings, host: string): string {
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
}

function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname : '';
  } catch {
    return '';
  }
}

function Viewer() {
  const [settings, update] = useSettings();
  const settingsRef = useRef<Settings | undefined>(undefined);
  const t: TFunction = createT(settings?.uiLang ?? 'auto');
  const tRef = useRef(t);

  const [fileUrl] = useState(() => new URLSearchParams(location.search).get('file') ?? '');
  const [phase, setPhase] = useState<Phase>(fileUrl ? 'loading' : 'empty');
  const [error, setError] = useState('');
  const [source, setSource] = useState<Source>({
    name: fileUrl ? pdfFileName(fileUrl) : '',
    host: hostOf(fileUrl),
  });
  const sourceRef = useRef(source);
  // Callbacks handed to the viewer and selection UI read the latest values through refs.
  useLayoutEffect(() => {
    settingsRef.current = settings;
    tRef.current = t;
    sourceRef.current = source;
  });
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const exportAbort = useRef<AbortController | null>(null);
  const [dragging, setDragging] = useState(false);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PdfViewer | null>(null);
  const [viewer, setViewer] = useState<PdfViewer | null>(null);
  const selectionRef = useRef<SelectionUi | null>(null);
  const fatalShown = useRef(false);
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  const openSettings = useCallback(
    () => void sendToBackground({ type: 'options:open' }).catch(() => {}),
    [],
  );

  // Selection translation and toasts, as on web pages.
  useEffect(() => {
    const selection = new SelectionUi({
      doc: document,
      isEnabled: () => {
        const s = settingsRef.current;
        return !!s && effectiveSiteConfig(s, sourceRef.current.host).selectionEnabled;
      },
      trigger: () => settingsRef.current?.selection.trigger ?? 'icon',
      targetLang: () => settingsRef.current?.targetLang ?? 'en',
      translate: (text, targetLang) =>
        sendToBackground({
          type: 'translate:selection',
          text,
          targetLang,
          host: sourceRef.current.host,
          title: document.title,
        }),
      openSettings,
      strings: () => {
        const tt = tRef.current;
        return {
          translate: tt('translate'),
          copy: tt('copy'),
          copied: tt('copied'),
          close: tt('close'),
          retry: tt('retry'),
          openSettings: tt('openSettings'),
          failed: tt('failed'),
        };
      },
    });
    selectionRef.current = selection;
    return () => selection.destroy();
  }, [openSettings]);

  const load = useCallback(
    async (getData: () => Promise<Uint8Array>, next: Source) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      exportAbort.current?.abort();
      setExporting(null);
      viewerRef.current?.destroy();
      viewerRef.current = null;
      setViewer(null);
      setSource(next);
      sourceRef.current = next;
      setPhase('loading');
      setError('');
      try {
        const data = await getData();
        const doc = await openPdf(data).promise;
        const meta = await doc.getMetadata().catch(() => null);
        const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
        const name = typeof title === 'string' && title.trim() ? title.trim() : next.name;
        setSource({ ...next, name });
        document.title = `${name} · Translate Now`;
        const viewer = new PdfViewer(scroller, doc, {
          translate: async (texts) => {
            const res = await sendToBackground({
              type: 'translate:page',
              texts,
              host: sourceRef.current.host,
              title: name,
            });
            return res.results;
          },
          cancel: () => void sendToBackground({ type: 'cancel' }).catch(() => {}),
          getConfig: () => {
            const s = settingsRef.current!;
            return {
              targetLang: s.targetLang,
              neverTranslateLangs: s.neverTranslateLangs,
              displayMode: effectiveSiteConfig(s, sourceRef.current.host).displayMode,
              maxChars: s.batch.maxChars,
              maxSegments: s.batch.maxSegments,
            };
          },
          browserDetect,
          strings: {
            get retry() {
              return tRef.current('retry');
            },
            error: (m) => tRef.current('errorTitle', m),
          },
          onChange: rerender,
          onFatalError: (e) => {
            if (fatalShown.current) return;
            fatalShown.current = true;
            const tt = tRef.current;
            const msg = e.kind === 'config' ? tt('toastNeedKey') : tt('toastAuth', e.message);
            selectionRef.current?.toast(msg, { label: tt('openSettings'), run: openSettings });
          },
        });
        viewerRef.current = viewer;
        await viewer.init();
        setViewer(viewer);
        setPhase('ready');
        // Opening a PDF here is the request to translate it.
        viewer.start();
      } catch (e) {
        const err = e as { name?: string; message?: string };
        const tt = tRef.current;
        setError(
          err?.name === 'PasswordException'
            ? tt('pdfPassword')
            : tt('pdfLoadFailed', err?.message ?? String(e)),
        );
        setPhase('error');
      }
    },
    [openSettings],
  );

  // Load the PDF named in the URL once settings are available.
  const started = useRef(false);
  useEffect(() => {
    if (!settings || started.current || !fileUrl) return;
    started.current = true;
    void load(
      async () => {
        let res: Response;
        try {
          res = await fetch(fileUrl, { credentials: 'include' });
        } catch (e) {
          if (fileUrl.startsWith('file:')) {
            throw new Error(tRef.current('pdfFileAccess'), { cause: e });
          }
          throw e;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return new Uint8Array(await res.arrayBuffer());
      },
      { name: pdfFileName(fileUrl), host: hostOf(fileUrl) },
    );
  }, [settings, fileUrl, load]);

  const openFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      void load(async () => new Uint8Array(await file.arrayBuffer()), {
        name: file.name,
        host: '',
      });
    },
    [load],
  );

  // React to settings changes: re-translate or just re-layout.
  const prevSettings = useRef<Settings | undefined>(undefined);
  useEffect(() => {
    const prev = prevSettings.current;
    prevSettings.current = settings;
    const viewer = viewerRef.current;
    if (!prev || !settings || !viewer) return;
    if (fingerprint(prev, source.host) !== fingerprint(settings, source.host)) {
      fatalShown.current = false;
      viewer.restart();
    } else {
      viewer.applyDisplay();
    }
  }, [settings, source.host]);

  // Popup and keyboard shortcut commands, addressed to this tab.
  useEffect(() => {
    let tabId: number | undefined;
    void browser.tabs.getCurrent().then((tab) => (tabId = tab?.id));
    const listener = (message: unknown, _sender: unknown, sendResponse: (r: unknown) => void) => {
      const msg = message as ViewerMessage;
      if (msg?.type !== 'viewer:command' || tabId === undefined || msg.tabId !== tabId) {
        return false;
      }
      const viewer = viewerRef.current;
      const cmd: ContentMessage = msg.command;
      if (cmd.type === 'selection:translate') selectionRef.current?.translate(cmd.text);
      if (viewer) {
        if (cmd.type === 'page:toggle') {
          fatalShown.current = false;
          viewer.toggle();
        } else if (cmd.type === 'page:set') {
          fatalShown.current = false;
          if (cmd.on) viewer.start();
          else viewer.stop();
        } else if (cmd.type === 'page:retry-errors') {
          viewer.retryErrors();
        }
      }
      const state: PageState = {
        translated: viewer?.active ?? false,
        host: sourceRef.current.host,
        ...(viewer?.stats() ?? { total: 0, done: 0, pending: 0, errors: 0 }),
      };
      sendResponse(state);
      return false;
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  useEffect(() => () => viewerRef.current?.destroy(), []);

  const stats = viewer?.stats();
  const displayMode: DisplayMode = settings
    ? effectiveSiteConfig(settings, source.host).displayMode
    : 'bilingual';

  const exportPdf = async () => {
    if (!viewer) return;
    if (exporting) {
      exportAbort.current?.abort();
      setExporting(null);
      return;
    }
    const ac = new AbortController();
    exportAbort.current = ac;
    const total = viewer.numPages;
    setExporting({ done: 0, total });
    await viewer.prepareExport((done) => setExporting({ done, total }), ac.signal);
    if (ac.signal.aborted) return;
    setExporting(null);
    const errors = viewer.stats().errors;
    if (errors > 0) selectionRef.current?.toast(t('pdfExportErrors', errors));
    // Let the toolbar update before the print dialog blocks the page.
    requestAnimationFrame(() => setTimeout(() => viewer.print(), 50));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = [...e.dataTransfer.files].find(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
    );
    openFile(file);
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="pdf-toolbar flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
        <Logo size={22} />
        <span className="min-w-0 truncate text-sm font-medium" title={source.name}>
          {source.name || t('appName')}
        </span>
        <div className="flex-1" />
        {viewer && settings && (
          <>
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {t('pdfPage', viewer.currentPage, viewer.numPages)}
            </span>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <Button
              variant="ghost"
              size="icon"
              color="gray"
              aria-label={t('pdfZoomOut')}
              title={t('pdfZoomOut')}
              onClick={() => viewer.zoomBy(1 / 1.15)}
            >
              <HugeiconsIcon icon={MinusSignIcon} size={18} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              color="gray"
              className="w-14 tabular-nums"
              title={t('pdfFitWidth')}
              onClick={() => viewer.setZoom('fit')}
            >
              {Math.round(viewer.zoom * 100)}%
            </Button>
            <Button
              variant="ghost"
              size="icon"
              color="gray"
              aria-label={t('pdfZoomIn')}
              title={t('pdfZoomIn')}
              onClick={() => viewer.zoomBy(1.15)}
            >
              <HugeiconsIcon icon={PlusSignIcon} size={18} />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-5" />
            {viewer.active && (
              <Choice
                label={t('popupDisplay')}
                value={displayMode}
                options={[
                  { value: 'bilingual', label: t('displayBilingual') },
                  { value: 'translation-only', label: t('displayTranslationOnly') },
                ]}
                onChange={(m) =>
                  void update((s) =>
                    source.host ? setDisplayMode(s, source.host, m) : void (s.displayMode = m),
                  )
                }
              />
            )}
            {viewer.active && stats && stats.total > 0 && (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {t('popupProgress', stats.done, stats.total)}
              </span>
            )}
            {stats && stats.errors > 0 && (
              <Button variant="link" size="1" onClick={() => viewer.retryErrors()}>
                {t('popupErrors', stats.errors)} · {t('popupRetryErrors')}
              </Button>
            )}
            <Button
              variant={viewer.active ? 'soft' : 'solid'}
              onClick={() => {
                fatalShown.current = false;
                viewer.toggle();
              }}
            >
              {viewer.active ? t('popupShowOriginal') : t('translate')}
            </Button>
            <Button variant="outline" title={t('pdfExportTitle')} onClick={() => void exportPdf()}>
              {exporting && <Spinner />}
              {exporting ? t('pdfExporting', exporting.done, exporting.total) : t('pdfExport')}
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon"
          color="gray"
          aria-label={t('popupSettings')}
          title={t('popupSettings')}
          onClick={openSettings}
        >
          <HugeiconsIcon icon={Settings02Icon} size={20} />
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={scrollerRef} className="pdf-viewer" />
        {phase !== 'ready' && (
          <div className="pdf-banner absolute inset-0 flex items-center justify-center bg-background">
            {phase === 'loading' ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Spinner /> {t('pdfLoading')}
              </div>
            ) : (
              <FilePicker
                message={phase === 'error' ? error : t('pdfDropHint')}
                isError={phase === 'error'}
                label={t('pdfOpenFile')}
                onFile={openFile}
              />
            )}
          </div>
        )}
        {dragging && (
          <div className="pdf-banner pointer-events-none absolute inset-3 rounded-xl border-2 border-dashed border-primary bg-primary/5" />
        )}
      </div>
    </div>
  );
}

function FilePicker(props: {
  message: string;
  isError: boolean;
  label: string;
  onFile: (f: File | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <HugeiconsIcon icon={FileUploadIcon} size={40} className="text-muted-foreground" />
      <p className={props.isError ? 'm-0 text-sm text-destructive' : 'm-0 text-sm'}>
        {props.message}
      </p>
      <Button onClick={() => input.current?.click()}>{props.label}</Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => props.onFile(e.target.files?.[0])}
      />
    </div>
  );
}
