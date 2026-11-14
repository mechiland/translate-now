# 任务：从零构建浏览器翻译扩展「Translate Now」

你在一个几乎为空的 git 仓库里工作（只有空的 `.gitignore`）。请**自主**完成下面的扩展，中途不要停下来问我问题。遇到需要决策的地方，选最合理的默认方案，并把决策和理由记录在 `docs/DECISIONS.md`，然后继续。

## 1. 产品目标

一个“自带 LLM key”的网页沉浸式翻译扩展：用户填入自己的 API key，扩展把网页按段落翻译，并把译文插在原文下方（双语对照），或只显示译文。另外支持划词翻译、翻译风格、按站点规则自动翻译/不翻译。

不收费、无账号、无后端服务器、无遥测。所有请求从用户浏览器直接发到用户配置的 LLM provider。

## 2. 功能范围（MVP，必须完成）

### 2.1 LLM Provider

- 统一抽象 `Provider` 接口，实现两种协议即可覆盖绝大多数服务：
  - **OpenAI 兼容**（`POST {baseURL}/chat/completions`）
  - **Anthropic 原生**（`POST https://api.anthropic.com/v1/messages`，需带 `x-api-key`、`anthropic-version: 2023-06-01`、`anthropic-dangerous-direct-browser-access: true`）
- 内置预设（用户只需填 key，可改 baseURL 和 model）：

  | 预设                       | 协议      | 默认 baseURL                                                                                                                        |
  | -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | OpenAI                     | openai    | `https://api.openai.com/v1`                                                                                                         |
  | OpenRouter                 | openai    | `https://openrouter.ai/api/v1`（附 `HTTP-Referer` 与 `X-Title` 头）                                                                 |
  | DeepSeek                   | openai    | `https://api.deepseek.com/v1`                                                                                                       |
  | 通义千问 Qwen（DashScope） | openai    | `https://dashscope.aliyuncs.com/compatible-mode/v1`（国际站 `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` 作为备选说明） |
  | Google Gemini              | openai    | `https://generativelanguage.googleapis.com/v1beta/openai`                                                                           |
  | Anthropic Claude           | anthropic | `https://api.anthropic.com/v1`                                                                                                      |
  | Ollama（本地）             | openai    | `http://localhost:11434/v1`，无需 key；在 UI 中提示需设置 `OLLAMA_ORIGINS`                                                          |
  | 自定义 OpenAI 兼容         | openai    | 用户填写                                                                                                                            |

- 用户可以配置多个 provider profile，并选择一个为当前使用。
- model 字段是自由文本 + “获取模型列表”按钮（调用 `GET {baseURL}/models`，失败则静默降级为手填）。不要硬编码会过期的模型名，只给 placeholder 示例。
- “测试连接”按钮：发一个极短的翻译请求，显示成功/错误信息（401、429、网络错误要给出可读提示）。
- 可配置：temperature、每批最大字符数、最大并发数。

### 2.2 网页翻译

- 触发方式：popup 按钮、快捷键（默认 `Alt+A`，通过 `commands` 配置）、右键菜单、站点规则自动触发。再次触发 = 切换显示原文。
- 段落识别：遍历 DOM，找“块级文本容器”（p、li、h1-h6、td、blockquote、dd、figcaption，以及只含内联子元素且有足够文本的 div 等）。跳过：`pre`、`code`、`script`、`style`、`textarea`、`input`、`[contenteditable]`、`svg`、`math`、`[translate="no"]`、`.notranslate`、纯数字/纯符号/已是目标语言的文本、扩展自己注入的节点。
- 只翻译视口附近的段落（IntersectionObserver，带 rootMargin 预取），滚动时增量翻译。
- 用 MutationObserver 处理 SPA / 无限滚动新增内容（debounce）。
- 显示模式（popup 中可即时切换，无需重新请求）：
  - **双语对照**：译文作为原段落的后继节点（或段内追加的块元素）插入，样式可选：无装饰 / 虚线下划线 / 浅色背景 / 左边框 / 弱化颜色。
  - **仅译文**：隐藏原文，只显示译文。
  - 实现方式建议：给 `<html>` 加 class 控制 CSS，而不是重新渲染。
- MVP 中译文是纯文本；保留内联链接/加粗属于加分项（见 §6）。
- 加载中显示小的 loading 指示；单段失败显示可点击重试的错误标记，不影响其他段。

### 2.3 批量请求与 Prompt

- 把多个段落合并成一个请求（按字符上限分批），用编号标签包裹：
  ```
  <seg id="1">...</seg>
  <seg id="2">...</seg>
  ```
  要求模型按同样格式返回。解析时按 id 对齐；若数量不匹配或解析失败，将该批拆成单段重试。
