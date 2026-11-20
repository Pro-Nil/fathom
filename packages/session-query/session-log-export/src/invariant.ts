/** Package invariant companion for `@fathom/session-log-export`. */

/* jscpd:ignore-start */
import type { Context } from '@fathom/cordis'
import type { InvariantInstaller } from '@fathom/invariants'

const PACKAGE_NAME = '@fathom/session-log-export'

export const name = 'session-export-invariant'
export const inject = ['invariants']

/** No runtime invariant: the command registry owns lifecycle pairing and ApiProxy owns ZIP integrity. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Host context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
