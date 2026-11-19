/** Locale preference stored in the Host user-settings document. */

import z from '@pentest-harness/schemastery'

/** Settings namespace owned by the locale plugin. */
export const LOCALE_SETTINGS_NAMESPACE = 'locale'

/** Field carrying an explicit locale selection; absence delegates to the browser. */
export const LOCALE_PREFERENCE_FIELD = 'preference'

/** Locale identifiers shipped by the browser client. */
export const LOCALE_IDS = ['en'] as const

/** Shipped locale identifier. */
export type LocaleId = typeof LOCALE_IDS[number]

/** Durable locale section shared by the Host schema and the browser scope. */
export interface LocaleSettings {
  /**
   * Explicit locale selection; absence delegates to the browser. Typed as a
   * string so a selection saved by an older build (for example `zh`) still
   * loads; the runtime ignores ids it does not ship.
   */
  preference?: string
}

/** Durable locale schema; also the wire envelope the browser scope validates against. */
export const LocaleSettingsSchema: z<LocaleSettings> = z.object({
  [LOCALE_PREFERENCE_FIELD]: z.string().required(false),
})