- System prompt 由模板生成，包含：目标语言、翻译风格指令、页面标题/域名作为上下文、“只输出译文、保持标签结构、不要解释”。
- 结果缓存：IndexedDB，key = hash(原文 + 目标语言 + provider + model + 风格)，带 LRU/容量上限；设置页可一键清除。
- 并发控制 + 429 时指数退避重试。
- 所有 LLM 请求在 **background service worker** 中发出（规避 CORS，key 不暴露给页面上下文），content script 通过消息通信。用 `AbortController` 支持页面切换/关闭翻译时取消请求。

### 2.4 划词翻译

- 选中文本后，在选区附近出现一个小图标按钮；点击后弹出浮动卡片显示译文（不要选中即自动请求，避免浪费 token；但在设置里提供“选中即翻译”开关）。
- 也支持：右键菜单“翻译选中文本”、快捷键。
- 卡片功能：复制译文、切换目标语言、关闭、对单个词显示简短释义（让 prompt 在输入很短时给出词性/释义）。
- 所有注入的 UI 用 WXT 的 `createShadowRootUi` 放在 Shadow DOM 里，避免与页面样式互相污染。
- 可在设置里全局关闭，或按站点关闭。

### 2.5 输出语言

- 目标语言下拉框（至少：简体中文、繁體中文、English、日本語、한국어、Français、Deutsch、Español、Русский、Português 等），默认取浏览器 UI 语言。
- “不翻译以下语言”列表：检测段落语言（`browser.i18n.detectLanguage` 或简单启发式），与目标语言相同或在该列表中的段落跳过。

### 2.6 翻译风格

- 内置预设：标准、口语化、正式/商务、学术、技术文档（保留术语/代码标识符原文）、小说/文学、新闻。
- 自定义风格：用户填写名称 + 额外 prompt 指令，可新增多个。
- 可选术语表（glossary）：`原词 → 译法` 列表，注入 prompt。（若时间紧可放到 §6）

### 2.7 站点规则

- 每个 hostname 可设置：
  - 翻译行为：**总是自动翻译** / **从不翻译** / **默认（手动）**
  - 覆盖：翻译风格、显示模式、是否启用划词翻译
- popup 中提供当前站点的快捷开关（“总是翻译此站点”、“从不翻译此站点”）。
- 设置页中可查看/编辑/删除所有规则；支持通配子域名（如 `*.example.com`）。
- 全局选项：“当页面语言不是目标语言时自动翻译”（默认关）。

### 2.8 设置与存储

- 用 WXT 的 `storage.defineItem`（带 version 与迁移）定义类型化设置。
- **API key 只存在 `storage.local`**（不进入 sync）；其他非敏感设置可存 `storage.sync`。设置页里明确提示 key 存在本地。
- 支持导出/导入设置 JSON（导出时默认不含 key，可勾选包含）。

### 2.9 UI

- **Popup**：开关当前页翻译、显示模式切换、目标语言、当前风格、当前站点规则快捷开关、当前 provider/model 显示、打开设置。
- **Options 页面**：Provider 管理、翻译（语言/风格/术语表）、显示样式（带实时预览）、划词翻译、站点规则、快捷键说明（链接到浏览器的快捷键设置页）、缓存、导入导出、关于。
- 界面支持中文和英文（WXT i18n），默认跟随浏览器语言。
- 支持深色模式（prefers-color-scheme）。

## 3. 技术栈与约束

- **WXT**（最新稳定版）+ **TypeScript**（strict）+ **pnpm**。
- Popup / Options 用 **React**；content script 尽量轻（原生 DOM，不在页面里挂 React，除了 shadow root 里的划词卡片可以用 React 或原生）。
- 样式：普通 CSS / CSS Modules 即可，shadow DOM 内样式通过 WXT 的 `cssInjectionMode: 'ui'`。
- 目标浏览器：**Chrome、Edge（MV3）**、**Firefox（WXT 默认构建，需设置 `browser_specific_settings.gecko.id`）**。Safari 不在本次范围，但代码不要使用阻碍将来移植的 Chrome 专有 API（统一用 WXT 的 `browser`）。
- 权限尽量少：`storage`、`contextMenus`、`activeTab`、`scripting`（如需要），`host_permissions: ["<all_urls>"]`（自动翻译与任意 baseURL 需要）。在 `docs/DECISIONS.md` 说明每个权限的用途。
- 不引入任何遥测、远程代码加载、`eval`。
- 不使用任何第三方商标/品牌素材；图标自己用简单 SVG 生成。

## 4. 代码结构建议

```
entrypoints/
  background.ts            # 消息路由、LLM 调用、缓存、限流、右键菜单、快捷键
  content/index.ts         # 页面翻译 + 划词翻译入口
  popup/                   # React
  options/                 # React
lib/
  providers/               # openai.ts, anthropic.ts, presets.ts, types.ts
  translate/               # batching.ts, prompt.ts, parse.ts, cache.ts, queue.ts
  dom/                     # segmenter.ts, inject.ts, observer.ts
  settings/                # schema.ts, storage.ts, siteRules.ts
  messaging.ts             # 类型化消息协议
  i18n/
tests/
  unit/                    # vitest
  e2e/                     # Playwright + mock LLM server + fixture 页面
```

