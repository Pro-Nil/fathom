import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Every test runs against a throwaway OS home, never the real one.
const fake = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:os')>()
  return { ...real, homedir: () => fake.home }
})

const {
  FATHOM_HOME_DIR_NAME,
  LEGACY_HOME_DIR_NAME,
  defaultFathomHome,
  fathomHomeDisplay,
  migrateLegacyHome,
  migrateLegacyProfiles,
  resolveFathomHome,
} = await import('@fathom/home-paths')

const OLD_SCOPE = '@pentest' + '-harness/'

function writeLegacyProfile(home: string): string {
  const dir = join(home, 'profiles', 'web')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `${LEGACY_HOME_DIR_NAME.slice(1)}-profile-web`,
    private: true,
    [LEGACY_HOME_DIR_NAME.slice(1)]: { profile: { bundles: [`${OLD_SCOPE}dsh-base`, `${OLD_SCOPE}dsh-web-app`] } },
  }, null, 2))
  writeFileSync(join(dir, 'cordis.patch.yml'), `- id: web-search-google\n  name: '${OLD_SCOPE}dsh-web-search-google'\n`)
  mkdirSync(join(home, 'profiles', 'node_modules', OLD_SCOPE.slice(0, -1)), { recursive: true })
  return dir
}

beforeEach(() => {
  fake.home = mkdtempSync(join(tmpdir(), 'fathom-home-migration-'))
})

afterEach(() => {
  rmSync(fake.home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('pre-rename home', () => {
  it('keeps serving the old home until it is migrated, without moving it', () => {
    const legacy = join(fake.home, LEGACY_HOME_DIR_NAME)
    mkdirSync(legacy)

    expect(defaultFathomHome()).toBe(legacy)
    expect(fathomHomeDisplay(legacy)).toBe(`~/${LEGACY_HOME_DIR_NAME}`)
    expect(existsSync(legacy)).toBe(true)
  })

  it('moves the old home and rewrites its profile to the new names', () => {
    const legacy = join(fake.home, LEGACY_HOME_DIR_NAME)
    writeLegacyProfile(legacy)
    writeFileSync(join(legacy, 'settings.yaml'), 'kept: true\n')

    const result = migrateLegacyHome({})
    const home = join(fake.home, FATHOM_HOME_DIR_NAME)

    expect(result.moved).toEqual({ from: legacy, to: home })
    expect(existsSync(legacy)).toBe(false)
    expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toBe('kept: true\n')
    expect(defaultFathomHome()).toBe(home)
    const manifest = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.name).toBe('fathom-profile-web')
    expect(manifest.fathom).toEqual({ profile: { bundles: ['@fathom/base', '@fathom/web-app'] } })
    expect(manifest[LEGACY_HOME_DIR_NAME.slice(1)]).toBeUndefined()
    expect(readFileSync(join(home, 'profiles', 'web', 'cordis.patch.yml'), 'utf8')).toContain("name: '@fathom/web-search-google'")
    expect(existsSync(join(home, 'profiles', 'node_modules', OLD_SCOPE.slice(0, -1)))).toBe(false)
  })

  it('does nothing once migrated, and leaves an existing Fathom home alone', () => {
    const home = join(fake.home, FATHOM_HOME_DIR_NAME)
    mkdirSync(home)
    mkdirSync(join(fake.home, LEGACY_HOME_DIR_NAME))

    expect(migrateLegacyHome({})).toEqual({ profilesRewritten: 0 })
    expect(existsSync(join(fake.home, LEGACY_HOME_DIR_NAME))).toBe(true)
    expect(defaultFathomHome()).toBe(home)
  })

  it('never moves a home when one is configured, but still updates its profiles', () => {
    const configured = join(fake.home, 'custom')
    writeLegacyProfile(configured)
    mkdirSync(join(fake.home, LEGACY_HOME_DIR_NAME))

    const result = migrateLegacyHome({ FATHOM_HOME: configured })

    expect(result.moved).toBeUndefined()
    expect(result.profilesRewritten).toBe(2)
    expect(existsSync(join(fake.home, LEGACY_HOME_DIR_NAME))).toBe(true)
    expect(migrateLegacyProfiles(configured)).toBe(0)
  })

  it('honours the old home variable when the new one is unset', () => {
    const legacyVar = 'DSH' + '_HOME'
    expect(resolveFathomHome(undefined, { [legacyVar]: join(fake.home, 'old-var') })).toBe(join(fake.home, 'old-var'))
    expect(resolveFathomHome(undefined, { FATHOM_HOME: join(fake.home, 'new'), [legacyVar]: join(fake.home, 'old-var') })).toBe(join(fake.home, 'new'))
  })
})
