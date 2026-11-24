/**
 * Inline elements whose look is kept in the translation: their translated text is wrapped in a
 * copy of the element (tag, class, style), the way links are.
 *
 * Only list selectors that are specific to one generator or site, so they cannot match ordinary
 * pages, and only ones that look clearly different from the surrounding text. Each marker is a
 * tag the model has to keep, so every entry adds some risk of a garbled translation.
 */
export const KEEP_STYLE_SELECTORS = [
  // LaTeXML (arXiv HTML, ar5iv): glossary terms and acronyms, shown in red with a dotted underline.
  '.ltx_glossaryref',
  // LaTeXML: \textit / \emph, mostly variable names in running text.
  '.ltx_font_italic',
  // LaTeXML: \texttt, package and function names.
  '.ltx_font_typewriter',
];

const SELECTOR = KEEP_STYLE_SELECTORS.join(',');

export function keepsStyle(el: Element): boolean {
  return el.matches(SELECTOR);
}
