import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@fathom/cordis'
import { describe, expect, it } from 'vitest'
import SkillRegistry from '@fathom/skill'
import * as SkillBadge from '@fathom/skill-badge'

describe('fathom-skill-badge', () => {
  it('registers and disposes the bundled badge skill', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(SkillBadge)
    const resourcePath = fileURLToPath(new URL('../assets/', import.meta.url))

    expect(await ctx.skills.list()).toEqual([{
      name: 'fathom-badge',
      description: 'Add the official “powered by fathom” badge to documents, pull requests, merge requests, and other content produced with Fathom. Use whenever creating a pull request or merge request. Also use when the user asks for a fathom badge, powered-by-fathom attribution, or a reusable fathom badge asset or snippet.',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'fathom-badge',
      source: 'bundled',
      resourceBase: { kind: 'directory', path: resourcePath },
    }])
    const loaded = await ctx.skills.get('fathom-badge')
    expect(loaded?.content).toContain('Preserve the badge\'s 121×20 dimensions')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: resourcePath })

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('ships the official 726×120 PNG unchanged', async () => {
    const image = await readFile(new URL('../assets/fathom-badge.png', import.meta.url))
    expect(image.readUInt32BE(16)).toBe(726)
    expect(image.readUInt32BE(20)).toBe(120)
    expect(createHash('sha256').update(image).digest('hex')).toBe(
      'e1a5cf018e7bd17440243d77ff9823f5fab330cb271d7590efbe36d14bba47a1',
    )
  })
})
