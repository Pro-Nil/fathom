/**
 * Google search providers for `ctx.web`:
 *
 * - `google` loads the results page in a hidden page of the harness's shared
 *   browser (same profile and cookies as the user's sign-ins), so it needs no
 *   key. A CAPTCHA or "unusual traffic" page is reported as a provider error,
 *   which lets the seam fall back to the next engine.
 * - `google-api` calls the Programmable Search JSON API with an API key and a
 *   search-engine id resolved per request from the credential store.
 */

import { WebError } from '@fathom/web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@fathom/web'

/** Id of the keyless browser-backed provider. */
export const GOOGLE_PROVIDER_ID = 'google'

/** Id of the Programmable Search JSON API provider. */
export const GOOGLE_API_PROVIDER_ID = 'google-api'

/** Default results page. */
export const GOOGLE_DEFAULT_SEARCH_URL = 'https://www.google.com/search'

/** Default Programmable Search JSON API endpoint. */
export const GOOGLE_API_DEFAULT_BASE_URL = 'https://www.googleapis.com/customsearch/v1'

/** The API returns at most ten results per request. */
const GOOGLE_API_PAGE_SIZE = 10

/** What the results page yields per hit before validation. */
export interface RawGoogleHit {
  url: string
  title: string
  snippet: string
}

/** The minimum a hidden browser page must offer this provider. */
export interface SearchPage {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>
  url(): string
  evaluate<R>(fn: () => R): Promise<R>
}

/** Runs work in a hidden page; the shared browser's `withScratchPage`. */
export type ScratchPageRunner = <T>(work: (page: SearchPage) => Promise<T>) => Promise<T>

/** Options of {@link GoogleBrowserSearchProvider}. */
export interface GoogleBrowserSearchProviderOptions {
  /** Hidden-page runner, or undefined when no shared browser is mounted. */
  runner: () => ScratchPageRunner | undefined
  /** Results page URL. */
  searchURL: string
  /** Interface language sent as `hl` (for example `en`); empty for Google's default. */
  language: string
  /** Page-load timeout in milliseconds. */
  timeoutMs: number
}

/**
 * Keep http(s) results that point away from Google itself, drop duplicates,
 * and trim the text.
 * @param hits - raw hits scraped from the page.
 * @returns citeable sources in page order.
 */
export function cleanHits(hits: readonly RawGoogleHit[]): WebSearchSource[] {
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const hit of hits) {
    let url: URL
    try {
      url = new URL(hit.url)
    } catch {
      continue
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue
    if (/(^|\.)google\.[a-z.]+$/u.test(url.hostname) && url.pathname !== '/url') continue
    // Google sometimes links through /url?q=<target>.
    const target = url.pathname === '/url' ? url.searchParams.get('q') ?? url.searchParams.get('url') : url.href
    if (target === null || seen.has(target)) continue
    seen.add(target)
    const title = hit.title.replace(/\s+/gu, ' ').trim()
    const snippet = hit.snippet.replace(/\s+/gu, ' ').trim()
    sources.push({ url: target, ...title === '' ? {} : { title }, ...snippet === '' ? {} : { snippet } })
  }
  return sources
}

/**
 * Whether a loaded page is Google's block / CAPTCHA interstitial.
 * @param pageUrl - the page's final URL.
 * @param bodyText - the page's visible text.
 * @returns true when Google refused the search.
 */
export function isBlockedPage(pageUrl: string, bodyText: string): boolean {
  return pageUrl.includes('/sorry/')
    || /unusual traffic from your computer network|our systems have detected unusual traffic|recaptcha/iu.test(bodyText)
}

/** Keyless Google search through a hidden page of the shared browser. */
export class GoogleBrowserSearchProvider implements WebSearchProvider {
  readonly id = GOOGLE_PROVIDER_ID

  constructor(private readonly options: GoogleBrowserSearchProviderOptions) {}

