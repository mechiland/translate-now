/** Path of the built-in PDF viewer page inside the extension. */
export const VIEWER_PATH = '/pdf-viewer.html';

/**
 * Does this URL most likely serve a PDF? Used where the document itself can't be inspected
 * (e.g. Firefox's built-in viewer runs no content scripts).
 */
export function isLikelyPdfUrl(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!['http:', 'https:', 'file:'].includes(u.protocol)) return false;
  const path = decodeURIComponent(u.pathname).toLowerCase();
  if (path.endsWith('.pdf')) return true;
  // arXiv serves PDFs without an extension: https://arxiv.org/pdf/1706.03762(v7)
  if (/(^|\.)arxiv\.org$/.test(u.hostname) && /^\/pdf\/[^/]/.test(path)) return true;
  // OpenReview: https://openreview.net/pdf?id=...
  if (/(^|\.)openreview\.net$/.test(u.hostname) && path === '/pdf') return true;
  return false;
}

/** Viewer URL for a PDF, relative to the extension root (pass to `runtime.getURL`). */
export function viewerPath(fileUrl: string): `/pdf-viewer.html${string}` {
  return `${VIEWER_PATH}?file=${encodeURIComponent(fileUrl)}`;
}

/** The PDF a viewer URL shows, if `url` is our viewer page. */
export function pdfUrlFromViewer(url: string | undefined, viewerBase: string): string | undefined {
  if (!url || !url.startsWith(viewerBase)) return undefined;
  try {
    return new URL(url).searchParams.get('file') ?? undefined;
  } catch {
    return undefined;
  }
}

/** File name shown for a PDF URL. */
export function pdfFileName(url: string): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return last || u.hostname || url;
  } catch {
    return url;
  }
}
