import { languageEnglishName } from '../languages';
import type { GlossaryEntry } from '../settings/schema';

export interface PromptContext {
  targetLang: string;
  styleInstruction: string;
  glossary: GlossaryEntry[];
  pageTitle?: string;
  host?: string;
}

function glossaryBlock(glossary: GlossaryEntry[]): string {
  const entries = glossary.filter((g) => g.source.trim() && g.target.trim());
  if (entries.length === 0) return '';
  const lines = entries.map((g) => `- ${g.source.trim()} => ${g.target.trim()}`).join('\n');
  return `\n\nGlossary (always translate these terms exactly as given):\n${lines}`;
}

function contextBlock(ctx: PromptContext): string {
  const parts: string[] = [];
  if (ctx.host) parts.push(`Website: ${ctx.host}`);
  if (ctx.pageTitle) parts.push(`Page title: ${ctx.pageTitle.slice(0, 200)}`);
  return parts.length
    ? `\n\nContext (for reference only, do not translate):\n${parts.join('\n')}`
    : '';
}

export function buildPageSystemPrompt(ctx: PromptContext): string {
  const lang = languageEnglishName(ctx.targetLang);
  return (
    `You are a professional translation engine. Translate every segment the user sends into ${lang}.\n\n` +
    `Rules:\n` +
    `- Input segments are wrapped in <seg id="N">...</seg> tags. Output exactly one <seg id="N">...</seg> for every input segment, with the same id, in the same order.\n` +
    `- Output only the translated segments. No explanations, notes, markdown fences or extra text.\n` +
    `- Translate each segment independently but keep terminology consistent across segments.\n` +
    `- Keep line breaks inside a segment. Keep URLs, email addresses, code, numbers and emoji unchanged.\n` +
    `- If a segment is already in ${lang} or cannot be translated (e.g. a name or code), output it unchanged.\n\n` +
    `Style: ${ctx.styleInstruction}` +
    glossaryBlock(ctx.glossary) +
    contextBlock(ctx)
  );
}

/** Neutralize anything that looks like our own segment tags inside page text. */
function escapeSegText(text: string): string {
  return text.replace(/<(\/?)seg\b/gi, '‹$1seg');
}

export function buildPageUserPrompt(texts: string[]): string {
  return texts.map((t, i) => `<seg id="${i + 1}">${escapeSegText(t)}</seg>`).join('\n');
}

const WORD_LIKE = /^[\p{L}\p{M}'’-]+(?:\s+[\p{L}\p{M}'’-]+){0,2}$/u;

/** A short word/phrase (≤3 words, no sentence punctuation) gets a dictionary-style answer. */
export function isShortTerm(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 40) return false;
  return WORD_LIKE.test(t);
}

export function buildSelectionSystemPrompt(ctx: PromptContext, text: string): string {
  const lang = languageEnglishName(ctx.targetLang);
  const base =
    `You are a professional translator. Translate the user's text into ${lang}. ` +
    `Output only the translation, without quotes, explanations or markdown fences. Keep line breaks.\n\n` +
    `Style: ${ctx.styleInstruction}` +
    glossaryBlock(ctx.glossary) +
    contextBlock(ctx);
  if (!isShortTerm(text)) return base;
  return (
    `You are a bilingual dictionary. The user sends a word or short phrase. Answer in ${lang}.\n` +
    `Format (plain text, no markdown):\n` +
    `Line 1: the best translation in ${lang}.\n` +
    `Then up to 4 lines, one per common sense: "<part of speech abbreviation>. <translation(s)>; <very short explanation>".\n` +
    `If the input is already in ${lang}, give a short definition instead. Keep the whole answer under 80 words.` +
    glossaryBlock(ctx.glossary) +
    contextBlock(ctx)
  );
}
