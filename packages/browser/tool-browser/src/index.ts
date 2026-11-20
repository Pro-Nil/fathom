/**
 * Model-facing browser tools (`browser_*`) over the shared browser `ctx.browser`.
 * This package owns schemas, validation, limits, prompt guidance and result
 * formatting; the browser process, tabs and live view belong to
 * `@fathom/browser`.
 * @module @fathom/tool-browser
 */

import type { Context } from '@fathom/cordis'
import z from '@fathom/schemastery'
import type {} from '@fathom/browser'
import { applyBrowserTools } from './tools.ts'

export { applyBrowserTools, capText, interactiveLines } from './tools.ts'
export type { BrowserToolLimits } from './tools.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-browser'

/** Services required by the browser tool suite. */
export const inject = ['tools', 'systemPrompt', 'browser']

/** Default cap on characters returned by page reads. */
export const DEFAULT_BROWSER_MAX_CHARS = 40_000

/** Plugin config. */
export interface Config {
  /** Default and maximum characters returned by read_page, get_page_text and log reads. */
  maxChars?: number
}

export const Config: z<Config> = z.object({
  maxChars: z.natural().default(DEFAULT_BROWSER_MAX_CHARS),
})

/** Register the browser tools and their system-prompt guidance. */
export function apply(ctx: Context, config: Config): void {
  const maxChars = config.maxChars ?? DEFAULT_BROWSER_MAX_CHARS
  if (!Number.isInteger(maxChars) || maxChars < 1000) throw new Error('tool-browser: maxChars must be an integer of at least 1000')
  applyBrowserTools(ctx, { maxChars })
}
