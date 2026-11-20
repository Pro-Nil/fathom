import { describe, expect, it } from 'vitest'
import { Context } from '@fathom/cordis'
import * as SidebarInvariant from '@fathom/client-ui-sidebar/invariant'
import InvariantRegistry from '@fathom/invariants'

describe('invariant companion', () => {
  it('registers under the package name with an empty installer', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(SidebarInvariant).await()).resolves.toBeDefined()
  })

  it('node-half apply is a no-op host placeholder', async () => {
    const { apply } = await import('@fathom/client-ui-sidebar')
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
