/// <reference types="chrome" />
// Translate the most visited websites in both display modes, check that the translations are
// readable and styled like the page, and save screenshots for a visual pass. Network required;
// uses the mock LLM in "cjk" mode (pseudo-Chinese of realistic length), so no API key needed.
// Run with: TOP_SITES=1 pnpm exec playwright test topsites --workers=8
// Use BOOK_SITES=1 for the 100-site Books and Literature corpus (BOOK_SITES=wattpad.com for a subset).
// Pick general sites with TOP_SITES=github.com,nytimes.com. Output goes to TOP_SITES_OUT
// (default tests/e2e/screenshots/topsites): <host>-original|bilingual|translation-only.png
// and <host>.json with the outcome and readability findings. Set TOP_SITES_SCREENSHOTS=0 for JSON only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import { chromium, expect, type Page, type Worker } from '@playwright/test';
import { BOOK_SITES } from './bookSites';
import { baseSettings, configure, sendToPage, test as base } from './harness';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, '../../.output/chrome-mv3');
const books = process.env.BOOK_SITES;
const OUT =
  process.env.TOP_SITES_OUT ?? path.resolve(here, 'screenshots', books ? 'books' : 'topsites');

// https://en.wikipedia.org/wiki/List_of_most-visited_websites (November 2026), adult sites left out.
const ALL_SITES = [
  'google.com', 'youtube.com', 'facebook.com', 'instagram.com', 'chatgpt.com', 'x.com',
  'tiktok.com', 'whatsapp.com', 'reddit.com', 'bing.com', 'en.wikipedia.org/wiki/Main_Page',
  'yahoo.co.jp', 'amazon.com', 'yandex.ru', 'gemini.google.com', 'yahoo.com', 'linkedin.com',
  'cloud.microsoft', 'baidu.com', 'pinterest.com', 'naver.com', 'netflix.com', 'live.com',
  'bilibili.com', 'claude.ai', 'twitch.tv', 'microsoft.com', 'temu.com', 'dzen.ru', 'vk.ru',
  'canva.com', 'globo.com', 'weather.com', 'news.yahoo.co.jp', 'github.com', 'samsung.com',
  'espn.com', 'mail.ru', 'fandom.com', 'brave.com', 'nytimes.com', 'duckduckgo.com',
  'zoom.com', 't.me', 'apple.com',
]; // prettier-ignore

const pick = (books || process.env.TOP_SITES)?.split(',').filter((s) => s && s !== '1');
const candidates = books ? BOOK_SITES : ALL_SITES;
const SITES = pick?.length
  ? candidates.filter((s) => pick.some((p) => s.startsWith(p)))
  : candidates;
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      userAgent: UA,
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
});

test.skip(!books && !process.env.TOP_SITES, 'set TOP_SITES=1 or BOOK_SITES=1 to run');
test.describe.configure({ mode: 'parallel', timeout: 150_000 });

interface Finding {
  kind: string;
  detail: string;
}