纯逻辑（分段、批处理、prompt 生成、响应解析、站点规则匹配、缓存 key）必须与 DOM/浏览器 API 解耦，以便单测。

## 5. 里程碑（按顺序做，每个完成后提交一次 commit）

1. **脚手架**：WXT + React + TS + pnpm + vitest + ESLint/Prettier；`pnpm build` 和 `pnpm build:firefox` 均能产出可加载的扩展。
2. **设置与 Provider**：设置 schema/存储、provider 抽象与两个协议实现、Options 页的 Provider 管理 + 测试连接 + 获取模型列表。
3. **翻译核心**：prompt 模板、批处理、`<seg>` 解析与降级、缓存、并发队列、重试、取消。全部有单测。
4. **网页翻译**：分段、视口懒翻译、注入、双语/仅译文切换、显示样式、MutationObserver、快捷键、右键菜单、popup 开关。
5. **划词翻译**：浮动按钮 + Shadow DOM 卡片 + 右键菜单。
6. **风格与站点规则**：风格预设/自定义、术语表、站点规则 CRUD、自动翻译逻辑、popup 快捷开关。
7. **打磨**：i18n（中/英）、深色模式、错误提示、导入导出、图标、README。
8. **E2E 验证**：见 §7。

## 6. 加分项（MVP 全部完成且验证通过后再做；做不完就列在 README 的 Roadmap）

- 保留内联格式：把 `<a>`、`<b>`、`<code>` 等替换为占位标签（如 `<x1>…</x1>`）让模型保留，再还原。
- 流式输出（SSE）用于划词卡片。
- 悬停 + 修饰键翻译单个段落。
- 输入框翻译（在输入框里输入中文，快捷键替换为目标语言）。
- 针对常见站点（Twitter/X、Reddit、GitHub、YouTube 评论、Hacker News）的选择器适配规则。
- 免 key 的机器翻译后备（明确标注为可选，并说明其非官方性质）。

## 7. 验证要求（Definition of Done）

在宣布完成前，以下全部必须通过，且你要实际运行过：

1. `pnpm install && pnpm compile`（tsc --noEmit）无错误。
2. `pnpm lint` 无错误。
3. `pnpm test`：单测覆盖分段规则、批处理切分、prompt 生成、`<seg>` 解析（含模型返回缺段/多段/乱序/带多余文字的情况）、站点规则匹配（含通配子域名）、缓存 key、provider 请求体/响应解析（mock fetch）、错误映射（401/429/5xx/网络错误）。
4. `pnpm build` 与 `pnpm build:firefox` 成功，产物的 manifest 合法。
5. **E2E（Playwright, Chromium 加载 unpacked 扩展）**：
   - 启动一个本地 mock 的 OpenAI 兼容服务器（返回确定性的“译文”，例如在每段前加 `[ZH]`，并正确回显 `<seg>` 结构），把扩展配置指向它。
   - 用本地 fixture HTML 页面（包含段落、列表、标题、代码块、`.notranslate`、动态插入的内容）验证：
     - 触发翻译后段落下方出现译文；代码块和 `.notranslate` 未被翻译；
     - 切换“仅译文”模式后原文被隐藏；再次触发后恢复原文；
     - 动态插入的段落也被翻译；
     - 选中文本 → 点击浮动按钮 → 卡片显示译文；
     - 站点规则设为“总是翻译”后，重新加载页面自动翻译；设为“从不翻译”则不翻译；
     - mock 服务器返回 429 时会重试，返回 401 时页面显示错误提示。
   - 截图保存在 `tests/e2e/screenshots/`（加入 .gitignore）供人工查看。
6. README（中文为主，附英文简介）：功能、安装（各浏览器加载 unpacked / 打包方法）、各 provider 配置示例、隐私说明、已知限制、Roadmap。

若某一项确实无法在当前环境完成（例如无法下载 Playwright 浏览器），在 `docs/DECISIONS.md` 和最终总结中如实说明原因和你做了什么替代验证，不要声称通过。

## 8. 工作方式

- 在当前分支上工作，每个里程碑一个清晰的 commit；不要 push。
- 先读 WXT 官方文档确认当前版本的 API（entrypoint 定义、storage、`createShadowRootUi`、`commands`、Firefox 构建配置），不要凭记忆写过时 API。
- 不要过度工程：不需要状态管理库、不需要 monorepo。
- 最终输出一份总结：完成了什么、如何加载试用、哪些验证通过、已知问题、建议的下一步。
