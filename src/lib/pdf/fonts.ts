/**
 * What a PDF font looks like, guessed from its PostScript name.
 *
 * pdf.js's own guess (`fontFamily` in text content, `isSerifFont`) relies on font flags that
 * TeX and many other producers leave unset: it reports NimbusRomNo9L (a Times clone) as
 * sans-serif and the TeX math symbol fonts as monospace. Names are far more reliable.
 */

export type FontFamilyClass = 'serif' | 'sans' | 'mono';

export interface FontInfo {
  family: FontFamilyClass;
  bold: boolean;
  /**
   * `symbol`: a math font whose glyphs are never prose (TeX math italic, symbols, extensible
   * delimiters, blackboard bold...). `upright`: TeX's text fonts, which in a document set in
   * another font only appear inside formulas ("softmax", digits, parentheses).
   */
  math?: 'symbol' | 'upright';
  /** One of TeX's Computer Modern / Latin Modern text fonts. */
  tex: boolean;
}

/** pdf.js font object fields used here (needs `fontExtraProperties`). */
export interface PdfJsFont {
  name?: string;
  bold?: boolean;
  black?: boolean;
  isSerifFont?: boolean;
  isMonospace?: boolean;
  fallbackName?: string;
}

/** "ABCDEF+NimbusRomNo9L-Regu" → "nimbusromno9l-regu". */
export function baseFontName(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '').toLowerCase();
}

const MONO =
  /^(?:cm|sf|lm|ec|tc|t1|tx|px|qc)tt|^lmmono|mono|courier|consol|menlo|inconsolata|nimbusmon|typewriter|lucidaconsole|codepro|firacode|^pcr/;
const SANS =
  /sans|helvet|arial|verdana|tahoma|calibri|segoe|frutiger|myriad|futura|gill|optima|lucidagrande|avenir|roboto|\blato|^inter\b|nimbussan|^cmss|^sfss|^lmss|gothic|grotesk|univers|franklin|trebuchet|aptos|candara|corbel|pingfang|heiti|yahei|simhei|dengxian|^ptmono/;
const SERIF =
  /serif|times|roman|nimbusrom|^cm(?:r|bx|ti|sl|csc|b|u|fib|dunh|vtt)\d|^sf(?:rm|bx|ti|sl|cc)\d|^lmr|^lmroman|georgia|garamond|palatino|^pala|minion|libertine|baskerville|bookman|caslon|cambria|charter|utopia|century|schoolbook|^stix|computermodern|^ptm|^ppl|^pbk|^pnc|termes|pagella|bonum|schola|^tx(?:r|b|i|sl)|^px(?:r|b|i|sl)|^ntx|^npx|song|ming|kaiti|fangsong|simsun|mincho|batang|myeongjo|constantia|bodoni|didot|sabon|plantin|perpetua|dutch|cochin|hoefler|newsreader|merriweather/;
const MATH_SYMBOL =
  /^cm(?:mi|sy|ex|mib|bsy)\d|^lmmathitalic|^lmmathsymbols|^lmmathextension|^ms(?:am|bm)\d|^eu(?:fm|fb|sm|sb|ex|rm|rb)\d|^rsfs|^wasy|^stmary|^esint|^bbm|^dsrom|^txmi|^txsy|^txex|^txsya|^txsyb|^pxmi|^pxsy|^pxex|^ntxmi|^ntxsy|^ntxexx|^npxmi|^npxsy|^zxmi|^stixmath|^stixtwomath|^xitsmath|^cambriamath|^cambria-math|^latinmodernmath|^texgyre\w*math|^libertinusmath|^asanamath|mathematicalpi|^symbolmt$|^symbol$|^euclid|^mtsy|^mtex|^mtmi|^rmtmi/;
/** TeX text fonts: math in a document typeset in another font, prose in a CM document. */
const TEX_TEXT =
  /^(?:cm(?:r|bx|ti|sl|csc|b|u|ss|ssbx|ssi|fib|dunh)\d|sf(?:rm|bx|ti|sl|cc|ss)\d|lmr|lmroman|lmbx|lmss|ec(?:rm|bx|ti|sl))/;
const BOLD =
  /bold|black|heavy|demi|semibold|medi(?:um)?\b|-medi|cmbx|^sfbx|^lmbx|^ecbx|cmmib|cmbsy|cmssbx|bx\d/;

export function classifyFont(font: PdfJsFont | null | undefined): FontInfo {
  const name = baseFontName(font?.name ?? '');
  const symbol = MATH_SYMBOL.test(name);
  const tex = TEX_TEXT.test(name);
  let family: FontFamilyClass;
  if (symbol || tex) family = /ss/.test(name) ? 'sans' : 'serif';
  else if (MONO.test(name)) family = 'mono';
  else if (SANS.test(name)) family = 'sans';
  else if (SERIF.test(name)) family = 'serif';
  else if (font?.isMonospace) family = 'mono';
  else if (font?.isSerifFont || font?.fallbackName === 'serif') family = 'serif';
  else family = 'sans';
  return {
    family,
    bold: !!(font?.bold || font?.black || BOLD.test(name)),
    ...(symbol ? { math: 'symbol' as const } : tex ? { math: 'upright' as const } : {}),
    tex,
  };
}
