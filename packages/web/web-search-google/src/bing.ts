/**
 * `bing`: keyless Bing search through a hidden page of the harness's shared
 * browser, like the `google` provider beside it. It is the fallback that
 * still answers when Google shows a CAPTCHA and DuckDuckGo throttles the
 * address (DuckDuckGo answers HTTP 202 after a handful of searches).
 *
 * It runs in the browser rather than over plain HTTP on purpose: Bing serves a
 * cookie-less scripted client a page of unrelated results (a query for
 * "nuclei templates github" came back as YouTube help pages), which would
 * mislead the agent far worse than an error that moves on to the next engine.
 * @module @fathom/web-search-google/bing
 */

import { WebError } from '@fathom/web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@fathom/web'
import type { ScratchPageRunner } from './provider.ts'

/** Stable id this provider registers under. */
export const BING_PROVIDER_ID = 'bing'

/** Default results page. */
export const BING_DEFAULT_SEARCH_URL = 'https://www.bing.com/search'

/** What the results page yields per hit before validation. */
export interface RawBingHit {
  /** The result link's `href` (usually Bing's click tracker). */
  href: string
  title: string
  snippet: string
}

/** Options of {@link BingBrowserSearchProvider}. */
export interface BingBrowserSearchProviderOptions {
  /** Hidden-page runner, or undefined when no shared browser is mounted. */
  runner: () => ScratchPageRunner | undefined
  /** Results page URL. */
  searchURL: string
  /** Market sent as `mkt` (for example `en-US`, `en-IN`); empty for Bing's default. */
  market: string
  /** Page-load timeout in milliseconds. */
  timeoutMs: number
}

/**
 * Resolve a result link: unwrap Bing's `/ck/a?…&u=a1<base64url>` click
 * tracker to its destination.
 * @param href - the result link.
 * @returns the destination URL, or `undefined` for Bing's own pages and anything that is not http(s).
 */
export function resolveBingUrl(href: string): string | undefined {
  let url: URL
  try {
    url = new URL(href.replace(/&amp;/gu, '&'), 'https://www.bing.com')
  } catch {
    return undefined
  }
  if (url.hostname.endsWith('bing.com') && url.pathname.startsWith('/ck/')) {
    const wrapped = url.searchParams.get('u')
    if (wrapped === null || !wrapped.startsWith('a1')) return undefined
    const target = Buffer.from(wrapped.slice(2), 'base64url').toString('utf8')
    return target.startsWith('http') ? resolveBingUrl(target) : undefined
  }
  // Bing's own pages (image, video and related-search links) are not results.
  if (url.hostname.endsWith('bing.com')) return undefined
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
}

/**
 * Turn scraped hits into citeable sources: unwrap links, drop Bing's own pages
 * and duplicates, and trim the text.
 * @param hits - raw hits scraped from the page, in page order.
 * @returns sources in page order.
 */
export function cleanBingHits(hits: readonly RawBingHit[]): WebSearchSource[] {
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const hit of hits) {
    const url = resolveBingUrl(hit.href)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    const title = hit.title.replace(/\s+/gu, ' ').trim()
    const snippet = hit.snippet.replace(/\s+/gu, ' ').trim()
    sources.push({ url, ...title === '' ? {} : { title }, ...snippet === '' ? {} : { snippet } })
  }
  return sources
}

/**
 * Whether a loaded page without results is a genuine "no results" page rather
 * than a challenge or a blocked response.
 * @param bodyText - the page's visible text.
 * @returns true when Bing really found nothing.
 */
export function isNoResultsPage(bodyText: string): boolean {
  return /There are no results for|No results found for/iu.test(bodyText)
}

/** Keyless Bing search through a hidden page of the shared browser. */
export class BingBrowserSearchProvider implements WebSearchProvider {
  readonly id = BING_PROVIDER_ID

  constructor(private readonly options: BingBrowserSearchProviderOptions) {}

  available(): boolean {
    return this.options.runner() !== undefined
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const runner = this.options.runner()
    if (runner === undefined) throw new WebError('the shared browser is not mounted', 'WEB_PROVIDER_ERROR')
    signal?.throwIfAborted()
    const url = new URL(this.options.searchURL)
    url.searchParams.set('q', request.query)
    url.searchParams.set('setlang', 'en')
    if (this.options.market !== '') url.searchParams.set('mkt', this.options.market)
    const scraped = await runner(async (page) => {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: this.options.timeoutMs })
      return page.evaluate(() => {
        const hits: { href: string; title: string; snippet: string }[] = []
        // Organic results only: ads are `b_ad` items, never `b_algo`.
        for (const item of document.querySelectorAll('li.b_algo')) {
          const anchor = item.querySelector('h2 a')
          if (!(anchor instanceof HTMLAnchorElement)) continue
          const caption = item.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_paractl')
          let snippet = caption instanceof HTMLElement ? caption.innerText : ''
          // The caption ends with a "Read more" link repeating the result link.
          snippet = snippet.replace(/\s*Read more\s*$/u, '')
          hits.push({ href: anchor.href, title: anchor.innerText, snippet })
        }
        return { hits, text: document.body.innerText.slice(0, 4000) }
      })
    }).catch((error: unknown) => {
      if (signal?.aborted === true) throw new WebError('Bing search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Bing search page failed to load: ${error instanceof Error ? error.message : String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    })
    const sources = cleanBingHits(scraped.hits)
    // A page with no results that is not Bing's "no results" page is a
    // challenge or a blocked response: fail so the seam tries the next engine.
    if (sources.length === 0 && !isNoResultsPage(scraped.text)) {
      throw new WebError('Bing returned a page without results; it may be challenging this browser.', 'WEB_PROVIDER_ERROR')
    }
    return { sources, truncated: false }
  }
}
