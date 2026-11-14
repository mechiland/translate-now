# Design decisions

Decisions made while building v0.1.0, with the reasoning, so they can be revisited.

## Architecture

- **All LLM requests go through the background script.** Content scripts only touch the DOM and send messages. This avoids CORS (extension host permissions apply to the background), keeps API keys out of page context, and gives one global concurrency limiter and cache.
- **Two protocols cover every provider.** OpenAI-compatible Chat Completions (OpenAI, OpenRouter, DeepSeek, DashScope/Qwen, Gemini's OpenAI endpoint, Ollama, anything custom) and Anthropic Messages (with `anthropic-dangerous-direct-browser-access`). Presets only fill in base URL / headers.
- **No hard-coded default model.** Model names change too often; the field shows a placeholder and a "fetch models" button (`GET /models`).
- **Temperature is optional** and omitted by default, because several reasoning models reject non-default temperatures.
- **"Codex" ≠ an API.** ChatGPT subscriptions have no official third-party API; users should use an OpenAI API key or OpenRouter. Documented in README.

## Translation protocol

- Paragraphs are batched into one request, wrapped as `<seg id="N">…</seg>`. The model must echo the same structure. Parsing tolerates fences, chatter, `<think>` blocks, single quotes, missing close tags, out-of-order and duplicate ids.
- Missing segments are retried individually; parse/bad-request/timeout errors on a batch split it into single requests. Auth/config errors fail fast (no retry, no split).
- 429 / 5xx / network / timeout are retried up to 3 times with exponential backoff + jitter, honoring `Retry-After`.
- Cache key = SHA-256 of (kind, text, target language, protocol, base URL, model, style instruction, glossary). Stored in IndexedDB with approximate LRU eviction (50k entries). Content scripts additionally keep an in-memory map so toggling translation off/on is instant.

## DOM

- **Segmentation** walks the tree and groups inline content into "runs" per block element (computed `display`). Translations are inserted inside the block right after the run, so they inherit font/color/layout. `<br>` becomes a line break.
- **Skipped:** `pre`, `code` blocks, form controls, `svg`/media, `nav`, ARIA roles navigation/menu/menubar/tablist/toolbar/button/textbox, `[translate=no]`, `.notranslate`, `contenteditable`, numbers/URLs/emails, paragraphs already in the target language (script heuristics for CJK, `i18n.detectLanguage` for others).
  - `nav` is skipped deliberately: on real sites (GitHub, Wikipedia) translating navigation breaks layouts and costs tokens for little value.
- **Short snippets** (≤5 words / ≤12 CJK chars) get their translation inline after the original instead of on a new line; this keeps headers, buttons-ish links and table cells usable.
- **Lazy translation** via IntersectionObserver (600px margin). **Dynamic content** via MutationObserver with debounce (300ms, max wait 1.5s). Mutations caused by our own nodes are ignored.
- **Translation-only mode** never removes or moves page nodes (that breaks React/Vue apps). Instead blocks that contain only text-level elements get `data-tn-hide`; CSS sets `font-size: 0` on the block, hides its element children, restores the translation's font size from a CSS variable, and restores the block's measured margin/padding (em-based spacing would otherwise collapse). Blocks containing images/buttons keep showing the original.
- Injected UI (selection button/card, toasts) lives in an open Shadow DOM under a `<tn-ui>` element, so page CSS can't leak in and ours can't leak out. Written in plain DOM (no React in the content script) to keep it small.

## Settings & storage

- Everything (including keys) lives in `storage.local`, never `storage.sync`. Simpler, and keys never leave the device. Export excludes keys unless explicitly requested; import keeps existing keys when the file has none.
- Settings are normalized on every read (missing fields → defaults, wrong types dropped, numbers clamped), so older or hand-edited data can't break the extension.
- Site rule patterns: `example.com` matches the host and subdomains, `*.example.com` subdomains only, `=host` exact. Most specific match wins.
- Popup changes to style / display mode update the site's override if it has one, otherwise the global setting.

## Permissions

| Permission          | Why                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `storage`           | Settings and API keys (local only).                                                                                                                                            |
| `contextMenus`      | "Translate this page" / "Translate selection" menu items.                                                                                                                      |
| `activeTab`         | Popup reads the current tab's URL to show/edit the site rule.                                                                                                                  |
| `<all_urls>` (host) | Content script must run on every page for selection translation and auto-translate rules; background must reach any user-configured base URL (including localhost for Ollama). |

## Browsers

- Chrome/Edge build is MV3 (service worker). Firefox build is WXT's default MV2 (persistent background) with `browser_specific_settings.gecko.id` and `data_collection_permissions: none`. `AbortSignal.any` is avoided for Firefox < 124 compatibility.
- Context menus are recreated (`removeAll` + `create`) every time the background starts, which works for both MV3 service workers and Firefox.
- Safari is out of scope (requires Xcode packaging); no Chrome-only APIs are used directly (everything goes through WXT's `browser`).

## Verification

- 100+ unit tests (Vitest; DOM tests with happy-dom).
- 12 end-to-end tests (Playwright, real Chromium with the built extension loaded, local mock OpenAI-compatible server): bilingual, translation-only, toggle restore, no re-request on display change, dynamic content and text changes, selection button + context menu, site rules always/never, auto-translate foreign pages, 429 retry, 401 error marker + toast + retry, options page test connection + model list, popup toggle.
- Optional real-site smoke test (`REAL_SITES=1`) on Wikipedia, Hacker News, GitHub and MDN with the mock LLM.
- Firefox build checked with `web-ext lint` (0 errors; remaining warnings: React's own `innerHTML` use, and `data_collection_permissions` being newer than `strict_min_version`). Not run end-to-end in Firefox — Playwright can't load Firefox extensions.
