# @pentest-harness/dsh-web-search-duckduckgo

[English](README.md) | 中文

`ctx.web` 接缝的免密钥搜索提供方。它把查询提交到 DuckDuckGo 的无 JavaScript 结果页（`https://html.duckduckgo.com/html/`），返回每条自然结果的 URL、标题和摘要。不需要账号、API Key 或付费，`web_search` 开箱即用。

- 跳过赞助结果和重复 URL。
- 把 DuckDuckGo 的 `/l/?uddg=` 跳转链接还原为真实目标地址。
- 不生成答案（省略 `content`），由模型阅读来源。
- 如果 DuckDuckGo 对客户端限流（HTTP 202 或验证页面），搜索以 `WEB_PROVIDER_ERROR` 失败，并提示稍后重试。

基础 bundle 在 `web` 行上用 `searchProvider: duckduckgo` 选中它。Acme 提供方仍然注册；如有 Acme 密钥，把 `searchProvider` 改回 `acme-official` 即可使用。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `baseURL` | `https://html.duckduckgo.com/html/` | 提交查询的结果页地址。 |
| `region` | 无 | 以 `kl` 发送的地区代码，例如 `us-en` 或 `in-en`。 |
