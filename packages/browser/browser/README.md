# @pentest-harness/dsh-browser

English | [中文](README.zh.md)

One shared browser for the agent and the user. The default-exported `BrowserRuntime` service registers `ctx.browser`, whose `shared` member is a persistent Chromium session driven through Playwright. By default it is the harness's own Chromium build (Playwright's pinned Chromium, about 180 MB), downloaded into Playwright's browser cache the first time the browser starts, so it does not depend on an installed browser. The browser launches on first use, not at startup, and keeps its profile on disk, so sign-ins and cookies survive restarts.

The agent drives it through [`dsh-tool-browser`](../tool-browser/README.md). When `ctx.webServer` is mounted, the service also serves a live view:

- `GET /browser/view` returns a self-contained page with a tab strip, an address bar and a canvas.
- `WS /browser/ws` streams the active tab as JPEG frames (a CDP screencast, sent only while a viewer is connected) plus the tab list. It accepts pointer, wheel, keyboard, paste, navigation, tab and viewport-size messages, so the user can take over at any point.

The Web client's [`dsh-client-ui-browser`](../../client/ui-browser/README.md) pane frames this page. Both routes accept only loopback `Host` values, refuse `Sec-Fetch-Site: cross-site`, and require any `Origin` to match the host, so another site (or a DNS-rebound page) cannot drive the signed-in browser.

Address-bar and `browser_navigate` input resolve like a browser omnibox: URLs, bare hosts, IP addresses and `host:port` open directly, and any other text is searched (`searchUrl`, DuckDuckGo by default; Google answers this automated browser with an "unusual traffic" challenge). When a page opens a file picker, the live view asks the user for the file and hands it to the page, so uploads work.

The live view's ⋮ menu imports saved passwords from password-export CSV files (Chrome, Brave, Edge, Firefox and most password managers can export one); several files can be chosen at once. Rows are encrypted with this browser's own storage key and written to its password store while it is briefly closed, as Chromium stores a saved password; existing entries for the same site and username are kept. Other browsers' encrypted stores are never read: modern Chrome, Brave and Edge protect them with app-bound encryption. Import is a live-view action only; no tool exposes it to the model.

Per tab, the session keeps the last 300 console lines (including uncaught errors and dialogs) and the last 400 network requests. Native dialogs are handled automatically: alerts are accepted, and confirm, prompt and beforeunload dialogs are dismissed. Both outcomes are logged to the console buffer.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `channel` | `chromium` | `chromium` is the harness's own build, downloaded on first use; `msedge` or `chrome` use an installed browser. |
| `executablePath` | none | Explicit browser executable; overrides `channel`. |
| `headless` | `true` | Run without a native window. The live view still shows the page. |
| `profileDir` | `~/.dsh/browser/profile` | Persistent profile directory. |
| `width` / `height` | `1280` / `800` | Initial viewport in CSS pixels. The live view resizes it to fit its pane. |
| `liveView` | `true` | Serve `/browser/view` and `/browser/ws` when a web server is mounted. |
| `searchUrl` | `https://duckduckgo.com/?q=%s` | Search for address-bar text that is not an address; `%s` is the encoded query. |

## Model Experience

Indirectly, through `dsh-tool-browser`, whose tools read and act on this session; this package registers no prompt section or tool schema.

#### KV Cache effect

None directly; tool results that report this browser's pages are appended by `dsh-tool-browser`.

## Known Limitations and Deferred Work

- **One shared session** — every agent and viewer acts on the same tabs, so concurrent agents can interfere with each other's page state.
- **Live-view input is coarse** — mouse moves are throttled to 25 per second, and IME composition and file drag-and-drop are not forwarded.
- **No download handling** — downloads are left to Playwright defaults.
- **Password import is Windows-only and CSV-based** — it unlocks this browser's own key with Windows DPAPI, and it cannot read other browsers' stores directly, so the user exports from each browser first. Cookies and sign-ins are not imported; sign in once in the pane and the profile keeps them.
