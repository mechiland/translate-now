import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Explicit imports everywhere (no auto-imports) keeps lint/tsc/vitest simple.
  imports: false,
  zip: {
    // Sources zip (for Firefox AMO review) — keep test artifacts out.
    excludeSources: ['tests/e2e/screenshots/**', 'test-results/**', 'playwright-report/**', '.github/**'],
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    permissions: ['storage', 'contextMenus', 'activeTab'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '__MSG_extName__',
    },
    commands: {
      'toggle-page': {
        suggested_key: { default: 'Alt+A' },
        description: '__MSG_cmdTogglePage__',
      },
      'translate-selection': {
        suggested_key: { default: 'Alt+S' },
        description: '__MSG_cmdTranslateSelection__',
      },
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'translate-now@mechiland.github.io',
              strict_min_version: '115.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
