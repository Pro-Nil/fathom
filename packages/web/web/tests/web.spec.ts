import { describe, expect, it } from 'vitest'
import { Context } from '@pentest-harness/cordis'
import WebRuntime, {
  WebError,
  type WebFetchProvider,
  type WebFetchResult,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
} from '@pentest-harness/dsh-web'

/** A scripted search provider for contract tests. */
function makeSearchProvider(
  id: string,
  available: boolean,
  search: (request: WebSearchRequest) => Promise<WebSearchResult>,
): WebSearchProvider {
  return { id, available: () => available, search: request => search(request) }
}

function makeFetchProvider(id: string, available: boolean, result: WebFetchResult): WebFetchProvider {
  return { id, available: () => available, fetch: () => Promise.resolve(result) }
}

const available = true
const unavailable = false

function searchResult(marker: string, overrides: Partial<WebSearchResult> = {}): WebSearchResult {
  return { content: marker, sources: [], truncated: false, ...overrides }
}

function fetchResult(marker: string): WebFetchResult {
  return { url: 'https://example.com', statusCode: 200, body: { kind: 'text', content: marker }, truncated: false }
}

/** Mount a WebRuntime on a fresh root context with the given config. */
async function mountWeb(config: ConstructorParameters<typeof WebRuntime>[1] = {}): Promise<{ ctx: Context; web: WebRuntime }> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, config)
  return { ctx, web: ctx.web }
}

describe('WebRuntime registration', () => {
  it('registers a search provider and unregisters it via the returned disposer', async () => {
    const { web } = await mountWeb()

    const dispose = web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })

    dispose()
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })

  it('throws WEB_DUPLICATE_PROVIDER on a duplicate search id', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    expect(() => web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa')))))
      .toThrow(expect.objectContaining({ code: 'WEB_DUPLICATE_PROVIDER' }))
  })

  it('keeps search and fetch id namespaces independent', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('shared', available, () => Promise.resolve(searchResult('shared'))))
    expect(() => web.registerFetchProvider(makeFetchProvider('shared', available, fetchResult('shared')))).not.toThrow()
  })

  it('disposes provider registrations when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, web } = await mountWeb()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    }, { inject: ['web'] }))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
    await fiber.dispose()
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })
})

describe('WebRuntime execution resolution', () => {
  it('throws WEB_PROVIDER_UNAVAILABLE when nothing is registered', async () => {
    const { web } = await mountWeb()
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })

  it('throws WEB_PROVIDER_UNAVAILABLE when providers exist but none are usable', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }))
  })

  it('throws WEB_PROVIDER_CONFIGURED_MISSING for an unregistered configured id', async () => {
    const { web } = await mountWeb({ searchProvider: 'perplexity' })
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('throws WEB_PROVIDER_CONFIGURED_UNAVAILABLE for an unusable configured id', async () => {
    const { web } = await mountWeb({ searchProvider: 'exa' })
    web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('throws WEB_PROVIDER_AMBIGUOUS rather than picking by order', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    await expect(web.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_AMBIGUOUS' }))
  })

  it('runs the configured provider even when another usable provider is registered', async () => {
    const { web } = await mountWeb({ searchProvider: 'perplexity' })
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
  })

  it('ignores unusable providers when auto-selecting', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    web.registerSearchProvider(makeSearchProvider('perplexity', unavailable, () => Promise.resolve(searchResult('perplexity'))))
    await expect(web.search({ query: 'q' })).resolves.toMatchObject({ content: 'exa' })
  })

  it('does not let registration order change auto-selection', async () => {
    const a = await mountWeb()
    a.web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    a.web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    await expect(a.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })

    const b = await mountWeb()
    b.web.registerSearchProvider(makeSearchProvider('perplexity', available, () => Promise.resolve(searchResult('perplexity'))))
    b.web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('exa'))))
    await expect(b.web.search({ query: 'q' })).resolves.toMatchObject({ content: 'perplexity' })
  })

  it('runs the selected provider and returns its result', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(
      searchResult('exa', { content: 'answer', sources: [{ url: 'https://a' }] }),
    )))
    const result = await web.search({ query: 'q' })
    expect(result.content).toBe('answer')
    expect(result.sources).toEqual([{ url: 'https://a' }])
  })

  it('propagates the abort signal to the provider', async () => {
    const { web } = await mountWeb()
    const seen: (AbortSignal | undefined)[] = []
    web.registerSearchProvider({
      id: 'exa',
      available: () => available,
      search: (_request, signal) => { seen.push(signal); return Promise.resolve(searchResult('exa')) },
    })
    const controller = new AbortController()
    await web.search({ query: 'q' }, controller.signal)
    expect(seen[0]).toBe(controller.signal)
  })
})

