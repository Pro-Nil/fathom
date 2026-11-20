/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never depends
 * on registration order.
 * @module @fathom/web
 */

import { Context, Service } from '@fathom/cordis'
import z from '@fathom/schemastery'
import { installSettingsSection, settingsNamespace } from '@fathom/settings'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

declare module '@fathom/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/**
 * Config for the web seam. `searchProvider` / `fetchProvider` pin which provider
 * wins for each capability; both are optional (a single registered usable
 * provider auto-selects). Operational overrides such as environment variables
 * must feed these same fields rather than introduce a hidden priority chain.
 */
export interface WebRuntimeConfig {
  /** Explicit search provider id. Omitted = auto-select when exactly one usable. */
  readonly searchProvider?: string
  /** Explicit fetch provider id. Omitted = auto-select when exactly one usable. */
  readonly fetchProvider?: string
  /**
   * When the chosen search provider fails (rate limit, block, network) or is
   * unavailable, try the other usable providers in {@link SEARCH_FALLBACK_ORDER}.
   * Defaults to false (strict selection).
   */
  readonly searchFallback?: boolean
  /** Expose `searchProvider` / `searchFallback` as the live `web-search` settings section. */
  readonly settings?: boolean
}

/** The user-editable search selection (`web-search` settings section). */
export interface WebSearchSettings {
  /** Chosen search provider id; empty means auto-select. */
  searchProvider?: string
  /** Fall back to other usable providers when the chosen one fails. */
  searchFallback?: boolean
}

/** Settings namespace of the search selection. */
export const WEB_SEARCH_SETTINGS_NAMESPACE = 'web-search'

/** Schema of the `web-search` settings section. */
export const WEB_SEARCH_SETTINGS_SCHEMA: z<WebSearchSettings> = z.object({
  searchProvider: z.string(),
  searchFallback: z.boolean(),
})

/**
 * Order the seam tries providers after the chosen one fails. Ids not listed
 * follow in registration order; unregistered or unavailable ones are skipped.
 */
export const SEARCH_FALLBACK_ORDER: readonly string[] = ['google', 'google-api', 'bing', 'duckduckgo', 'exa', 'perplexity']

/**
 * The web access service. Registered as `ctx.web` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$FATHOM_WEB_SEARCH_PROVIDER` / `$FATHOM_WEB_FETCH_PROVIDER` are equivalent to
   * `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
   */
  static Config: z<WebRuntimeConfig> = z.object({
    searchProvider: z.string(),
    fetchProvider: z.string(),
    searchFallback: z.boolean(),
    settings: z.boolean(),
  })

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private searchSettings: () => WebSearchSettings
  private readonly fetchProviderId: string | undefined

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    const searchProvider = config.searchProvider ?? process.env.FATHOM_WEB_SEARCH_PROVIDER
    const entry: WebSearchSettings = {
      ...searchProvider === undefined ? {} : { searchProvider },
      searchFallback: config.searchFallback ?? false,
    }
    this.searchSettings = () => entry
    this.fetchProviderId = config.fetchProvider ?? process.env.FATHOM_WEB_FETCH_PROVIDER
    if (config.settings === true) {
      installSettingsSection(ctx, settingsNamespace(WEB_SEARCH_SETTINGS_NAMESPACE), WEB_SEARCH_SETTINGS_SCHEMA, entry, {
        setSource: (current) => { this.searchSettings = current },
        // Read at every search, so a change applies to the next one.
        onChange: () => {},
      })
    }
  }

  /**
   * The registered search providers and whether each can run now, in the
   * order the fallback tries them.
   * @returns provider ids with their availability.
   */
  searchProviderIds(): { id: string; available: boolean }[] {
    return orderedProviders(this.searchProviders, undefined).map(provider => ({ id: provider.id, available: provider.available() }))
  }

  /**
   * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for fetch. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one search through the selected provider. Resolves the provider at call
   * time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. The seam enforces `request.maxResults` on the result:
   * if the provider over-returns, `sources[]` is truncated and `truncated` set.
   * @param request - the query and optional result limit.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the provider's results, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const settings = this.searchSettings()
    const configuredId = settings.searchProvider === undefined || settings.searchProvider.trim() === ''
      ? undefined
      : settings.searchProvider.trim()
    if (settings.searchFallback === false) {
      const provider = resolveProvider({
        providers: this.searchProviders,
        ...configuredId !== undefined ? { configuredId } : {},
      })
      return capSources(await provider.search(request, signal), request.maxResults)
    }
    // Chosen provider first, then the rest in fallback order; each failure is
    // kept so the final error explains every attempt.
    const candidates = orderedProviders(this.searchProviders, configuredId).filter(provider => provider.available())
    if (candidates.length === 0) {
      throw new WebError(configuredId === undefined
        ? 'no usable web search provider is registered'
        : `configured web provider "${configuredId}" is unavailable and no other search provider is usable`,
      configuredId === undefined ? 'WEB_PROVIDER_UNAVAILABLE' : 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    const failures: string[] = []
    for (const provider of candidates) {
      signal?.throwIfAborted()
      try {
        const result = await provider.search(request, signal)
        const note = failures.length === 0 ? undefined : `Searched with ${provider.id} after: ${failures.join('; ')}.`
        return capSources(note === undefined ? result : { ...result, content: [note, result.content].filter(Boolean).join('\n') }, request.maxResults)
      } catch (error: unknown) {
        if (signal?.aborted === true) throw error
        failures.push(`${provider.id} failed (${error instanceof Error ? error.message : String(error)})`)
      }
    }
    throw new WebError(`every search provider failed: ${failures.join('; ')}`, 'WEB_PROVIDER_UNAVAILABLE')
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const provider = resolveProvider({
      providers: this.fetchProviders,
      ...this.fetchProviderId !== undefined ? { configuredId: this.fetchProviderId } : {},
    })
    return provider.fetch(request, signal)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

/**
 * Providers in the order a search tries them: the configured id first, then
 * {@link SEARCH_FALLBACK_ORDER}, then any others in registration order.
 */
function orderedProviders<P extends ResolvableProvider>(providers: ReadonlyMap<string, P>, configuredId: string | undefined): P[] {
  const ids = [...new Set([
    ...configuredId === undefined ? [] : [configuredId],
    ...SEARCH_FALLBACK_ORDER,
    ...providers.keys(),
  ])]
  return ids.map(id => providers.get(id)).filter((provider): provider is P => provider !== undefined)
}

/** Resolve the selected provider or throw the matching {@link WebError}. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) {
    throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

/** Enforce `maxResults` on a search result: truncate `sources[]` and flag it. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime
