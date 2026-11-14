/// <reference types="chrome" />
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockServer, type MockServer } from './mockServer';

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(here, '../../.output/chrome-mv3');

export interface Fixtures {
  context: BrowserContext;
  sw: Worker;
  server: MockServer;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await startMockServer(path.resolve(here, 'fixtures'));
    await use(server);
    await server.close();
  },
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
      throw new Error('Build the extension first: pnpm build');
    }
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await use(context);
    await context.close();
  },
  sw: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker');
    await use(sw);
  },
});

export function baseSettings(server: MockServer, extra: Record<string, unknown> = {}) {
  return {
    activeProviderId: 'mock',
    providers: [
      {
        id: 'mock',
        name: 'Mock',
        presetId: 'custom',
        protocol: 'openai',
        baseURL: `${server.url}/v1`,
        apiKey: 'test-key',
        model: 'mock-model',
      },
    ],
    targetLang: 'zh-CN',
    ...extra,
  };
}

export async function configure(sw: Worker, settings: unknown) {
  await sw.evaluate(async (s) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ settings: s });
  }, settings);
}

export async function sendToPage(sw: Worker, pageUrl: string, msg: unknown) {
  return sw.evaluate(
    async ({ url, msg }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find((t) => t.url?.startsWith(url));
      if (!tab?.id)
        throw new Error(`tab not found for ${url}: ${tabs.map((t) => t.url).join(', ')}`);
      return chrome.tabs.sendMessage(tab.id, msg);
    },
    { url: pageUrl, msg },
  );
}
