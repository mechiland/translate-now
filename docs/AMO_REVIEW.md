# Firefox AMO reviewer instructions

## Reproduce the build

Use Linux (Ubuntu 24.04 is suitable), Node.js 22, and pnpm **12.16.1**. All build tools are open source; no API key, account, environment file, or external build service is required. Internet access is only required to download dependencies from npm.

From the root of the extracted sources:

```sh
npm install --global pnpm@12.16.1
pnpm install --frozen-lockfile
pnpm build:firefox
```

Compare `.output/firefox-mv2/` with the uploaded extension ZIP. `pnpm zip:firefox` produces the same build plus the extension and sources ZIPs. The committed PNG icons are build inputs; generating them again is unnecessary. WXT/Vite bundle and minify TypeScript/React locally. No obfuscator is used.

`web-ext lint` reports two `UNSAFE_VAR_ASSIGNMENT` warnings inside the bundled React DOM library's generic `dangerouslySetInnerHTML` implementation. This add-on never uses that React prop: provider responses and page content are rendered as text. The remaining Android minimum-version warning does not apply to this desktop-only submission; do not select Android compatibility in AMO.

## Review the behavior

The add-on uses manifest ID `translate-now@mechiland.github.io` and supports desktop Firefox 140+. Installation uses Firefox's built-in consent for `websiteContent`, `browsingActivity`, and `authenticationInfo` because translation sends page text, title, domain, and an API key directly to the endpoint chosen by the user.

1. Open the add-on settings and select a provider. Supply your own key, endpoint, and model; developer credentials are not bundled. A local Ollama endpoint is supported without an API key.
2. Open an ordinary HTTP(S) article and use the toolbar button or Alt+A. The add-on inserts translated text beneath the originals. Select text to use the floating translation button or right-click menu.
3. Enable an “always translate” site rule or automatic foreign-page translation to check automatic mode. It is disabled by default.
4. Check the network requests: they go only to the configured provider. There is no developer backend or analytics endpoint. The key is used only in provider authentication headers; translation responses are plain text.

Supported provider protocols are OpenAI-compatible chat completions and Anthropic messages. Model list and connection test requests also go directly to the configured provider. Settings and keys are in local extension storage, translations in local IndexedDB. See `PRIVACY.md` for details.
