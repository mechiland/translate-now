/// <reference types="chrome" />
import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseSettings, configure, sendToPage, test } from './harness';
import { PDF_PARAGRAPHS, type MockServer } from './mockServer';

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
  await expect(translationOf(page, 'p2').locator('a')).toHaveAttribute('href', '#');
  await expect(translationOf(page, 'p2').locator('a')).toHaveText('this link');
  await expect(translationOf(page, 'title')).toHaveText('[ZH] A simple test article');
  await expect(translationOf(page, 'li1')).toHaveText('[ZH] First list item text');
  await expect(translationOf(page, 'li3').locator('a')).toHaveAttribute('href', '#linked-item');
  await expect(translationOf(page, 'li3').locator('a')).toHaveText('[ZH] Linked list item text');
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
  await expect(page.locator('#p2 > a')).toBeHidden();
  await expect(translationOf(page, 'p2').locator('a')).toBeVisible();
  await expect(translationOf(page, 'p2').locator('a')).toHaveAttribute('href', '#');
  await expect(translationOf(page, 'li3').locator('a')).toBeVisible();
  await translationOf(page, 'li3').locator('a').click();
  await expect(page).toHaveURL(/#linked-item$/);
  const fs1 = await translationOf(page, 'p1').evaluate((el) => getComputedStyle(el).fontSize);
  expect(fs1).toBe('16px');
  await shot(page, '02-translation-only');

  await sendToPage(sw, page.url(), { type: 'page:toggle' });
  await expect(page.locator('tn-translation')).toHaveCount(0);
  await expect(page.locator('[data-tn-hide]')).toHaveCount(0);
  await expect(page.locator('#p2 b')).toBeVisible();
});

