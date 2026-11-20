/**
 * The shared browser: one persistent Chromium-family context (the harness's own Chromium by default)
 * driven through Playwright. The agent's tools and the user's live view act on
 * the same tabs, so either side can see and continue the other's work.
 * @module @fathom/browser/src/runtime
 */

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { chromium } from 'playwright-core'
import type { BrowserContext, CDPSession, FileChooser, Locator, Page } from 'playwright-core'
import { parsePasswordCsv, writeLogins } from './passwords.ts'
import type { ImportedLogin, PasswordImportResult } from './passwords.ts'

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
  /** Search URL for address-bar text that is not an address; `%s` is replaced by the encoded query. */
  readonly searchUrl: string
}

/**
 * Default address-bar search. DuckDuckGo, like the harness's web_search: Google
 * answers this automated browser with an "unusual traffic" challenge page.
 */
export const DEFAULT_SEARCH_URL = 'https://duckduckgo.com/?q=%s'

/** The Playwright channel that means "the harness's own Chromium build". */
export const BUNDLED_CHANNEL = 'chromium'

/** One open tab as both the model and the live view see it. */
export interface BrowserTab {
  readonly id: string
  readonly title: string
  readonly url: string
  readonly active: boolean
  /** In a session's list: a tab no session has claimed yet (the user's); acting on it claims it. */
  readonly unclaimed?: boolean
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
  /**
   * The session whose agent works in this tab. Unset for a tab the user opened
   * (or the launch tab) until an agent acts on it, which claims it. A session
   * never sees or touches another session's tabs, so two agents running at
   * once each keep their own pages instead of driving one another's.
   */
  owner?: string
}

/**
 * The tab operations one session's agent may perform: the same as
 * {@link SharedBrowser}'s, limited to that session's own tabs plus the
 * unclaimed ones the user opened. Obtained with {@link SharedBrowser.scope}.
 */
export interface BrowserScope {
  /** The page a call acts on: the given tab, else this session's current tab (opened on first use). */
  page(tabId?: string): Promise<Page>
  /** This session's tabs and the user's unclaimed ones; `active` marks this session's current tab. */
  listTabs(): Promise<BrowserTab[]>
  /** Open a tab owned by this session and make it current. */
  createTab(url?: string): Promise<string>
  /** Make a tab this session's current one (and the one the user sees). */
  selectTab(tabId: string): Promise<void>
  /** Close one of this session's tabs. */
  closeTab(tabId: string): Promise<void>
  /** Load an address, or move through history. */
  navigate(target: string, tabId?: string): Promise<void>
  /** Locator for an element ref from the latest snapshot. */
  locate(ref: string, tabId?: string): Promise<Locator>
  /** Console lines retained for a tab. */
  consoleOf(tabId?: string): Promise<readonly ConsoleEntry[]>
  /** Network requests retained for a tab. */
  networkOf(tabId?: string): Promise<readonly NetworkEntry[]>
  /** Id of this session's current tab. */
  activeTabId(): Promise<string>
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
  return resolveAddress(input, DEFAULT_SEARCH_URL)
}

/**
 * Resolve address-bar input the way a browser omnibox does: a URL or bare host
 * opens directly, anything else is searched. Bare hosts get `https://`,
 * loopback hosts `http://`; text with spaces, or a single word that is not
 * `localhost` and has no dot or port, becomes a search.
 * @param input - the raw address-bar text.
 * @param searchUrl - search template; `%s` is replaced by the encoded query.
 * @returns an absolute URL string.
 */
export function resolveAddress(input: string, searchUrl: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0) return 'about:blank'
  if (/^(localhost|127\.|\[::1\])/iu.test(trimmed) && !/\s/u.test(trimmed)) return `http://${trimmed}`
  // A scheme, but not a `host:port` pair such as `example.com:8080`.
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/iu.test(trimmed) && !/\s/u.test(trimmed)) return trimmed
  const looksLikeHost = !/\s/u.test(trimmed) && /^[^/?#]+\.[^/?#.]{2,}|^[^/?#.]+:\d+|^\d{1,3}(?:\.\d{1,3}){3}(?:[:/?#]|$)/u.test(trimmed)
  if (looksLikeHost) return `https://${trimmed}`
  return searchUrl.replace('%s', encodeURIComponent(trimmed))
}

/** One file the live view hands to a page's file chooser. */
export interface ViewerFile {
  readonly name: string
  readonly mimeType: string
  /** Base64 contents. */
  readonly data: string
}

