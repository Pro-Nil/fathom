/**
 * Package-owned invariant companion for `@pentest-harness/dsh-client-ui-browser`.
 * @module @pentest-harness/dsh-client-ui-browser/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@pentest-harness/cordis'
import type { InvariantInstaller } from '@pentest-harness/dsh-invariants'

const PACKAGE_NAME = '@pentest-harness/dsh-client-ui-browser'

/** Cordis companion plugin name. */
export const name = 'client-ui-browser-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the pane keeps only local view state, and its one overlay
 * entry installs and leaves through one slot effect.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
