# Translate Now

English | [简体中文](README.zh.md)

**A bring-your-own-key bilingual web page translator** for Chrome, Edge and Firefox. Free, open source, no account, no server, no telemetry.

Use your own LLM API key (OpenAI, OpenRouter, DeepSeek, Qwen, Gemini, Claude, Ollama or any OpenAI-compatible service) to translate pages paragraph by paragraph, with each translation shown below its original or on its own.

## Features

- **Page translation**: finds the main paragraphs and inserts translations below the originals (bilingual) or shows translations only. Switch modes at any time without new requests.
  - Translates only what is on or near the screen and continues as you scroll, saving tokens.
  - Handles dynamically loaded content (SPAs, infinite scroll).
  - Skips code blocks, inputs, navigation and menus, `notranslate`, and paragraphs already in the target language.
  - Short text (buttons, labels, headings) gets its translation right after the original, keeping layouts intact.
  - Paragraphs are batched into one request; results are cached in local IndexedDB so the same text is never requested twice.
- **Selection translation**: select text and click the button for a translation card (copy, change target language, drag). Single words and phrases get dictionary-style explanations. Also available from the context menu and a keyboard shortcut.
- **Hover translation**: point at a paragraph and tap `Ctrl` on its own to translate just that paragraph; tap again to remove it. The key can be changed to `Alt`/`Shift` or turned off under **Selection & hover**.
- **Providers**: presets for OpenAI, OpenRouter, DeepSeek, Qwen (DashScope), Google Gemini, Anthropic Claude and Ollama, plus any OpenAI-compatible endpoint. Save multiple profiles and switch between them; test the connection and fetch the model list from the settings page.
- **Translation styles**: standard, casual, formal, academic, technical, literary, news, or your own prompt; glossary support.
- **Site rules**: always / never / manual translation per site, with per-site style, display mode and selection-translation switch. Optionally translate foreign-language pages automatically.
- **Other**: English and Chinese interface, dark mode, settings import/export, six translation styles.

## Install from the stores

