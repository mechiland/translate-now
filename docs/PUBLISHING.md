# Publishing to the Chrome Web Store and Firefox AMO

## Store items

- Chrome item ID: `hkahabmfamcffhaficngecicoagnaknj`; [developer dashboard](https://chrome.google.com/webstore/devconsole/21607d6d-86f2-4d36-a859-5f022274fe6f/hkahabmfamcffhaficngecicoagnaknj/edit/status).
- Firefox manifest ID: `translate-now@mechiland.github.io`; [developer dashboard](https://addons.mozilla.org/en-US/developers/addon/translate-now-ai/versions); public page `/firefox/addon/translate-now-ai/`.
- First store submission: `0.1.1` (submitted manually). Every later version must be higher than anything already submitted.
- Chrome publishing project: `translate-now-releases`; service account: `translate-now-publisher@translate-now-releases.iam.gserviceaccount.com`. The service account is only used for the store API and has no Cloud project roles.
- Reusable listing screenshots live in `store/screenshots/` (taken with a local demo article and sample credentials). Listing copy is in `store/LISTING.md`.

## Store listing text

The store API only uploads the package. The listing (detailed description, screenshots, privacy answers) lives in each dashboard and has to be edited there by hand; the manifest `description` from `public/_locales` is part of the package and becomes the Chrome summary.

- **Never list third-party brand names in store-facing text** (manifest name/description, listing descriptions in any language). Chrome rejected `0.1.1` for keyword spam ("Yellow Argon") over `(OpenAI, OpenRouter, DeepSeek, Qwen, Gemini, Claude, Ollama)`. Describe providers generically; names stay in the README and settings UI. `tests/release/store-copy.test.mjs` checks the manifest and `store/LISTING.md`, but not what is pasted into the dashboards, so paste only from `store/LISTING.md`.
- When the listing copy changes, update **both dashboards and every locale** (English and Chinese) _before_ the next version is submitted. A Chrome submission reviews the dashboard listing together with the package, so stale dashboard text gets the new version rejected too.
- After a rejection, fix the cause, then ship a new version. Do not retry an older tag whose package still carries the rejected text.

## How a release happens

```
PR (Conventional Commits title) ──squash──▶ main
                                             │
                     release-please.yml ◀────┘  updates the release PR
                                             │  (version bump + CHANGELOG)
          merge the release PR ──────────────┘
                     │
                     ├─ release-please tags vX.Y.Z and creates the GitHub Release
                     └─ release.yml (called directly):
                          build → compile, lint, unit + release tests, Chromium E2E,
                                  zip, web-ext lint
                          github-release → attach chrome/firefox/sources ZIPs
                          submit (chrome) → Chrome Web Store API v2, cancel pending review, submit
                          submit (firefox) → AMO listed channel with sources
```

1. **Write a Conventional Commits PR title.** PRs are squash-merged and the PR title becomes the commit message on `main`; the `PR title` workflow enforces the format. Write titles in English; user-facing descriptions are copied into the release notes as-is:
   - `feat: translate a paragraph on hover` → minor bump, listed under Features
   - `fix(selection): keep the card on screen` → patch bump, listed under Bug Fixes
   - `perf: …` → Performance Improvements, `revert: …` → Reverts, `deps: …` → Dependencies
   - `docs`, `refactor`, `test`, `build`, `ci`, `chore`, `style` → no release on their own and hidden from the notes
   - `feat!: …` or a `BREAKING CHANGE:` footer → breaking change (a minor bump while the version is below 1.0)
2. **Review the release PR.** After each merge, release-please opens or updates `chore(main): release X.Y.Z`. It bumps `package.json` and `.release-please-manifest.json` and prepends the new section to `CHANGELOG.md`. Edit the PR if the notes need polishing.
3. **Merge the release PR** when you want to ship. Everything after that is automatic. CI passing does not mean the stores approved the version; Chrome and Firefox reviews usually take from hours to a few days. Approved versions are published automatically.

Notes:

- PRs and tags created by release-please use `GITHUB_TOKEN`, so they do not trigger other workflows: the release PR has no CI run of its own, and the store release is called from `release-please.yml` instead of a tag-push trigger. `release.yml` runs the full test suite again on the tagged commit before packaging.
- The repository must allow GitHub Actions to create pull requests (Settings → Actions → General → Workflow permissions), and squash merges must use the PR title.
- Chrome does not accept uploads while a version is in review (`NOT_UPDATEABLE: You may not edit or publish an item that is in review`). For an item that has been published before, the API reports the pending review and the new upload cancels it and submits the new version instead (`--chrome-cancel-pending`). The **first** review of a new item is not reported by the API, so it cannot be cancelled automatically: the Chrome job fails with that message, and you retry Chrome for the same tag once the review is finished (see [retries](#credential-dry-runs-and-retries)), or cancel the review in the dashboard first. AMO queues versions without that restriction.
- To force a specific version, add a `Release-As: 1.0.0` footer to a commit on `main`.

## First listing

The store items must be created in the developer dashboards first; automated updates cannot replace the item, screenshots, privacy declarations or account settings.

```sh
pnpm install --frozen-lockfile
pnpm compile && pnpm lint && pnpm test
pnpm zip && pnpm zip:firefox
pnpm lint:firefox
```

- Chrome: [developer dashboard](https://chrome.google.com/webstore/devconsole). Upload `.output/translate-now-<version>-chrome.zip`, fill in the listing from `store/LISTING.md`, add screenshots and icons, complete the privacy practices and distribution settings, then submit for review.
- Firefox: [developer hub](https://addons.mozilla.org/developers/). Choose public distribution and upload `.output/translate-now-<version>-firefox.zip` together with `.output/translate-now-<version>-sources.zip`; build instructions for reviewers are in `docs/AMO_REVIEW.md` inside the sources ZIP. Keep the fixed manifest ID.
- Public privacy policy: `https://github.com/mechiland/translate-now/blob/main/PRIVACY.md`. Store declarations: page text, title and domain go to the translation provider the user configures, the user's API key authenticates those requests, and there is no developer server or telemetry.

## GitHub Actions secrets (one-time)

Add these under [repository secrets](https://github.com/mechiland/translate-now/settings/secrets/actions). Never commit secrets or paste them into chats.

| Secret                                | Source                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CHROME_EXTENSION_ID`                 | The 32-letter store item ID (not a local unpacked ID)                                       |
| `CHROME_PUBLISHER_ID`                 | Publisher ID from the Chrome developer dashboard                                            |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | `client_email` from the Google Cloud service account JSON                                   |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`  | `private_key` from the same JSON, with real line breaks                                     |
| `FIREFOX_JWT_ISSUER`                  | JWT issuer from [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/) |
| `FIREFOX_JWT_SECRET`                  | JWT secret from the same page                                                               |

Chrome uses **Web Store API v2**. Follow [Google's guide](https://developer.chrome.com/docs/webstore/service-accounts) to enable the API, create a service account, and link its email under Account in the Chrome developer dashboard. The service account needs no additional Google Cloud roles. Firefox uses manifest ID `translate-now@mechiland.github.io` and the `listed` (public) channel.

For local checks, `pnpm exec wxt submit init` writes a local `.env.submit`, which Git ignores. CI only uses GitHub secrets. The sources ZIP is built from an allowlist that excludes local configuration and credentials.

## Credential dry runs and retries

Actions → Release → Run workflow, then choose `both`, `chrome` or `firefox`:

- `dry_run: true` (default) only authenticates against the stores. Nothing is uploaded and no GitHub Release is touched. The tag can be left empty to check the selected branch.
- To retry a failed store, enter the **existing** version tag, pick that store, and turn off `dry_run`. Packages are always built from the tag, never from `main`.

The two stores run independently; one failing never cancels the other. Retry only the store that failed so a version that already went through is not uploaded again. Submissions for the same tag and store are serialized.

Local check (with credentials configured):

```sh
pnpm submit:chrome --dry-run
pnpm submit:firefox --dry-run
```

## References

- [release-please](https://github.com/googleapis/release-please) and [release-please-action](https://github.com/googleapis/release-please-action)
- [WXT publishing](https://wxt.dev/guide/essentials/publishing)
- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/api)
- [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [AMO source code requirements](https://extensionworkshop.com/documentation/publish/source-code-submission/)
