/**
 * Package-owned invariant companion for `@fathom/session-checkpoint-policy`.
 * @module @fathom/session-checkpoint-policy/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@fathom/cordis'
import type { InvariantInstaller } from '@fathom/invariants'

const PACKAGE_NAME = '@fathom/session-checkpoint-policy'

/** Cordis companion plugin name. */
export const name = 'session-checkpoint-policy-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: checkpoint ordering is enforced at the intercepted waterfall and
 * persistence seams; this stateless policy owns no independent mutable relation.
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