/** Runs in the page: readability and style problems of the injected translations. */
function inspect(mode: string) {
  const T = 'tn-translation';
  const findings: { kind: string; detail: string }[] = [];
  const add = (kind: string, el: Element, extra = '') => {
    const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    let p: Element | null = el.parentElement;
    const trail: string[] = [];
    for (let i = 0; p && i < 3; i++, p = p.parentElement) {
      const cls = typeof p.className === 'string' ? p.className.trim().split(/\s+/)[0] : '';
      trail.unshift(p.localName + (cls ? '.' + cls : ''));
    }
    findings.push({ kind, detail: `${trail.join('>')} "${text}" ${extra}`.trim() });
  };
  const parseColor = (c: string): number[] | null => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1]!
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (v: number) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
  };
  const background = (el: Element): number[] | null => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none') return null; // image/gradient: can't tell
      const c = parseColor(cs.backgroundColor);
      if (c && c[3]! > 0.5) return c;
    }
    return [255, 255, 255, 1];
  };
  const opacity = (el: Element) => {
    let o = 1;
    for (let n: Element | null = el; n; n = n.parentElement)
      o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  const contrast = (el: Element): number | null => {
    const fg = parseColor(getComputedStyle(el).color);
    const bg = background(el);
    if (!fg || !bg) return null;
    const a = fg[3]! * opacity(el);
    const mixed = fg.slice(0, 3).map((v, i) => v * a + bg[i]! * (1 - a));
    const [l1, l2] = [lum(mixed), lum(bg)].sort((x, y) => y - x);
    return (l1! + 0.05) / (l2! + 0.05);
  };

  const els = [...document.querySelectorAll(`${T}.tn-done`)] as HTMLElement[];
  let visible = 0;
  let stillOriginal = 0;
  const stillSamples: string[] = [];
  for (const el of els) {
    const block = el.parentElement!;
    const blockVisible = block.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    if (!blockVisible) continue;
    const rects = el.getClientRects();
    const shown =
      el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && rects.length > 0;
    const blockRect = block.getBoundingClientRect();
    if (!shown) {
      if (blockRect.width > 0 && blockRect.height > 0) add('invisible', el);
      continue;
    }
    visible++;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize);
    if (fs < 10) add('tiny-font', el, `${fs}px`);

    // Style should follow the original text (the element its first text node is in).
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.textContent!.trim() && !n.parentElement!.closest(T)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP,
    });
    const firstText = walker.nextNode();
    const bcs = getComputedStyle(firstText?.parentElement ?? block);
    if (mode === 'translation-only' && block.hasAttribute('data-tn-hide')) {
      const want = el.style.getPropertyValue('--tn-fs');
      if (want && Math.abs(parseFloat(want) - fs) > 0.5)
        add('font-size-changed', el, `${want} -> ${fs}px`);
    } else if (Math.abs(parseFloat(bcs.fontSize) - fs) > 0.5) {
      add('font-size-changed', el, `${bcs.fontSize} -> ${fs}px`);
    }
    if (cs.fontFamily !== bcs.fontFamily)
      add('font-family-changed', el, cs.fontFamily.slice(0, 40));

    // Cramped lines: wrapped text whose line box is shorter than the glyphs.
    const lh = parseFloat(cs.lineHeight);
    if (Number.isFinite(lh) && lh < fs * 1.1 && r.height > lh * 1.6)
      add('cramped-lines', el, `lh ${lh}px fs ${fs}px`);

    // Low contrast, compared with the original text of the same block.
    const c = contrast(el);
    const cb = contrast(block);
    if (c !== null && c < 3 && (cb === null || c < cb - 0.5))
      add('low-contrast', el, `${c.toFixed(2)} vs original ${cb?.toFixed(2)}`);

    // Clipped by an ancestor that doesn't clip the original text.
    for (let n: Element | null = block; n && n !== document.body; n = n.parentElement) {
      const ncs = getComputedStyle(n);
      if (ncs.overflowX === 'visible' && ncs.overflowY === 'visible') continue;
      const nr = n.getBoundingClientRect();
      const inside =
        blockRect.top >= nr.top - 1 && blockRect.left >= nr.left - 1 && blockRect.top < nr.bottom;
      if (!inside) break;
      // Only vertical: horizontal clipping is how carousels and marquees work.
      if (r.bottom > nr.bottom + 2) {
        add(
          'clipped',
          el,
          `by ${n.localName}.${String(n.className).split(' ')[0]} (${Math.round(r.bottom - nr.bottom)}px)`,
        );
        break;
      }
    }

    // Covered by something else (overlapping layout) — only checked in the first viewport.
    const first = rects[0]!;
    if (first.top >= 0 && first.bottom <= innerHeight && first.width > 4) {
      const x = first.left + Math.min(first.width / 2, 20);
      const y = first.top + first.height / 2;
      const top = document.elementFromPoint(x, y);
      if (top && !el.contains(top) && !top.contains(el))
        add('covered', el, `by ${top.localName}.${String(top.className).split(' ')[0]}`);
    }

    // Broken into a column of single characters.
    const textRange = document.createRange();
    textRange.selectNodeContents(el);
    const frags = [...textRange.getClientRects()].filter((x) => x.width > 0);
    const nLines = new Set(frags.map((x) => Math.round(x.top))).size;
    if (nLines >= 2 && Math.max(...frags.map((x) => x.width)) < fs * 1.6)
      add('column', el, `${nLines} lines`);

    // Visible translation of text the page hides (off-screen, transparent, zero-size, clipped).
    if (mode === 'bilingual') {
      const range = document.createRange();
      const texts = [...block.childNodes].filter((n) => n.nodeType === 3 && n.textContent!.trim());
      const holder = texts.length ? null : el.previousElementSibling;
      if (texts.length) {
        range.setStartBefore(texts[0]!);
        range.setEndAfter(texts[texts.length - 1]!);
      } else if (holder) range.selectNodeContents(holder);
      const tr = range.getBoundingClientRect();
      const src = texts.length ? block : holder;
      const scs = src ? getComputedStyle(src) : null;
      const why =
        (texts.length || holder) && tr.width < 2
          ? 'zero-size'
          : (texts.length || holder) && (tr.right < 0 || tr.left > innerWidth + 2000)
            ? 'off-screen'
            : scs && parseColor(scs.color)?.[3] === 0
              ? 'transparent'
              : scs && parseFloat(scs.fontSize) < 2
                ? 'font-size-0'
                : '';
      if (why && r.width > 2) add('stray', el, why);
    }

    if (mode === 'translation-only' && !block.hasAttribute('data-tn-hide')) {
      stillOriginal++;
      if (stillSamples.length < 6)
        stillSamples.push(block.outerHTML.replace(/\s+/g, ' ').slice(0, 500));
    }
  }
  return {
    translations: els.length,
    visible,
    stillOriginal,
    stillSamples,
    hOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    findings,
  };
}

