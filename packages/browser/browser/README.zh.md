# @pentest-harness/dsh-browser

[English](README.md) | 中文

供智能体和用户共用的一个浏览器。默认导出的 `BrowserRuntime` 服务注册 `ctx.browser`，其 `shared` 成员是一个通过 Playwright 驱动的持久化 Chromium 系会话（默认 Microsoft Edge）。浏览器在首次使用时启动，而不是随启动加载；配置文件保存在磁盘上，登录状态和 Cookie 在重启后仍然保留。

智能体通过 [`dsh-tool-browser`](../tool-browser/README.zh.md) 驱动它。挂载了 `ctx.webServer` 时，该服务还提供实时视图：

- `GET /browser/view` 返回一个自包含页面，含标签栏、地址栏和画布。
- `WS /browser/ws` 以 JPEG 帧推送当前标签页（CDP screencast，仅在有查看者连接时发送）以及标签列表。它接收指针、滚轮、键盘、粘贴、导航、标签和视口尺寸消息，用户可以随时接管。

Web 客户端的 [`dsh-client-ui-browser`](../../client/ui-browser/README.zh.md) 面板嵌入这个页面。两个路由只接受回环地址的 `Host`，拒绝 `Sec-Fetch-Site: cross-site`，并要求任何 `Origin` 与 Host 一致，因此其他网站（或经 DNS 重绑定的页面）无法操控已登录的浏览器。

会话为每个标签页保留最近 300 条控制台消息（包括未捕获错误和对话框）和最近 400 个网络请求。原生对话框会被自动处理：alert 被确认，confirm、prompt 和 beforeunload 被取消；两种结果都记入控制台缓冲。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `channel` | `msedge` | 已安装浏览器的 Playwright 渠道（`msedge`、`chrome`、`chromium`）。 |
| `executablePath` | 无 | 显式指定浏览器可执行文件；优先于 `channel`。 |
| `headless` | `true` | 不显示原生窗口运行，实时视图仍会显示页面。 |
| `profileDir` | `~/.dsh/browser/profile` | 持久化配置目录。 |
| `width` / `height` | `1280` / `800` | 初始视口（CSS 像素）。实时视图会调整它以适配面板。 |
| `liveView` | `true` | 挂载 Web 服务器时提供 `/browser/view` 和 `/browser/ws`。 |

## 模型体验

本包通过 `dsh-tool-browser` 间接影响模型：那些工具读取并操作这个会话；本包不注册任何提示词段落或工具 schema。

#### KV Cache 影响

无直接影响；报告该浏览器页面的工具结果由 `dsh-tool-browser` 追加。

## 已知限制与暂缓事项

- **单一共享会话** —— 所有智能体和查看者操作同一组标签页，并发的智能体可能互相干扰页面状态。
- **实时视图输入较粗糙** —— 鼠标移动限制为每秒 25 次，不转发输入法组合输入和文件拖放。
- **不处理下载和文件上传** —— 下载和文件选择器沿用 Playwright 默认行为。
