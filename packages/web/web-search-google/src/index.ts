/**
 * `@fathom/web-search-google`: browser-backed and Google search
 * for `ctx.web`. Registers `google` and `bing` (keyless, each through a hidden
 * page of the shared browser; usable whenever `ctx.browser` is mounted) and
 * `google-api` (the Programmable Search JSON API; usable once `GOOGLE_API_KEY`
 * and `GOOGLE_CSE_ID` are stored as credentials or set in the environment).
 * @module @fathom/web-search-google
 */

import type { Context } from '@fathom/cordis'
import z from '@fathom/schemastery'
import type {} from '@fathom/web'
import type {} from '@fathom/browser'
import { credentialRef } from '@fathom/credentials'
import {
  GOOGLE_API_DEFAULT_BASE_URL,
  GOOGLE_DEFAULT_SEARCH_URL,
  GoogleApiSearchProvider,
  GoogleBrowserSearchProvider,
} from './provider.ts'
import type { ScratchPageRunner } from './provider.ts'
import { BING_DEFAULT_SEARCH_URL, BingBrowserSearchProvider } from './bing.ts'

export {
  BING_DEFAULT_SEARCH_URL,
  BING_PROVIDER_ID,
  BingBrowserSearchProvider,
  cleanBingHits,
  isNoResultsPage,
  resolveBingUrl,
} from './bing.ts'
export type { BingBrowserSearchProviderOptions, RawBingHit } from './bing.ts'

export {
  GOOGLE_API_DEFAULT_BASE_URL,
  GOOGLE_API_PROVIDER_ID,
  GOOGLE_DEFAULT_SEARCH_URL,
  GOOGLE_PROVIDER_ID,
  GoogleApiSearchProvider,
  GoogleBrowserSearchProvider,
  cleanHits,
  isBlockedPage,
} from './provider.ts'
export type {
  GoogleApiSearchProviderOptions,
  GoogleBrowserSearchProviderOptions,
  RawGoogleHit,
  ScratchPageRunner,
  SearchPage,
} from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-google'

/** The web seam both providers register into. */
export const inject = ['web']

/** Plugin config (all optional). */
export interface Config {
  /** Results page for the keyless provider. */
  searchURL?: string
  /** Interface language (`hl`) for the keyless provider; empty for Google's default. */
  language?: string
  /** Endpoint for the API provider. */
  apiBaseURL?: string
  /** Credential reference holding the API key. Defaults to `GOOGLE_API_KEY`. */
  apiKeyEnv?: string
  /** Credential reference holding the search-engine id (`cx`). Defaults to `GOOGLE_CSE_ID`. */
  engineIdEnv?: string
  /** Page-load / request timeout in milliseconds. Defaults to 20000. */
  timeoutMs?: number
  /** Results page for the keyless Bing provider. */
  bingSearchURL?: string
  /** Bing market (`mkt`, for example `en-US`, `en-IN`); empty for Bing's default. */
  bingMarket?: string
}

export const Config: z<Config> = z.object({
  searchURL: z.string(),
  language: z.string(),
  apiBaseURL: z.string(),
  apiKeyEnv: z.string(),
  engineIdEnv: z.string(),
  timeoutMs: z.natural(),
  bingSearchURL: z.string(),
  bingMarket: z.string(),
})

/** Register the Google, Bing and Google API search providers with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  const timeoutMs = config.timeoutMs ?? 20_000
  const runner = (): ScratchPageRunner | undefined => {
    const browser = ctx.get('browser')
    if (browser === undefined) return undefined
    return (work => browser.shared.withScratchPage(work)) as ScratchPageRunner
  }
  ctx.web.registerSearchProvider(new GoogleBrowserSearchProvider({
    runner,
    searchURL: config.searchURL ?? GOOGLE_DEFAULT_SEARCH_URL,
    language: config.language ?? 'en',
    timeoutMs,
  }))
  ctx.web.registerSearchProvider(new BingBrowserSearchProvider({
    runner,
    searchURL: config.bingSearchURL ?? BING_DEFAULT_SEARCH_URL,
    market: config.bingMarket ?? '',
    timeoutMs,
  }))

  const keyRef = credentialRef(config.apiKeyEnv ?? 'GOOGLE_API_KEY')
  const cxRef = credentialRef(config.engineIdEnv ?? 'GOOGLE_CSE_ID')
  const read = async (ref: ReturnType<typeof credentialRef>): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const resolved = await credentials.resolve(ref).catch(() => undefined)
      if (resolved !== undefined) return resolved.value
    }
    const fromEnv = process.env[ref]
    return fromEnv === undefined || fromEnv === '' ? undefined : fromEnv
  }
  let configured = false
  const refresh = async (): Promise<void> => {
    const [key, cx] = await Promise.all([read(keyRef), read(cxRef)])
    configured = key !== undefined && cx !== undefined
  }
  void refresh()
  ctx.on('credentials/reference-updated', (ref) => {
    if (ref === keyRef || ref === cxRef) void refresh()
  })
  ctx.web.registerSearchProvider(new GoogleApiSearchProvider({
    baseURL: config.apiBaseURL ?? GOOGLE_API_DEFAULT_BASE_URL,
    apiKey: () => read(keyRef),
    engineId: () => read(cxRef),
    configured: () => configured,
    timeoutMs,
  }))
}
