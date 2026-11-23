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
- **Skipped:** `pre`, `code` blocks, form controls (input/select/textarea), `svg`/media, `nav`, ARIA roles navigation/menu/menubar/tablist/toolbar/textbox/searchbox/combobox, `[translate=no]`, `.notranslate`, `contenteditable`, visually hidden text (`visibility: hidden`, sr-only boxes that are absolutely positioned and ≤1px or clipped), numbers/URLs/bare domains/emails, paragraphs already in the target language (script heuristics for CJK, `i18n.detectLanguage` for others).
  - `nav` is skipped deliberately: on real sites (GitHub, Wikipedia) translating navigation breaks layouts and costs tokens for little value.
  - **Buttons are translated** (`<button>`, `role=button`, and `role=tooltip` wrappers). Sites put real content in them: Kagi News headlines are buttons that expand the story, and TalentLMS course outlines are `dd role=button` items inside `role=tooltip` wrappers. Short labels get the usual inline translation.
  - Hidden text is dropped without ending the paragraph. Kagi's citation buttons hold an sr-only "Citation 1 from …" span (absolutely positioned, so it computes as `display: block`) inside a sentence.
  - Children of `inline-flex`/`inline-grid` elements compute as blocks (blockification) but stay on the line, so they don't split the surrounding paragraph either.
- **Placement in row layouts:** when a long run's block lays out its children in a row (flex row or grid) and the block's parent stacks vertically, the translation goes right after the block instead of inside it, where it would sit beside the text. Translation-only mode can't hide those originals (the block may be a button the user still needs), so both are shown. Text inside a flex item (e.g. a `<span>` in a flex button) is blockified and handled normally.
- **Short snippets** (≤5 words / ≤12 CJK chars) get their translation inline after the original instead of on a new line; this keeps headers, buttons-ish links and table cells usable.
- **Lazy translation** via IntersectionObserver (600px margin). **Dynamic content** via MutationObserver with debounce (300ms, max wait 1.5s). Mutations caused by our own nodes are ignored.
- **Translation-only mode** never removes or moves page nodes (that breaks React/Vue apps). Instead blocks that contain only text-level elements get `data-tn-hide`; CSS sets `font-size: 0` on the block, hides its element children, restores the translation's font size from a CSS variable, and restores the block's measured margin/padding (em-based spacing would otherwise collapse). Blocks containing images/buttons keep showing the original.
- **Hover translation** is a _tap_ of the modifier on its own (press and release within 600 ms, no other key, click or wheel in between), not "hold while hovering". Ctrl+C, Ctrl+click, Ctrl+scroll and typing in fields therefore never send requests. Default key is Ctrl: tapping Alt opens browser menus on Windows/Linux and Shift switches Chinese IMEs. The paragraph is the segmenter run under the pointer in its nearest block-level ancestor; it is always shown bilingually (translation-only mode would hide what the user is reading) and reuses the page translator's batching, cache and error handling. While the whole page is translated, the tap does nothing except retrying a failed paragraph; "show original" and settings changes also clear hover translations.
- Injected UI (selection button/card, toasts) lives in an open Shadow DOM under a `<tn-ui>` element, so page CSS can't leak in and ours can't leak out. Written in plain DOM (no React in the content script) to keep it small.

## PDF

