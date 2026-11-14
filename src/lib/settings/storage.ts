import { storage } from 'wxt/utils/storage';
import { createDefaultSettings, normalizeSettings, type Settings } from './schema';

const browserLang = typeof navigator !== 'undefined' ? navigator.language : 'en';

/**
 * All settings live in storage.local (never storage.sync) so API keys never leave the device.
 */
export const settingsItem = storage.defineItem<unknown>('local:settings', {
  fallback: null,
  version: 1,
});

export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await settingsItem.getValue(), browserLang);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsItem.setValue(normalizeSettings(settings, browserLang));
}

export async function updateSettings(fn: (s: Settings) => Settings | void): Promise<Settings> {
  const current = await loadSettings();
  const next = fn(current) ?? current;
  await saveSettings(next);
  return next;
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return settingsItem.watch((v) => cb(normalizeSettings(v, browserLang)));
}

export function defaultSettings(): Settings {
  return createDefaultSettings(browserLang);
}

export interface ExportOptions {
  includeKeys: boolean;
}

export function exportSettings(settings: Settings, opts: ExportOptions): string {
  const copy: Settings = structuredClone(settings);
  if (!opts.includeKeys) {
    copy.providers = copy.providers.map((p) => ({ ...p, apiKey: '' }));
  }
  return JSON.stringify({ app: 'translate-now', version: 1, settings: copy }, null, 2);
}

/** Merge imported JSON into current settings; keeps existing keys when the import has none. */
export function importSettings(json: string, current: Settings): Settings {
  const parsed: unknown = JSON.parse(json);
  const raw =
    typeof parsed === 'object' && parsed !== null && 'settings' in parsed
      ? (parsed as { settings: unknown }).settings
      : parsed;
  const next = normalizeSettings(raw, browserLang);
  next.providers = next.providers.map((p) => {
    if (p.apiKey) return p;
    const existing = current.providers.find((c) => c.id === p.id);
    return existing ? { ...p, apiKey: existing.apiKey } : p;
  });
  return next;
}
