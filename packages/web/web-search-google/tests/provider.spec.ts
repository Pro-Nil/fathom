import { describe, expect, it, vi } from 'vitest'
import {
  GoogleApiSearchProvider,
  GoogleBrowserSearchProvider,
  cleanHits,
  isBlockedPage,
} from '../src/provider.ts'
import type { ScratchPageRunner, SearchPage } from '../src/provider.ts'

function fakeRunner(view: { hits: { url: string; title: string; snippet: string }[]; text: string }, pageUrl: string): {
  runner: ScratchPageRunner
  visited: string[]
} {
  const visited: string[] = []
  const page: SearchPage = {
    goto: (url) => { visited.push(url); return Promise.resolve() },
    url: () => pageUrl,
    evaluate: <R>() => Promise.resolve(view as R),
  }
  const runner = (<T>(work: (page: SearchPage) => Promise<T>) => work(page)) as ScratchPageRunner
  return { runner, visited }
}

describe('cleanHits', () => {
  it('keeps external results, unwraps /url redirects, drops Google pages and duplicates', () => {
    expect(cleanHits([
      { url: 'https://example.com/a', title: ' A  title ', snippet: 'one\n two' },
      { url: 'https://www.google.com/url?q=https://target.test/x&sa=U', title: 'Wrapped', snippet: '' },
      { url: 'https://www.google.com/search?q=more', title: 'More', snippet: '' },
      { url: 'https://example.com/a', title: 'dup', snippet: '' },
      { url: 'javascript:alert(1)', title: 'bad', snippet: '' },
    ])).toEqual([
      { url: 'https://example.com/a', title: 'A title', snippet: 'one two' },
      { url: 'https://target.test/x', title: 'Wrapped' },
    ])
  })
})

describe('isBlockedPage', () => {
  it('recognises the sorry page and the unusual-traffic text', () => {
    expect(isBlockedPage('https://www.google.com/sorry/index?continue=x', '')).toBe(true)
    expect(isBlockedPage('https://www.google.com/search?q=x', 'Our systems have detected unusual traffic from your computer network.')).toBe(true)
    expect(isBlockedPage('https://www.google.com/search?q=x', 'About 1,000 results')).toBe(false)
  })
})

describe('GoogleBrowserSearchProvider', () => {
  const options = { searchURL: 'https://www.google.com/search', language: 'en', timeoutMs: 1000 }

  it('is unavailable without a shared browser', () => {
    expect(new GoogleBrowserSearchProvider({ ...options, runner: () => undefined }).available()).toBe(false)
  })

  it('searches in a hidden page and returns the scraped results', async () => {
    const { runner, visited } = fakeRunner({
      hits: [{ url: 'https://owasp.org/Top10/', title: 'OWASP Top 10', snippet: 'The standard awareness document' }],
      text: 'results',
    }, 'https://www.google.com/search?q=owasp')
    const provider = new GoogleBrowserSearchProvider({ ...options, runner: () => runner })
    const result = await provider.search({ query: 'owasp top 10', maxResults: 5 })
    expect(result.sources).toEqual([{ url: 'https://owasp.org/Top10/', title: 'OWASP Top 10', snippet: 'The standard awareness document' }])
    const url = new URL(visited[0]!)
    expect(url.searchParams.get('q')).toBe('owasp top 10')
    expect(url.searchParams.get('num')).toBe('5')
    expect(url.searchParams.get('hl')).toBe('en')
  })

  it('reports a CAPTCHA page as a provider error so the seam can fall back', async () => {
    const { runner } = fakeRunner({ hits: [], text: 'unusual traffic from your computer network' }, 'https://www.google.com/sorry/index')
    const provider = new GoogleBrowserSearchProvider({ ...options, runner: () => runner })
    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })
})

describe('GoogleApiSearchProvider', () => {
  const base = { baseURL: 'https://api.test/customsearch/v1', timeoutMs: 1000, configured: () => true }

  it('sends key, engine id and query, and maps items', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      items: [{ link: 'https://example.com/', title: 'Example', snippet: 'Snippet' }],
    }), { status: 200 })))
    const provider = new GoogleApiSearchProvider({
      ...base,
      apiKey: () => Promise.resolve('k1'),
      engineId: () => Promise.resolve('cx1'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const result = await provider.search({ query: 'nmap', maxResults: 3 })
    expect(result.sources).toEqual([{ url: 'https://example.com/', title: 'Example', snippet: 'Snippet' }])
    const url = new URL(String((fetchImpl.mock.calls[0] as unknown[])[0]))
    expect([url.searchParams.get('key'), url.searchParams.get('cx'), url.searchParams.get('q'), url.searchParams.get('num')])
      .toEqual(['k1', 'cx1', 'nmap', '3'])
  })

  it('fails without credentials and never leaks the key in errors', async () => {
    const missing = new GoogleApiSearchProvider({ ...base, apiKey: () => Promise.resolve(undefined), engineId: () => Promise.resolve('cx') })
    await expect(missing.search({ query: 'x' })).rejects.toThrow(/GOOGLE_API_KEY/u)
    const denied = new GoogleApiSearchProvider({
      ...base,
      apiKey: () => Promise.resolve('secret-key'),
      engineId: () => Promise.resolve('cx'),
      fetchImpl: (() => Promise.resolve(new Response(JSON.stringify({ error: { code: 429, message: 'Quota exceeded' } }), { status: 429 }))) as unknown as typeof fetch,
    })
    const error = await denied.search({ query: 'x' }).then(() => new Error('expected a rejection'), (e: unknown) => e as Error)
    expect(error.message).toContain('HTTP 429')
    expect(error.message).not.toContain('secret-key')
  })
})
