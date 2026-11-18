import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SharedBrowser, isTrustedViewerRequest, normalizeUrl, toPlaywrightChord } from '@pentest-harness/dsh-browser'

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

// Real browser: launches the installed Edge headless on a throwaway profile.
describe('SharedBrowser (real Edge)', () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-browser-test-'))
  const browser = new SharedBrowser({ channel: 'msedge', headless: true, profileDir, width: 800, height: 600 })
  afterAll(async () => {
    await browser.dispose()
    rmSync(profileDir, { recursive: true, force: true })
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

  it('rejects malformed refs before touching the page', async () => {
    await expect(browser.locate('e1"] , css=body')).rejects.toThrow(/not an element ref/u)
  })
})
