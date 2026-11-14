/// <reference types="chrome" />
// Smoke test on real websites (network required). Uses the mock LLM, so no API key needed.
// Run with: REAL_SITES=1 pnpm exec playwright test realsites
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { baseSettings, configure, sendToPage, test } from './harness';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITES = [
  'https://en.wikipedia.org/wiki/Red_fox',
  'https://news.ycombinator.com/',
  'https://github.com/microsoft/TypeScript',
  'https://developer.mozilla.org/en-US/docs/Web/API/IntersectionObserver',
];

test.skip(!process.env.REAL_SITES, 'set REAL_SITES=1 to run');

for (const url of SITES) {
  test(`real site: ${url}`, async ({ context, sw, server }) => {
    await configure(sw, baseSettings(server));
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await expect
      .poll(() => sendToPage(sw, page.url(), { type: 'page:state' }).catch(() => null))
      .toBeTruthy();
    await sendToPage(sw, page.url(), { type: 'page:toggle' });
    await expect
      .poll(() => page.locator('tn-translation.tn-done').count(), { timeout: 15_000 })
      .toBeGreaterThan(3);
    await page.waitForTimeout(1000);
    const state = (await sendToPage(sw, page.url(), { type: 'page:state' })) as Record<
      string,
      number
    >;
    console.log(url, JSON.stringify(state), 'requests:', server.requests.length);
    const dir = path.resolve(here, 'screenshots');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `real-${new URL(url).hostname}.png`) });
    expect(state.errors).toBe(0);
  });
}
