/**
 * Remote namespaces the Session cluster calls. One parameter for one concept:
 * the generated surface a Session and its manager reach the Host through.
 *
 * @module @fathom/client-runtime/client/sessions/remotes
 */

import type { Context } from '@fathom/cordis'
import type {} from '@fathom/api-remotes/client'

/** The generated Remote namespaces a Session and its manager call. */
export type SessionRemotes = Pick<Context['remote'], 'commands'>