- **Our own viewer page, built on pdf.js** (`pdf-viewer.html?file=<url>`). Neither browser lets extensions touch the content of its built-in PDF viewer, so "Translate" on a PDF tab (popup button, `Alt+A`, context menu) navigates the tab to the viewer; Back returns to the browser's viewer. Chrome runs our content script in the PDF wrapper document (`document.contentType === 'application/pdf'`), which reports `pdf: true` and asks the background to open the viewer. Firefox's viewer runs no content scripts, so the background and popup fall back to the URL (`.pdf`, arXiv `/pdf/…`, OpenReview `/pdf`) and the popup asks the server with a `HEAD` request.
- **Side by side, translation in place.** Each page is rendered once to a PNG that both columns share. The left column adds pdf.js's invisible text layer (select, copy, selection translation). The right column covers each translated paragraph with a patch of the background color sampled around it and draws the translation on top, shrinking the font (down to half) until it fits the paragraph's box. Figures, tables, equations and page furniture stay untouched. Translation only hides the left column; "Show original" hides the right one.
- **Paragraphs from glyph runs** (`lib/pdf/layout.ts`): items join into lines (same baseline within 0.8em, continuing to the right; wide gaps split table cells and figure labels), lines into paragraphs (same font size, normal line spacing for the page, horizontal overlap) unless a cue says a paragraph ended: extra space, the previous line ending although the next line's first word would have fitted, a first-line indent, or a bullet. Centered lines stay together. Content-stream order is kept as reading order. Rotated text (arXiv's margin stamp) is ignored.
- **Not translated:** display equations (math symbols with fewer than three words), numbers, author lines with email addresses, page numbers and bibliography entries (`[12] …`). Text already in the target language is skipped like on web pages.
- The overlay is laid out at 2 units per PDF point and scaled with `transform`, so fitting is done once and zooming is pure CSS (bitmaps are re-rendered when the zoom outgrows their resolution). Translations reuse the page batching, cache, error handling and site rules (the PDF's host).
- **Export goes through the print dialog** ("Save as PDF"): `@page` is sized to the PDF page (twice as wide side by side), every page is translated and rendered at 3× first, and the translation stays selectable text. Writing a PDF directly would need an embedded CJK font (megabytes per script) to keep text vector; printing uses the system fonts. In print the overlay uses `zoom` instead of `transform`: Chrome fragments a transformed element by its unscaled box, which cut off the lower half of each page.
- **pdf.js legacy build**: the modern build calls `Map.prototype.getOrInsertComputed` without a polyfill. CMaps, standard fonts, image decoders and ICC profiles ship under `pdfjs/`; the QuickJS sandbox for scripts inside PDFs is left out, and XFA is off.

## Extension UI (popup and options)

- **shadcn components from the radix-base registry** (`components.json` → `@radix-base`): Radix Themes design tokens with Base UI behavior, installed as source into `src/components/ui` and `src/lib/theme`. Use these controls instead of hand-written ones; app-specific compositions live in `src/components/app` (`SimpleSelect`, `Choice`, `ConfirmButton`, `SettingsCard`, `AppTheme`).
- **Icons are HugeIcons** (`@hugeicons/react` + `@hugeicons/core-free-icons`). The registry ships lucide imports; they were replaced, and newly added components need the same change.
- **System fonts only** (the registry's default font stack); no font downloads.
- **Tailwind v4 is scoped to extension pages.** `src/styles/globals.css` is imported only by the popup and options entrypoints and scans only `src/`. The content script keeps its own small, Shadow-DOM-scoped CSS so nothing leaks into web pages.
- **The popup mimics the browser's own menus** (e.g. Chrome's Extensions bubble): plain title and close button, bold section headings, 48px icon rows with a trailing control, and a full-width divider before a "Settings" footer row. Header and footer stay fixed and the middle scrolls, since browser popups are capped at 600px tall. Settings moved from a top-right gear to that footer row.
- **The popup starts with a static loading surface.** Its entry only loads a small stylesheet; after the document loads and the loading surface gets a paint opportunity, it imports React and the full UI. Chrome waits for the document's load event before showing the popup, so eager UI imports delay the window itself. The loading surface lives outside React's root and is removed in a layout effect once saved settings are ready, keeping the popup visible while the theme and settings initialize. Keep heavy dependencies out of this entry.
- **Import HugeIcons through individual icon paths**, such as `@hugeicons/core-free-icons/Cancel01Icon`. The package root makes Vite's development server serve the entire icon library even when a page uses only a handful of icons.
- **Theme**: indigo accent (close to the browser's blue and the logo), solid panels, follows `prefers-color-scheme`. Destructive actions use an AlertDialog instead of `window.confirm`; transient results use toasts.

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
- Firefox build checked with `web-ext lint` (0 errors; remaining warnings: React's own `innerHTML` use, core-js's unreachable `Function("return this")` fallback in the pdf.js legacy build and pdf.js's dynamic imports of its bundled worker and fallback decoders, and `data_collection_permissions` being newer than `strict_min_version`). Not run end-to-end in Firefox — Playwright can't load Firefox extensions.
