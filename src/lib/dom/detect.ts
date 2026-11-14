import { baseLang, sameLanguage } from '../languages';

export type ScriptGuess =
  'zh' | 'ja' | 'ko' | 'ru' | 'ar' | 'th' | 'he' | 'hi' | 'el' | 'latin' | 'unknown';

const RANGES: [ScriptGuess | 'kana' | 'han', RegExp][] = [
  ['kana', /[぀-ヿㇰ-ㇿ]/g],
  ['han', /[㐀-䶿一-鿿豈-﫿]/g],
  ['ko', /[가-힯ᄀ-ᇿ㄰-㆏]/g],
  ['ru', /[Ѐ-ӿ]/g],
  ['ar', /[؀-ۿݐ-ݿ]/g],
  ['th', /[฀-๿]/g],
  ['he', /[֐-׿]/g],
  ['hi', /[ऀ-ॿ]/g],
  ['el', /[Ͱ-Ͽ]/g],
  ['latin', /[A-Za-zÀ-ɏ]/g],
];

/** Guess the writing system of a text by counting characters per script. */
export function guessScript(text: string): ScriptGuess {
  const counts = new Map<string, number>();
  let total = 0;
  for (const [name, re] of RANGES) {
    const n = text.match(re)?.length ?? 0;
    counts.set(name, n);
    total += n;
  }
  if (total === 0) return 'unknown';
  const kana = counts.get('kana')!;
  const han = counts.get('han')!;
  if (kana > 0 && kana + han >= total * 0.2) return 'ja';
  // CJK characters carry much more information per char than Latin letters.
  if (han > 0 && han * 3 >= total - han) return 'zh';
  let best: ScriptGuess = 'unknown';
  let bestN = 0;
  for (const [name] of RANGES) {
    if (name === 'kana' || name === 'han') continue;
    const n = counts.get(name)!;
    if (n > bestN) {
      best = name as ScriptGuess;
      bestN = n;
    }
  }
  return bestN >= total * 0.6 ? best : 'unknown';
}

/** Languages whose script uniquely identifies them (for our purposes). */
const SCRIPT_LANGS = new Set(['zh', 'ja', 'ko', 'th', 'he', 'el']);

export type LanguageDetector = (text: string) => Promise<string | undefined>;

/**
 * Detect language: script heuristics first (fast, reliable for CJK), then the
 * browser's built-in detector for Latin/Cyrillic text.
 */
export async function detectLanguage(
  text: string,
  browserDetect?: LanguageDetector,
): Promise<string | undefined> {
  const script = guessScript(text);
  if (SCRIPT_LANGS.has(script)) return script;
  if (script === 'ar' && !browserDetect) return 'ar';
  if (!browserDetect || text.length < 12) return undefined;
  try {
    return await browserDetect(text);
  } catch {
    return undefined;
  }
}

/** Should a paragraph in `detected` language be skipped for `target`? */
export function shouldSkipLanguage(
  detected: string | undefined,
  target: string,
  never: string[],
): boolean {
  if (!detected) return false;
  if (sameLanguage(detected, target)) return true;
  return never.some((n) => baseLang(n) === baseLang(detected));
}