/** The shared browser session. */
export class SharedBrowser {
  private context: BrowserContext | undefined
  private launching: Promise<BrowserContext> | undefined
  private readonly tabs = new Map<Page, TabState>()
  /** The page the user sees in the live view. */
  private activePage: Page | undefined
  /** Each session's current tab: what its agent's calls act on by default. */
  private readonly activeByOwner = new Map<string, Page>()
  private nextTabNumber = 1
  private readonly viewers = new Set<BrowserViewer>()
  private screencast: { page: Page; cdp: CDPSession } | undefined
  private screencastSwitch: Promise<void> = Promise.resolve()
  private disposed = false
  private pendingChooser: FileChooser | undefined
  private installing: Promise<void> | undefined
  /** Set while the closed profile is being written; launches wait for it. */
  private maintenance: Promise<unknown> | undefined

  constructor(private readonly options: BrowserLaunchOptions) {}

  /** True once a browser process is running. */
  get running(): boolean {
    return this.context !== undefined
  }

  /** Launch on first use; concurrent callers share one launch. */
  private async ensureContext(): Promise<BrowserContext> {
    if (this.disposed) throw new Error('the browser has shut down')
    while (this.maintenance !== undefined) await this.maintenance.catch(() => {})
    if (this.context !== undefined) return this.context
    this.launching ??= this.launch().finally(() => { this.launching = undefined })
    return this.launching
  }

  /** Resolve address-bar or tool input with this browser's search engine. */
  address(input: string): string {
    return resolveAddress(input, this.options.searchUrl)
  }

  private async launch(): Promise<BrowserContext> {
    try {
      return await this.launchOnce()
    } catch (error) {
      // The harness's own Chromium is downloaded on first use rather than
      // shipped in the repository; any other launch failure is final.
      const missing = error instanceof Error && /Executable doesn't exist|playwright install/iu.test(error.message)
      if (!missing || this.options.executablePath !== undefined || this.options.channel !== BUNDLED_CHANNEL) throw error
      await this.installBundledBrowser()
      return this.launchOnce()
    }
  }