test('translations follow the look of the original and never break into a column', async ({
  context,
  sw,
  server,
}) => {
  server.setMode('cjk');
  await configure(sw, baseSettings(server));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`${server.url}/layout.html`);
  await expect.poll(() => sendToPageState(page).catch(() => null)).toBeTruthy();
  await sendToPage(sw, page.url(), { type: 'page:toggle' });

  const style = (id: string, prop: string) =>
    translationOf(page, id).evaluate(
      (el, prop) => getComputedStyle(el).getPropertyValue(prop),
      prop,
    );
  await expect(translationOf(page, 'center')).toBeVisible();
  expect(await style('center', 'text-align')).toBe('center');
  // The text sits in a styled span: the translation takes that span's size, weight and color.
  await expect(translationOf(page, 'ticker')).toBeVisible();
  expect(await style('ticker', 'font-size')).toBe('11px');
  expect(await style('ticker', 'font-weight')).toBe('700');
  expect(await style('ticker', 'color')).toBe('rgb(200, 0, 0)');
  // The whole run is an inline-block button: the translation goes inside it.
  await expect(translationOf(page, 'pill')).toBeVisible();
  // Repeating the original adds nothing.
  await expect(page.locator('#same tn-translation')).toHaveCount(0);
  // A box too narrow for the translation keeps just the original.
  await expect(page.locator('#tabs > tn-translation.tn-squeezed')).toHaveCount(1);
  await expect(page.locator('#tabs > tn-translation')).toBeHidden();

  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...(settings as object), displayMode: 'translation-only' },
    });
  });
  await expect(page.locator('html')).toHaveAttribute('data-tn-mode', 'translation-only');
  // em-based sizes of the hidden block are kept, the icon stays, the text is swapped.
  const pill = await page.locator('#pill').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { minWidth: cs.minWidth, radius: cs.borderTopLeftRadius };
  });
  expect(pill).toEqual({ minWidth: '224px', radius: '28px' });
  await expect(page.locator('#icon')).toBeVisible();
  expect(await page.locator('#icon').evaluate((el) => el.getBoundingClientRect().width)).toBe(14);
  // Line height comes from the original (1.4em of 16px), not from the hidden block's 0px.
  expect(await style('cap', 'line-height')).toBe('22.4px');
  // The squeezed translation stays hidden and the original stays readable.
  expect(await page.locator('#tabs').evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
  await shot(page, '03-layout-translation-only');
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

test('translates headline buttons, role=button/tooltip widgets and expanded content, not hidden text', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto(`${server.url}/widgets.html`);
  await expect
    .poll(() => sendToPage(sw, page.url(), { type: 'page:state' }).catch(() => null))
    .toBeTruthy();
  await sendToPage(sw, page.url(), { type: 'page:toggle' });

  // Kagi-style headline: the title span is a flex item (blockified), so its translation
  // renders inside it, below the title.
  const headlineTr = page.locator('#headline tn-translation.tn-done');
  await expect(headlineTr).toHaveText(
    '[ZH] Airspace reopens after a communications failure halts all departures',
  );
  const titleBox = (await page.locator('#headline > span').evaluate((el) => {
    const r = el.firstChild!.ownerDocument!.createRange();
    r.selectNodeContents(el.firstChild!);
    const b = r.getBoundingClientRect();
    return { y: b.y, height: b.height };
  }))!;
  expect((await headlineTr.boundingBox())!.y).toBeGreaterThanOrEqual(
    titleBox.y + titleBox.height - 1,
  );
  // Text directly inside a flex button: the translation goes right after the button, below it.
  const moreTr = page.locator('#more + tn-translation.tn-done');
  await expect(moreTr).toHaveText(
    '[ZH] See how airlines rebuilt their schedules after the ground stop',
  );
  const moreBox = (await page.locator('#more').boundingBox())!;
  expect((await moreTr.boundingBox())!.y).toBeGreaterThanOrEqual(moreBox.y + moreBox.height - 1);

  // TalentLMS-style sidebar: role=button items and role=tooltip wrappers.
  await expect(page.locator('#unit-1 tn-translation.tn-done')).toHaveText(
    '[ZH] Meet the Instructors',
  );
  await expect(page.locator('#chapter tn-translation.tn-done')).toHaveText(
    '[ZH] Chapter 1: About this Course',
  );
  // The duplicated, visually hidden <dt> and form values are left alone.
  await expect(page.locator('dt tn-translation')).toHaveCount(0);
  await expect(page.locator('form tn-translation')).toHaveCount(0);

  // The headline still works as a button; the content it reveals gets translated.
  await page.locator('#headline').click();
  await expect(page.locator('#summary tn-translation.tn-done')).toContainText(
    '[ZH] Flights resumed in the evening after a nationwide ground stop.',
  );
  const sent = server.requests.map((r) => r.user).join('\n');
  expect(sent).not.toContain('Citation 1');
  expect(sent).not.toContain('Typed value');
  expect(sent.match(/Meet the Instructors/g)).toHaveLength(1);
  await shot(page, '07-widgets');
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

test('popup shows a loading surface before its JavaScript is available', async ({
  context,
  sw,
}) => {
  const popup = await context.newPage();
  let releaseScripts!: () => void;
  const scriptsReady = new Promise<void>((resolve) => (releaseScripts = resolve));
  await popup.route('**/*.js', async (route) => {
    await scriptsReady;
    await route.continue();
  });

  try {
    await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`, {
      waitUntil: 'commit',
    });
    const loading = popup.getByRole('status', { name: /Translate Now/ });
    await expect(loading).toBeVisible();
    expect((await loading.boundingBox())!.height).toBeGreaterThan(100);
  } finally {
    releaseScripts();
  }

  await expect(popup.getByRole('heading', { name: 'Translate Now' })).toBeVisible();
  await expect(popup.locator('.settings-btn')).toBeVisible();
});

test('popup keeps the loading surface visible until saved settings are ready', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server, { uiLang: 'en', targetLang: 'ja' }));
  const popup = await context.newPage();
  await popup.addInitScript(() => {
    const get = chrome.storage.local.get.bind(chrome.storage.local);
    const settingsReady = new Promise<void>((resolve) => {
      Object.defineProperty(window, 'releasePopupSettings', { value: resolve });
    });
    Object.defineProperty(chrome.storage.local, 'get', {
      value: async (keys: string | string[] | Record<string, unknown> | null = null) => {
        Object.defineProperty(window, 'popupSettingsRequested', {
          value: true,
          configurable: true,
        });
        await settingsReady;
        return get<Record<string, unknown>>(keys);
      },
    });
  });

  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  await popup.waitForFunction(() => Reflect.get(window, 'popupSettingsRequested'));
  await expect(popup.getByRole('status', { name: /Translate Now/ })).toBeVisible();
  await expect(popup.locator('#target')).toHaveCount(0);

  await popup.evaluate(() => Reflect.get(window, 'releasePopupSettings')());
  await expect(popup.locator('#target')).toContainText('日本語');
  await expect(popup.locator('.settings-btn')).toBeVisible();
  await expect(popup.getByRole('status', { name: /Translate Now/ })).toHaveCount(0);

  await popup.locator('#target').click();
  await popup.getByRole('option', { name: 'Français', exact: true }).click();
  await expect
    .poll(() =>
      sw.evaluate(async () => {
        const { settings } = await chrome.storage.local.get<{ settings: { targetLang: string } }>(
          'settings',
        );
        return settings.targetLang;
      }),
    )
    .toBe('fr');
});

test('popup can retry when its application fails to load', async ({ context, sw }) => {
  const popup = await context.newPage();
  await popup.route('**/chunks/render-*.js', (route) => route.abort());
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html`);
  await expect(popup.getByRole('alert')).toBeVisible();
  await popup.unroute('**/chunks/render-*.js');
  await popup.getByRole('button', { name: /Retry|重试/ }).click();
  await expect(popup.locator('.settings-btn')).toBeVisible();
});

// ---- PDF -------------------------------------------------------------------

async function extensionId(sw: Worker) {
  return new URL(sw.url()).host;
}

async function openViewer(context: BrowserContext, sw: Worker, file: string) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(
    `chrome-extension://${await extensionId(sw)}/pdf-viewer.html?file=${encodeURIComponent(file)}`,
  );
  return page;
}

test('PDF viewer translates paragraphs side by side and skips page numbers', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const page = await openViewer(context, sw, `${server.url}/paper.pdf`);
  const done = page.locator('.pdf-translated .tn-pdf-block.tn-done');
  await expect(done).toHaveCount(PDF_PARAGRAPHS.length);
  await expect(done.nth(0)).toHaveText('[ZH] Introduction');
  await expect(done.nth(1)).toHaveText(`[ZH] ${PDF_PARAGRAPHS[1]!.join(' ')}`);
  await expect(page.locator('.pdf-original')).toBeVisible();
  // The original column has a selectable text layer.
  await expect(page.locator('.pdf-original .textLayer')).toContainText('Transformer');
  expect(server.requests.some((r) => r.user.includes('>1<'))).toBe(false);
  await shot(page, 'pdf-bilingual');

  // Translation only: the original column goes away.
  await configure(sw, baseSettings(server, { displayMode: 'translation-only' }));
  await expect(page.locator('.pdf-original')).toBeHidden();
  await expect(page.locator('.pdf-translated')).toBeVisible();
});

