# Translate Now

[English](README.md) | 简体中文

**自带 API Key 的网页双语翻译扩展**，支持 Chrome、Edge 和 Firefox。免费、开源、无账号、无服务器、无遥测。

用你自己的 LLM API Key（OpenAI、OpenRouter、DeepSeek、通义千问、Gemini、Claude、Ollama 或任意 OpenAI 兼容服务）把网页逐段翻译，译文显示在原文下方，或只显示译文。

## 功能

- **网页翻译**：按段落识别正文，译文插在原文下方（双语对照），或只显示译文；可随时切换，不需要重新请求。
  - 只翻译当前屏幕附近的内容，滚动时继续翻译，节省 Token。
  - 自动处理动态加载的内容（SPA、无限滚动）。
  - 跳过代码块、输入框、导航/菜单、`notranslate`、已经是目标语言的段落。
  - 短文本（按钮、标签、标题）的译文直接跟在原文后面，尽量不破坏页面布局。
  - 多段合并成一个请求；结果缓存在本地 IndexedDB，同样的内容不会重复请求。
- **划词翻译**：选中文字后出现翻译按钮，点击后弹出译文卡片（可复制、切换目标语言、拖动）；单词或短语会给出词典式释义。也可以用右键菜单或快捷键触发。
- **悬停翻译**：鼠标停在某个段落上，单独轻按一下 `Ctrl` 即可只翻译这一段，再按一次取消。可在设置“划词与悬停”中改为 `Alt` / `Shift` 或关闭。
- **翻译服务**：内置 OpenAI、OpenRouter、DeepSeek、通义千问（DashScope）、Google Gemini、Anthropic Claude、Ollama 预设，以及任意 OpenAI 兼容接口；可以保存多个配置随时切换。支持“测试连接”和“获取模型列表”。
- **翻译风格**：标准、口语化、正式、学术、技术文档、文学、新闻，以及自定义风格（自己写提示词）；支持术语表。
- **站点规则**：按网站设置“总是翻译 / 从不翻译 / 手动”，还可以单独设置风格、显示方式和划词翻译开关。可选“自动翻译外语网页”。
- **其他**：中/英文界面、深色模式、导入/导出设置、6 种译文样式。

## 商店安装

