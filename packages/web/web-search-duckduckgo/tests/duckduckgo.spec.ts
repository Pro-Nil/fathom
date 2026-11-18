import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@pentest-harness/dsh-web'
import {
  DUCKDUCKGO_DEFAULT_BASE_URL, DuckDuckGoSearchProvider, decodeEntities, parseResults, resolveResultUrl,
} from '@pentest-harness/dsh-web-search-duckduckgo'

const PAGE = `
<div class="results">
  <div class="result results_links results_links_deep result--ad">
    <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=x">Sponsored thing</a>
    <a class="result__snippet" href="#">Buy now</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="https://owasp.org/projects/top-ten">OWASP Top 10 | OWASP <b>Foundation</b></a>
    </h2>
    <a class="result__snippet" href="https://owasp.org/projects/top-ten">The <b>OWASP</b> Top 10 is a standard awareness document &amp; more.</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&amp;rut=abc">Example &#x27;quoted&#x27;</a>
  </div>
  <div class="result results_links web-result ">
    <a rel="nofollow" class="result__a" href="https://owasp.org/projects/top-ten">Duplicate</a>
  </div>
</div>`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parsing', () => {
  it('returns organic results in order, skipping ads and duplicates', () => {
    expect(parseResults(PAGE)).toEqual([
      {
        url: 'https://owasp.org/projects/top-ten',
        title: 'OWASP Top 10 | OWASP Foundation',
        snippet: 'The OWASP Top 10 is a standard awareness document & more.',
      },
      { url: 'https://example.com/a?b=1', title: 'Example \'quoted\'' },
    ])
  })

  it('unwraps redirect links and rejects non-web links', () => {
    expect(resolveResultUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.test%2F')).toBe('https://a.test/')
    expect(resolveResultUrl('javascript:alert(1)')).toBeUndefined()
    expect(resolveResultUrl('https://duckduckgo.com/y.js?ad=1')).toBeUndefined()
  })

  it('decodes named and numeric entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x2F;')).toBe('a & b <c> \'d\' /')
  })
})

describe('DuckDuckGoSearchProvider', () => {
  const provider = new DuckDuckGoSearchProvider({ baseURL: DUCKDUCKGO_DEFAULT_BASE_URL, region: 'us-en' })

  it('needs no key to be available', () => {
    expect(provider.available()).toBe(true)
  })

  it('posts the query and region, and maps the page', async () => {
    const fetchMock = vi.fn(async () => new Response(PAGE, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await provider.search({ query: 'owasp top 10' })
    expect(result.sources).toHaveLength(2)
    expect(result.truncated).toBe(false)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBe('q=owasp+top+10&kl=us-en')
  })

  it('reports throttling as a provider error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<div class="anomaly-modal"></div>', { status: 202 })))
    await expect(provider.search({ query: 'x' })).rejects.toBeInstanceOf(WebError)
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }))
    await expect(provider.search({ query: 'x' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })
})