test('PDF translation keeps fonts, colors, bold runs, formulas and list markers', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const page = await openViewer(context, sw, `${server.url}/styled.pdf`);
  const done = page.locator('.pdf-translated .tn-pdf-block.tn-done');
  await expect(done).toHaveCount(3);
  // Times → serif, red stays red.
  await expect(done.nth(0)).toHaveAttribute('data-family', 'serif');
  expect(await done.nth(0).evaluate((e) => getComputedStyle(e).color)).toMatch(
    /^rgb\(2[0-5]\d, \d{1,2}, \d{1,2}\)$/,
  );
  // The bold run-in heading, the footnote mark and the inline code went to the model
  // as tags and came back with their style.
  const sent = server.requests.map((r) => r.user).join('\n');
  expect(sent).toContain('<a id="1">Encoder:</a> The encoder');
  expect(sent).toMatch(/gradients ?<m id="1"\/>\. Use the <a id="2">--config<\/a> option\./);
  const para = done.nth(1);
  await expect(para.locator('b')).toHaveText('Encoder:');
  await expect(para.locator('.tn-pdf-code')).toHaveText('--config');
  const mark = para.locator('.tn-pdf-math');
  await expect(mark).toHaveText('4');
  expect(await mark.evaluate((e) => getComputedStyle(e).backgroundImage)).toMatch(/^url\("blob:/);
  // The bullet stays on the page; the item's text hangs beside it.
  const item = done.nth(2);
  await expect(item).not.toContainText('•');
  const { left, textLeft } = await item.evaluate((e) => ({
    left: parseFloat(e.style.left) / 2,
    textLeft: (parseFloat(e.style.left) + parseFloat(e.style.paddingLeft)) / 2,
  }));
  expect(left).toBeGreaterThan(93); // right of the bullet at x = 90
  expect(textLeft).toBeCloseTo(99, 0); // the text column of the item's second line
  await shot(page, 'pdf-styled');
});

test('PDF viewer answers popup commands and exports through the print dialog', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const page = await openViewer(context, sw, `${server.url}/paper.pdf`);
  await expect(page.locator('.tn-pdf-block.tn-done')).toHaveCount(PDF_PARAGRAPHS.length);

  const command = (cmd: unknown) =>
    sw.evaluate(async (cmd) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url?.includes('/pdf-viewer.html'));
      return chrome.runtime.sendMessage({ type: 'viewer:command', tabId: tab!.id, command: cmd });
    }, cmd);
  expect(await command({ type: 'page:state' })).toMatchObject({
    translated: true,
    host: '127.0.0.1',
    done: PDF_PARAGRAPHS.length,
  });
  expect(await command({ type: 'page:toggle' })).toMatchObject({ translated: false });
  await expect(page.locator('.pdf-translated')).toBeHidden();

  await page.evaluate(() => {
    (window as unknown as { printed: boolean }).printed = false;
    window.print = () => void ((window as unknown as { printed: boolean }).printed = true);
  });
  await page.getByRole('button', { name: 'Export PDF' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { printed: boolean }).printed))
    .toBe(true);
  // Export turns translation back on and sizes sheets for side-by-side pages.
  await expect(page.locator('.pdf-translated')).toBeVisible();
  expect(await page.locator('#tn-print-page').textContent()).toContain('size: 1224pt 792pt');
});

