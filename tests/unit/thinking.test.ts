import { describe, expect, it } from 'vitest';
import { thinkingOffFields } from '@/lib/providers/thinking';
import type { ProviderProfile } from '@/lib/settings/schema';

function profile(presetId: string, model: string, extra: Partial<ProviderProfile> = {}) {
  return {
    id: 'x',
    name: 'x',
    presetId,
    protocol: presetId === 'anthropic' ? 'anthropic' : 'openai',
    baseURL: 'https://example.com/v1',
    apiKey: 'k',
    model,
    ...extra,
  } satisfies ProviderProfile;
}

describe('thinkingOffFields', () => {
  it.each([
    ['deepseek', 'deepseek-v4-flash', { thinking: { type: 'disabled' } }],
    ['qwen', 'qwen3-32b', { enable_thinking: false }],
    ['gemini', 'gemini-2.5-flash', { reasoning_effort: 'none' }],
    ['gemini', 'gemini-3-flash-preview', { reasoning_effort: 'none' }],
    ['gemini', 'gemini-2.5-pro', { reasoning_effort: 'low' }],
    ['openrouter', 'deepseek/deepseek-v4-flash', { reasoning: { effort: 'none' } }],
    ['ollama', 'qwen3:8b', { reasoning_effort: 'none' }],
    ['openai', 'gpt-5', { reasoning_effort: 'minimal' }],
    ['openai', 'gpt-5-mini-2025-08-07', { reasoning_effort: 'minimal' }],
    ['openai', 'gpt-5.1', { reasoning_effort: 'none' }],
    ['openai', 'gpt-5.2-mini', { reasoning_effort: 'none' }],
    ['openai', 'o4-mini', { reasoning_effort: 'low' }],
    ['openai', 'gpt-4.1-mini', {}],
    ['openai', 'gpt-5-chat-latest', {}],
    ['custom', 'glm-4.6', { thinking: { type: 'disabled' } }],
    ['custom', 'doubao-seed-1-6-250615', { thinking: { type: 'disabled' } }],
    ['custom', 'moonshotai/Kimi-K2.5', { thinking: { type: 'disabled' } }],
    [
      'custom',
      'Qwen/Qwen3-8B',
      { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } },
    ],
    ['custom', 'llama-3.3-70b', {}],
    ['anthropic', 'claude-haiku-4-5', {}],
    ['anthropic', 'deepseek-v4-flash', { thinking: { type: 'disabled' } }],
  ])('%s / %s', (preset, model, expected) => {
    expect(thinkingOffFields(profile(preset, model))).toEqual(expected);
  });

  it('returns nothing when the profile allows thinking', () => {
    expect(
      thinkingOffFields(profile('deepseek', 'deepseek-v4-flash', { allowThinking: true })),
    ).toEqual({});
  });
});
