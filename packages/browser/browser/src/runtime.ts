/**
 * The shared browser: one persistent Chromium-family context (Edge by default)
 * driven through Playwright. The agent's tools and the user's live view act on
 * the same tabs, so either side can see and continue the other's work.
 * @module @pentest-harness/dsh-browser/src/runtime
 */

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
import type { BrowserContext, CDPSession, Page } from 'playwright-core'

/** Resolved launch options for the shared browser. */
export interface BrowserLaunchOptions {
  /** Playwright channel (`msedge`, `chrome`, …); ignored when `executablePath` is set. */
  readonly channel: string
  /** Explicit browser executable; overrides `channel`. */
  readonly executablePath?: string
  /** Run without a native window. The web pane still shows the page. */
  readonly headless: boolean
  /** Persistent profile directory, so sign-ins and cookies survive restarts. */
  readonly profileDir: string
  /** Initial viewport width in CSS pixels. */
  readonly width: number
  /** Initial viewport height in CSS pixels. */
  readonly height: number
}

/** One open tab as both the model and the live view see it. */
export interface BrowserTab {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly active: boolean
}

/** One retained console line. */
export interface ConsoleEntry {
  readonly level: string
  readonly text: string
  readonly time: number
}

/** One retained network request. */
export interface NetworkEntry {
  readonly method: string
  readonly url: string
  readonly resourceType: string
  status?: number
  failure?: string
}

/** Where a pointer action lands: an element ref from a snapshot, or viewport coordinates. */
export type BrowserTarget = { readonly ref: string } | { readonly x: number; readonly y: number }

/** Mouse button names accepted by pointer actions. */
export type MouseButton = 'left' | 'right' | 'middle'

/** A live-view subscriber: receives JSON messages. */
export interface BrowserViewer {
  send(message: string): void
}

const CONSOLE_LIMIT = 300
const NETWORK_LIMIT = 400
const ACTION_TIMEOUT_MS = 10_000
const NAVIGATION_TIMEOUT_MS = 30_000

/** Per-tab state kept beside the Playwright page. */
interface TabState {
  readonly id: string
  readonly page: Page
  readonly console: ConsoleEntry[]
  readonly network: NetworkEntry[]
  title: string
}

/**
 * Translate Claude-style key chords (`ctrl+a`, `cmd+shift+t`, `Return`) into
 * Playwright key names (`Control+a`, `Meta+Shift+t`, `Enter`).
 * @param chord - one chord, `+`-joined.
 * @returns the Playwright key expression.
 */
export function toPlaywrightChord(chord: string): string {
  const names: Record<string, string> = {
    ctrl: 'Control', control: 'Control', cmd: 'Meta', meta: 'Meta', command: 'Meta', win: 'Meta', windows: 'Meta',
    alt: 'Alt', option: 'Alt', shift: 'Shift', return: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape',
    space: 'Space', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', del: 'Delete', up: 'ArrowUp', down: 'ArrowDown',
    left: 'ArrowLeft', right: 'ArrowRight', pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End',
  }
  return chord.split('+').map((part) => {
    const lower = part.toLowerCase()
    if (names[lower] !== undefined) return names[lower]
    if (/^f\d{1,2}$/u.test(lower)) return lower.toUpperCase()
    return part
  }).join('+')
}

