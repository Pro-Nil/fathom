/**
 * Human handoff for CAPTCHAs and failed logins.
 *
 * Models guess at sign-in flows and try to solve CAPTCHAs themselves. This
 * guard enforces the handoff in the tools that act on the page, not in prompt
 * text alone:
 *
 * - While a CAPTCHA (reCAPTCHA, hCaptcha, Cloudflare Turnstile / challenge,
 *   Arkose/FunCaptcha, PerimeterX, DataDome, GeeTest, or a "verify you are
 *   human" page) is on the page, every acting tool is refused with an
 *   instruction to ask the user. Reading tools keep working.
 * - Each time a password is entered on a host while the page still shows a
 *   password field from an earlier entry, that host gets one failed attempt.
 *   After {@link MAX_FAILED_LOGINS} failures further password entry on that
 *   host is refused until the user is asked.
 *
 * A successful `ask_user_question` call releases both blocks: the user has had
 * the chance to solve the CAPTCHA or sign in in the Browser pane.
 * @module @pentest-harness/dsh-tool-browser/src/handoff
 */

import type { Page } from 'playwright-core'

/** Failed sign-in attempts allowed per host before the agent must ask the user. */
/** Interstitial wording of human-verification pages (Cloudflare, reCAPTCHA, press-and-hold). */
const HUMAN_CHECK_TEXT = new RegExp([
  String.raw`verify (that )?you('| a)re (a )?human`,
  String.raw`i('|’)?m not a robot`,
  'are you a robot',
  'complete the security check',
  'press (&|and) hold',
  'checking (if the site connection is secure|your browser)',
].join('|'), 'iu')

export const MAX_FAILED_LOGINS = 2

/** What the page shows that matters for handoff. */
export interface PageSignals {
  /** Short CAPTCHA kind ("reCAPTCHA", "hCaptcha", …) or undefined. */
  captcha?: string
  /** A visible password field is on the page. */
  passwordField: boolean
  /** The focused element is a password field. */
  passwordFocused: boolean
}

/** Frame URL fragments that identify CAPTCHA widgets. */
const CAPTCHA_FRAMES: readonly (readonly [RegExp, string])[] = [
  [/google\.com\/recaptcha|recaptcha\.net|gstatic\.com\/recaptcha/iu, 'reCAPTCHA'],
  [/hcaptcha\.com/iu, 'hCaptcha'],
  [/challenges\.cloudflare\.com/iu, 'Cloudflare Turnstile'],
  [/arkoselabs\.com|funcaptcha\.com/iu, 'Arkose/FunCaptcha'],
  [/captcha-delivery\.com|datadome/iu, 'DataDome'],
  [/geetest\.com/iu, 'GeeTest'],
]

/**
 * Inspect the page for CAPTCHAs and password fields.
 * @param page - the page about to be acted on.
 * @returns the handoff-relevant signals; detection failures read as "nothing found".
 */
export async function inspectPage(page: Page): Promise<PageSignals> {
  let captcha: string | undefined
  for (const frame of page.frames()) {
    const url = frame.url()
    const hit = CAPTCHA_FRAMES.find(([pattern]) => pattern.test(url))
    if (hit !== undefined) {
      captcha = hit[1]
      break
    }
  }
  try {
    const dom = await page.evaluate((humanCheck: string) => {
      const visible = (element: Element): boolean => {
        const box = (element as HTMLElement).getBoundingClientRect()
        const style = getComputedStyle(element)
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }
      const widget = [
        ['.g-recaptcha, [data-sitekey][class*="recaptcha"]', 'reCAPTCHA'],
        ['.h-captcha, [data-hcaptcha-widget-id]', 'hCaptcha'],
        ['.cf-turnstile, #challenge-form, #cf-challenge-running', 'Cloudflare challenge'],
        ['#px-captcha', 'PerimeterX'],
        ['#FunCaptcha, [id^="arkose"]', 'Arkose/FunCaptcha'],
        ['.geetest_holder, .geetest_panel', 'GeeTest'],
        ['iframe[title*="captcha" i], img[alt*="captcha" i], input[name*="captcha" i]', 'CAPTCHA'],
      ].find(([selector]) => [...document.querySelectorAll(selector as string)].some(visible))?.[1]
      const text = (document.body?.innerText ?? '').slice(0, 4000)
      const phrase = new RegExp(humanCheck, 'iu').test(text)
        || /^just a moment/iu.test(document.title)
      const password = [...document.querySelectorAll('input[type="password"]')].some(visible)
      const active = document.activeElement
      const focused = active instanceof HTMLInputElement && active.type === 'password'
      return { widget, phrase, password, focused }
    }, HUMAN_CHECK_TEXT.source)
    captcha ??= dom.widget ?? (dom.phrase ? 'human-verification check' : undefined)
    return { ...captcha === undefined ? {} : { captcha }, passwordField: dom.password, passwordFocused: dom.focused }
  } catch {
    return { ...captcha === undefined ? {} : { captcha }, passwordField: false, passwordFocused: false }
  }
}

