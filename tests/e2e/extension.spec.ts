/// <reference types="chrome" />
import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseSettings, configure, sendToPage, test } from './harness';
import type { MockServer } from './mockServer';

const here = path.dirname(fileURLToPath(import.meta.url));
const screenshots = path.resolve(here, 'screenshots');

async function openFixture(context: BrowserContext, server: MockServer): Promise<Page> {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`${server.url}/page.html`);
  // Wait for the content script to be ready.
  await expect
    .poll(async () => {
      try {
        return Boolean(await sendToPageState(page));
      } catch {
        return false;
      }
    })
    .toBe(true);
  return page;
}

let currentSw: Worker;
async function sendToPageState(page: Page) {
  return sendToPage(currentSw, page.url(), { type: 'page:state' });
}

async function shot(page: Page, name: string) {
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: false });
}

const translationOf = (page: Page, id: string) => page.locator(`#${id} > tn-translation.tn-done`);

test.beforeEach(({ sw }) => {
  currentSw = sw;
});

test('translates the page bilingually, skips code/notranslate/target-language text', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  expect(await page.locator('tn-translation').count()).toBe(0);

  await sendToPage(sw, page.url(), { type: 'page:toggle' });

  await expect(translationOf(page, 'p1')).toHaveText(
    '[ZH] The quick brown fox jumps over the lazy dog.',
  );
  await expect(translationOf(page, 'p2')).toHaveText(
    '[ZH] Simple tools are often the most useful ones, as this link shows.',
  );
  await expect(translationOf(page, 'title')).toHaveText('[ZH] A simple test article');
  await expect(translationOf(page, 'li1')).toHaveText('[ZH] First list item text');
  // Original text is still visible in bilingual mode.
  await expect(page.locator('#p1')).toContainText('The quick brown fox');

  await expect(page.locator('#code tn-translation')).toHaveCount(0);
  await expect(page.locator('#nt tn-translation')).toHaveCount(0);
  await expect(page.locator('#zh tn-translation')).toHaveCount(0);
  // Far-below-the-fold paragraph is not translated until scrolled into view.
  await expect(page.locator('#far tn-translation')).toHaveCount(0);
  // Paragraphs were batched: far fewer requests than paragraphs.
  expect(server.requests.length).toBeLessThanOrEqual(2);
  expect(server.requests[0]!.auth).toBe('Bearer test-key');
  expect(server.requests[0]!.system).toContain('Simplified Chinese');
  await shot(page, '01-bilingual');

  await page.locator('#far').scrollIntoViewIfNeeded();
  await expect(translationOf(page, 'far')).toHaveText('[ZH] This paragraph is far below the fold.');
});

test('translation-only mode hides the original; toggling again restores the page', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server, { displayMode: 'translation-only' }));
  const page = await openFixture(context, server);
  await sendToPage(sw, page.url(), { type: 'page:toggle' });
  await expect(translationOf(page, 'p1')).toBeVisible();
  // Original text is hidden (font-size 0 + inline children hidden); only the translation is visible.
  // The original text node renders with zero width.
  const originalWidth = await page.locator('#p2').evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.firstChild!);
    return range.getBoundingClientRect().width;
  });
  expect(originalWidth).toBe(0);
  // Paragraph spacing (1em margins) is preserved despite font-size 0 on the block.
  const margin = await page.locator('#p2').evaluate((el) => getComputedStyle(el).marginTop);
  expect(margin).toBe('16px');
  await expect(page.locator('#p2 b')).toBeHidden();
  const fs1 = await translationOf(page, 'p1').evaluate((el) => getComputedStyle(el).fontSize);
  expect(fs1).toBe('16px');
  await shot(page, '02-translation-only');

  await sendToPage(sw, page.url(), { type: 'page:toggle' });
  await expect(page.locator('tn-translation')).toHaveCount(0);
  await expect(page.locator('[data-tn-hide]')).toHaveCount(0);
  await expect(page.locator('#p2 b')).toBeVisible();
});

test('switching display mode does not re-request', async ({ context, sw, server }) => {
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  await sendToPage(sw, page.url(), { type: 'page:toggle' });
  await expect(translationOf(page, 'p1')).toBeVisible();
  const before = server.requests.length;
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...(settings as object), displayMode: 'translation-only' },
    });
  });
  await expect(page.locator('html')).toHaveAttribute('data-tn-mode', 'translation-only');
  expect(server.requests.length).toBe(before);
});

test('translates dynamically inserted content', async ({ context, sw, server }) => {
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  await sendToPage(sw, page.url(), { type: 'page:toggle' });
  await expect(translationOf(page, 'p1')).toBeVisible();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'added';
    p.textContent = 'Freshly inserted paragraph text.';
    document.getElementById('dynamic')!.appendChild(p);
  });
  await expect(translationOf(page, 'added')).toHaveText('[ZH] Freshly inserted paragraph text.');
  // Text changes in an existing paragraph are re-translated.
  await page.evaluate(() => {
    document.getElementById('added')!.firstChild!.nodeValue = 'Updated paragraph content.';
  });
  await expect(translationOf(page, 'added')).toHaveText('[ZH] Updated paragraph content.');
  await expect(page.locator('#added tn-translation')).toHaveCount(1);
});

