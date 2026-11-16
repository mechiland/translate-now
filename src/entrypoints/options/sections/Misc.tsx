import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { HugeiconsIcon } from '@hugeicons/react';
import LinkSquare02Icon from '@hugeicons/core-free-icons/LinkSquare02Icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Kbd } from '@/components/ui/kbd';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { ConfirmButton } from '@/components/app/confirm-button';
import { SettingsCard } from '@/components/app/settings-card';
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
    <SettingsCard description={t('shortcutsIntro')}>
      <Table>
        <TableBody>
          {commands
            .filter((c) => c.name === 'toggle-page' || c.name === 'translate-selection')
            .map((c) => (
              <TableRow key={c.name}>
                <TableCell>{label(c.name)}</TableCell>
                <TableCell className="text-right">
                  {c.shortcut ? (
                    <Kbd>{c.shortcut}</Kbd>
                  ) : (
                    <span className="text-muted-foreground">{t('notSet')}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
      {isFirefox ? (
        <FieldDescription>{t('shortcutsFirefox')}</FieldDescription>
      ) : (
        <div>
          <Button variant="soft" onClick={open}>
            {t('shortcutsOpen')}
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}

export function DataSection({ settings, t }: SectionProps) {
  const [count, setCount] = useState<number>();
  const [includeKeys, setIncludeKeys] = useState(false);
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
      toast.add({ title: t('importOk'), type: 'success' });
    } catch (e) {
      toast.add({
        title: t('importFailed', e instanceof Error ? e.message : String(e)),
        type: 'error',
      });
    }
  };

  return (
    <>
      <SettingsCard title={t('cacheTitle')}>
        <Field orientation="horizontal">
          <FieldLabel className="font-normal">
            {count === undefined ? '…' : t('cacheCount', count)}
          </FieldLabel>
          <Button
            variant="soft"
            onClick={() =>
              void sendToBackground({ type: 'cache:clear' }).then(() => {
                toast.add({ title: t('cacheCleared'), type: 'success' });
                refresh();
              })
            }
          >
            {t('cacheClear')}
          </Button>
        </Field>
      </SettingsCard>

      <SettingsCard title={t('exportTitle')}>
        <Field orientation="horizontal">
          <Checkbox
            id="include-keys"
            checked={includeKeys}
            onCheckedChange={(on) => setIncludeKeys(on)}
          />
          <FieldLabel htmlFor="include-keys" className="font-normal">
            {t('exportIncludeKeys')}
          </FieldLabel>
        </Field>
        <div className="flex gap-2">
          <Button variant="soft" onClick={exportJson}>
            {t('exportButton')}
          </Button>
          <Button variant="soft" onClick={() => fileRef.current?.click()}>
            {t('importButton')}
          </Button>
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
      </SettingsCard>

      <SettingsCard title={t('resetTitle')}>
        <div>
          <ConfirmButton
            title={t('resetConfirm')}
            confirmLabel={t('resetButton')}
            cancelLabel={t('cancel')}
            onConfirm={() => void saveSettings(defaultSettings())}
          >
            {t('resetButton')}
          </ConfirmButton>
        </div>
      </SettingsCard>
    </>
  );
}

export function AboutSection({ t }: SectionProps) {
  const version = browser.runtime.getManifest().version;
  return (
    <SettingsCard>
      <p className="m-0">{t('aboutText')}</p>
      <p className="m-0">{t('aboutPrivacy')}</p>
      <p className="m-0 flex items-center gap-2 text-muted-foreground">
        v{version} ·
        <a
          className="inline-flex items-center gap-1 text-primary"
          href="https://github.com/mechiland/translate-now"
          target="_blank"
          rel="noreferrer"
        >
          {t('aboutSource')}
          <HugeiconsIcon icon={LinkSquare02Icon} size={14} />
        </a>
      </p>
    </SettingsCard>
  );
}