- [Chrome Web Store](https://chromewebstore.google.com/detail/hkahabmfamcffhaficngecicoagnaknj) (also works in Edge, Brave, Arc and other Chromium browsers)
- [Firefox Add-ons (AMO)](https://addons.mozilla.org/firefox/addon/translate-now-ai/) — Firefox 140+

Store installs update automatically. New versions appear in the stores after their review; until then, use the GitHub Releases packages below.

## Install from GitHub Releases

Download the latest version from [Releases](https://github.com/mechiland/translate-now/releases).

### Chrome / Edge / Brave / Arc and other Chromium browsers

1. Download `translate-now-<version>-chrome.zip` and **unzip** it into a permanent folder (don't delete it afterwards).
2. Open `chrome://extensions` (Edge: `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder (the one that contains `manifest.json`).
4. Click the extension icon in the toolbar → gear button → enter your API key and model → **Save** → **Test connection**.

To update, unzip the new version over the same folder and click the reload button on the extensions page.

### Firefox

Unsigned extensions can only be loaded temporarily in release Firefox:

1. Download `translate-now-<version>-firefox.zip` (no need to unzip).
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → select the zip.
3. Temporary add-ons are removed when Firefox restarts. Prefer the AMO version for long-term use.

## Provider examples

| Provider   | Base URL                                                                                                                      | Example models                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| OpenAI     | `https://api.openai.com/v1`                                                                                                   | `gpt-4.1-mini`                                  |
| OpenRouter | `https://openrouter.ai/api/v1`                                                                                                | `openai/gpt-4.1-mini`, `deepseek/deepseek-chat` |
| DeepSeek   | `https://api.deepseek.com/v1`                                                                                                 | `deepseek-chat`                                 |
| Qwen       | `https://dashscope.aliyuncs.com/compatible-mode/v1` (international: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`) | `qwen-plus`, `qwen-turbo`                       |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/openai`                                                                     | `gemini-2.5-flash`                              |
| Claude     | `https://api.anthropic.com/v1`                                                                                                | `claude-haiku-4-5`                              |
| Ollama     | `http://localhost:11434/v1`                                                                                                   | `qwen3:8b`                                      |

Tips:

- Page translation uses a lot of tokens; prefer **cheap, fast** non-reasoning models (`deepseek-chat`, `qwen-plus`/`qwen-turbo`, `gpt-4.1-mini`, `gemini-2.5-flash`). Reasoning models (`deepseek-reasoner`, the o series, etc.) are much slower and more expensive.
- Check your provider's docs for model names, or click **Fetch models** to list what is available.
- On 429 (too many requests) the extension retries automatically. If it happens often, lower the concurrency under **Providers → Request settings**.
- If Ollama returns 403, set `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"` and restart Ollama.

About "Codex": ChatGPT subscriptions (Plus/Pro) have no official API for third-party extensions. Use an OpenAI API key (platform.openai.com) or OpenAI models through OpenRouter.

## Keyboard shortcuts

| Action                           | Default    |
| -------------------------------- | ---------- |
| Translate page / show original   | `Alt+A`    |
| Translate selected text          | `Alt+S`    |
| Translate paragraph under cursor | Tap `Ctrl` |

Change them at `chrome://extensions/shortcuts` (Firefox: `about:addons` → gear → Manage Extension Shortcuts).

## Privacy

- Only the text you translate (plus the page title and domain, as context) is sent, directly to **the provider you configure**.
- Settings and API keys stay in local browser storage (`storage.local`). They are never synced or sent anywhere else.
- No analytics, telemetry or remote code.

See [PRIVACY.md](PRIVACY.md) for the full policy.

## Known limitations

- PDFs in the built-in viewer, video subtitles, browser internal pages and extension store pages are not supported.
- Only the top-level frame is translated (content inside iframes is not).
- Translations are plain text; links and bold text in the original are not preserved in the translation.
- In translation-only mode, paragraphs that contain images, buttons or other non-text elements show both the original and the translation (to avoid hiding page elements).
- Pages opened before the extension was installed or updated need one reload.

## Roadmap

- [ ] Preserve inline formatting (links, bold) in translations
- [ ] Streaming output for selection translation
- [x] Hover + modifier key to translate a single paragraph
- [ ] Translate text in input boxes
- [ ] iframe support
- [ ] Rules for popular sites (X/Twitter, Reddit, YouTube comments)
- [x] Chrome Web Store / Firefox AMO listings with automated releases
- [ ] Edge Add-ons

## Development

Requires Node.js 26+ (see `.node-version`) and pnpm 12.18.0 (pinned in `package.json`; `corepack enable` picks it up).

```bash
pnpm install
pnpm dev              # Chrome dev mode (opens a browser with hot reload)
pnpm dev:firefox      # Firefox dev mode
pnpm build            # Chrome/Edge build → .output/chrome-mv3
pnpm build:firefox    # Firefox build → .output/firefox-mv2
pnpm zip:all          # Package zips → .output/*.zip
pnpm compile          # TypeScript type check
pnpm lint
pnpm test             # Unit tests (Vitest) and release script tests
pnpm test:e2e         # End-to-end tests (Playwright + local mock LLM server)
REAL_SITES=1 pnpm exec playwright test realsites   # Smoke test on real sites (needs network, no API key)
```

Run `pnpm exec playwright install chromium` before the first E2E run.

### Commits and releases

Releases are automated with [release-please](https://github.com/googleapis/release-please):

1. PRs are squash-merged, and **the PR title becomes the commit message**. Titles must follow [Conventional Commits](https://www.conventionalcommits.org/) (checked in CI), e.g. `feat: translate a paragraph on hover`. The repository is English-only (commits, PRs, release notes, docs); Chinese is supplementary (`README.zh.md`, the Chinese UI and store copy).
2. After each merge to `main`, release-please updates a release PR that bumps the version and updates `CHANGELOG.md`.
3. Merging the release PR tags the version, creates the GitHub Release, attaches the packages, and submits the version to the Chrome Web Store and Firefox AMO for review. Approved versions are published automatically.

Secrets, credential dry runs and per-store retries are covered in the [publishing guide](docs/PUBLISHING.md).

Tech stack: [WXT](https://wxt.dev), TypeScript, React (popup and settings only), Vitest, Playwright. Design decisions are in [docs/DECISIONS.md](docs/DECISIONS.md).

## License

MIT
