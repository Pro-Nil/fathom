/**
 * `@fathom/web-search-duckduckgo`: registers a keyless,
 * DuckDuckGo-backed `WebSearchProvider` with `ctx.web`, so `web_search` works
 * without an account or a paid API. Like the other search providers it
 * registers INTO the seam owned by `@fathom/web`.
 * @module @fathom/web-search-duckduckgo
 */

import type { Context } from '@fathom/cordis'
import z from '@fathom/schemastery'
import type {} from '@fathom/web'
import { DUCKDUCKGO_DEFAULT_BASE_URL, DuckDuckGoSearchProvider } from './provider.ts'

export {
  DUCKDUCKGO_DEFAULT_BASE_URL,
  DUCKDUCKGO_PROVIDER_ID,
  DuckDuckGoSearchProvider,
  decodeEntities,
  parseResults,
  resolveResultUrl,
} from './provider.ts'
export type { DuckDuckGoSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-duckduckgo'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional). */
export interface Config {
  /** Results page the query is posted to. Defaults to DuckDuckGo's HTML page. */
  baseURL?: string
  /** Region code sent as `kl` (for example `us-en`, `in-en`). Omitted = DuckDuckGo's default. */
  region?: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
  region: z.string(),
})

/** Register the DuckDuckGo search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({
    baseURL: config.baseURL ?? DUCKDUCKGO_DEFAULT_BASE_URL,
    region: config.region ?? '',
  }))
}
