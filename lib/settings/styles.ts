import type { Settings, TranslationStyle } from './schema';

export const BUILTIN_STYLES: TranslationStyle[] = [
  {
    id: 'standard',
    name: 'standard',
    instruction: 'Translate faithfully and fluently, as a professional translator would.',
    builtin: true,
  },
  {
    id: 'casual',
    name: 'casual',
    instruction:
      'Use a casual, conversational tone, the way a native speaker would naturally say it. Avoid stiff or literal phrasing.',
    builtin: true,
  },
  {
    id: 'formal',
    name: 'formal',
    instruction: 'Use a formal, polite, business-appropriate register.',
    builtin: true,
  },
  {
    id: 'academic',
    name: 'academic',
    instruction:
      'Use precise academic language. Keep domain terminology accurate; keep citations, formulas and variable names unchanged.',
    builtin: true,
  },
  {
    id: 'technical',
    name: 'technical',
    instruction:
      'This is technical documentation. Keep code identifiers, API names, CLI commands, file paths, product names and widely used English technical terms in their original form. Be concise and precise.',
    builtin: true,
  },
  {
    id: 'literary',
    name: 'literary',
    instruction:
      'This is literary prose. Preserve the voice, rhythm, imagery and emotional tone; prefer natural, elegant phrasing over literal translation.',
    builtin: true,
  },
  {
    id: 'news',
    name: 'news',
    instruction:
      'This is a news article. Use clear, neutral, journalistic language. Keep names of people, organizations and places accurate (use established translations when they exist).',
    builtin: true,
  },
];

export function allStyles(settings: Pick<Settings, 'customStyles'>): TranslationStyle[] {
  return [...BUILTIN_STYLES, ...settings.customStyles];
}

export function findStyle(settings: Pick<Settings, 'customStyles'>, id: string): TranslationStyle {
  return allStyles(settings).find((s) => s.id === id) ?? BUILTIN_STYLES[0]!;
}