test('selection translation via floating button', async ({ context, sw, server }) => {
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  const box = (await page.locator('#p1').boundingBox())!;
  // Drag-select the first paragraph.
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const button = page.locator('tn-ui .btn');
  await expect(button).toBeVisible();
  await button.click();
  const card = page.locator('tn-ui .card');
  await expect(card.locator('.out')).toContainText('[ZH] The quick brown fox');
  await shot(page, '03-selection');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('tapping Ctrl over a paragraph translates only that paragraph; tapping again removes it', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  const bold = (await page.locator('#p2 b').boundingBox())!;
  await page.mouse.move(bold.x + bold.width / 2, bold.y + bold.height / 2);

  // Ctrl+C is a shortcut, not a tap.
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(300);
  expect(server.requests).toHaveLength(0);

  await page.keyboard.press('Control');
  await expect(translationOf(page, 'p2')).toHaveText(
    '[ZH] Simple tools are often the most useful ones, as this link shows.',
  );
  await expect(page.locator('tn-translation')).toHaveCount(1);
  expect(server.requests).toHaveLength(1);
  await shot(page, '04-hover');

  await page.keyboard.press('Control');
  await expect(page.locator('tn-translation')).toHaveCount(0);

  // Turning it off in settings disables the trigger.
  await configure(sw, baseSettings(server, { hover: { modifier: 'off' } }));
  await page.waitForTimeout(200);
  await page.keyboard.press('Control');
  await page.waitForTimeout(300);
  await expect(page.locator('tn-translation')).toHaveCount(0);
  expect(server.requests).toHaveLength(1);
});

test('selection translation via context-menu message', async ({ context, sw, server }) => {
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  await sendToPage(sw, page.url(), { type: 'selection:translate', text: 'Hello there' });
  await expect(page.locator('tn-ui .card .out')).toHaveText('[ZH] Hello there');
});

test('site rule "always" auto-translates on load; "never" does not', async ({
  context,
  sw,
  server,
}) => {
  await configure(
    sw,
    baseSettings(server, { siteRules: [{ pattern: '127.0.0.1', mode: 'always' }] }),
  );
  const page = await openFixture(context, server);
  await expect(translationOf(page, 'p1')).toBeVisible();

  await configure(
    sw,
    baseSettings(server, {
      siteRules: [{ pattern: '127.0.0.1', mode: 'never' }],
      autoTranslateForeign: true,
    }),
  );
  const page2 = await openFixture(context, server);
  await page2.waitForTimeout(800);
  await expect(page2.locator('tn-translation')).toHaveCount(0);
});

test('auto-translate foreign pages when enabled', async ({ context, sw, server }) => {
  await configure(sw, baseSettings(server, { autoTranslateForeign: true }));
  const page = await openFixture(context, server);
  await expect(translationOf(page, 'p1')).toBeVisible();
});

test('retries on 429 and succeeds', async ({ context, sw, server }) => {
  server.setMode('429-twice');
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  await sendToPage(sw, page.url(), { type: 'page:toggle' });
  await expect(translationOf(page, 'p1')).toBeVisible({ timeout: 20_000 });
  expect(server.requests.length).toBeGreaterThanOrEqual(3);
});

test('shows an error marker and a toast on 401, retry works after fixing', async ({
  context,
  sw,
  server,
}) => {
  server.setMode('401');
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  await sendToPage(sw, page.url(), { type: 'page:toggle' });
  await expect(page.locator('#p1 > tn-translation.tn-error')).toBeVisible();
  await expect(page.locator('tn-ui .toast')).toContainText('Translate Now');
  await shot(page, '04-error');
  const state = (await sendToPage(sw, page.url(), { type: 'page:state' })) as { errors: number };
  expect(state.errors).toBeGreaterThan(0);

  server.setMode('ok');
  await page.locator('#p1 > tn-translation.tn-error').click();
  await expect(translationOf(page, 'p1')).toHaveText(
    '[ZH] The quick brown fox jumps over the lazy dog.',
  );
});

test('options page: test connection and fetch models against the mock server', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const extId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options.html#providers`);
  await page.getByRole('button', { name: /Test connection|测试连接/ }).click();
  await expect(page.locator('[data-testid=test-status][data-status=ok]')).toContainText(
    '[ZH] Hello, world!',
  );
  await page.getByRole('button', { name: /Fetch models|获取模型列表/ }).click();
  await expect(page.locator('[data-testid=models-status][data-status=ok]')).toContainText('2');
  await shot(page, '05-options');
});

test('popup renders and toggles translation for the active tab', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const page = await openFixture(context, server);
  const extId = new URL(sw.url()).host;
  await page.bringToFront();
  // The popup queries the active tab; open it in a tab and point it at the fixture tab via a stub.
  const popup = await context.newPage();
  await popup.addInitScript((fixtureUrl) => {
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (async (q: chrome.tabs.QueryInfo) => {
      if (q.active) return (await orig({})).filter((t) => t.url?.startsWith(fixtureUrl));
      return orig(q);
    }) as typeof chrome.tabs.query;
  }, server.url);
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.setViewportSize({ width: 340, height: 520 });
  const main = popup.locator('.main-btn');
  await expect(main).toBeVisible();
  await main.click();
  await expect(translationOf(page, 'p1')).toBeVisible();
  await expect(main).toHaveText(/Show original|显示原文/);
  await shot(popup, '06-popup');
});
