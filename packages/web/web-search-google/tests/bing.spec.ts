import { describe, expect, it, vi } from 'vitest'
import { WebError } from '@pentest-harness/dsh-web'
import {
  BING_DEFAULT_SEARCH_URL, BingBrowserSearchProvider, cleanBingHits, isNoResultsPage, resolveBingUrl,
} from '@pentest-harness/dsh-web-search-google'
import type { RawBingHit, ScratchPageRunner, SearchPage } from '@pentest-harness/dsh-web-search-google'

/** Bing's click tracker: `u` is `a1` plus the destination in base64url. */
function tracked(destination: string): string {
  return `https://www.bing.com/ck/a?!&&p=abc&ptn=3&u=a1${Buffer.from(destination).toString('base64url')}&ntb=1`
}

/** A runner whose hidden page loads and yields the given scrape. */
function runnerYielding(view: { hits: RawBingHit[]; text: string }, visited: string[] = []): () => ScratchPageRunner {
  const page: SearchPage = {
    goto: async (url: string) => { visited.push(url) },
    url: () => 'https://www.bing.com/search',
    evaluate: async <R>() => view as R,
  }
  return () => (async work => work(page)) as ScratchPageRunner
}

describe('resolveBingUrl', () => {
  it('unwraps the click tracker to its destination', () => {
    expect(resolveBingUrl(tracked('https://roundcube.net/'))).toBe('https://roundcube.net/')
    expect(resolveBingUrl(tracked('https://example.com/a?b=1&c=2').replace(/&/gu, '&amp;'))).toBe('https://example.com/a?b=1&c=2')
  })

  it('keeps a direct http(s) link and drops Bing pages, broken trackers and non-http links', () => {
    expect(resolveBingUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(resolveBingUrl('https://www.bing.com/images/search?q=x')).toBeUndefined()
    expect(resolveBingUrl('https://www.bing.com/ck/a?u=zz')).toBeUndefined()
    expect(resolveBingUrl('javascript:void(0)')).toBeUndefined()
  })
})

describe('cleanBingHits', () => {
  it('unwraps links, drops duplicates and Bing pages, and trims text', () => {
    expect(cleanBingHits([
      { href: tracked('https://owasp.org/top-ten'), title: ' OWASP  Top 10 ', snippet: 'The OWASP Top 10\n is a standard.' },
      { href: tracked('https://owasp.org/top-ten'), title: 'Duplicate', snippet: '' },
      { href: 'https://www.bing.com/videos/search?q=x', title: 'Videos', snippet: '' },
      { href: 'https://example.com/direct', title: 'Direct', snippet: '' },
    ])).toEqual([
      { url: 'https://owasp.org/top-ten', title: 'OWASP Top 10', snippet: 'The OWASP Top 10 is a standard.' },
      { url: 'https://example.com/direct', title: 'Direct' },
    ])
  })
})

describe('isNoResultsPage', () => {
  it('recognizes a genuine no-results page only', () => {
    expect(isNoResultsPage('There are no results for xyzzy')).toBe(true)
    expect(isNoResultsPage('Verify you are human')).toBe(false)
  })
})

describe('BingBrowserSearchProvider', () => {
  const base = { searchURL: BING_DEFAULT_SEARCH_URL, market: 'en-IN', timeoutMs: 1000 }

  it('is unavailable without the shared browser', () => {
    expect(new BingBrowserSearchProvider({ ...base, runner: () => undefined }).available()).toBe(false)
  })

  it('loads the results page with the query and market and returns the sources', async () => {
    const visited: string[] = []
    const provider = new BingBrowserSearchProvider({
      ...base,
      runner: runnerYielding({ hits: [{ href: tracked('https://github.com/projectdiscovery/nuclei-templates'), title: 'nuclei-templates', snippet: 'Community templates' }], text: '' }, visited),
    })
    const result = await provider.search({ query: 'nuclei templates github' })
    expect(result.sources).toEqual([{ url: 'https://github.com/projectdiscovery/nuclei-templates', title: 'nuclei-templates', snippet: 'Community templates' }])
    const url = new URL(visited[0] ?? '')
    expect(url.searchParams.get('q')).toBe('nuclei templates github')
    expect(url.searchParams.get('mkt')).toBe('en-IN')
  })

  it('throws on a page without results that is not a no-results page, so the seam falls through', async () => {
    const provider = new BingBrowserSearchProvider({ ...base, runner: runnerYielding({ hits: [], text: 'Verify you are human' }) })
    await expect(provider.search({ query: 'x' })).rejects.toBeInstanceOf(WebError)
  })

  it('returns no sources for a genuine no-results page', async () => {
    const provider = new BingBrowserSearchProvider({ ...base, runner: runnerYielding({ hits: [], text: 'There are no results for x' }) })
    await expect(provider.search({ query: 'x' })).resolves.toEqual({ sources: [], truncated: false })
  })

  it('reports a page that fails to load as a provider error', async () => {
    const runner = vi.fn(async () => { throw new Error('net::ERR_TIMED_OUT') })
    const provider = new BingBrowserSearchProvider({ ...base, runner: () => runner as unknown as ScratchPageRunner })
    await expect(provider.search({ query: 'x' })).rejects.toThrow(/failed to load/)
  })
})
