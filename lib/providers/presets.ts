import type { Protocol } from '../settings/schema';

export interface ProviderPreset {
  id: string;
  name: string;
  protocol: Protocol;
  baseURL: string;
  /** Placeholder shown in the model field. Not a default — model names change often. */
  modelPlaceholder: string;
  keyRequired: boolean;
  /** Where to get a key. */
  keyURL?: string;
  /** Extra hint shown in the settings page (i18n key). */
  hintKey?: string;
  extraHeaders?: Record<string, string>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseURL: 'https://api.openai.com/v1',
    modelPlaceholder: 'gpt-4.1-mini',
    keyRequired: true,
    keyURL: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    baseURL: 'https://openrouter.ai/api/v1',
    modelPlaceholder: 'openai/gpt-4.1-mini',
    keyRequired: true,
    keyURL: 'https://openrouter.ai/keys',
    extraHeaders: {
      'HTTP-Referer': 'https://github.com/mechiland/translate-now',
      'X-Title': 'Translate Now',
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    baseURL: 'https://api.deepseek.com/v1',
    modelPlaceholder: 'deepseek-chat',
    keyRequired: true,
    keyURL: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'qwen',
    name: '通义千问 Qwen (DashScope)',
    protocol: 'openai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    modelPlaceholder: 'qwen-plus',
    keyRequired: true,
    keyURL: 'https://bailian.console.aliyun.com/',
    hintKey: 'hintQwen',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    protocol: 'openai',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelPlaceholder: 'gemini-2.5-flash',
    keyRequired: true,
    keyURL: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    protocol: 'anthropic',
    baseURL: 'https://api.anthropic.com/v1',
    modelPlaceholder: 'claude-haiku-4-5',
    keyRequired: true,
    keyURL: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    protocol: 'openai',
    baseURL: 'http://localhost:11434/v1',
    modelPlaceholder: 'qwen3:8b',
    keyRequired: false,
    hintKey: 'hintOllama',
  },
  {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    protocol: 'openai',
    baseURL: '',
    modelPlaceholder: 'model-name',
    keyRequired: false,
    hintKey: 'hintCustom',
  },
];

export function getPreset(id: string): ProviderPreset {
  return (
    PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]!
  );
}