  /**
   * Download the pinned Chromium build into Playwright's browser cache
   * (`%LOCALAPPDATA%\\ms-playwright` on Windows, `~/.cache/ms-playwright` on Linux)
   * with Playwright's own installer.
   */
  installBundledBrowser(): Promise<void> {
    this.installing ??= new Promise<void>((resolve, reject) => {
      this.broadcast({ type: 'status', message: 'Downloading the harness browser (Chromium, about 180 MB). This happens once.' })
      const cli = join(dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')), 'cli.js')
      const child = spawn(process.execPath, [cli, 'install', BUNDLED_CHANNEL], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      let tail = ''
      const keep = (chunk: Buffer): void => { tail = (tail + chunk.toString('utf8')).slice(-2000) }
      child.stdout.on('data', keep)
      child.stderr.on('data', keep)
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0) {
          this.broadcast({ type: 'status', message: '' })
          resolve()
        } else {
          reject(new Error(`installing the harness browser failed (exit ${String(code)}): ${tail.trim().split('\n').at(-1) ?? ''}`))
        }
      })
    }).finally(() => { this.installing = undefined })
    return this.installing
  }

  private async launchOnce(): Promise<BrowserContext> {
    mkdirSync(this.options.profileDir, { recursive: true })
    const linux = process.platform === 'linux'
    // A Linux host without a display server (a server or container) cannot
    // show a window; the live view works from screencasts either way.
    const headless = this.options.headless || (linux && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    // Chromium refuses to start its sandbox as root on Linux.
    const asRoot = linux && typeof process.getuid === 'function' && process.getuid() === 0
    const context = await chromium.launchPersistentContext(this.options.profileDir, {
      ...this.options.executablePath !== undefined
        ? { executablePath: this.options.executablePath }
        : { channel: this.options.channel },
      headless,
      viewport: { width: this.options.width, height: this.options.height },
      args: ['--no-first-run', '--no-default-browser-check', ...asRoot ? ['--no-sandbox'] : []],
    }).catch((error: unknown) => {
      if (linux && error instanceof Error && /missing dependencies|error while loading shared libraries/iu.test(error.message)) {
        throw new Error(`the harness browser needs system libraries this Linux host lacks; run "sudo npx playwright install-deps chromium" once, then try again (${error.message.split('\n')[0] ?? ''})`, { cause: error })
      }
      throw error
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
    if (this.tabs.has(page) || this.scratchPages.has(page)) return
    if (this.openingScratch) {
      this.scratchPages.add(page)
      return
    }
    const state: TabState = { id: `tab-${this.nextTabNumber++}`, page, console: [], network: [], title: '' }
    this.tabs.set(page, state)
    // A popup or target=_blank tab belongs to the session whose page opened it.
    void page.opener().then((opener) => {
      const owner = opener === null ? undefined : this.tabs.get(opener)?.owner
      if (owner !== undefined && state.owner === undefined) state.owner = owner
    }, () => {})
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
    // A page asked for files: hand the picker to the live view so the user
    // chooses them on their own machine (uploads, password CSV import, …).
    page.on('filechooser', (chooser) => {
      this.pendingChooser = chooser
      this.broadcast({ type: 'filechooser', multiple: chooser.isMultiple() })
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
      for (const [owner, current] of this.activeByOwner) if (current === page) this.activeByOwner.delete(owner)
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

  /**
   * The tab a call names, or the default one. Without an owner (the user's
   * live view) every tab is reachable and the default is the one on screen.
   * With an owner (one session's agent) another session's tab is refused, a
   * tab nobody owns (the user opened it, or it is the launch tab) is claimed
   * by the first session that acts on it, and the default is that session's
   * current tab. Undefined means the session has no tab yet.
   */
  private stateFor(tabId: string | undefined, owner?: string): TabState | undefined {
    if (tabId !== undefined) {
      let found: TabState | undefined
      for (const state of this.tabs.values()) if (state.id === tabId) found = state
      if (found === undefined) throw new Error(`no tab with id "${tabId}"; list tabs to see the open ones`)
      if (owner !== undefined) {
        if (found.owner !== undefined && found.owner !== owner) {
          throw new Error(`tab "${tabId}" belongs to another session; open your own with browser_tabs create`)
        }
        found.owner = owner
      }
      return found
    }
    if (owner === undefined) return this.activePage === undefined ? undefined : this.tabs.get(this.activePage)
    const current = this.activeByOwner.get(owner)
    const currentState = current === undefined ? undefined : this.tabs.get(current)
    if (currentState !== undefined) return currentState
    let latest: TabState | undefined
    for (const state of this.tabs.values()) if (state.owner === owner) latest = state
    if (latest !== undefined) return latest
    // Nothing of its own yet: take the tab on screen if no session has it, so
    // "look at this page" keeps working for a single session; a second
    // session then gets a fresh tab instead of the first one's.
    const shown = this.activePage === undefined ? undefined : this.tabs.get(this.activePage)
    if (shown !== undefined && shown.owner === undefined) {
      shown.owner = owner
      return shown
    }
    return undefined
  }

  /** {@link stateFor} for a named tab, which always resolves or throws. */
  private namedState(tabId: string, owner?: string): TabState {
    const state = this.stateFor(tabId, owner)
    if (state === undefined) throw new Error(`no tab with id "${tabId}"; list tabs to see the open ones`)
    return state
  }

  /**
   * Resolve the tab a call acts on, opening one for a session that has none
   * yet. Launches the browser on first use.
   */
  private async resolveTab(tabId: string | undefined, owner: string | undefined): Promise<TabState> {
    await this.ensureContext()
    const state = this.stateFor(tabId, owner)
    if (state !== undefined) {
      if (owner !== undefined && tabId === undefined) this.activeByOwner.set(owner, state.page)
      return state
    }
    if (owner === undefined) throw new Error('no tab is open; create one first')
    const id = await this.createTab(undefined, owner)
    return this.namedState(id, owner)
  }

  /**
   * The page a call acts on: the given tab, else the current one (for a
   * session, its own current tab, opened on first use).
   * @param tabId - optional tab id.
   * @param owner - the calling session; omitted for the user's live view.
   * @returns the Playwright page.
   */
  async page(tabId?: string, owner?: string): Promise<Page> {
    return (await this.resolveTab(tabId, owner)).page
  }

  /**
   * Snapshot of open tabs. For a session: its own tabs plus the ones no
   * session has claimed, with `active` marking its current tab.
   * @param owner - the calling session; omitted for every tab.
   * @returns the tabs.
   */
  async listTabs(owner?: string): Promise<BrowserTab[]> {
    await this.ensureContext()
    return this.describeTabs(owner)
  }

  private describeTabs(owner?: string): BrowserTab[] {
    const current = owner === undefined ? this.activePage : this.activeByOwner.get(owner)
    return [...this.tabs.values()]
      .filter(state => owner === undefined || state.owner === undefined || state.owner === owner)
      .map(state => ({
        id: state.id,
        title: state.title,
        url: state.page.url(),
        active: state.page === current,
        ...owner !== undefined && state.owner === undefined ? { unclaimed: true } : {},
      }))
  }

  /**
   * The tab operations bound to one session: it sees and acts on only its own
   * tabs and the ones nobody has claimed, so concurrent sessions never drive
   * each other's pages.
   * @param owner - the session id.
   * @returns the scoped operations.
   */
  scope(owner: string): BrowserScope {
    return {
      page: tabId => this.page(tabId, owner),
      listTabs: () => this.listTabs(owner),
      createTab: url => this.createTab(url, owner),
      selectTab: tabId => this.selectTab(tabId, owner),
      closeTab: tabId => this.closeTab(tabId, owner),
      navigate: (target, tabId) => this.navigate(target, tabId, owner),
      locate: (ref, tabId) => this.locate(ref, tabId, owner),
      consoleOf: tabId => this.consoleOf(tabId, owner),
      networkOf: tabId => this.networkOf(tabId, owner),
      activeTabId: () => this.activeTabId(owner),
    }
  }

  /** Pages opened by {@link withScratchPage}: never listed as tabs or mirrored. */
  private readonly scratchPages = new WeakSet<Page>()
  /** True while a scratch page is being created, so `track` skips it. */
  private openingScratch = false
  /** Serializes scratch-page creation so the `openingScratch` flag is unambiguous. */
  private scratchQueue: Promise<unknown> = Promise.resolve()

  /**
   * Run work in a hidden page of the shared browser (same profile and cookies)
   * that never appears in the tab list or the live view, then close it.
   * @param work - receives the page; its result is returned.
   * @returns what `work` returned.
   */
  async withScratchPage<T>(work: (page: Page) => Promise<T>): Promise<T> {
    const context = await this.ensureContext()
    const opened = this.scratchQueue.then(async () => {
      this.openingScratch = true
      try {
        const page = await context.newPage()
        this.scratchPages.add(page)
        return page
      } finally {
        this.openingScratch = false
      }
    })
    this.scratchQueue = opened.catch(() => {})
    const page = await opened
    try {
      return await work(page)
    } finally {
      await page.close().catch(() => {})
    }
  }

  /**
   * Open a tab and make it active (and, for a session, its current tab).
   * @param url - optional address to load.
   * @param owner - the session that owns the tab; omitted for the user's.
   * @returns the new tab id.
   */
  async createTab(url?: string, owner?: string): Promise<string> {
    const context = await this.ensureContext()
    const page = await context.newPage()
    this.track(page, true)
    const state = this.tabs.get(page)
    if (state === undefined) throw new Error('the new tab closed before it opened')
    if (owner !== undefined) {
      state.owner = owner
      this.activeByOwner.set(owner, page)
    }
    this.activePage = page
    this.refreshScreencast()
    if (url !== undefined && url.trim().length > 0) await page.goto(this.address(url), { waitUntil: 'domcontentloaded' })
    this.publishTabs()
    return state.id
  }

  /** Make a tab the active one (and, for a session, its current tab). */
  async selectTab(tabId: string, owner?: string): Promise<void> {
    await this.ensureContext()
    const state = this.namedState(tabId, owner)
    if (owner !== undefined) this.activeByOwner.set(owner, state.page)
    this.activePage = state.page
    await state.page.bringToFront().catch(() => {})
    this.refreshScreencast()
    this.publishTabs()
  }

  /** Close a tab; the last remaining tab is replaced by a blank one. */
  async closeTab(tabId: string, owner?: string): Promise<void> {
    const context = await this.ensureContext()
    const state = this.namedState(tabId, owner)
    if (this.tabs.size === 1) await context.newPage()
    await state.page.close()
  }

  /**
   * Load an address, or move through history.
   * @param target - URL, or `back` / `forward` / `reload`.
   * @param tabId - optional tab id.
   * @param owner - the calling session; omitted for the user's live view.
   */
  async navigate(target: string, tabId?: string, owner?: string): Promise<void> {
    const page = await this.page(tabId, owner)
    const options = { waitUntil: 'domcontentloaded' as const }
    if (target === 'back') await page.goBack(options)
    else if (target === 'forward') await page.goForward(options)
    else if (target === 'reload') await page.reload(options)
    else await page.goto(this.address(target), options)
    this.publishTabs()
  }

  /** Locator for an element ref from the latest snapshot. */
  async locate(ref: string, tabId?: string, owner?: string): Promise<Locator> {
    const page = await this.page(tabId, owner)
    if (!/^[\w-]+$/u.test(ref)) throw new Error(`"${ref}" is not an element ref; use a ref such as e12 from read_page or find`)
    return page.locator(`aria-ref=${ref}`)
  }

  /** Console lines retained for a tab. */
  async consoleOf(tabId?: string, owner?: string): Promise<readonly ConsoleEntry[]> {
    return (await this.resolveTab(tabId, owner)).console
  }

  /** Network requests retained for a tab. */
  async networkOf(tabId?: string, owner?: string): Promise<readonly NetworkEntry[]> {
    return (await this.resolveTab(tabId, owner)).network
  }

  /** Id of the current tab (for a session, its own), launching the browser when needed. */
  async activeTabId(owner?: string): Promise<string> {
    return (await this.resolveTab(undefined, owner)).id
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
   * Restart the active tab's screencast so viewers get a frame at the current
   * size right away. Chromium sends frames only when the page repaints, and a
   * static page (about:blank, a finished load) may not repaint after a
   * viewport change, which would leave the old-sized frame letterboxed.
   * @param page - the page whose stream to restart; ignored unless it is streaming.
   */
  private async restartScreencast(page: Page): Promise<void> {
    await this.screencastSwitch
    const current = this.screencast
    if (current?.page !== page) return
    await current.cdp.send('Page.stopScreencast').catch(() => {})
    await current.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 }).catch(() => {})
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
        case 'files': {
          const chooser = this.pendingChooser
          this.pendingChooser = undefined
          if (chooser === undefined) break
          // The message is untrusted JSON: keep only well-formed file entries.
          const raw: unknown[] = Array.isArray(message.files) ? message.files : []
          const files = raw.filter((file): file is ViewerFile => typeof file === 'object' && file !== null
            && typeof (file as ViewerFile).name === 'string' && typeof (file as ViewerFile).data === 'string')
          await chooser.setFiles(files.map(file => ({
            name: file.name,
            mimeType: typeof file.mimeType === 'string' && file.mimeType.length > 0 ? file.mimeType : 'application/octet-stream',
            buffer: Buffer.from(file.data, 'base64'),
          })))
          break
        }
        case 'importPasswords': {
          const raw: unknown[] = Array.isArray(message.files) ? message.files : []
          const files = raw.filter((file): file is ViewerFile => typeof file === 'object' && file !== null
            && typeof (file as ViewerFile).name === 'string' && typeof (file as ViewerFile).data === 'string')
          const result = await this.importPasswords(files)
          const parts = [`Imported ${result.imported} password${result.imported === 1 ? '' : 's'}`]
          if (result.duplicates > 0) parts.push(`${result.duplicates} already saved`)
          if (result.skipped > 0) parts.push(`${result.skipped} rows skipped (no web address or password)`)
          this.broadcast({ type: 'notice', message: `${parts.join(', ')}. Delete the exported CSV files now; they hold your passwords in plain text.` })
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
          if (width >= 200 && height >= 200 && width <= 4000 && height <= 4000) {
            await page.setViewportSize({ width, height })
            await this.restartScreencast(page)
          }
          break
        }
        default:
          break
      }
    } catch (error) {
      this.broadcast({ type: 'error', message: error instanceof Error ? error.message.split('\n')[0] : String(error) })
    }
  }

  /**
   * Import saved passwords from password-export CSV files into this browser's
   * own password manager. The browser closes for a moment while its store is
   * written, then reopens; open tabs are not restored.
   * @param files - CSV files exported from other browsers or password managers.
   * @returns counts of imported, duplicate and skipped rows.
   */
  async importPasswords(files: readonly ViewerFile[]): Promise<PasswordImportResult> {
    const logins: ImportedLogin[] = []
    let skipped = 0
    for (const file of files) {
      const parsed = parsePasswordCsv(Buffer.from(file.data, 'base64').toString('utf8'))
      logins.push(...parsed.logins)
      skipped += parsed.skipped
    }
    if (logins.length === 0) return { imported: 0, duplicates: 0, skipped }
    // The profile (and its password key) exists once the browser has run.
    const context = await this.ensureContext()
    this.broadcast({ type: 'status', message: `Importing ${logins.length} saved passwords…` })
    const work = (async () => {
      // Closing runs the context's close handler, which clears tabs and the
      // screencast; launches wait on `maintenance` until the store is written.
      await context.close()
      return writeLogins(this.options.profileDir, logins)
    })()
    this.maintenance = work
    try {
      const written = await work
      return { ...written, skipped }
    } finally {
      this.maintenance = undefined
      this.broadcast({ type: 'status', message: '' })
      // Reopen for the viewers and the agent whatever the outcome.
      if (this.viewers.size > 0) void this.ensureContext().then(() => { this.refreshScreencast() }, () => {})
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
