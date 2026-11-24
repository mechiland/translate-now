import { TRANSLATION_TAG } from './segmenter';

const T = TRANSLATION_TAG;

/** CSS injected into the page while translation is active. Scoped to our own tag/attributes. */
export const PAGE_CSS = `
${T} {
  display: block;
  margin: 0.3em 0 0.1em;
  white-space: pre-line;
  word-break: normal;
  overflow-wrap: anywhere;
  text-indent: 0;
  font-style: normal;
  font-weight: inherit;
  text-align: start;
  unicode-bidi: plaintext;
}
${T}.tn-inline { display: inline; margin: 0 0 0 0.4em; }
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

${T}.tn-loading { display: inline-block; margin-inline-start: 0.4em; vertical-align: middle; }
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
  display: inline-block;
  margin-inline-start: 0.4em;
  font-size: 12px;
  font-weight: normal;
  line-height: 1.4;
  color: #c2410c;
  cursor: pointer;
  text-decoration: underline dotted;
}

/* Translation-only mode: hide the original text of blocks that contain nothing but text. */
html[data-tn-mode="translation-only"] [data-tn-hide] {
  font-size: 0 !important;
  /* em-based spacing would collapse with font-size 0; restore the measured px values */
  margin: var(--tn-m) !important;
  padding: var(--tn-p) !important;
  min-width: var(--tn-minw) !important;
  max-width: var(--tn-maxw) !important;
}
html[data-tn-mode="translation-only"] [data-tn-hide] > :not(${T}) { display: none !important; }
html[data-tn-mode="translation-only"] [data-tn-hide] > ${T} {
  display: inline !important;
  font-size: var(--tn-fs, 16px) !important;
  line-height: var(--tn-lh, normal) !important;
  letter-spacing: var(--tn-ls, normal) !important;
  margin: 0 !important;
  opacity: 1 !important;
  border: 0 !important;
  padding: 0 !important;
}
html[data-tn-mode="translation-only"] li[data-tn-hide]::marker { font-size: var(--tn-marker-fs, 16px); }
`;
