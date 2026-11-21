/**
 * `@fathom/browser`: one shared browser for the agent and the
 * user. Provides `ctx.browser`, a persistent Chromium session (the harness's
 * own Chromium build by default, downloaded on first use) driven through Playwright. When the web server is mounted it
 * also serves a live view at `/browser/view` (WebSocket `/browser/ws`) that
 * streams the active tab and forwards the user's pointer and keyboard input,
 * so the user can watch the agent and take over.
 * @module @fathom/browser
 */

import type { IncomingMessage } from 'node:http'
import { Context, Service } from '@fathom/cordis'
import z from '@fathom/schemastery'
import type {} from '@fathom/host-webserver'
import { fathomHomePath } from '@fathom/home-paths'
import { WebSocketServer } from 'ws'
import { BUNDLED_CHANNEL, DEFAULT_SEARCH_FALLBACK_URLS, DEFAULT_SEARCH_URL, SharedBrowser } from './runtime.ts'
import { VIEWER_PAGE } from './viewer-page.ts'

export {
  BUNDLED_CHANNEL,
  DEFAULT_SEARCH_FALLBACK_URLS,
  DEFAULT_SEARCH_URL,
  SharedBrowser,
  isChallengePage,
  normalizeUrl,
  resolveAddress,
  searchQuery,
  toPlaywrightChord,
  withoutAiOverview,
} from './runtime.ts'
export type { BrowserLaunchOptions, BrowserScope, BrowserTab, BrowserTarget, BrowserViewer, ConsoleEntry, MouseButton, NetworkEntry, ViewerFile } from './runtime.ts'

declare module '@fathom/cordis' {
  interface Context {
    browser: BrowserRuntime
  }
}

/** Path of the live-view page. */
export const BROWSER_VIEW_PATH = '/browser/view'
/** Path of the live-view WebSocket. */
export const BROWSER_SOCKET_PATH = '/browser/ws'

/** Plugin config. */
export interface BrowserRuntimeConfig {
  /**
   * Browser build: `chromium` (default) is the harness's own Chromium, downloaded
   * once on first use; `msedge` or `chrome` use an installed browser instead.
   */
  channel?: string
  /** Explicit browser executable; overrides `channel`. */
  executablePath?: string
  /** Run without a native window (default). The live view still shows the page. */
  headless?: boolean
  /** Persistent profile directory. Defaults to `~/.fathom/browser/profile`. */
  profileDir?: string
  /** Initial viewport width (CSS px). The live view resizes it to fit its pane. */
  width?: number
  /** Initial viewport height (CSS px). */
  height?: number
  /** Serve the live view on the web server when one is mounted. Defaults to true. */
  liveView?: boolean
  /** Search URL for address-bar text that is not an address; `%s` is the encoded query. Defaults to Google. */
  searchUrl?: string
  /** Engines tried in order when the search engine answers with a challenge. Defaults to Bing, then DuckDuckGo. */
  searchFallbackUrls?: string[]
  /**
   * Drop the automation tells that make sites challenge the browser: Playwright's
   * `--enable-automation` switch (`navigator.webdriver`), Blink's
   * AutomationControlled feature, and the `HeadlessChrome` user-agent token in
   * headless mode. Defaults to true.
   */
  hideAutomation?: boolean
}

/**
 * Loopback-only fence for the live view: the Host header must be a loopback
 * authority and any Origin must match it, so another site (or a DNS-rebound
 * page) cannot drive the user's signed-in browser.
 * @param req - the incoming request.
 * @returns whether the request may use the live view.
 */
export function isTrustedViewerRequest(req: Pick<IncomingMessage, 'headers'>): boolean {
  const host = req.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname.replace(/^\[|\]$/gu, '')
  if (!(hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(hostname))) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** The shared-browser service, registered as `ctx.browser`. */
export default class BrowserRuntime extends Service {
  static Config: z<BrowserRuntimeConfig> = z.object({
    channel: z.string().default(BUNDLED_CHANNEL),
    executablePath: z.string(),
    headless: z.boolean().default(true),
    profileDir: z.string(),
    width: z.natural().default(1280),
    height: z.natural().default(800),
    liveView: z.boolean().default(true),
    searchUrl: z.string().default(DEFAULT_SEARCH_URL),
    searchFallbackUrls: z.array(z.string()).default([...DEFAULT_SEARCH_FALLBACK_URLS]),
    hideAutomation: z.boolean().default(true),
  })

  /** The live browser session shared by tools and the live view. */
  readonly shared: SharedBrowser

  constructor(ctx: Context, config: BrowserRuntimeConfig = {}) {
    super(ctx, 'browser')
    this.shared = new SharedBrowser({
      channel: config.channel ?? BUNDLED_CHANNEL,
      ...config.executablePath !== undefined && config.executablePath.length > 0 ? { executablePath: config.executablePath } : {},
      headless: config.headless ?? true,
      profileDir: config.profileDir ?? fathomHomePath('browser', 'profile'),
      width: config.width ?? 1280,
      height: config.height ?? 800,
      searchUrl: config.searchUrl ?? DEFAULT_SEARCH_URL,
      searchFallbackUrls: config.searchFallbackUrls ?? DEFAULT_SEARCH_FALLBACK_URLS,
      hideAutomation: config.hideAutomation ?? true,
    })
    ctx.effect(() => () => { void this.shared.dispose() }, 'browser: shut down the shared browser')
    if (config.liveView ?? true) {
      ctx.inject(['webServer'], (webCtx) => { mountLiveView(webCtx, this.shared) })
    }
  }
}

/**
 * Register the live-view page and its WebSocket on the web server.
 * @param ctx - context carrying `webServer`.
 * @param shared - the browser the view mirrors.
 */
function mountLiveView(ctx: Context, shared: SharedBrowser): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BROWSER_VIEW_PATH,
    handler: (req, res) => {
      if (!isTrustedViewerRequest(req)) {
        res.writeHead(403).end()
        return
      }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'SAMEORIGIN',
        'content-security-policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'",
      })
      res.end(VIEWER_PAGE)
    },
  }), 'browser: live-view page')

  const server = new WebSocketServer({ noServer: true, maxPayload: 64 << 20 })
  ctx.effect(() => () => {
    for (const client of server.clients) client.terminate()
    server.close()
  }, 'browser: live-view sockets')
  ctx.effect(() => ctx.webServer.registerUpgrade({
    path: BROWSER_SOCKET_PATH,
    handler: (req, socket, head) => {
      if (!isTrustedViewerRequest(req)) {
        socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
        return
      }
      server.handleUpgrade(req, socket, head, (ws) => {
        const detach = shared.attachViewer({
          send: (message) => {
            // Drop frames for a slow viewer instead of queueing without bound.
            if (ws.bufferedAmount > 4 * 1024 * 1024 && message.startsWith('{"type":"frame"')) return
            ws.send(message)
          },
        })
        ws.on('message', (data) => {
          const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(new Uint8Array(data)).toString('utf8')
          void shared.handleViewerMessage(text)
        })
        ws.on('close', detach)
        ws.on('error', detach)
      })
    },
  }), 'browser: live-view WebSocket')
}
