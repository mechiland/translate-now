import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Tailwind is only imported by the popup and options pages (src/styles/globals.css).
  vite: () => ({ plugins: [tailwindcss()] }),
  // Explicit imports everywhere (no auto-imports) keeps lint/tsc/vitest simple.
  imports: false,
  zip: {
    // Only reproducible build inputs are sent to AMO; local credentials stay out.
    includeSources: [
      'src/**',
      'components.json',
      'public/**',
      'scripts/gen-icons.mjs',
      'package.json',
      'pnpm-lock.yaml',
      'wxt.config.ts',
      'tsconfig.json',
      'README.md',
      'docs/AMO_REVIEW.md',
      'PRIVACY.md',
      'LICENSE',
    ],
    excludeSources: ['**/.env*', '**/*.pem', '**/*.key'],
  },
  manifest: ({ browser }) => ({
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    homepage_url: 'https://github.com/mechiland/translate-now',
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
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['websiteContent', 'browsingActivity', 'authenticationInfo'],
              },
            },
          },
        }
      : {}),
  }),
});
