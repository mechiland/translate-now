import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { sendToBackground } from '@/lib/messaging';
import {
  defaultSettings,
  exportSettings,
  importSettings,
  saveSettings,
} from '@/lib/settings/storage';
import type { SectionProps } from './types';

const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);

export function ShortcutsSection({ t }: SectionProps) {
  const [commands, setCommands] = useState<{ name?: string; shortcut?: string }[]>([]);
  useEffect(() => {
    void browser.commands
      .getAll()
      .then(setCommands)
      .catch(() => setCommands([]));
  }, []);
  const label = (name?: string) =>
    name === 'toggle-page'
      ? t('shortcutToggle')
      : name === 'translate-selection'
        ? t('shortcutSelection')
        : name;
  const open = () => {
    const url = navigator.userAgent.includes('Edg/')
      ? 'edge://extensions/shortcuts'
      : 'chrome://extensions/shortcuts';
    void browser.tabs.create({ url });
  };
  return (
    <div>
      <p className="intro">{t('shortcutsIntro')}</p>
      <table className="grid">
        <tbody>
          {commands
            .filter((c) => c.name === 'toggle-page' || c.name === 'translate-selection')
            .map((c) => (
              <tr key={c.name}>
                <td>{label(c.name)}</td>
                <td>
                  {c.shortcut ? (
                    <span className="kbd">{c.shortcut}</span>
                  ) : (
                    <span className="muted">{t('notSet')}</span>
                  )}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="actions">
        {isFirefox ? (
          <span className="muted">{t('shortcutsFirefox')}</span>
        ) : (
          <button className="btn" onClick={open}>
            {t('shortcutsOpen')}
          </button>
        )}
      </div>
    </div>
  );
}

export function DataSection({ settings, t }: SectionProps) {
  const [count, setCount] = useState<number>();
  const [includeKeys, setIncludeKeys] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    void sendToBackground({ type: 'cache:count' }).then((r) => setCount(r.count));
  useEffect(refresh, []);

  const exportJson = () => {
    const blob = new Blob([exportSettings(settings, { includeKeys })], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `translate-now-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (file: File) => {
    try {
      const next = importSettings(await file.text(), settings);
      await saveSettings(next);
      setMessage({ ok: true, text: t('importOk') });
    } catch (e) {
      setMessage({
        ok: false,
        text: t('importFailed', e instanceof Error ? e.message : String(e)),
      });
    }
  };

  return (
    <div>
      <h3>{t('cacheTitle')}</h3>
      <div className="actions">
        <span>{count === undefined ? '…' : t('cacheCount', count)}</span>
        <button
          className="btn"
          onClick={() =>
            void sendToBackground({ type: 'cache:clear' }).then(() => {
              setMessage({ ok: true, text: t('cacheCleared') });
              refresh();
            })
          }
        >
          {t('cacheClear')}
        </button>
      </div>

      <h3>{t('exportTitle')}</h3>
      <label className="switch">
        <input
          type="checkbox"
          checked={includeKeys}
          onChange={(e) => setIncludeKeys(e.target.checked)}
        />
        {t('exportIncludeKeys')}
      </label>
      <div className="actions">
        <button className="btn" onClick={exportJson}>
          {t('exportButton')}
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          {t('importButton')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJson(f);
            e.target.value = '';
          }}
        />
      </div>

      <h3>{t('resetTitle')}</h3>
      <div className="actions">
        <button
          className="btn danger"
          onClick={() => {
            if (confirm(t('resetConfirm'))) void saveSettings(defaultSettings());
          }}
        >
          {t('resetButton')}
        </button>
      </div>
      {message && <p className={message.ok ? 'ok' : 'err'}>{message.text}</p>}
    </div>
  );
}

export function AboutSection({ t }: SectionProps) {
  const version = browser.runtime.getManifest().version;
  return (
    <div>
      <p>{t('aboutText')}</p>
      <p>{t('aboutPrivacy')}</p>
      <p>
        v{version} ·{' '}
        <a
          className="link"
          href="https://github.com/mechiland/translate-now"
          target="_blank"
          rel="noreferrer"
        >
          {t('aboutSource')} ↗
        </a>
      </p>
    </div>
  );
}
