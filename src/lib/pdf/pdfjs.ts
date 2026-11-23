import { browser } from 'wxt/browser';
// The legacy build polyfills recent JS features (e.g. Map.prototype.getOrInsertComputed)
// that the modern build expects, so it also works in older Chrome and Firefox releases.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
export { pdfjs };

/** Open a PDF from bytes. Resources (CMaps, fonts, decoders) ship with the extension. */
export function openPdf(data: Uint8Array) {
  const base = (path: string) => browser.runtime.getURL(`/pdfjs/${path}/` as '/');
  return pdfjs.getDocument({
    data,
    cMapUrl: base('cmaps'),
    standardFontDataUrl: base('standard_fonts'),
    wasmUrl: base('wasm'),
    iccUrl: base('iccs'),
    // Never run scripts embedded in PDFs.
    enableXfa: false,
    // Keeps font names (e.g. "NimbusRomNo9L-Medi") to show bold headings in bold.
    fontExtraProperties: true,
  });
}