/**
 * Normalise a model- or user-typed address into a navigable URL. Bare hosts get
 * `https://`; `localhost`/loopback addresses get `http://`.
 * @param input - the raw address.
 * @returns an absolute URL string.
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (/^(localhost|127\.|\[::1\])/iu.test(trimmed)) return `http://${trimmed}`
  // A scheme, but not a `host:port` pair such as `example.com:8080`.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/iu.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

/** The shared browser session. */
export class SharedBrowser {
  private context: BrowserContext | undefined
  private launching: Promise<BrowserContext> | undefined
  private readonly tabs = new Map<Page, TabState>()
  private activePage: Page | undefined
  private nextTabNumber = 1
  private readonly viewers = new Set<BrowserViewer>()
  private screencast: { page: Page; cdp: CDPSession } | undefined
  private screencastSwitch: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly options: BrowserLaunchOptions) {}

  /** True once a browser process is running. */
  get running(): boolean {
    return this.context !== undefined
  }

  /** Launch on first use; concurrent callers share one launch. */
  private async ensureContext(): Promise<BrowserContext> {
    if (this.disposed) throw new Error('the browser has shut down')
    if (this.context !== undefined) return this.context
    this.launching ??= this.launch().finally(() => { this.launching = undefined })
    return this.launching
  }

  private async launch(): Promise<BrowserContext> {
    mkdirSync(this.options.profileDir, { recursive: true })
    const context = await chromium.launchPersistentContext(this.options.profileDir, {
      ...this.options.executablePath !== undefined
        ? { executablePath: this.options.executablePath }
        : { channel: this.options.channel },
      headless: this.options.headless,
      viewport: { width: this.options.width, height: this.options.height },
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    this.context = context
    context.setDefaultTimeout(ACTION_TIMEOUT_MS)
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS)
    context.on('page', (page) => { this.track(page, true) })
    context.on('close', () => {
      if (this.context !== context) return
      this.context = undefined
      this.tabs.clear()
      this.activePage = undefined
      this.screencast = undefined
      this.publishTabs()
    })
    for (const page of context.pages()) this.track(page, false)
    if (this.tabs.size === 0) await context.newPage()
    this.activePage ??= context.pages()[0]
    this.publishTabs()
    this.refreshScreencast()
    return context
  }

  private track(page: Page, activate: boolean): void {
    if (this.tabs.has(page)) return
    const state: TabState = { id: `tab-${this.nextTabNumber++}`, page, console: [], network: [], title: '' }
    this.tabs.set(page, state)
    const push = <T>(list: T[], item: T, limit: number): void => {
      list.push(item)
      if (list.length > limit) list.splice(0, list.length - limit)
    }
    page.on('console', (message) => {
      push(state.console, { level: message.type(), text: message.text(), time: Date.now() }, CONSOLE_LIMIT)
    })
    page.on('pageerror', (error) => {
      push(state.console, { level: 'error', text: `Uncaught ${error.name}: ${error.message}`, time: Date.now() }, CONSOLE_LIMIT)
    })
    const requests = new WeakMap<object, NetworkEntry>()
    page.on('request', (request) => {
      const entry: NetworkEntry = { method: request.method(), url: request.url(), resourceType: request.resourceType() }
      requests.set(request, entry)
      push(state.network, entry, NETWORK_LIMIT)
    })
    page.on('response', (response) => {
      const entry = requests.get(response.request())
      if (entry !== undefined) entry.status = response.status()
    })
    page.on('requestfailed', (request) => {
      const entry = requests.get(request)
      if (entry !== undefined) entry.failure = request.failure()?.errorText ?? 'failed'
    })
    // Native dialogs block every later action on the page. Alerts are
    // acknowledged; confirm/prompt/beforeunload are declined. Both are logged.
    page.on('dialog', (dialog) => {
      push(state.console, { level: 'dialog', text: `${dialog.type()}: ${dialog.message()}`, time: Date.now() }, CONSOLE_LIMIT)
      void (dialog.type() === 'alert' ? dialog.accept() : dialog.dismiss()).catch(() => {})
    })
    const refreshTitle = (): void => {
      void page.title().then((title) => {
        state.title = title
        this.publishTabs()
      }, () => {})
    }
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) refreshTitle() })
    page.on('domcontentloaded', refreshTitle)
    page.on('load', refreshTitle)
    page.on('close', () => {
      this.tabs.delete(page)
      if (this.activePage === page) {
        const remaining = [...this.tabs.keys()]
        this.activePage = remaining.at(-1)
        this.refreshScreencast()
      }
      this.publishTabs()
    })
    if (activate || this.activePage === undefined) {
      this.activePage = page
      this.refreshScreencast()
    }
    this.publishTabs()
  }

  private stateFor(tabId?: string): TabState {
    if (tabId !== undefined) {
      for (const state of this.tabs.values()) if (state.id === tabId) return state
      throw new Error(`no tab with id "${tabId}"; list tabs to see the open ones`)
    }
    const page = this.activePage
    const state = page === undefined ? undefined : this.tabs.get(page)
    if (state === undefined) throw new Error('no tab is open; create one first')
    return state
  }

  /**
   * The page a call acts on: the given tab, else the active one. Launches the
   * browser on first use.
   * @param tabId - optional tab id.
   * @returns the Playwright page.
   */
  async page(tabId?: string): Promise<Page> {
    await this.ensureContext()
    return this.stateFor(tabId).page
  }

  /** Snapshot of open tabs, active first in the user's sense of "current". */
  async listTabs(): Promise<BrowserTab[]> {
    await this.ensureContext()
    return this.describeTabs()
  }

  private describeTabs(): BrowserTab[] {
    return [...this.tabs.values()].map(state => ({
      id: state.id,
      title: state.title,
      url: state.page.url(),
      active: state.page === this.activePage,
    }))
  }

  /**
   * Open a tab and make it active.
   * @param url - optional address to load.
   * @returns the new tab id.
   */
  async createTab(url?: string): Promise<string> {
    const context = await this.ensureContext()
    const page = await context.newPage()
    this.track(page, true)
    this.activePage = page
    this.refreshScreencast()
    if (url !== undefined && url.trim().length > 0) await page.goto(normalizeUrl(url), { waitUntil: 'domcontentloaded' })
    this.publishTabs()
    return this.stateFor().id
  }

  /** Make a tab the active one. */
  async selectTab(tabId: string): Promise<void> {
    await this.ensureContext()
    const state = this.stateFor(tabId)
    this.activePage = state.page
    await state.page.bringToFront().catch(() => {})
    this.refreshScreencast()
    this.publishTabs()
  }

  /** Close a tab; the last remaining tab is replaced by a blank one. */
  async closeTab(tabId: string): Promise<void> {
    const context = await this.ensureContext()
    const state = this.stateFor(tabId)
    if (this.tabs.size === 1) await context.newPage()
    await state.page.close()
  }

  /**
   * Load an address, or move through history.
   * @param target - URL, or `back` / `forward` / `reload`.
   * @param tabId - optional tab id.
   */
  async navigate(target: string, tabId?: string): Promise<void> {
    const page = await this.page(tabId)
    const options = { waitUntil: 'domcontentloaded' as const }
    if (target === 'back') await page.goBack(options)
    else if (target === 'forward') await page.goForward(options)
    else if (target === 'reload') await page.reload(options)
    else await page.goto(normalizeUrl(target), options)
    this.publishTabs()
  }

  /** Locator for an element ref from the latest snapshot. */
  async locate(ref: string, tabId?: string) {
    const page = await this.page(tabId)
    if (!/^[\w-]+$/u.test(ref)) throw new Error(`"${ref}" is not an element ref; use a ref such as e12 from read_page or find`)
    return page.locator(`aria-ref=${ref}`)
  }

  /** Console lines retained for a tab. */
  async consoleOf(tabId?: string): Promise<readonly ConsoleEntry[]> {
    await this.ensureContext()
    return this.stateFor(tabId).console
  }

  /** Network requests retained for a tab. */
  async networkOf(tabId?: string): Promise<readonly NetworkEntry[]> {
    await this.ensureContext()
    return this.stateFor(tabId).network
  }

  /** Id of the active tab, launching the browser when needed. */
  async activeTabId(): Promise<string> {
    await this.ensureContext()
    return this.stateFor().id
  }

  // ── live view ──────────────────────────────────────────────────────────

  /**
   * Attach a live-view subscriber. The browser launches on the first viewer so
   * the pane is never empty, and frames stream only while someone watches.
   * @param viewer - the subscriber.
   * @returns the detach function.
   */
  attachViewer(viewer: BrowserViewer): () => void {
    this.viewers.add(viewer)
    void this.ensureContext().then(() => {
      viewer.send(JSON.stringify({ type: 'tabs', tabs: this.describeTabs() }))
      this.refreshScreencast()
    }, (error: unknown) => {
      viewer.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
    })
    return () => {
      this.viewers.delete(viewer)
      if (this.viewers.size === 0) this.refreshScreencast()
    }
  }

  private broadcast(message: unknown): void {
    if (this.viewers.size === 0) return
    const text = JSON.stringify(message)
    for (const viewer of this.viewers) {
      try {
        viewer.send(text)
      } catch {
        this.viewers.delete(viewer)
      }
    }
  }

  private publishTabs(): void {
    this.broadcast({ type: 'tabs', tabs: this.describeTabs() })
  }

  /** Point the CDP screencast at the active tab while viewers exist; stop it otherwise. */
  private refreshScreencast(): void {
    this.screencastSwitch = this.screencastSwitch.then(async () => {
      const want = this.viewers.size > 0 && this.context !== undefined ? this.activePage : undefined
      if (this.screencast?.page === want) return
      const previous = this.screencast
      this.screencast = undefined
      if (previous !== undefined) {
        await previous.cdp.send('Page.stopScreencast').catch(() => {})
        await previous.cdp.detach().catch(() => {})
      }
      if (want === undefined || this.context === undefined) return
      const cdp = await this.context.newCDPSession(want)
      cdp.on('Page.screencastFrame', (frame) => {
        void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
        this.broadcast({
          type: 'frame',
          data: frame.data,
          width: frame.metadata.deviceWidth,
          height: frame.metadata.deviceHeight,
        })
      })
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 })
      this.screencast = { page: want, cdp }
    }).catch(() => {})
  }

  /**
   * Apply one input or control message from a live viewer. Coordinates are CSS
   * pixels in the page viewport.
   * @param raw - the JSON message text.
   */
  async handleViewerMessage(raw: string): Promise<void> {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    const number = (key: string): number => typeof message[key] === 'number' ? message[key] : 0
    const text = (key: string): string => typeof message[key] === 'string' ? message[key] : ''
    try {
      switch (message.type) {
        case 'mouse': {
          const page = await this.page()
          const button = (['left', 'right', 'middle'].includes(text('button')) ? text('button') : 'left') as MouseButton
          if (message.action === 'move') await page.mouse.move(number('x'), number('y'))
          else if (message.action === 'down') {
            await page.mouse.move(number('x'), number('y'))
            await page.mouse.down({ button, clickCount: Math.max(1, number('clickCount')) })
          } else if (message.action === 'up') {
            await page.mouse.move(number('x'), number('y'))
            await page.mouse.up({ button, clickCount: Math.max(1, number('clickCount')) })
          } else if (message.action === 'wheel') {
            await page.mouse.move(number('x'), number('y'))
            await page.mouse.wheel(number('deltaX'), number('deltaY'))
          }
          break
        }
        case 'key': {
          const page = await this.page()
          const key = text('key')
          if (key.length === 0) break
          if (message.action === 'down') await page.keyboard.down(key)
          else if (message.action === 'up') await page.keyboard.up(key)
          break
        }
        case 'text': {
          const page = await this.page()
          await page.keyboard.insertText(text('text'))
          break
        }
        case 'navigate':
          await this.navigate(text('url'))
          break
        case 'back':
        case 'forward':
        case 'reload':
          await this.navigate(message.type)
          break
        case 'newTab':
          await this.createTab(text('url'))
          break
        case 'selectTab':
          await this.selectTab(text('tabId'))
          break
        case 'closeTab':
          await this.closeTab(text('tabId'))
          break
        case 'resize': {
          const page = await this.page()
          const width = Math.round(number('width'))
          const height = Math.round(number('height'))
          if (width >= 200 && height >= 200 && width <= 4000 && height <= 4000) await page.setViewportSize({ width, height })
          break
        }
        default:
          break
      }
    } catch (error) {
      this.broadcast({ type: 'error', message: error instanceof Error ? error.message.split('\n')[0] : String(error) })
    }
  }

  /** Close the browser and every viewer stream. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.viewers.clear()
    const context = this.context ?? await this.launching?.catch(() => undefined)
    this.context = undefined
    await context?.close().catch(() => {})
  }
}