test('translating a PDF tab opens it in the viewer', async ({ context, sw, server }) => {
  await configure(sw, baseSettings(server));
  const page = await context.newPage();
  const pdfUrl = `${server.url}/pdf/1706.03762`;
  await page.goto(pdfUrl).catch(() => {});
  await expect
    .poll(async () => {
      try {
        return ((await sendToPage(sw, pdfUrl, { type: 'page:state' })) as { pdf?: boolean }).pdf;
      } catch {
        return false;
      }
    })
    .toBe(true);
  await sendToPage(sw, pdfUrl, { type: 'page:toggle' });
  await expect(page).toHaveURL(/pdf-viewer\.html\?file=/);
  await expect(page.locator('.tn-pdf-block.tn-done')).toHaveCount(PDF_PARAGRAPHS.length);
});

test('popup offers PDF translation on a PDF tab and controls the viewer', async ({
  context,
  sw,
  server,
}) => {
  await configure(sw, baseSettings(server));
  const pdfUrl = `${server.url}/pdf/2401.00001`;
  const page = await context.newPage();
  await page.goto(pdfUrl).catch(() => {});
  const extId = await extensionId(sw);
  const openPopup = async () => {
    const popup = await context.newPage();
    await popup.addInitScript((target) => {
      const orig = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (async (q: chrome.tabs.QueryInfo) => {
        if (q.active) return (await orig({})).filter((t) => t.url?.includes(target));
        return orig(q);
      }) as typeof chrome.tabs.query;
    }, '2401.00001');
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    return popup;
  };

  const popup = await openPopup();
  const main = popup.locator('.main-btn');
  await expect(main).toHaveText(/Translate this PDF|翻译此 PDF/);
  await main.click();
  await expect(page).toHaveURL(/pdf-viewer\.html/);
  await expect(page.locator('.tn-pdf-block.tn-done')).toHaveCount(PDF_PARAGRAPHS.length);

  // In the viewer tab the popup works like on any page.
  const popup2 = await openPopup();
  const main2 = popup2.locator('.main-btn');
  await expect(main2).toHaveText(/Show original|显示原文/);
  await expect(popup2.getByText('127.0.0.1')).toBeVisible();
  await main2.click();
  await expect(page.locator('.pdf-translated')).toBeHidden();
});