/** Host of a page URL, or the raw URL when it has none. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** Per-host sign-in state. */
interface LoginState {
  /** A password was entered and the outcome is not known yet. */
  pending: boolean
  failures: number
}

/** Enforces the CAPTCHA / failed-login handoff for one tool suite. */
export class HandoffGuard {
  private readonly logins = new Map<string, LoginState>()
  /** Hosts whose CAPTCHA blocked an action and is waiting for the user. */
  private readonly captchaWaiting = new Set<string>()
  /** Hosts where the user had the chance to solve the CAPTCHA (solved widgets stay visible). */
  private readonly captchaCleared = new Set<string>()

  /**
   * Gate an acting tool. Throws when the agent must ask the user first.
   * @param page - the page about to be acted on.
   * @param entersPassword - the action types or sets a password.
   */
  async beforeAction(page: Page, entersPassword: boolean): Promise<void> {
    const signals = await inspectPage(page)
    const host = hostOf(page.url())
    if (signals.captcha !== undefined && !this.captchaCleared.has(host)) {
      this.captchaWaiting.add(host)
      throw new Error(`${signals.captcha} on ${host}. Do not try to solve it or work around it. Call ask_user_question now and ask the user to complete it in the Browser pane; continue after they answer.`)
    }
    const state = this.logins.get(host)
    if (state !== undefined && !signals.passwordField) {
      // The sign-in form is gone: the last attempt worked.
      this.logins.delete(host)
      return
    }
    if (!entersPassword) return
    const current = state ?? { pending: false, failures: 0 }
    // A new password entry while the form from the previous one is still here
    // means the previous attempt failed.
    if (current.pending && signals.passwordField) current.failures += 1
    if (current.failures >= MAX_FAILED_LOGINS) {
      this.logins.set(host, current)
      throw new Error(`Sign-in on ${host} has failed ${current.failures} times. Do not guess credentials or try other sign-in routes. Call ask_user_question now and ask the user to sign in in the Browser pane (or give the correct credentials); continue after they answer.`)
    }
    current.pending = true
    this.logins.set(host, current)
  }

  /**
   * A note appended to read results so the model learns about a CAPTCHA or a
   * sign-in form before it starts acting.
   * @param page - the page just read.
   * @returns a note, or an empty string.
   */
  async note(page: Page): Promise<string> {
    const signals = await inspectPage(page)
    const host = hostOf(page.url())
    if (signals.captcha !== undefined && !this.captchaCleared.has(host)) {
      return `\n\n[Handoff required] ${signals.captcha} on ${host}. Do not try to solve it: call ask_user_question and ask the user to complete it in the Browser pane.`
    }
    const state = this.logins.get(host)
    if (state !== undefined && !signals.passwordField) this.logins.delete(host)
    if (signals.passwordField) {
      const failures = this.logins.get(host)?.failures ?? 0
      return `\n\n[Sign-in form] Use only credentials the user gave you. Failed attempts on ${host}: ${failures}/${MAX_FAILED_LOGINS}; after ${MAX_FAILED_LOGINS} failures you must ask the user (ask_user_question) to sign in in the Browser pane.`
    }
    return ''
  }

  /** The user answered a question: they had the chance to solve or sign in. */
  release(): void {
    this.logins.clear()
    for (const host of this.captchaWaiting) this.captchaCleared.add(host)
    this.captchaWaiting.clear()
  }
}
