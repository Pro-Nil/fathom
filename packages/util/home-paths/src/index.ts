/**
 * Shared filesystem path helpers for Fathom user data.
 *
 * @module @fathom/home-paths
 */

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { opendir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

/** Directory name for the default Fathom home under the OS home. */
export const FATHOM_HOME_DIR_NAME = '.fathom'

/** Stable user-facing display form for the default Fathom home. */
export const DEFAULT_FATHOM_HOME_DISPLAY = `~/${FATHOM_HOME_DIR_NAME}`

/** Environment variable that overrides the default Fathom home. */
export const FATHOM_HOME_ENV = 'FATHOM_HOME'

/**
 * The home directory name before the project was renamed to Fathom. An
 * existing one is moved to {@link FATHOM_HOME_DIR_NAME} on first use.
 */
export const LEGACY_HOME_DIR_NAME = '.' + 'dsh'

/** The home override variable before the rename; still honoured when `FATHOM_HOME` is unset. */
export const LEGACY_HOME_ENV = 'DSH' + '_HOME'

/** Package scope and manifest key used inside profiles before the rename. */
const LEGACY_SCOPE = '@pentest' + '-harness/'
const LEGACY_KEY = 'dsh'

/**
 * Rewrite the names a pre-rename profile stores: its manifest key and
 * package name, and the bundle and plugin package names in its config
 * layers. Stale module links under the old scope are dropped; profile boot
 * recreates them under the new scope. Idempotent: a profile that already
 * uses the new names is left untouched.
 * @param home - the harness home whose `profiles/` to update.
 * @returns how many files were rewritten.
 */
export function migrateLegacyProfiles(home: string): number {
  const profiles = join(home, 'profiles')
  if (!existsSync(profiles)) return 0
  const rescope = (text: string): string => text
    .replaceAll(`${LEGACY_SCOPE}${LEGACY_KEY}-`, '@fathom/')
    .replaceAll(LEGACY_SCOPE, '@fathom/')
  let rewritten = 0
  for (const entry of readdirSync(profiles)) {
    const dir = join(profiles, entry)
    if (entry === 'node_modules' || !statSync(dir).isDirectory()) continue
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest)) {
      const text = readFileSync(manifest, 'utf8')
      const parsed = JSON.parse(rescope(text)) as Record<string, unknown>
      // Rebuild the manifest with the old section key renamed in place, so key order is kept.
      const renameKey = parsed[LEGACY_KEY] !== undefined && parsed.fathom === undefined
      const data: Record<string, unknown> = Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [renameKey && key === LEGACY_KEY ? 'fathom' : key, value]),
      )
      if (typeof data.name === 'string') data.name = data.name.replace(new RegExp(`^${LEGACY_KEY}-profile-`), 'fathom-profile-')
      const next = `${JSON.stringify(data, null, 2)}\n`
      if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(data)) {
        writeFileSync(manifest, next)
        rewritten++
      }
    }
    for (const file of readdirSync(dir)) {
      if (!/\.ya?ml$/u.test(file)) continue
      const path = join(dir, file)
      const text = readFileSync(path, 'utf8')
      const next = rescope(text)
      if (next !== text) {
        writeFileSync(path, next)
        rewritten++
      }
    }
  }
  rmSync(join(profiles, 'node_modules', LEGACY_SCOPE.slice(0, -1)), { recursive: true, force: true })
  return rewritten
}

/** What {@link migrateLegacyHome} did. */
export interface HomeMigration {
  /** The pre-rename home that was moved, when one was. */
  readonly moved?: { readonly from: string; readonly to: string }
  /** Profile files rewritten to the new names. */
  readonly profilesRewritten: number
}

/**
 * Bring a pre-rename installation forward. Call once at startup, before the
 * home is used. With no explicit home configured, an existing `~/.dsh` and no
 * `~/.fathom` moves the old home over; then the home's profiles are
 * rewritten to the new package names (also for an explicit home).
 *
 * A failed move (another process holds a file open on Windows) throws; the
 * old home then keeps serving as the default, so nothing is lost and the move
 * is retried on the next start.
 * @param env - environment mapping used to read the home overrides.
 * @returns what was migrated.
 */
