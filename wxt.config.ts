import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// pdf.js loads CMaps (CJK text), standard fonts, image decoders and ICC profiles at runtime.
const PDFJS_DIR = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const PDFJS_ASSETS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  // Tailwind is only imported by the popup and options pages (src/styles/globals.css).
  vite: () => ({ plugins: [tailwindcss()] }),
  // Explicit imports everywhere (no auto-imports) keeps lint/tsc/vitest simple.
  imports: false,
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const dir of PDFJS_ASSETS) {
        for (const name of readdirSync(join(PDFJS_DIR, dir))) {
          // The JavaScript sandbox for scripts embedded in PDFs is never used.
          if (name.startsWith('quickjs')) continue;
          files.push({
            absoluteSrc: join(PDFJS_DIR, dir, name),
            relativeDest: `pdfjs/${dir}/${name}`,
          });
        }
      }
    },
  },
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
