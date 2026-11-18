import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { SharedBrowser } from '@pentest-harness/dsh-browser'
import { HandoffGuard, MAX_FAILED_LOGINS, inspectPage } from '../src/handoff.ts'

const page = (html: string): string => `data:text/html,${encodeURIComponent(html)}`

// Real browser: the harness's own Chromium, headless, on a throwaway profile.
describe('HandoffGuard (real Chromium)', () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'dsh-handoff-test-'))
  const browser = new SharedBrowser({ channel: 'chromium', headless: true, profileDir, width: 800, height: 600, searchUrl: 'https://duckduckgo.com/?q=%s' })
  afterAll(async () => {
    await browser.dispose()
    rmSync(profileDir, { recursive: true, force: true })
  })

  it('refuses to act on a CAPTCHA page until the user has been asked', async () => {
    const guard = new HandoffGuard()
    await browser.navigate(page('<title>Shop</title><div class="g-recaptcha" style="width:300px;height:78px"></div><button>Buy</button>'))
    const current = await browser.page()
    expect((await inspectPage(current)).captcha).toBe('reCAPTCHA')
    expect(await guard.note(current)).toContain('[Handoff required] reCAPTCHA')
    await expect(guard.beforeAction(current, false)).rejects.toThrow(/reCAPTCHA .*ask_user_question/u)
    // The user answered: a solved widget stays visible, so the host is cleared.
    guard.release()
    await expect(guard.beforeAction(current, false)).resolves.toBeUndefined()
    expect(await guard.note(current)).toBe('')
  }, 60_000)

  it('recognises a "verify you are human" interstitial by its text', async () => {
    await browser.navigate(page('<title>Just a moment...</title><p>Verify you are human by completing the action below.</p>'))
    expect((await inspectPage(await browser.page())).captcha).toBe('human-verification check')
  }, 60_000)

  it(`blocks password entry after ${MAX_FAILED_LOGINS} failed sign-ins and lifts after the user answers`, async () => {
    const guard = new HandoffGuard()
    await browser.navigate(page('<title>Sign in</title><input name="u"><input type="password" name="p"><button>Sign in</button>'))
    const current = await browser.page()
    expect(await guard.note(current)).toContain('Failed attempts on')
    // First entry, then two retries while the form is still there.
    await guard.beforeAction(current, true)
    await guard.beforeAction(current, true)
    await expect(guard.beforeAction(current, true)).rejects.toThrow(/failed 2 times.*ask_user_question/u)
    // Clicking around is still allowed; only password entry waits.
    await expect(guard.beforeAction(current, false)).resolves.toBeUndefined()
    guard.release()
    await expect(guard.beforeAction(current, true)).resolves.toBeUndefined()
  }, 60_000)

  it('treats the sign-in form disappearing as success', async () => {
    const guard = new HandoffGuard()
    const login = page('<title>Sign in</title><input type="password"><button>Go</button>')
    await browser.navigate(login)
    await guard.beforeAction(await browser.page(), true)
    await guard.beforeAction(await browser.page(), true)
    // Same host, no password field any more: signed in, counter resets.
    await browser.page().then(p => p.evaluate(() => { document.querySelector('input')?.remove() }))
    await guard.beforeAction(await browser.page(), false)
    await browser.page().then(p => p.evaluate(() => { document.body.insertAdjacentHTML('beforeend', '<input type="password">') }))
    await guard.beforeAction(await browser.page(), true)
    await expect(guard.beforeAction(await browser.page(), true)).resolves.toBeUndefined()
  }, 60_000)
})
