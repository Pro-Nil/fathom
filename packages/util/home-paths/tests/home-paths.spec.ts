import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_FATHOM_HOME_DISPLAY,
  FATHOM_HOME_DIR_NAME,
  LEGACY_HOME_DIR_NAME,
  canonicalizeWatchPath,
  defaultFathomHome,
  fathomHomeDisplay,
  fathomHomePath,
  expandHomePath,
  resolveFathomHome,
} from '@fathom/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('fathom path helpers', () => {
  it('owns the shared default FATHOM home directory name', () => {
    expect(FATHOM_HOME_DIR_NAME).toBe('.fathom')
    expect(DEFAULT_FATHOM_HOME_DISPLAY).toBe('~/.fathom')
    // A machine that still has a pre-rename home serves it until it is
    // migrated (see legacy-migration.spec.ts); either way it sits under the OS home.
    expect([join(homedir(), '.fathom'), join(homedir(), LEGACY_HOME_DIR_NAME)]).toContain(defaultFathomHome())
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.fathom')).toBe(join(homedir(), '.fathom'))
    expect(expandHomePath('~\\.fathom')).toBe(join(homedir(), '.fathom'))
    expect(expandHomePath('/tmp/.fathom')).toBe('/tmp/.fathom')
    expect(expandHomePath('~other/.fathom')).toBe('~other/.fathom')
  })

  it('resolves explicit path before FATHOM_HOME and the default', () => {
    const envHome = join(homedir(), 'env-fathom')

    expect(resolveFathomHome('/tmp/explicit-fathom', { FATHOM_HOME: '~/env-fathom' })).toBe(resolve('/tmp/explicit-fathom'))
    expect(resolveFathomHome(undefined, { FATHOM_HOME: '~/env-fathom' })).toBe(envHome)
    expect(resolveFathomHome(undefined, {})).toBe(defaultFathomHome())
  })

  it('treats an empty or whitespace-only FATHOM_HOME as unset', () => {
    expect(resolveFathomHome(undefined, { FATHOM_HOME: '' })).toBe(defaultFathomHome())
    expect(resolveFathomHome(undefined, { FATHOM_HOME: '   ' })).toBe(defaultFathomHome())
  })

  it('joins child segments onto the resolved FATHOM_HOME', () => {
    vi.stubEnv('FATHOM_HOME', '~/env-fathom')
    expect(fathomHomePath()).toBe(join(homedir(), 'env-fathom'))
    expect(fathomHomePath('storages', 'cache')).toBe(join(homedir(), 'env-fathom', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(fathomHomeDisplay(resolve(join(homedir(), '.fathom')))).toBe('~/.fathom')
    expect(fathomHomeDisplay('/some/other/root')).toBe('$FATHOM_HOME')
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'fathom-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
