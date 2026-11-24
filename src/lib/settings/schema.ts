import { defaultTargetLang } from '../languages';

export type Protocol = 'openai' | 'anthropic';

export interface ProviderProfile {
  id: string;
  /** Display name chosen by the user. */
  name: string;
  /** Which preset this profile was created from (see providers/presets.ts). */
  presetId: string;
  protocol: Protocol;
  baseURL: string;
  apiKey: string;
  model: string;
  /** Undefined = let the model use its default temperature. */
  temperature?: number;
  /** Let reasoning models think before answering. Off by default: much slower. */
  allowThinking?: boolean;
}

export type DisplayMode = 'bilingual' | 'translation-only';

export type TranslationTheme = 'none' | 'underline' | 'background' | 'border' | 'dimmed' | 'italic';

export interface TranslationStyle {
  id: string;
  name: string;
  /** Extra instruction appended to the system prompt. */
  instruction: string;
  builtin?: boolean;
}

export interface GlossaryEntry {
  source: string;
  target: string;
}

export type SiteMode = 'default' | 'always' | 'never';

export interface SiteRule {
  /** "example.com" (also matches subdomains) or "*.example.com" or exact "=www.example.com". */
  pattern: string;
  mode: SiteMode;
  styleId?: string;
  displayMode?: DisplayMode;
  /** Override the global selection-translation switch for this site. */
  selection?: boolean;
}

export interface SelectionSettings {
  enabled: boolean;
  /** icon = show a small button first; auto = translate as soon as text is selected. */
  trigger: 'icon' | 'auto';
}

/** Modifier key that translates the paragraph under the pointer when tapped alone. */
export type HoverModifier = 'off' | 'ctrl' | 'alt' | 'shift';

export const HOVER_MODIFIERS: readonly HoverModifier[] = ['off', 'ctrl', 'alt', 'shift'];

export interface HoverSettings {
  modifier: HoverModifier;
}

export interface BatchSettings {
  /** Max characters per request. */
  maxChars: number;
  /** Max paragraphs per request. */
  maxSegments: number;
  /** Max parallel requests. */
  concurrency: number;
}

export type UiLang = 'auto' | 'zh' | 'en';

export interface Settings {
  activeProviderId: string;
  providers: ProviderProfile[];
  targetLang: string;
  /** Paragraphs detected in these languages are left untouched. */
  neverTranslateLangs: string[];
  displayMode: DisplayMode;
  theme: TranslationTheme;
  styleId: string;
  customStyles: TranslationStyle[];
  glossary: GlossaryEntry[];
  siteRules: SiteRule[];
  /** Automatically translate pages whose language differs from the target language. */
  autoTranslateForeign: boolean;
  selection: SelectionSettings;
  hover: HoverSettings;
  batch: BatchSettings;
  uiLang: UiLang;
}

export const DEFAULT_PROVIDER_ID = 'default';

export function createDefaultSettings(browserLang?: string): Settings {
  return {
    activeProviderId: DEFAULT_PROVIDER_ID,
    providers: [
      {
        id: DEFAULT_PROVIDER_ID,
        name: 'OpenAI',
        presetId: 'openai',
        protocol: 'openai',
        baseURL: 'https://api.openai.com/v1',
        apiKey: '',
        model: '',
      },
    ],
    targetLang: defaultTargetLang(browserLang),
    neverTranslateLangs: [],
    displayMode: 'bilingual',
    theme: 'dimmed',
    styleId: 'standard',
    customStyles: [],
    glossary: [],
    siteRules: [],
    autoTranslateForeign: false,
    selection: { enabled: true, trigger: 'icon' },
    // Ctrl: tapping Alt opens browser menus on Windows/Linux, and Shift switches Chinese IMEs.
    hover: { modifier: 'ctrl' },
    batch: { maxChars: 2000, maxSegments: 12, concurrency: 4 },
    uiLang: 'auto',
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Fill in any missing fields of a (possibly older or partially imported) settings
 * object with defaults. Unknown fields are dropped; nested plain objects are merged.
 */
export function normalizeSettings(input: unknown, browserLang?: string): Settings {
  const defaults = createDefaultSettings(browserLang);
  if (!isObject(input)) return defaults;
  const out: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    const def = defaults[key];
    if (isObject(def)) {
      if (isObject(value)) out[key] = { ...(def as object), ...value };
    } else if (Array.isArray(def)) {
      if (Array.isArray(value)) out[key] = value;
    } else if (typeof value === typeof def) {
      out[key] = value;
    }
  }
  const settings = out as unknown as Settings;
  if (settings.providers.length === 0) settings.providers = defaults.providers;
  if (!settings.providers.some((p) => p.id === settings.activeProviderId)) {
    settings.activeProviderId = settings.providers[0]!.id;
  }
  if (!HOVER_MODIFIERS.includes(settings.hover.modifier)) {
    settings.hover.modifier = defaults.hover.modifier;
  }
  const b = settings.batch;
  b.maxChars = clamp(b.maxChars, 200, 20000);
  b.maxSegments = clamp(b.maxSegments, 1, 100);
  b.concurrency = clamp(b.concurrency, 1, 20);
  return settings;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function getActiveProvider(settings: Settings): ProviderProfile | undefined {
  return (
    settings.providers.find((p) => p.id === settings.activeProviderId) ?? settings.providers[0]
  );
}
