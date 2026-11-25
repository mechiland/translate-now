import { TRANSLATION_TAG } from './segmenter';

const T = TRANSLATION_TAG;
/** Blocks whose original text translation-only mode hides (unless the translation did not fit). */
const HIDDEN = `html[data-tn-mode="translation-only"] [data-tn-hide]:not(:has(> ${T}.tn-squeezed))`;

/** CSS injected into the page while translation is active. Scoped to our own tag/attributes. */
export const PAGE_CSS = `
/* display is !important: pages restyle every child of a container (e.g. "> * { display: inline }"). */
${T} {
  display: block !important;
  /* Component sites may hide every :not(:defined) element before hydration. */
  visibility: inherit !important;
  margin: 0.3em 0 0.1em;
  white-space: pre-line;
  word-break: normal;
  overflow-wrap: anywhere;
  text-indent: 0;
  font-style: normal;
  font-weight: inherit;
  unicode-bidi: plaintext;
}
${T}.tn-inline { display: inline !important; margin: 0 0 0 0.4em; }
/* Too narrow a box: the translation would break into a column of single characters. */
${T}.tn-squeezed { display: none !important; }
html[data-tn-theme="dimmed"] ${T}.tn-done { opacity: 0.78; }
html[data-tn-theme="underline"] ${T}.tn-done .tn-text {
  text-decoration: underline dashed rgba(120, 120, 120, 0.6);
  text-underline-offset: 0.25em;
}
html[data-tn-theme="background"] ${T}.tn-done .tn-text {
  background: rgba(255, 214, 10, 0.18);
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  padding: 0 0.1em;
  border-radius: 2px;
}
html[data-tn-theme="border"] ${T}.tn-done:not(.tn-inline) {
  border-inline-start: 3px solid rgba(59, 130, 246, 0.55);
  padding-inline-start: 0.6em;
}
html[data-tn-theme="italic"] ${T}.tn-done { font-style: italic; }

${T}.tn-loading { display: inline-block !important; margin-inline-start: 0.4em; vertical-align: middle; }
${T}.tn-loading::after {
  content: "";
  display: inline-block;
  width: 0.7em; height: 0.7em;
  border: 2px solid rgba(127, 127, 127, 0.35);
  border-top-color: rgba(59, 130, 246, 0.9);
  border-radius: 50%;
  animation: tn-spin 0.8s linear infinite;
}
@keyframes tn-spin { to { transform: rotate(360deg); } }

${T}.tn-error {
  display: inline-block !important;
  margin-inline-start: 0.4em;
  font-size: 12px;
  font-weight: normal;
  line-height: 1.4;
  color: #c2410c;
  cursor: pointer;
  text-decoration: underline dotted;
}

/* Translation-only mode: hide the original text of blocks that contain nothing but text. */
${HIDDEN} {
  font-size: 0 !important;
  /* em-based sizes would collapse with font-size 0; restore the values measured before */
  margin: var(--tn-m) !important;
  padding: var(--tn-p) !important;
  min-width: var(--tn-minw) !important;
  max-width: var(--tn-maxw) !important;
  min-height: var(--tn-minh) !important;
  max-height: var(--tn-maxh) !important;
  gap: var(--tn-gap) !important;
  border-radius: var(--tn-br) !important;
}
${HIDDEN} > :not(${T}):not([data-tn-keep]) { display: none !important; }
/* Icons and images beside the hidden label stay, at the block's own font size. */
${HIDDEN} > [data-tn-keep] { font-size: var(--tn-bfs) !important; }
${HIDDEN} > ${T} {
  display: inline !important;
  font-size: var(--tn-fs, 16px) !important;
  /* the block's own line-height may be em-based and computed against font-size 0 */
  line-height: var(--tn-lh, normal) !important;
  letter-spacing: var(--tn-ls, normal) !important;
  margin: 0 !important;
  opacity: 1 !important;
  border: 0 !important;
  padding: 0 !important;
}
${HIDDEN} > ${T}.tn-nowrap { white-space: nowrap; }
${HIDDEN.replace('[data-tn-hide]', 'li[data-tn-hide]')}::marker { font-size: var(--tn-marker-fs, 16px); }
`;