export function migrateLegacyHome(env: Record<string, string | undefined> = process.env): HomeMigration {
  const set = (value: string | undefined): boolean => value !== undefined && value.trim().length > 0
  let moved: HomeMigration['moved']
  if (!set(env[FATHOM_HOME_ENV]) && !set(env[LEGACY_HOME_ENV])) {
    const target = join(homedir(), FATHOM_HOME_DIR_NAME)
    const legacy = join(homedir(), LEGACY_HOME_DIR_NAME)
    if (!existsSync(target) && existsSync(legacy)) {
      renameSync(legacy, target)
      moved = { from: legacy, to: target }
    }
  }
  return { ...moved === undefined ? {} : { moved }, profilesRewritten: migrateLegacyProfiles(resolveFathomHome(undefined, env)) }
}

/**
 * Give a native filesystem watcher one canonical spelling of a path, even
 * when its final components do not exist yet. The deepest existing ancestor
 * is resolved through {@link realpath}; when a suffix is missing, that
 * ancestor is also proved to be an enumerable directory before the suffix is
 * restored. This prevents Windows from treating a regular-file ancestor as
 * ordinary absence, and prevents short-name aliases from being mixed with
 * long paths emitted by the native watcher backend.
 * @param path - Watch target or root, resolved against the current directory.
 * @returns the target with its existing ancestor canonicalized.
 * @throws when ancestor traversal encounters an error other than absence, or
 * the existing ancestor of a missing suffix is not an enumerable directory.
 */
export async function canonicalizeWatchPath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      const canonical = await realpath(current)
      if (missing.length > 0) {
        // A Windows file-as-parent probe reports ENOENT. Opening the resolved
        // ancestor preserves the cross-platform directory requirement.
        const directory = await opendir(canonical)
        await directory.close()
      }
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(current)
      /* v8 ignore next -- a filesystem root exists, so traversal resolves before this guard */
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/**
 * Resolve the default Fathom home using Node's platform path rules.
 * @returns the absolute default harness home path.
 */
export function defaultFathomHome(): string {
  // A pre-rename home keeps serving until migrateLegacyHome() moves it, so
  // resolving the path never moves anything by itself.
  const target = join(homedir(), FATHOM_HOME_DIR_NAME)
  if (existsSync(target)) return target
  const legacy = join(homedir(), LEGACY_HOME_DIR_NAME)
  return existsSync(legacy) ? legacy : target
}

/**
 * Expand supported tilde prefixes against the operating-system home.
 * @param path - configured path that may begin with `~`, `~/`, or `~\`.
 * @returns the expanded path, or the original value when no supported prefix is present.
 */
export function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/**
 * Resolve the single-root Fathom home.
 *
 * Precedence, highest first: an explicit configured path, `$FATHOM_HOME`, then
 * `~/.fathom`. The harness keeps all user data under one root. An empty or
 * whitespace-only `$FATHOM_HOME` is treated as unset, so a blank override never
 * resolves the home to the current working directory.
 * @param configured - explicit harness-home override, which has highest precedence.
 * @param env - environment mapping used to read `FATHOM_HOME`.
 * @returns the normalized absolute harness home path.
 */
export function resolveFathomHome(configured?: string, env: Record<string, string | undefined> = process.env): string {
  const set = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0
  const fromEnv = set(env[FATHOM_HOME_ENV]) ? env[FATHOM_HOME_ENV] : env[LEGACY_HOME_ENV]
  const selected = configured ?? (set(fromEnv) ? fromEnv : defaultFathomHome())
  return resolve(expandHomePath(selected))
}

/**
 * Join path segments onto the resolved Fathom home.
 * @param segments - path segments appended to the Harness home; an empty list returns the home itself.
 * @returns the normalized absolute joined path.
 */
export function fathomHomePath(...segments: string[]): string {
  return join(resolveFathomHome(), ...segments)
}

/**
 * Describe a resolved harness home symbolically for user-facing display.
 *
 * It never returns an absolute machine path: the default home is labelled
 * `~/.fathom`, and any configured home is labelled `$FATHOM_HOME`.
 * @param resolvedHome - the absolute path returned by {@link resolveFathomHome}.
 * @returns `~/.fathom` for the default home, otherwise `$FATHOM_HOME`.
 */
export function fathomHomeDisplay(resolvedHome: string): string {
  if (resolvedHome === resolve(join(homedir(), FATHOM_HOME_DIR_NAME))) return DEFAULT_FATHOM_HOME_DISPLAY
  if (resolvedHome === resolve(join(homedir(), LEGACY_HOME_DIR_NAME))) return `~/${LEGACY_HOME_DIR_NAME}`
  return `$${FATHOM_HOME_ENV}`
}
