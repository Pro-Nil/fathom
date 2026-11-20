import { describe, expect, it } from 'vitest'
import { Context } from '@fathom/cordis'
import SessionStore, { SessionId } from '@fathom/session'
import TypertRegistry from '@fathom/typert-registry'

describe('Session Typert provider', () => {
  it('contributes live Session lookup in either service load order', async () => {
    const ctx = new Context()
    const sessionFiber = ctx.plugin(SessionStore)
    await sessionFiber
    await ctx.plugin(TypertRegistry)
    const session = ctx.sessions.create(SessionId('remote-session'))

    const lookup = ctx.typert.lookups.get('session')
    expect(lookup).toMatchObject({
      parameter: 'session',
      wire: 'sessionId',
      hostTypeSymbol: '@fathom/session#Session',
      wireTypeSymbol: '@fathom/session/types#SessionId',
    })
    expect(lookup?.resolve(session.id)).toBe(session)

    await sessionFiber.dispose()
    expect(ctx.typert.lookups.get('session')).toBeUndefined()
  })
})