describe('WebRuntime maxResults enforcement', () => {
  it('truncates sources and sets truncated when a provider over-returns', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa', {
      sources: [{ url: 'https://1' }, { url: 'https://2' }, { url: 'https://3' }],
    }))))
    const result = await web.search({ query: 'q', maxResults: 2 })
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('leaves truncated false when within the bound', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa', {
      sources: [{ url: 'https://1' }],
    }))))
    const result = await web.search({ query: 'q', maxResults: 8 })
    expect(result.sources).toHaveLength(1)
    expect(result.truncated).toBe(false)
  })

  it('does not bound when maxResults is omitted', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa', {
      sources: [{ url: 'https://1' }, { url: 'https://2' }],
    }))))
    const result = await web.search({ query: 'q' })
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })
})

describe('WebRuntime fetch capability', () => {
  it('resolves and runs the fetch provider independently of search', async () => {
    const { web } = await mountWeb()
    web.registerFetchProvider(makeFetchProvider('http', available, fetchResult('http')))
    const result = await web.fetch({ url: 'https://example.com' })
    expect(result.body.content).toBe('http')
    expect(result.statusCode).toBe(200)
  })

  it('throws WEB_PROVIDER_UNAVAILABLE for fetch when no fetch provider is registered', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', available, () => Promise.resolve(searchResult('exa'))))
    await expect(web.fetch({ url: 'https://example.com' })).rejects.toThrow(
      expect.objectContaining({ code: 'WEB_PROVIDER_UNAVAILABLE' }),
    )
  })
})

describe('WebError', () => {
  it('is a HarnessError carrying its code', () => {
    const error = new WebError('boom', 'WEB_INVALID_URL')
    expect(error.code).toBe('WEB_INVALID_URL')
    expect(error.name).toBe('WebError')
  })
})

describe('WebRuntime search fallback', () => {
  it('tries the chosen provider first, then falls back in order and says so', async () => {
    const { web } = await mountWeb({ searchProvider: 'google', searchFallback: true })
    const calls: string[] = []
    web.registerSearchProvider(makeSearchProvider('duckduckgo', available, () => { calls.push('duckduckgo'); return Promise.resolve(searchResult('ddg')) }))
    web.registerSearchProvider(makeSearchProvider('google', available, () => { calls.push('google'); return Promise.reject(new Error('CAPTCHA')) }))
    web.registerSearchProvider(makeSearchProvider('google-api', unavailable, () => Promise.resolve(searchResult('api'))))
    const result = await web.search({ query: 'x' })
    expect(calls).toEqual(['google', 'duckduckgo'])
    expect(result.content).toBe('Searched with duckduckgo after: google failed (CAPTCHA).\nddg')
  })

  it('uses the next usable provider when the chosen one is unavailable', async () => {
    const { web } = await mountWeb({ searchProvider: 'google-api', searchFallback: true })
    web.registerSearchProvider(makeSearchProvider('google-api', unavailable, () => Promise.resolve(searchResult('api'))))
    web.registerSearchProvider(makeSearchProvider('duckduckgo', available, () => Promise.resolve(searchResult('ddg'))))
    expect((await web.search({ query: 'x' })).content).toBe('ddg')
  })

  it('reports every attempt when all providers fail', async () => {
    const { web } = await mountWeb({ searchFallback: true })
    web.registerSearchProvider(makeSearchProvider('google', available, () => Promise.reject(new Error('blocked'))))
    web.registerSearchProvider(makeSearchProvider('duckduckgo', available, () => Promise.reject(new Error('HTTP 429'))))
    await expect(web.search({ query: 'x' })).rejects.toThrow('every search provider failed: google failed (blocked); duckduckgo failed (HTTP 429)')
  })

  it('stays strict when fallback is off', async () => {
    const { web } = await mountWeb({ searchProvider: 'google' })
    web.registerSearchProvider(makeSearchProvider('google', available, () => Promise.reject(new Error('blocked'))))
    web.registerSearchProvider(makeSearchProvider('duckduckgo', available, () => Promise.resolve(searchResult('ddg'))))
    await expect(web.search({ query: 'x' })).rejects.toThrow('blocked')
  })

  it('lists providers in fallback order with their availability', async () => {
    const { web } = await mountWeb()
    web.registerSearchProvider(makeSearchProvider('exa', unavailable, () => Promise.resolve(searchResult('e'))))
    web.registerSearchProvider(makeSearchProvider('duckduckgo', available, () => Promise.resolve(searchResult('d'))))
    web.registerSearchProvider(makeSearchProvider('google', available, () => Promise.resolve(searchResult('g'))))
    expect(web.searchProviderIds()).toEqual([
      { id: 'google', available: true },
      { id: 'duckduckgo', available: true },
      { id: 'exa', available: false },
    ])
  })
})
