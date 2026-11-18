# @pentest-harness/dsh-browser

English | [中文](README.zh.md)

One shared browser for the agent and the user. The default-exported `BrowserRuntime` service registers `ctx.browser`, whose `shared` member is a persistent Chromium-family session (Microsoft Edge by default) driven through Playwright. The browser launches on first use, not at startup, and keeps its profile on disk, so sign-ins and cookies survive restarts.

The agent drives it through [`dsh-tool-browser`](../tool-browser/README.md). When `ctx.webServer` is mounted, the service also serves a live view:

- `GET /browser/view` returns a self-contained page with a tab strip, an address bar and a canvas.
- `WS /browser/ws` streams the active tab as JPEG frames (a CDP screencast, sent only while a viewer is connected) plus the tab list. It accepts pointer, wheel, keyboard, paste, navigation, tab and viewport-size messages, so the user can take over at any point.

The Web client's [`dsh-client-ui-browser`](../../client/ui-browser/README.md) pane frames this page. Both routes accept only loopback `Host` values, refuse `Sec-Fetch-Site: cross-site`, and require any `Origin` to match the host, so another site (or a DNS-rebound page) cannot drive the signed-in browser.

Per tab, the session keeps the last 300 console lines (including uncaught errors and dialogs) and the last 400 network requests. Native dialogs are handled automatically: alerts are accepted, and confirm, prompt and beforeunload dialogs are dismissed. Both outcomes are logged to the console buffer.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `channel` | `msedge` | Playwright channel of an installed browser (`msedge`, `chrome`, `chromium`). |
| `executablePath` | none | Explicit browser executable; overrides `channel`. |
| `headless` | `true` | Run without a native window. The live view still shows the page. |
| `profileDir` | `~/.dsh/browser/profile` | Persistent profile directory. |
| `width` / `height` | `1280` / `800` | Initial viewport in CSS pixels. The live view resizes it to fit its pane. |
| `liveView` | `true` | Serve `/browser/view` and `/browser/ws` when a web server is mounted. |

## Model Experience

Indirectly, through `dsh-tool-browser`, whose tools read and act on this session; this package registers no prompt section or tool schema.

#### KV Cache effect

None directly; tool results that report this browser's pages are appended by `dsh-tool-browser`.

## Known Limitations and Deferred Work

- **One shared session** — every agent and viewer acts on the same tabs, so concurrent agents can interfere with each other's page state.
- **Live-view input is coarse** — mouse moves are throttled to 25 per second, and IME composition and file drag-and-drop are not forwarded.
- **No download or file-upload handling** — downloads and file pickers are left to Playwright defaults.