  available(): boolean {
    return this.options.runner() !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const runner = this.options.runner()
    if (runner === undefined) throw new WebError('the shared browser is not mounted', 'WEB_PROVIDER_ERROR')
    signal?.throwIfAborted()
    const url = new URL(this.options.searchURL)
    url.searchParams.set('q', request.query)
    // The plain "Web" results view: no AI Overview, and more organic results.
    if (!url.searchParams.has('udm')) url.searchParams.set('udm', '14')
    if (this.options.language !== '') url.searchParams.set('hl', this.options.language)
    if (request.maxResults !== undefined) url.searchParams.set('num', String(Math.min(Math.max(request.maxResults, 1), 20)))
    const scraped = await runner(async (page) => {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs })
      const view = await page.evaluate(() => {
        const hits: { url: string; title: string; snippet: string }[] = []
        for (const heading of document.querySelectorAll('#search a h3, #rso a h3')) {
          const anchor = heading.closest('a')
          if (anchor === null) continue
          const box = anchor.closest('div.g, div.MjjYud, div[data-hveid]')
          const snippet = box?.querySelector('.VwiC3b, [data-sncf], .IsZvec, .lEBKkf')
          hits.push({
            url: anchor.href,
            title: (heading as HTMLElement).innerText,
            snippet: snippet instanceof HTMLElement ? snippet.innerText : '',
          })
        }
        return { hits, text: document.body.innerText.slice(0, 4000) }
      })
      return { ...view, pageUrl: page.url() }
    }).catch((error: unknown) => {
      if (signal?.aborted === true) throw new WebError('Google search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Google search page failed to load: ${error instanceof Error ? error.message : String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    })
    if (isBlockedPage(scraped.pageUrl, scraped.text)) {
      throw new WebError('Google blocked the search with a CAPTCHA ("unusual traffic")', 'WEB_PROVIDER_ERROR')
    }
    return { sources: cleanHits(scraped.hits), truncated: false }
  }
}

/** Options of {@link GoogleApiSearchProvider}. */
export interface GoogleApiSearchProviderOptions {
  /** Endpoint URL. */
  baseURL: string
  /** Resolves the API key, or undefined when none is stored. */
  apiKey: () => Promise<string | undefined>
  /** Resolves the Programmable Search Engine id (`cx`), or undefined when none is stored. */
  engineId: () => Promise<string | undefined>
  /** Whether both credentials were present at the last check (keeps `available()` synchronous). */
  configured: () => boolean
  /** Request timeout in milliseconds. */
  timeoutMs: number
  /** HTTP client; `fetch` in production. */
  fetchImpl?: typeof fetch
}

/** Shape of the parts of a Custom Search response this provider reads. */
interface CustomSearchResponse {
  items?: { link?: string; title?: string; snippet?: string }[]
  error?: { code?: number; message?: string }
}

/** Google Programmable Search JSON API provider. */
export class GoogleApiSearchProvider implements WebSearchProvider {
  readonly id = GOOGLE_API_PROVIDER_ID

  constructor(private readonly options: GoogleApiSearchProviderOptions) {}

  available(): boolean {
    return this.options.configured()
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const [key, cx] = await Promise.all([this.options.apiKey(), this.options.engineId()])
    if (key === undefined || cx === undefined) {
      throw new WebError('Google API search needs GOOGLE_API_KEY and GOOGLE_CSE_ID', 'WEB_PROVIDER_ERROR')
    }
    const url = new URL(this.options.baseURL)
    url.searchParams.set('key', key)
    url.searchParams.set('cx', cx)
    url.searchParams.set('q', request.query)
    url.searchParams.set('num', String(Math.min(request.maxResults ?? GOOGLE_API_PAGE_SIZE, GOOGLE_API_PAGE_SIZE)))
    const timeout = AbortSignal.timeout(this.options.timeoutMs)
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    let body: CustomSearchResponse
    let status: number
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, { signal: combined, headers: { accept: 'application/json' } })
      status = response.status
      body = await response.json() as CustomSearchResponse
    } catch (error: unknown) {
      if (signal?.aborted === true) throw new WebError('Google API search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Google API search request failed: ${error instanceof Error ? error.message : String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (status < 200 || status >= 300 || body.error !== undefined) {
      // Never echo the request URL: it carries the key.
      throw new WebError(`Google API search returned HTTP ${status}${body.error?.message === undefined ? '' : `: ${body.error.message}`}`, 'WEB_PROVIDER_ERROR')
    }
    const hits: RawGoogleHit[] = (body.items ?? []).map(item => ({ url: item.link ?? '', title: item.title ?? '', snippet: item.snippet ?? '' }))
    return { sources: cleanHits(hits), truncated: false }
  }
}
