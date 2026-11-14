import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseVersion, submissionOptions } from '../../scripts/release.mjs';

test('release tags must match a version accepted by both extension stores', () => {
  assert.equal(releaseVersion('0.1.1', 'v0.1.1'), '0.1.1');
  for (const version of ['0.0.0', '01.1.0', '1.2.3-beta.1', '65536.1.0']) {
    assert.throws(() => releaseVersion(version, `v${version}`), /version/i);
  }
  assert.throws(() => releaseVersion('0.1.1', 'v0.1.0'), /match/i);
  assert.throws(() => releaseVersion('0.1.1', 'main'), /match/i);
});

const chromeEnv = {
  CHROME_EXTENSION_ID: 'a'.repeat(32),
  CHROME_PUBLISHER_ID: 'publisher-id',
  CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL: 'publisher@example.iam.gserviceaccount.com',
  CHROME_SERVICE_ACCOUNT_PRIVATE_KEY: 'private-value-never-log',
};
const firefoxEnv = { FIREFOX_JWT_ISSUER: 'issuer', FIREFOX_JWT_SECRET: 'private-value-never-log' };

test('Chrome uses API v2, an exact versioned artifact, and supersedes a pending review', () => {
  const result = submissionOptions('chrome', '0.1.1', chromeEnv, false);
  assert.deepEqual(result.args, [
    'exec',
    'wxt',
    'submit',
    '--chrome-api-version',
    'v2',
    '--chrome-zip',
    '.output/translate-now-0.1.1-chrome.zip',
    '--chrome-cancel-pending',
    'true',
  ]);
  assert.equal(
    JSON.stringify(result.args).includes(chromeEnv.CHROME_SERVICE_ACCOUNT_PRIVATE_KEY),
    false,
  );
});

test('Firefox submits the matching sources with its stable manifest ID to the public store', () => {
  const result = submissionOptions('firefox', '0.1.1', firefoxEnv, true);
  assert.deepEqual(result.args, [
    'exec',
    'wxt',
    'submit',
    '--firefox-channel',
    'listed',
    '--firefox-extension-id',
    'translate-now@mechiland.github.io',
    '--firefox-zip',
    '.output/translate-now-0.1.1-firefox.zip',
    '--firefox-sources-zip',
    '.output/translate-now-0.1.1-sources.zip',
    '--firefox-amo-metadata-file',
    'store/firefox-metadata.json',
    '--dry-run',
  ]);
});

test('missing credentials fail clearly before uploading without exposing values', () => {
  for (const [store, env] of [
    ['chrome', chromeEnv],
    ['firefox', firefoxEnv],
  ]) {
    for (const key of Object.keys(env)) {
      const incomplete = { ...env, [key]: ' ' };
      assert.throws(
        () => submissionOptions(store, '0.1.1', incomplete, false),
        (error) => {
          assert.match(error.message, new RegExp(key));
          assert.equal(error.message.includes('private-value-never-log'), false);
          return true;
        },
      );
    }
  }
});

test('submission rejects unknown stores, malformed versions and invalid Chrome item IDs', () => {
  assert.throws(() => submissionOptions('edge', '0.1.1', {}, false), /store/i);
  assert.throws(() => submissionOptions('chrome', '../secret', chromeEnv, false), /version/i);
  assert.throws(
    () => submissionOptions('chrome', '0.1.1', { ...chromeEnv, CHROME_EXTENSION_ID: 'bad' }, false),
    /CHROME_EXTENSION_ID/,
  );
});
