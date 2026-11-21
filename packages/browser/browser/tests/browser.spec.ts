import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_SEARCH_FALLBACK_URLS,
  DEFAULT_SEARCH_URL,
  SharedBrowser,
  isChallengePage,
  isTrustedViewerRequest,
  normalizeUrl,
  resolveAddress,
  searchQuery,
  toPlaywrightChord,
} from '@fathom/browser'

describe('normalizeUrl', () => {
  it('adds https to bare hosts and http to loopback', () => {
    expect(normalizeUrl('example.com/a')).toBe('https://example.com/a')
    expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeUrl('127.0.0.1:2323/x')).toBe('http://127.0.0.1:2323/x')
    expect(normalizeUrl(' https://a.test ')).toBe('https://a.test')
    expect(normalizeUrl('about:blank')).toBe('about:blank')
    expect(normalizeUrl('example.com:8080')).toBe('https://example.com:8080')
  })
})

describe('resolveAddress', () => {
  const search = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  it('searches text that is not an address, like a browser omnibox', () => {
    expect(resolveAddress('hh', DEFAULT_SEARCH_URL)).toBe(search('hh'))
    expect(resolveAddress('owasp top 10', DEFAULT_SEARCH_URL)).toBe(search('owasp top 10'))
    expect(resolveAddress('what is example.com', DEFAULT_SEARCH_URL)).toBe(search('what is example.com'))
    expect(resolveAddress('hh', 'https://www.google.com/search?q=%s')).toBe('https://www.google.com/search?q=hh')
  })
  it('opens hosts, IPs, ports and schemes directly', () => {
    expect(resolveAddress('example.com', DEFAULT_SEARCH_URL)).toBe('https://example.com')
    expect(resolveAddress('10.0.0.1', DEFAULT_SEARCH_URL)).toBe('https://10.0.0.1')
    expect(resolveAddress('intranet:8080/x', DEFAULT_SEARCH_URL)).toBe('https://intranet:8080/x')
    expect(resolveAddress('localhost', DEFAULT_SEARCH_URL)).toBe('http://localhost')
    expect(resolveAddress('chrome://version', DEFAULT_SEARCH_URL)).toBe('chrome://version')
    expect(resolveAddress('   ', DEFAULT_SEARCH_URL)).toBe('about:blank')
  })
})

describe('toPlaywrightChord', () => {
  it('maps Claude-style chords to Playwright key names', () => {
    expect(toPlaywrightChord('ctrl+a')).toBe('Control+a')
    expect(toPlaywrightChord('cmd+shift+t')).toBe('Meta+Shift+t')
    expect(toPlaywrightChord('Return')).toBe('Enter')
    expect(toPlaywrightChord('f5')).toBe('F5')
    expect(toPlaywrightChord('Backspace')).toBe('Backspace')
  })
})

