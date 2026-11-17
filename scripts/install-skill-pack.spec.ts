import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultSkillRoot, frontmatterName, installPack, sha256, uninstallPack, validateManifest,
  type FetchBytes, type PackManifest,
} from './install-skill-pack.ts'

const encoder = new TextEncoder()
const skillBody = (name: string, extra = '') => encoder.encode(`---\nname: ${name}\ndescription: test ${name}\n---\n\nBody${extra}\n`)

const COMMIT = 'a'.repeat(40)
const alpha = skillBody('alpha')
const beta = skillBody('beta')

function manifest(skills = [
  { name: 'alpha', file: 'owner-alpha.md', sha256: sha256(alpha), author: 'owner/alpha' },
  { name: 'beta', file: 'owner-beta.md', sha256: sha256(beta), author: 'owner/beta' },
]): PackManifest {
  return { description: 'test', repository: 'owner/pack', commit: COMMIT, path: 'skills', skills }
}

/** Serve fixture bytes by file name, recording every requested URL. */
function server(files: Record<string, Uint8Array>): FetchBytes & { urls: string[] } {
  const urls: string[] = []
  const fetchBytes = (async (url: string) => {
    urls.push(url)
    const file = decodeURIComponent(url.split('/').at(-1)!)
    const bytes = files[file]
    if (bytes === undefined) throw new Error('HTTP 404')
    return bytes
  }) as FetchBytes & { urls: string[] }
  fetchBytes.urls = urls
  return fetchBytes
}

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skill-pack-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('installPack', () => {
  it('installs every pinned skill as <name>.md from the pinned commit', async () => {
    const dest = tempDir()
    const fetchBytes = server({ 'owner-alpha.md': alpha, 'owner-beta.md': beta })
    const report = await installPack({ pack: 'test', manifest: manifest(), dest, fetchBytes })
    expect(report.installed).toEqual(['alpha', 'beta'])
    expect(readFileSync(join(dest, 'alpha.md'))).toEqual(Buffer.from(alpha))
    expect(fetchBytes.urls[0]).toBe(`https://raw.githubusercontent.com/owner/pack/${COMMIT}/skills/owner-alpha.md`)
  })

  it('refuses content whose hash differs from the manifest', async () => {
    const dest = tempDir()
    const tampered = skillBody('alpha', ' changed')
    const report = await installPack({
      pack: 'test', manifest: manifest(), dest, fetchBytes: server({ 'owner-alpha.md': tampered, 'owner-beta.md': beta }),
    })
    expect(report.skipped).toEqual([{ name: 'alpha', reason: 'content hash does not match the manifest' }])
    expect(readdirSync(dest)).not.toContain('alpha.md')
  })

  it('refuses a file whose frontmatter name differs from the manifest entry', async () => {
    const dest = tempDir()
    const renamed = skillBody('other')
    const report = await installPack({
      pack: 'test',
      manifest: manifest([{ name: 'alpha', file: 'owner-alpha.md', sha256: sha256(renamed), author: 'owner/alpha' }]),
      dest,
      fetchBytes: server({ 'owner-alpha.md': renamed }),
    })
    expect(report.skipped[0]?.reason).toBe('frontmatter name does not match the manifest')
  })

  it('leaves a user skill with the same name alone unless --force', async () => {
    const dest = tempDir()
    writeFileSync(join(dest, 'alpha.md'), 'my own skill')
    const files = server({ 'owner-alpha.md': alpha, 'owner-beta.md': beta })
    const first = await installPack({ pack: 'test', manifest: manifest(), dest, fetchBytes: files })
    expect(first.skipped.map(entry => entry.name)).toEqual(['alpha'])
    expect(readFileSync(join(dest, 'alpha.md'), 'utf8')).toBe('my own skill')

    const forced = await installPack({ pack: 'test', manifest: manifest(), dest, fetchBytes: files, force: true })
    expect(forced.installed).toContain('alpha')
    expect(readFileSync(join(dest, 'alpha.md'))).toEqual(Buffer.from(alpha))
  })

  it('is idempotent and writes nothing in dry-run mode', async () => {
    const dest = tempDir()
    const files = server({ 'owner-alpha.md': alpha, 'owner-beta.md': beta })
    const dry = await installPack({ pack: 'test', manifest: manifest(), dest, fetchBytes: files, dryRun: true })
    expect(dry.installed).toEqual(['alpha', 'beta'])
    expect(readdirSync(dest)).toEqual([])

    await installPack({ pack: 'test', manifest: manifest(), dest, fetchBytes: files })
    const again = await installPack({ pack: 'test', manifest: manifest(), dest, fetchBytes: files })
    expect(again.unchanged).toEqual(['alpha', 'beta'])
    expect(again.installed).toEqual([])
  })
})

describe('uninstallPack', () => {
  it('removes only unmodified files the pack installed', async () => {
    const dest = tempDir()
    await installPack({
      pack: 'test', manifest: manifest(), dest, fetchBytes: server({ 'owner-alpha.md': alpha, 'owner-beta.md': beta }),
    })
    writeFileSync(join(dest, 'beta.md'), 'edited by the user')
    writeFileSync(join(dest, 'mine.md'), 'unrelated')
    const result = uninstallPack(dest, 'test')
    expect(result).toEqual({ removed: ['alpha'], kept: ['beta'] })
    expect(readdirSync(dest).sort()).toEqual(['beta.md', 'mine.md'])
  })
})

describe('validateManifest', () => {
  it('rejects a short commit, a bad name, a duplicate, and a path-like file', () => {
    expect(() => validateManifest({ ...manifest(), commit: 'abc123' })).toThrow(/40-character/)
    expect(() => validateManifest(manifest([{ name: 'Bad Name', file: 'x.md', sha256: 'a'.repeat(64), author: 'o/r' }]))).toThrow(/invalid skill name/)
    const one = { name: 'alpha', file: 'x.md', sha256: 'a'.repeat(64), author: 'o/r' }
    expect(() => validateManifest(manifest([one, one]))).toThrow(/duplicate/)
    expect(() => validateManifest(manifest([{ ...one, file: '../x.md' }]))).toThrow(/invalid file/)
  })

  it('accepts the shipped bug-bounty manifest', () => {
    const shipped = JSON.parse(readFileSync(join(import.meta.dirname, 'skill-packs', 'bug-bounty.json'), 'utf8'))
    expect(validateManifest(shipped).skills.length).toBeGreaterThan(0)
  })
})

describe('helpers', () => {
  it('reads the frontmatter name', () => {
    expect(frontmatterName('---\nname: "hunt-idor"\ndescription: x\n---\nbody')).toBe('hunt-idor')
    expect(frontmatterName('no frontmatter')).toBeUndefined()
  })

  it('resolves the skill root from DSH_HOME, treating a blank value as unset', () => {
    expect(defaultSkillRoot({ DSH_HOME: join(tmpdir(), 'h') })).toBe(join(tmpdir(), 'h', 'skills'))
    expect(defaultSkillRoot({ DSH_HOME: '  ' }).endsWith(join('.dsh', 'skills'))).toBe(true)
  })
})
