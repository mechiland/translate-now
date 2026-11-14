export interface Language {
  code: string;
  /** Native name, shown in the UI. */
  name: string;
  /** English name, used in prompts. */
  english: string;
}

export const LANGUAGES: Language[] = [
  { code: 'zh-CN', name: '简体中文', english: 'Simplified Chinese' },
  { code: 'zh-TW', name: '繁體中文', english: 'Traditional Chinese' },
  { code: 'en', name: 'English', english: 'English' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'ko', name: '한국어', english: 'Korean' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'pt', name: 'Português', english: 'Portuguese' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'ru', name: 'Русский', english: 'Russian' },
  { code: 'uk', name: 'Українська', english: 'Ukrainian' },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'th', name: 'ไทย', english: 'Thai' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'ms', name: 'Bahasa Melayu', english: 'Malay' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish' },
  { code: 'ar', name: 'العربية', english: 'Arabic' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch' },
  { code: 'pl', name: 'Polski', english: 'Polish' },
];

export function getLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES.find((l) => l.code === baseLang(code));
}

export function languageEnglishName(code: string): string {
  return getLanguage(code)?.english ?? code;
}

/** "zh-CN" -> "zh", "en-US" -> "en" */
export function baseLang(code: string): string {
  return code.toLowerCase().split(/[-_]/)[0] ?? code.toLowerCase();
}

/** Pick a supported target language from a browser UI language such as "zh-CN" or "en-US". */
export function defaultTargetLang(uiLang: string | undefined): string {
  if (!uiLang) return 'en';
  const lower = uiLang.toLowerCase();
  if (lower.startsWith('zh')) {
    return /tw|hk|mo|hant/.test(lower) ? 'zh-TW' : 'zh-CN';
  }
  const base = baseLang(lower);
  return LANGUAGES.find((l) => l.code === base)?.code ?? 'en';
}

/** Two language codes refer to the same language (Chinese variants count as the same). */
export function sameLanguage(a: string, b: string): boolean {
  return baseLang(a) === baseLang(b);
}
