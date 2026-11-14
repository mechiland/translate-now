# 发布到 Chrome Web Store 和 Firefox AMO

## 首次上架

首次商店条目需要在开发者后台创建；自动更新不能代替条目、截图、隐私声明及账号设置。

```sh
pnpm install --frozen-lockfile
pnpm compile
pnpm lint
pnpm test
pnpm zip
pnpm zip:firefox
pnpm lint:firefox
```

- Chrome：[开发者后台](https://chrome.google.com/webstore/devconsole)。上传 `.output/translate-now-0.1.1-chrome.zip`，按 `store/LISTING.md` 填写条目，添加截图与图标，完成隐私声明及分发设置，然后提交审核。后续版本替换文件名中的版本号。
- Firefox：[开发者后台](https://addons.mozilla.org/developers/)。选择公开分发并上传 `.output/translate-now-0.1.1-firefox.zip`，同时上传 `.output/translate-now-0.1.1-sources.zip`；构建说明位于源码包的 `docs/AMO_REVIEW.md`。保留 manifest 中的固定 ID。
- 隐私政策公开链接：`https://github.com/mechiland/translate-now/blob/main/PRIVACY.md`。商店申报应说明：网页文本、标题、域名发送到用户配置的翻译服务，用户的 API Key 用于该服务的认证，无开发者服务器或遥测。

## 一次性配置 GitHub Actions Secrets

到 [仓库 Secrets](https://github.com/mechiland/translate-now/settings/secrets/actions) 添加以下项。不要把密钥写进代码或聊天。

| Secret | 来源 |
| --- | --- |
| `CHROME_EXTENSION_ID` | 创建条目后获得的 32 位商店 ID，不是本地开发安装 ID |
| `CHROME_PUBLISHER_ID` | Chrome 开发者后台中的发布者 ID |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | Google Cloud 服务账号 JSON 中的 `client_email` |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | 同一 JSON 中的 `private_key`，保留实际换行 |
| `FIREFOX_JWT_ISSUER` | [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/) 的 JWT issuer |
| `FIREFOX_JWT_SECRET` | 同页的 JWT secret |

Chrome 使用 **Web Store API v2**。按 [Google 官方说明](https://developer.chrome.com/docs/webstore/service-accounts) 启用 API、创建服务账号，并在 Chrome 开发者后台 Account 中关联该服务账号邮箱。该账号不需要额外的 Google Cloud 项目角色。Firefox 使用 manifest ID `translate-now@mechiland.github.io`，发布到 `listed` 公开频道。

本机如需验证，可以运行 `pnpm exec wxt submit init` 配置本地 `.env.submit`，它已被 Git 忽略。CI 只使用 GitHub Secrets。源码包采用文件白名单，排除本地配置和凭据。

## 每次自动发布

1. 更新 `package.json` 的版本号，补充 `CHANGELOG.md`，提交并推送代码。
2. 创建并推送同版本标签，例如：

   ```sh
   git tag -a v0.1.2 -m 'Release v0.1.2'
   git push origin main
   git push origin v0.1.2
   ```

3. [Release 工作流](https://github.com/mechiland/translate-now/actions/workflows/release.yml) 校验标签与版本一致，运行类型检查、ESLint、单元测试、发布逻辑测试、Chromium E2E 和 Firefox 商店验证，构建三个 ZIP。通过后上传 GitHub Release，并分别提交两个商店审核；通过商店审核后自动公开。

发布需要新版本号；不要为新代码复用已提交商店的版本。CI 提交成功不代表商店已审核通过。缺少凭据会明确报错，不会把跳过发布显示为成功。

## 凭据验证与失败重试

Actions → Release → Run workflow：填写**已存在的版本标签**，选择 `both`、`chrome` 或 `firefox`。默认 `dry_run: true` 只检查认证，不上传商店、不创建 GitHub Release。确认后关闭 dry-run 执行实际提交。

两个商店独立执行，一个失败不会取消另一个。单个商店失败时，通过手动工作流只重试失败的商店，避免重新上传已经成功的版本。所有提交使用该标签构建的包，不会从 main 偷换版本。每个版本发布串行执行，防止同版本并发上传。

本机检查（已配置凭据时）：

```sh
pnpm submit:chrome --dry-run
pnpm submit:firefox --dry-run
```

## 官方参考

- [WXT 发布说明](https://wxt.dev/guide/essentials/publishing)
- [Chrome 首次发布和 API 限制](https://developer.chrome.com/docs/webstore/api)
- [Firefox 数据传输许可](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [AMO 源码要求](https://extensionworkshop.com/documentation/publish/source-code-submission/)
