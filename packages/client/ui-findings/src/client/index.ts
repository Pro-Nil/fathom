/**
 * Findings surface plugin, browser half: the FindingsDock card in the
 * conversation.input.dock composer stack (order 12, after the goal bar).
 * Projection-mode surface — the live findings arrive through
 * `useProjection('findings')` (seeded by the history tail page, updated by
 * session/projection frames), so this plugin owns no store, refresh chain, or
 * event listener and registers no mutations (the panel is read-only).
 */
import type { ClientContext } from '@fathom/client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock entry).
import type {} from '@fathom/client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@fathom/client-locale/client'
// Type-only: the `findings` SessionProjectionMap key merge (the domain's pure outlet).
import type {} from '@fathom/tool-findings/client'
import { FindingsDock } from './FindingsDock.tsx'
import { en, type FindingsKey } from './locales.ts'

export { FindingsDock } from './FindingsDock.tsx'
export type { FindingsKey } from './locales.ts'

declare module '@fathom/client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The findings card's copy. */
    findings: FindingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'findings'

/** Required services: the UI slot registry and the locale registry. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the read-only FindingsDock entry in the composer stack.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { en }), 'ui-findings: dictionaries')
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'findings',
    order: 12,
    locale: NS,
  }, FindingsDock))
}