async function settle(sw: Worker, page: Page) {
  let last = '';
  let stableSince = Date.now();
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const s = (await sendToPage(sw, page.url(), { type: 'page:state' }).catch(() => null)) as {
      done: number;
      pending: number;
    } | null;
    const key = JSON.stringify(s);
    if (key !== last) {
      last = key;
      stableSince = Date.now();
    } else if (s && s.pending === 0 && Date.now() - stableSince > 850) return s;
    await page.waitForTimeout(300);
  }
  return JSON.parse(last || 'null');
}

async function setMode(sw: Worker, displayMode: string) {
  await sw.evaluate(async (displayMode) => {
    const { settings } = (await chrome.storage.local.get('settings')) as { settings: object };
    await chrome.storage.local.set({ settings: { ...settings, displayMode } });
  }, displayMode);
}

async function openSite(page: Page, site: string) {
  const start = books && site === 'books.com.tw' ? 'www.books.com.tw/web/books' : site;
  try {
    return await page.goto(`https://${start}`, { waitUntil: 'domcontentloaded', timeout: 16_000 });
  } catch (error) {
    if (!books || start.includes('/') || start.startsWith('www.')) throw error;
    return page.goto(`https://www.${site}`, { waitUntil: 'domcontentloaded', timeout: 16_000 });
  }
}

async function activateMode(sw: Worker, page: Page, mode: string) {
  await setMode(sw, mode);
  await expect
    .poll(
      async () => {
        const state = (await sendToPage(sw, page.url(), { type: 'page:state' }).catch(
          () => null,
        )) as {
          translated: boolean;
        } | null;
        if (state && !state.translated)
          await sendToPage(sw, page.url(), { type: 'page:set', on: true });
        return page
          .locator('html')
          .getAttribute('data-tn-mode', { timeout: 1000 })
          .catch(() => null);
      },
      { timeout: 9000 },
    )
    .toBe(mode);
}

