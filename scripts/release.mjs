import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function releaseVersion(version, tag) {
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
    version.split('.').some((part) => Number(part) > 65535) ||
    version === '0.0.0'
  ) {
    throw new Error(`Invalid store version: ${version}. Use three integers from 0 to 65535.`);
  }
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} must match package.json version v${version}.`);
  }
  return version;
}

export function submissionOptions(store, version, env, dryRun) {
  releaseVersion(version, `v${version}`);
  const prefix = `.output/translate-now-${version}`;
  let required;
  let args;
  if (store === 'chrome') {
    required = [
      'CHROME_EXTENSION_ID',
      'CHROME_PUBLISHER_ID',
      'CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL',
      'CHROME_SERVICE_ACCOUNT_PRIVATE_KEY',
    ];
    // A newer release supersedes a version still waiting for review; Chrome rejects
    // uploads while a review is pending, so cancel it and submit the new version.
    args = [
      '--chrome-api-version',
      'v2',
      '--chrome-zip',
      `${prefix}-chrome.zip`,
      '--chrome-cancel-pending',
      'true',
    ];
  } else if (store === 'firefox') {
    required = ['FIREFOX_JWT_ISSUER', 'FIREFOX_JWT_SECRET'];
    args = [
      '--firefox-channel',
      'listed',
      '--firefox-extension-id',
      'translate-now@mechiland.github.io',
      '--firefox-zip',
      `${prefix}-firefox.zip`,
      '--firefox-sources-zip',
      `${prefix}-sources.zip`,
      '--firefox-amo-metadata-file',
      'store/firefox-metadata.json',
    ];
  } else {
    throw new Error(`Unknown store: ${store}. Choose chrome or firefox.`);
  }
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing ${store} GitHub Actions secrets: ${missing.join(', ')}. See docs/PUBLISHING.md.`,
    );
  }
  if (store === 'chrome' && !/^[a-p]{32}$/.test(env.CHROME_EXTENSION_ID)) {
    throw new Error('CHROME_EXTENSION_ID must be the 32-letter Chrome Web Store item ID.');
  }
  return { args: ['exec', 'wxt', 'submit', ...args, ...(dryRun ? ['--dry-run'] : [])] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
    const [command, value, ...flags] = process.argv.slice(2);
    if (command === 'check') {
      console.log(releaseVersion(version, value));
    } else if (command === 'submit') {
      if (flags.some((flag) => flag !== '--dry-run')) throw new Error('Unknown submit option.');
      const { args } = submissionOptions(value, version, process.env, flags.includes('--dry-run'));
      for (let i = 0; i < args.length; i++) {
        if (
          [
            '--chrome-zip',
            '--firefox-zip',
            '--firefox-sources-zip',
            '--firefox-amo-metadata-file',
          ].includes(args[i]) &&
          !existsSync(args[i + 1])
        ) {
          throw new Error(
            `Missing artifact: ${args[i + 1]}. Run pnpm zip and pnpm zip:firefox first.`,
          );
        }
      }
      const result = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    } else {
      throw new Error(
        'Usage: node scripts/release.mjs check v<version> | submit chrome|firefox [--dry-run]',
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
