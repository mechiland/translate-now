import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The Chrome Web Store rejects listings that list third-party product names as
// "keyword spam" (violation "Yellow Argon"). Store-facing text describes providers
// generically; the README and settings UI are where provider names belong.
const BRANDS = [
  'OpenAI',
  'OpenRouter',
  'DeepSeek',
  'Qwen',
  '通义千问',
  'DashScope',
  'Gemini',
  'Google',
  'Claude',
  'Anthropic',
  'Ollama',
  'ChatGPT',
  'GPT',
  'Codex',
  'Mistral',
  'Llama',
  'Grok',
  'Kimi',
  '豆包',
  'LM Studio',
  'DeepL',
];
// Protocol names that describe compatibility rather than advertise a brand.
const ALLOWED = [/OpenAI-compatible/g, /OpenAI 兼容/g];

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function brandsIn(text) {
  const cleaned = ALLOWED.reduce((acc, pattern) => acc.replace(pattern, ''), text);
  return BRANDS.filter((brand) =>
    new RegExp(`(^|[^A-Za-z])${brand}([^A-Za-z]|$)`, 'i').test(cleaned),
  );
}

function listingSection(markdown, heading) {
  const match = markdown.match(
    new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'),
  );
  assert.ok(match, `store/LISTING.md is missing the "## ${heading}" section`);
  return match[1];
}

test('manifest name and description name no third-party brands', () => {
  for (const locale of ['en', 'zh_CN']) {
    const messages = JSON.parse(read(`public/_locales/${locale}/messages.json`));
    for (const key of ['extName', 'extDescription']) {
      assert.deepEqual(brandsIn(messages[key].message), [], `${locale}/${key}`);
    }
  }
});

test('store listing descriptions name no third-party brands', () => {
  const listing = read('store/LISTING.md');
  for (const heading of ['Name', 'Short description', 'English description', '中文描述']) {
    assert.deepEqual(brandsIn(listingSection(listing, heading)), [], heading);
  }
});

test('the brand check catches the copy Chrome rejected', () => {
  assert.deepEqual(brandsIn('your own LLM API key (OpenAI, OpenRouter, Ollama)'), [
    'OpenAI',
    'OpenRouter',
    'Ollama',
  ]);
  assert.deepEqual(brandsIn('OpenAI、OpenRouter、通义千问'), ['OpenAI', 'OpenRouter', '通义千问']);
  assert.deepEqual(brandsIn('any OpenAI-compatible endpoint'), []);
});
