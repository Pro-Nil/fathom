/**
 * `DuckDuckGoSearchProvider`: a keyless `WebSearchProvider` backed by
 * DuckDuckGo's HTML results page (`POST https://html.duckduckgo.com/html/`).
 * No account, key or payment is involved. It parses each organic result's
 * link, title and snippet, unwraps DuckDuckGo's `/l/?uddg=` redirect links,
 * skips sponsored results, and returns no generated answer.
 * @module @fathom/web-search-duckduckgo/provider
 */

import { WebError } from '@fathom/web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@fathom/web'

/** Stable id this provider registers under. */
export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'

/** Default endpoint: the JavaScript-free results page. */
export const DUCKDUCKGO_DEFAULT_BASE_URL = 'https://html.duckduckgo.com/html/'

/** A mainstream browser user agent; the HTML page refuses obviously scripted clients. */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

/** Resolved provider options. */
export interface DuckDuckGoSearchProviderOptions {
  /** Results page URL the query is posted to. */
  baseURL: string
  /** Region code sent as `kl` (for example `us-en`, `in-en`); empty for none. */
  region: string
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', '#39': '\'', '#x27': '\'', '#x2F': '/',
}

/** Decode the HTML entities DuckDuckGo emits in titles and snippets. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    const known = ENTITIES[entity] ?? ENTITIES[entity.toLowerCase()]
    if (known !== undefined) return known
    if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return match
  })
}

/** Strip tags, decode entities and collapse whitespace. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
}

/**
 * Resolve a result link: unwrap DuckDuckGo's `/l/?uddg=<target>` redirect and
 * make protocol-relative links absolute.
 * @param href - the raw `href` attribute.
 * @returns the destination URL, or `undefined` for anything that is not http(s).
 */
export function resolveResultUrl(href: string): string | undefined {
  const raw = decodeEntities(href)
  const absolute = raw.startsWith('//') ? `https:${raw}` : raw
  let url: URL
  try {
    url = new URL(absolute, 'https://duckduckgo.com')
  } catch {
    return undefined
  }
  if (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/l/')) {
    const target = url.searchParams.get('uddg')
    return target === null ? undefined : resolveResultUrl(target)
  }
  if (url.hostname.endsWith('duckduckgo.com') && url.pathname.startsWith('/y.js')) return undefined
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined
}

/**
 * Parse the organic results out of a results page.
 * @param html - the response body.
 * @returns sources in page order; sponsored and link-less entries are skipped.
 */
export function parseResults(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  // Each organic result is one `result` block; sponsored ones carry `result--ad`.
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1)
  for (const block of blocks) {
    const head = block.slice(0, 200)
    if (/result--ad\b/.test(head)) continue
    const link = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
      ?? /<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (link === null) continue
    const url = resolveResultUrl(link[1] ?? '')
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    const title = plainText(link[2] ?? '')
    const snippetMatch = /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(block)
    const snippet = snippetMatch === null ? '' : plainText(snippetMatch[1] ?? '')
    sources.push({
      url,
      ...title.length > 0 ? { title } : {},
      ...snippet.length > 0 ? { snippet } : {},
    })
  }
  return sources
}

/** The DuckDuckGo-backed search provider. */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly id = DUCKDUCKGO_PROVIDER_ID

  constructor(private readonly options: DuckDuckGoSearchProviderOptions) {}

  available(): boolean {
    return URL.canParse(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const form = new URLSearchParams({ q: request.query })
    if (this.options.region.length > 0) form.set('kl', this.options.region)
    let response: Response
    try {
      response = await fetch(this.options.baseURL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'text/html',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent': USER_AGENT,
        },
        body: form.toString(),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    let body: string
    try {
      body = await response.text()
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo returned an unreadable body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    // A 202 or a challenge page means DuckDuckGo is throttling this client.
    if (!response.ok || response.status === 202 || /anomaly-modal|challenge-form/.test(body)) {
      throw new WebError(
        `DuckDuckGo did not return results (HTTP ${response.status}); it may be rate-limiting. Wait a minute and retry, or rephrase.`,
        'WEB_PROVIDER_ERROR',
      )
    }
    const sources = parseResults(body)
    // The web service applies the request's maxResults bound.
    return { sources, truncated: false }
  }
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