- [Chrome Web Store](https://chromewebstore.google.com/detail/hkahabmfamcffhaficngecicoagnaknj)（Edge、Brave、Arc 等 Chromium 浏览器也可直接安装）
- [Firefox 附加组件（AMO）](https://addons.mozilla.org/firefox/addon/translate-now-ai/)：需要 Firefox 140+

商店版本会自动更新。新版本需要通过商店审核后才会上架，审核期间可先使用下方 GitHub Releases 安装方式。

## 安装（从 GitHub Releases）

到 [Releases](https://github.com/mechiland/translate-now/releases) 下载最新版本。

### Chrome / Edge / Brave / Arc 等 Chromium 浏览器

1. 下载 `translate-now-<版本>-chrome.zip` 并**解压**到一个固定的文件夹（之后不要删除这个文件夹）。
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），打开右上角的 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择刚才解压出的文件夹（里面直接就是 `manifest.json`）。
4. 点击工具栏上的扩展图标 → 齿轮按钮 → 填写 API Key 和模型 → **保存** → **测试连接**。

更新时：解压新版本覆盖原文件夹，然后在扩展页面点击刷新按钮。

### Firefox

未签名的扩展在正式版 Firefox 中只能临时加载：

1. 下载 `translate-now-<版本>-firefox.zip`（不用解压）。
2. 打开 `about:debugging#/runtime/this-firefox` → **临时载入附加组件** → 选择这个 zip。
3. 临时加载的扩展在 Firefox 重启后会被移除，长期使用请安装 AMO 商店版本。

## 配置示例

| 服务       | Base URL                                                                                                                | 模型示例                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| OpenAI     | `https://api.openai.com/v1`                                                                                             | `gpt-4.1-mini`                                  |
| OpenRouter | `https://openrouter.ai/api/v1`                                                                                          | `openai/gpt-4.1-mini`、`deepseek/deepseek-chat` |
| DeepSeek   | `https://api.deepseek.com/v1`                                                                                           | `deepseek-chat`                                 |
| 通义千问   | `https://dashscope.aliyuncs.com/compatible-mode/v1`（国际站：`https://dashscope-intl.aliyuncs.com/compatible-mode/v1`） | `qwen-plus`、`qwen-turbo`                       |
| Gemini     | `https://generativelanguage.googleapis.com/v1beta/openai`                                                               | `gemini-2.5-flash`                              |
| Claude     | `https://api.anthropic.com/v1`                                                                                          | `claude-haiku-4-5`                              |
| Ollama     | `http://localhost:11434/v1`                                                                                             | `qwen3:8b`                                      |

建议：

- 网页翻译量大，优先选**便宜且快**的非推理模型（如 `deepseek-chat`、`qwen-plus`/`qwen-turbo`、`gpt-4.1-mini`、`gemini-2.5-flash`）。推理模型（`deepseek-reasoner`、o 系列等）明显更慢、更贵。
- 模型名称以服务商文档为准；可以点击“获取模型列表”查看可用模型。
- 遇到 429（请求太频繁）时扩展会自动重试；如果频繁出现，可以在“翻译服务 → 请求设置”里调低并发数。
- Ollama 返回 403 时，设置 `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"` 后重启 Ollama。

关于 “Codex”：ChatGPT 订阅（Plus/Pro）的额度没有开放给第三方扩展的官方接口。请使用 OpenAI API Key（platform.openai.com），或通过 OpenRouter 使用 OpenAI 模型。

## 快捷键

| 功能                | 默认        |
| ------------------- | ----------- |
| 翻译页面 / 显示原文 | `Alt+A`     |
| 翻译选中文本        | `Alt+S`     |
| 翻译鼠标下的段落    | 轻按 `Ctrl` |

可以在 `chrome://extensions/shortcuts`（Firefox：`about:addons` → 齿轮 → 管理扩展快捷键）中修改。

## 隐私

- 只有你要翻译的文本（以及页面标题和域名，作为翻译上下文）会直接发送给**你配置的**服务商。
- 设置和 API Key 只保存在本机浏览器（`storage.local`），不会同步，不会发送到其他地方。
- 没有统计、遥测或远程代码。

完整隐私说明见 [PRIVACY.md](PRIVACY.md)。

## 已知限制

- 不支持 PDF（浏览器内置 PDF 阅读器）、视频字幕、浏览器内部页面和扩展商店页面。
- 只翻译页面顶层框架（iframe 内的内容暂不翻译）。
- 译文为纯文本，原文中的链接、加粗等格式不会保留在译文中。
- “仅译文”模式下，含有图片/按钮等非文本元素的段落会同时显示原文和译文（为避免隐藏页面元素）。
- 安装或更新扩展前已打开的页面需要刷新一次。

## Roadmap

- [ ] 译文保留链接、加粗等内联格式
- [ ] 划词翻译流式输出
- [x] 鼠标悬停 + 修饰键翻译单个段落
- [ ] 输入框翻译
- [ ] iframe 支持
- [ ] 常见网站（X/Twitter、Reddit、YouTube 评论）适配规则
- [x] 提交 Chrome Web Store / Firefox AMO 审核并配置自动发布
- [ ] 发布到 Edge Add-ons

## 开发

需要 Node.js 26+（见 `.node-version`）和 pnpm 12.18.0（已在 `package.json` 中固定，执行 `corepack enable` 即可自动使用）。

```bash
pnpm install
pnpm dev              # Chrome 开发模式（自动打开浏览器并热重载）
pnpm dev:firefox      # Firefox 开发模式
pnpm build            # 构建 Chrome/Edge 版本 → .output/chrome-mv3
pnpm build:firefox    # 构建 Firefox 版本 → .output/firefox-mv2
pnpm zip:all          # 打包 zip → .output/*.zip
pnpm compile          # TypeScript 类型检查
pnpm lint
pnpm test             # 单元测试 (Vitest) 与发布脚本测试
pnpm test:e2e         # 端到端测试 (Playwright + 本地模拟 LLM 服务器)
REAL_SITES=1 pnpm exec playwright test realsites   # 在真实网站上冒烟测试（需联网，不需要 API Key）
```

首次运行 E2E 前执行 `pnpm exec playwright install chromium`。

### 提交与发布

版本发布由 [release-please](https://github.com/googleapis/release-please) 自动完成：

1. PR 使用 squash 合并，**PR 标题就是最终的提交信息**，必须符合 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)（CI 会检查），例如 `feat: translate a paragraph on hover`。本仓库以英文为准：提交信息、PR、发布说明和文档都使用英文；中文只是补充（本文件、中文界面和商店中文描述）。
2. 每次合并到 `main` 后，release-please 会更新一个发布 PR，其中包含版本号升级和 `CHANGELOG.md` 更新。
3. 合并发布 PR 后会自动打标签、创建 GitHub Release 并上传安装包，同时提交 Chrome Web Store 和 Firefox AMO 审核，审核通过后自动上架。

所需 Secrets、凭据 dry-run 和单商店重试见 [发布指南](docs/PUBLISHING.md)（英文）。

技术栈：[WXT](https://wxt.dev)、TypeScript、React（仅 popup 与设置页）、Vitest、Playwright。设计决策见 [docs/DECISIONS.md](docs/DECISIONS.md)。

## License

MIT
