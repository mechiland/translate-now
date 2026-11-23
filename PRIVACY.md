# Translate Now privacy policy / 隐私政策

Effective date / 生效日期: 2026-11-23

Translate Now is an open-source, bring-your-own-key browser extension. It has no developer-operated translation server, account system, analytics, advertising, or telemetry.

## Information sent to your translation provider

When you translate a page or selection, the extension sends the text being translated, the page title (up to 200 characters), and the page domain directly to the API endpoint you configured. Your API key is sent to that endpoint in authentication headers. Custom style instructions and glossary entries are also included in translation requests. Testing a connection sends sample text; fetching models sends an authenticated request to the same configured provider.

Translation runs when you request it or enable automatic translation or an “always translate” site rule. Automatic translation may send text from supported pages as you browse. The extension does not send full browsing history, cookies, or passwords from page forms. Text you choose to translate can itself contain personal information; only translate content you intend to share with your chosen provider.

To translate a PDF, the extension downloads the PDF from its own address, with the same cookies the browser would send to that site, and reads it inside the extension. When the browser's own PDF viewer hides whether a tab shows a PDF, the popup may send a `HEAD` request to the tab's address to check. PDF text is sent to your provider like page text.

The extension developer does not receive these requests. The provider's own privacy policy, retention rules, and terms govern its handling of the data. You can configure a local provider such as Ollama to process requests locally.

## Local storage and deletion

Settings, provider profiles, API keys, site rules, custom prompts, and glossaries stay in `browser.storage.local` on your device. They are not synchronized by the extension. Translation results are cached locally in IndexedDB. You can clear the translation cache in settings. Removing the extension deletes its browser-managed local data. A settings export can include API keys; keep exported files private. Deleting local data does not delete data already retained by a provider.

## Permissions and third-party code

Website access lets the extension read page text, insert translations, and call user-configured API endpoints, including local endpoints. `storage` saves settings; `contextMenus` enables selection translation from the right-click menu; `activeTab` identifies the page the user operates on. All executable extension code is bundled in the extension. Translations are rendered as text, not executed as code.

## Contact

Questions or requests: [GitHub issues](https://github.com/mechiland/translate-now/issues). Do not post API keys or private page content in public issues.

## 中文说明

Translate Now 没有开发者运营的翻译服务器、账号、广告、统计或遥测。翻译时，待翻译文本、页面标题（最多 200 字符）、域名、自定义风格和术语表会直接发送到你配置的 API 地址，API Key 仅用于向该服务认证。“测试连接”发送示例文本，“获取模型列表”也会向该服务发送认证请求。开启自动翻译或“总是翻译”规则后，浏览相应页面时会自动发送翻译请求。

翻译 PDF 时，扩展会从 PDF 的原地址下载文件（携带浏览器访问该网站时同样的 Cookie），在扩展内解析；当浏览器自带的 PDF 阅读器无法确认标签页是否为 PDF 时，弹出窗口可能向该地址发送一次 `HEAD` 请求。PDF 中的文字和网页文字一样发送给你配置的服务商。

开发者不会收到这些数据。服务商如何保存和处理请求取决于其隐私政策；你也可以使用本地 Ollama。扩展不会发送完整浏览历史、Cookie 或页面表单中的密码，但你主动选择的文本可能包含个人信息。设置和 API Key 仅保存在本机，译文缓存在本机 IndexedDB。可在设置中清除缓存；卸载扩展会删除其浏览器本地数据。导出的设置可能包含 API Key，请妥善保管。清除本机数据不会删除服务商已保存的数据。