for (const site of SITES) {
  test(`top site: ${site}`, async ({ context, sw, server }) => {
    const host = site.split('/')[0]!;
    const report: Record<string, unknown> = { site, status: 'unavailable' };
    const page = await context.newPage();
    try {
      const response = await openSite(page, site);
      await page.waitForTimeout(500);
      report.finalUrl = page.url();
      report.title = await page.title();
      report.httpStatus = response?.status();
      if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`);
      if (response?.status() === 202 && !report.title) throw new Error('HTTP 202 without a page');
      if (
        /^(just a moment|access denied|attention required|robot check|request (?:blocked|rejected)|проверка$)/i.test(
          String(report.title),
        )
      ) {
        throw new Error('Access or bot challenge');
      }

      await page
        .waitForFunction(() => /\p{L}/u.test(document.body?.innerText ?? ''), null, {
          timeout: 6000,
        })
        .catch(() => {
          throw new Error('No readable page text');
        });
      report.finalUrl = page.url();
      report.title = await page.title();
      const { sourceLang, eastAsian } = await page.evaluate(() => {
        const text = document.body.innerText.slice(0, 4000);
        const cjk =
          text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
            ?.length ?? 0;
        const letters = text.match(/\p{L}/gu)?.length ?? 0;
        return {
          sourceLang: document.documentElement.lang,
          eastAsian: cjk > 0 && cjk * 4 > letters,
        };
      });
      report.status = 'translation-error';
      const targetLang =
        books && (/^(zh|ja|ko)(?:[-_]|$)/i.test(sourceLang) || eastAsian) ? 'en' : 'zh-CN';
      report.sourceLang = sourceLang;
      report.targetLang = targetLang;
      server.setMode(targetLang === 'en' ? 'english' : 'cjk');
      await configure(sw, baseSettings(server, { targetLang, displayMode: 'bilingual' }));
      await expect
        .poll(() => sendToPage(sw, page.url(), { type: 'page:state' }).catch(() => null), {
          timeout: 5000,
        })
        .toBeTruthy();
      fs.mkdirSync(OUT, { recursive: true });
      const baseOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      if (process.env.TOP_SITES_SCREENSHOTS !== '0')
        await page.screenshot({ path: path.join(OUT, `${host}-original.png`), timeout: 5000 });

      await activateMode(sw, page, 'bilingual');
      // Scroll a little so lazily translated content below the fold gets checked too.
      for (const y of [0, 900, 1800, 0]) {
        await page.evaluate((y) => scrollTo(0, y), y);
        await settle(sw, page);
      }
      let bothVisible = true;
      for (const mode of ['bilingual', 'translation-only']) {
        if (mode !== 'bilingual') await activateMode(sw, page, mode);
        await page.evaluate(() => scrollTo(0, 0));
        await settle(sw, page);
        const result = await page.evaluate(inspect, mode);
        bothVisible &&= result.visible > 0;
        const counts: Record<string, number> = {};
        for (const f of result.findings as Finding[]) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
        report[mode] = {
          ...result,
          state: await sendToPage(sw, page.url(), { type: 'page:state' }),
          newHOverflow: result.hOverflow && !baseOverflow,
          counts,
          findings: (result.findings as Finding[]).slice(0, 25),
        };
        if (process.env.TOP_SITES_SCREENSHOTS !== '0')
          await page.screenshot({ path: path.join(OUT, `${host}-${mode}.png`), timeout: 5000 });
      }
      report.status = bothVisible ? 'translated' : 'no-visible-translations';
    } catch (e) {
      report.error =
        e instanceof Error ? stripVTControlCharacters(e.message).split('\n')[0] : String(e);
    } finally {
      report.requests = server.requests.length;
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, `${host}.json`), JSON.stringify(report, null, 2));
    }
  });
}
