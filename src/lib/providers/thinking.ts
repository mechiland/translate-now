import type { ProviderProfile } from '../settings/schema';

/**
 * Request-body fields that switch a model's "thinking" / reasoning off (or to its lowest
 * level when it can't be fully disabled). Thinking makes translation many times slower and
 * rarely improves it.
 *
 * Every vendor spells this differently, and some reject fields they don't know, so the
 * caller retries without these fields when the provider answers 400 (see client.ts).
 */
export function thinkingOffFields(profile: ProviderProfile): Record<string, unknown> {
  if (profile.allowThinking) return {};
  const model = profile.model.trim().toLowerCase();

  if (profile.protocol === 'anthropic') {
    // Claude only thinks when asked to. Other models behind Anthropic-compatible endpoints
    // (DeepSeek, Kimi, GLM, ...) may think by default and accept the same switch.
    return model.startsWith('claude') ? {} : { thinking: { type: 'disabled' } };
  }

  switch (profile.presetId) {
    case 'deepseek':
      return { thinking: { type: 'disabled' } };
    case 'qwen':
      return { enable_thinking: false };
    case 'gemini':
      return geminiFields(model);
    case 'openrouter':
      // OpenRouter maps its unified field onto each upstream model.
      return { reasoning: { effort: 'none' } };
    case 'ollama':
      // Ollama's /v1 endpoint ignores its native `think` flag but honours this.
      return { reasoning_effort: 'none' };
  }
  // OpenAI and custom OpenAI-compatible gateways: guess from the model name.
  const name = model.slice(model.lastIndexOf('/') + 1);
  return openaiFields(name) ?? geminiFieldsIfGemini(name) ?? vendorFields(name) ?? {};
}

function openaiFields(model: string): Record<string, unknown> | undefined {
  if (model.includes('-chat')) return undefined; // gpt-5-chat-latest etc. don't reason
  // gpt-5, gpt-5-mini, gpt-5-nano (+ dated snapshots) can't go below "minimal".
  if (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(model)) {
    return { reasoning_effort: 'minimal' };
  }
  if (/^gpt-5\.\d/.test(model)) return { reasoning_effort: 'none' };
  if (/^o\d/.test(model)) return { reasoning_effort: 'low' };
  if (model.startsWith('gpt-oss')) return { reasoning_effort: 'low' };
  return undefined;
}

function geminiFields(model: string): Record<string, unknown> {
  // Flash models accept "none"; Pro models can only be turned down.
  return { reasoning_effort: model.includes('flash') ? 'none' : 'low' };
}

function geminiFieldsIfGemini(model: string): Record<string, unknown> | undefined {
  return model.startsWith('gemini') ? geminiFields(model) : undefined;
}

function vendorFields(model: string): Record<string, unknown> | undefined {
  // DeepSeek, Zhipu GLM, ByteDance Doubao/Seed and Moonshot Kimi share this switch.
  if (/deepseek|glm|doubao|seed|kimi/.test(model)) return { thinking: { type: 'disabled' } };
  // Qwen3 hybrid models: DashScope/SiliconFlow read the top-level flag, vLLM/SGLang the
  // chat-template one.
  if (/qwen/.test(model)) {
    return { enable_thinking: false, chat_template_kwargs: { enable_thinking: false } };
  }
  return undefined;
}
