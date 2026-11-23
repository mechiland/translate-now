import { describe, expect, it } from 'vitest';
import { isLikelyPdfUrl, pdfFileName, pdfUrlFromViewer, viewerPath } from '@/lib/pdf/url';

describe('isLikelyPdfUrl', () => {
  it.each([
    ['https://example.com/paper.pdf', true],
    ['https://example.com/files/Paper%20Final.PDF?download=1', true],
    ['file:///home/me/report.pdf', true],
    ['https://arxiv.org/pdf/1706.03762', true],
    ['https://arxiv.org/pdf/1706.03762v7', true],
    ['https://export.arxiv.org/pdf/1706.03762', true],
    ['https://openreview.net/pdf?id=abc', true],
    ['https://arxiv.org/abs/1706.03762', false],
    ['https://example.com/pdf-tools', false],
    ['https://example.com/', false],
    ['chrome://settings', false],
    ['not a url', false],
    [undefined, false],
  ])('%s -> %s', (url, expected) => {
    expect(isLikelyPdfUrl(url)).toBe(expected);
  });
});

describe('viewer URLs', () => {
  it('round-trips the PDF address through the viewer URL', () => {
    const file = 'https://arxiv.org/pdf/1706.03762?x=1&y=2#page=3';
    const path = viewerPath(file);
    expect(path.startsWith('/pdf-viewer.html?file=')).toBe(true);
    const base = 'chrome-extension://abc/pdf-viewer.html';
    expect(pdfUrlFromViewer(`chrome-extension://abc${path}`, base)).toBe(file);
    expect(pdfUrlFromViewer('https://example.com/pdf-viewer.html?file=x', base)).toBeUndefined();
  });

  it('names files after the last path segment', () => {
    expect(pdfFileName('https://arxiv.org/pdf/1706.03762')).toBe('1706.03762');
    expect(pdfFileName('https://example.com/a/My%20Paper.pdf?dl=1')).toBe('My Paper.pdf');
    expect(pdfFileName('https://example.com/')).toBe('example.com');
  });
});
