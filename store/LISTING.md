# Store listing copy

## Name

Translate Now

## Short description

Bring your own API key for bilingual page and selection translation with your preferred AI provider.

## English description

Read the web in two languages with Translate Now, a free and open-source browser extension powered by your own translation provider.

- Translate web pages paragraph by paragraph, with translations below the originals or in translation-only mode.
- Select text for a floating translation card, or use the context menu and keyboard shortcuts.
- Connect OpenAI, OpenRouter, DeepSeek, Gemini, Claude, DashScope, local Ollama, or an OpenAI-compatible endpoint.
- Save multiple provider profiles, choose translation styles, and add your own glossary.
- Set per-site rules and optionally translate foreign-language pages automatically.
- Translate visible content first and cache results locally to reduce repeated API requests.
- Choose an English or Chinese interface, dark mode, and translation styles.

Setup: open the extension settings, select a provider, enter your own API key and model, save, and test the connection. Provider usage may incur charges under your provider's plan. A local Ollama server can be used without a paid API key. The extension does not include a hosted translation service.

Privacy: page text, title, and domain go directly to the API endpoint you configure. Your key authenticates those requests. Settings and keys stay in local browser storage; cached translations stay on your device. No developer-operated server, analytics, ads, or telemetry.

Does not translate browser internal pages, extension-store pages, browser PDF viewers, video subtitles, or content inside iframes.

Source and support: https://github.com/mechiland/translate-now

## 中文描述

Translate Now 是免费开源的网页双语翻译扩展，使用你自己的 API Key 和模型服务。

- 网页逐段双语翻译或仅显示译文，滚动时继续翻译。
- 划词翻译浮窗、右键菜单、Alt+A / Alt+S 快捷键。
- 支持 OpenAI、OpenRouter、DeepSeek、Gemini、Claude、通义千问、本地 Ollama 及 OpenAI 兼容服务。
- 多服务配置、自定义翻译风格、术语表、站点规则和可选自动翻译。
- 本地译文缓存、中英文界面、深色模式及多种译文样式。

安装后进入设置，填写自己的 API Key 和模型并测试连接。模型调用费用由服务商收取；使用本地 Ollama 可以不填写付费 API Key。待翻译文本、页面标题和域名直接发送到你配置的服务商。扩展无开发者服务器、广告或遥测；设置和密钥仅保存在本机。

## Chrome privacy practices and permission justifications

Single purpose: translate web pages and selected text using the user's configured AI translation provider.

- `storage`: save provider profiles, API keys, language, display preferences, and site translation rules locally.
- `contextMenus`: add a right-click action to translate selected text.
- `activeTab`: identify and operate on the page when the user invokes translation.
- Host access to all websites: read page text, insert translations, apply per-site automatic rules, and contact arbitrary user-configured provider endpoints, including local servers.
- Remote code: none. All executable JavaScript is bundled. API responses are rendered as text.
- Data handled for the core feature: website content, browsing activity (page domain/title), and authentication information (user-supplied provider API keys). No advertising, sale of data, creditworthiness use, or unrelated profiling. Third-party processing happens only at the user's configured provider.

Privacy policy: https://github.com/mechiland/translate-now/blob/main/PRIVACY.md

## Suggested categories and assets

Chrome: Productivity / Tools. Firefox: Language Support. Use `public/icon/128.png` for the Chrome icon and `public/icon/96.png` for Firefox. Capture screenshots of bilingual translation, selection translation, and settings with dummy keys; do not include real credentials or private pages. Chrome accepts screenshots at 1280×800 or 640×400.