describe('isTrustedViewerRequest', () => {
  const req = (headers: Record<string, string>) => ({ headers })
  it('accepts loopback hosts with a matching or absent origin', () => {
    expect(isTrustedViewerRequest(req({ host: '127.0.0.1:2323' }))).toBe(true)
    expect(isTrustedViewerRequest(req({ host: 'localhost:2323', origin: 'http://localhost:2323' }))).toBe(true)
    expect(isTrustedViewerRequest(req({ host: '[::1]:2323' }))).toBe(true)
  })
  it('refuses foreign hosts, cross-site requests and mismatched origins', () => {
    expect(isTrustedViewerRequest(req({ host: 'evil.test' }))).toBe(false)
    expect(isTrustedViewerRequest(req({}))).toBe(false)
    expect(isTrustedViewerRequest(req({ host: '127.0.0.1:2323', origin: 'http://evil.test' }))).toBe(false)
    expect(isTrustedViewerRequest(req({ host: '127.0.0.1:2323', 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(isTrustedViewerRequest(req({ host: '127.0.0.1:2323', origin: 'null' }))).toBe(false)
  })
})

describe('search engines', () => {
  it('defaults to Google, then Bing, then DuckDuckGo', () => {
    expect(DEFAULT_SEARCH_URL).toBe('https://www.google.com/search?q=%s')
    expect(DEFAULT_SEARCH_FALLBACK_URLS).toEqual(['https://www.bing.com/search?q=%s', 'https://duckduckgo.com/?q=%s'])
  })

  it('tells searches from addresses', () => {
    expect(searchQuery('owasp top 10')).toBe('owasp top 10')
    expect(searchQuery('xss')).toBe('xss')
    expect(searchQuery('example.com')).toBeUndefined()
    expect(searchQuery('localhost:3000')).toBeUndefined()
    expect(searchQuery('https://a.test/?q=1')).toBeUndefined()
  })

  it('recognizes challenge pages without flagging long results pages', () => {
    expect(isChallengePage('https://www.google.com/sorry/index?continue=x', '', false)).toBe(true)
    expect(isChallengePage('https://www.google.co.in/sorry/index', 'x'.repeat(3000), false)).toBe(true)
    expect(isChallengePage('https://x.test/', 'Our systems have detected unusual traffic from your computer network.', false)).toBe(true)
    expect(isChallengePage('https://x.test/', 'Just a moment... Verify you are human by completing the action below.', false)).toBe(true)
    expect(isChallengePage('https://x.test/', 'Log in', true)).toBe(true)
    const results = `Web results ${'Cloudflare explains how to verify you are human with Turnstile. '.repeat(40)}`
    expect(isChallengePage('https://www.google.com/search?q=turnstile', results, true)).toBe(false)
    expect(isChallengePage('https://example.com/', 'Welcome to the shop', false)).toBe(false)
  })
})

// Real browser: launches the harness's own Chromium headless on a throwaway profile.
describe('SharedBrowser (real Chromium)', () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'fathom-browser-test-'))
  const browser = new SharedBrowser({ channel: 'chromium', headless: true, profileDir, width: 800, height: 600, searchUrl: DEFAULT_SEARCH_URL })
  afterAll(async () => {
    await browser.dispose()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('falls back to the next search engine when one answers with a challenge', async () => {
    const challenge = `data:text/html,${encodeURIComponent('<p>Our systems have detected unusual traffic</p>')}%s`
    const ok = `data:text/html,${encodeURIComponent('<title>engine-two</title><p>results for</p>')}%s`
    const fallback = new SharedBrowser({
      channel: 'chromium', headless: true, profileDir: mkdtempSync(join(tmpdir(), 'fathom-browser-fallback-')),
      width: 800, height: 600, searchUrl: challenge, searchFallbackUrls: [ok],
    })
    try {
      await fallback.navigate('find me')
      const page = await fallback.page()
      expect(await page.title()).toBe('engine-two')
      expect(await page.evaluate(() => navigator.webdriver)).toBe(false)
      expect(await page.evaluate(() => navigator.userAgent)).not.toContain('HeadlessChrome')
    } finally {
      await fallback.dispose()
    }
  })

  it('reads a page as an AI snapshot, clicks a ref, and streams frames to a viewer', async () => {
    const html = '<title>Probe</title><button onclick="document.title=\'clicked\';console.log(\'hit\')">Press me</button>'
    await browser.navigate(`data:text/html,${encodeURIComponent(html)}`)
    const page = await browser.page()
    const snapshot = await page.ariaSnapshot({ mode: 'ai' })
    const ref = /button "Press me" \[ref=(e\d+)\]/u.exec(snapshot)?.[1]
    expect(ref).toBeDefined()
    await (await browser.locate(ref as string)).click()
    expect(await page.title()).toBe('clicked')
    expect((await browser.consoleOf()).some(entry => entry.text === 'hit')).toBe(true)

    const messages: string[] = []
    const detach = browser.attachViewer({ send: (message) => { messages.push(message) } })
    const deadline = Date.now() + 10_000
    while (!messages.some(m => m.startsWith('{"type":"frame"')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100))
    detach()
    expect(messages.some(m => m.startsWith('{"type":"tabs"'))).toBe(true)
    expect(messages.some(m => m.startsWith('{"type":"frame"'))).toBe(true)

    await browser.handleViewerMessage(JSON.stringify({ type: 'newTab', url: 'about:blank' }))
    const tabs = await browser.listTabs()
    expect(tabs).toHaveLength(2)
    expect(tabs.find(tab => tab.active)?.id).toBe(tabs[1]?.id)
  }, 60_000)

  it('keeps each session in its own tabs', async () => {
    const page = (title: string): string => `data:text/html,${encodeURIComponent(`<title>${title}</title>`)}`
    const alpha = browser.scope('session-alpha')
    const beta = browser.scope('session-beta')

    // The user opens a tab; the first session to act takes it, the second gets its own.
    await browser.handleViewerMessage(JSON.stringify({ type: 'newTab', url: page('user page') }))
    const userTab = (await browser.listTabs()).find(tab => tab.active)?.id
    expect((await alpha.listTabs()).find(tab => tab.id === userTab)?.unclaimed).toBe(true)
    await alpha.navigate(page('alpha page'))
    expect(await alpha.activeTabId()).toBe(userTab)
    await beta.navigate(page('beta page'))
    const betaTab = await beta.activeTabId()
    expect(betaTab).not.toBe(userTab)

    // Each keeps acting on its own page, whatever the other or the user does.
    await browser.handleViewerMessage(JSON.stringify({ type: 'selectTab', tabId: betaTab }))
    expect(await (await alpha.page()).title()).toBe('alpha page')
    expect(await (await beta.page()).title()).toBe('beta page')

    // Neither sees nor reaches the other's tabs; the user's view sees both.
    expect((await alpha.listTabs()).map(tab => tab.id)).not.toContain(betaTab)
    expect((await beta.listTabs()).map(tab => tab.id)).not.toContain(userTab)
    await expect(alpha.page(betaTab)).rejects.toThrow(/belongs to another session/u)
    await expect(beta.closeTab(userTab as string)).rejects.toThrow(/belongs to another session/u)
    const all = (await browser.listTabs()).map(tab => tab.id)
    expect(all).toContain(userTab)
    expect(all).toContain(betaTab)

    // A tab a session opens is its new current one.
    const second = await alpha.createTab(page('alpha second'))
    expect(await alpha.activeTabId()).toBe(second)
    expect(await (await beta.page()).title()).toBe('beta page')
    await alpha.closeTab(second)
    expect(await alpha.activeTabId()).toBe(userTab)
  }, 60_000)

  it('hands a page file chooser to the viewer and fills it with the picked file', async () => {
    const html = '<input type="file" id="f"><script>f.onchange=()=>{f.files[0].text().then(t=>{document.title=f.files[0].name+":"+t})}</script>'
    await browser.navigate(`data:text/html,${encodeURIComponent(html)}`)
    const messages: string[] = []
    const detach = browser.attachViewer({ send: (message) => { messages.push(message) } })
    const page = await browser.page()
    await page.locator('#f').click()
    const deadline = Date.now() + 5000
    while (!messages.some(m => m.startsWith('{"type":"filechooser"')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
    expect(messages.some(m => m.startsWith('{"type":"filechooser"'))).toBe(true)
    await browser.handleViewerMessage(JSON.stringify({ type: 'files', files: [{ name: 'a.txt', mimeType: 'text/plain', data: Buffer.from('hello').toString('base64') }, { bogus: true }] }))
    await page.waitForFunction(() => document.title.startsWith('a.txt'))
    expect(await page.title()).toBe('a.txt:hello')
    detach()
  }, 30_000)

  it('searches address-bar text that is not an address', async () => {
    const page = await browser.page()
    let requested = ''
    await page.route('https://www.google.com/**', async (route) => {
      requested = route.request().url()
      await route.fulfill({ body: `<title>search</title>${'<p>result</p>'.repeat(5)}`, contentType: 'text/html' })
    })
    await browser.handleViewerMessage(JSON.stringify({ type: 'navigate', url: 'hh' }))
    expect(requested).toBe('https://www.google.com/search?q=hh')
    await page.unrouteAll()
  })

  it('sends a frame at the new size after a resize, even on a page that does not repaint', async () => {
    await browser.navigate('about:blank')
    const frames: { width: number; height: number }[] = []
    const detach = browser.attachViewer({
      send: (message) => {
        if (message.startsWith('{"type":"frame"')) {
          const frame = JSON.parse(message) as { width: number; height: number }
          frames.push({ width: frame.width, height: frame.height })
        }
      },
    })
    const waitFor = async (match: (f: { width: number; height: number }) => boolean): Promise<boolean> => {
      const deadline = Date.now() + 8000
      while (!frames.some(match) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
      return frames.some(match)
    }
    expect(await waitFor(() => true)).toBe(true)
    await browser.handleViewerMessage(JSON.stringify({ type: 'resize', width: 517, height: 733 }))
    expect(await waitFor(f => f.width === 517 && f.height === 733)).toBe(true)
    detach()
  }, 30_000)

  it('rejects malformed refs before touching the page', async () => {
    await expect(browser.locate('e1"] , css=body')).rejects.toThrow(/not an element ref/u)
  })
})
