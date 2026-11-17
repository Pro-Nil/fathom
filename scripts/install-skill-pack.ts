/**
 * Install a curated, pinned skill pack into the user skill root
 * (`$DSH_HOME/skills`, default `~/.dsh/skills`) as flat `<name>.md` files.
 *
 * A pack manifest (`scripts/skill-packs/<pack>.json`) pins a GitHub
 * repository commit and the SHA-256 of every file, so the installer only ever
 * writes content that was reviewed when the manifest was made: a changed or
 * tampered file is refused, never installed. Files the user already has under
 * the same name are left alone unless `--force`. A small state file records
 * what the pack installed so `--uninstall` removes exactly those files (and
 * only while they are unmodified).
 *
 * Usage: tsx scripts/install-skill-pack.ts [pack] [--dest <dir>] [--dry-run] [--force] [--uninstall]
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface PackSkill {
  /** Skill name; must equal the file's frontmatter `name` and is the installed file stem. */
  readonly name: string
  /** File name inside the repository's `path`. */
  readonly file: string
  /** Lowercase hex SHA-256 of the exact file bytes at `commit`. */
  readonly sha256: string
  /** Original author repository, for attribution. */
  readonly author: string
}

export interface PackManifest {
  readonly description: string
  readonly repository: string
  readonly commit: string
  readonly path: string
  readonly skills: readonly PackSkill[]
}

/** Download one URL's exact bytes (hashing decoded text would drop a BOM and hide byte changes). */
export type FetchBytes = (url: string) => Promise<Uint8Array>

export interface InstallOptions {
  readonly pack: string
  readonly manifest: PackManifest
  readonly dest: string
  readonly fetchBytes: FetchBytes
  readonly dryRun?: boolean
  readonly force?: boolean
}

export interface InstallReport {
  readonly installed: string[]
  readonly unchanged: string[]
  readonly skipped: { name: string; reason: string }[]
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Hex SHA-256 of exact bytes. */
export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** The frontmatter `name` of a Markdown skill, or undefined when absent. */
export function frontmatterName(text: string): string | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const block = match?.[1]
  if (block === undefined) return undefined
  const line = block.split(/\r?\n/).find(candidate => /^name\s*:/.test(candidate))
  return line?.replace(/^name\s*:\s*/, '').trim().replace(/^["']|["']$/g, '')
}

/** Validate a parsed manifest's shape, failing loud on anything unexpected. */
export function validateManifest(value: unknown): PackManifest {
  const manifest = value as PackManifest
  if (typeof manifest?.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(manifest.repository)) {
    throw new Error('skill pack: `repository` must be "owner/name"')
  }
  if (typeof manifest.commit !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.commit)) {
    throw new Error('skill pack: `commit` must be a full 40-character commit sha')
  }
  if (!Array.isArray(manifest.skills) || manifest.skills.length === 0) {
    throw new Error('skill pack: `skills` must be a non-empty list')
  }
  const names = new Set<string>()
  for (const skill of manifest.skills) {
    if (!KEBAB.test(skill.name)) throw new Error(`skill pack: invalid skill name "${skill.name}"`)
    if (names.has(skill.name)) throw new Error(`skill pack: duplicate skill name "${skill.name}"`)
    names.add(skill.name)
    if (!/^[0-9a-f]{64}$/.test(skill.sha256)) throw new Error(`skill pack: invalid sha256 for "${skill.name}"`)
    if (skill.file.includes('/') || skill.file.includes('\\') || skill.file.includes('..')) {
      throw new Error(`skill pack: invalid file for "${skill.name}"`)
    }
  }
  return manifest
}

function stateFile(dest: string, pack: string): string {
  return join(dest, `.skill-pack-${pack}.json`)
}

function readState(dest: string, pack: string): Record<string, string> {
  const path = stateFile(dest, pack)
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, string> : {}
}

/**
 * Fetch every pinned skill, verify its hash and name, and write it to `dest`.
 * Never overwrites a file the pack did not install unless `force`.
 */
export async function installPack(options: InstallOptions): Promise<InstallReport> {
  const { pack, manifest, dest, fetchBytes } = options
  const report: InstallReport = { installed: [], unchanged: [], skipped: [] }
  const state = readState(dest, pack)
  for (const skill of manifest.skills) {
    const url = `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${manifest.path}/${encodeURIComponent(skill.file)}`
    let bytes: Uint8Array
    try {
      bytes = await fetchBytes(url)
    } catch (error) {
      report.skipped.push({ name: skill.name, reason: `download failed: ${(error as Error).message}` })
      continue
    }
    if (sha256(bytes) !== skill.sha256) {
      report.skipped.push({ name: skill.name, reason: 'content hash does not match the manifest' })
      continue
    }
    if (frontmatterName(new TextDecoder().decode(bytes)) !== skill.name) {
      report.skipped.push({ name: skill.name, reason: 'frontmatter name does not match the manifest' })
      continue
    }
    const target = join(dest, `${skill.name}.md`)
    if (existsSync(target)) {
      const current = sha256(readFileSync(target))
      if (current === skill.sha256) {
        report.unchanged.push(skill.name)
        state[skill.name] = skill.sha256
        continue
      }
      const ours = state[skill.name] === current
      if (!ours && !options.force) {
        report.skipped.push({ name: skill.name, reason: `${target} already exists (use --force to replace it)` })
        continue
      }
    }
    if (!options.dryRun) {
      mkdirSync(dest, { recursive: true })
      writeFileSync(target, bytes)
    }
    state[skill.name] = skill.sha256
    report.installed.push(skill.name)
  }
  if (!options.dryRun && (report.installed.length > 0 || report.unchanged.length > 0)) {
    mkdirSync(dest, { recursive: true })
    writeFileSync(stateFile(dest, pack), JSON.stringify(state, null, 2) + '\n', 'utf8')
  }
  return report
}

/** Remove the files this pack installed, keeping any the user has since edited. */
export function uninstallPack(dest: string, pack: string, dryRun = false): { removed: string[]; kept: string[] } {
  const state = readState(dest, pack)
  const removed: string[] = []
  const kept: string[] = []
  for (const [name, hash] of Object.entries(state)) {
    const target = join(dest, `${name}.md`)
    if (!existsSync(target)) continue
    if (sha256(readFileSync(target)) !== hash) {
      kept.push(name)
      continue
    }
    if (!dryRun) rmSync(target)
    removed.push(name)
  }
  if (!dryRun) rmSync(stateFile(dest, pack), { force: true })
  return { removed, kept }
}

/** `$DSH_HOME/skills`, falling back to `~/.dsh/skills` (a blank `$DSH_HOME` counts as unset). */
export function defaultSkillRoot(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim()
  return join(home ? resolve(home) : join(homedir(), '.dsh'), 'skills')
}

async function main(argv: string[]): Promise<void> {
  const flags = new Set(argv.filter(arg => arg.startsWith('--') && arg !== '--dest'))
  const destIndex = argv.indexOf('--dest')
  const dest = destIndex >= 0 ? resolve(argv[destIndex + 1] ?? '') : defaultSkillRoot()
  const pack = argv.find((arg, index) => !arg.startsWith('--') && argv[index - 1] !== '--dest') ?? 'bug-bounty'
  if (!KEBAB.test(pack)) throw new Error(`invalid pack name "${pack}"`)
  const manifestPath = join(fileURLToPath(new URL('.', import.meta.url)), 'skill-packs', `${pack}.json`)
  const manifest = validateManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
  const dryRun = flags.has('--dry-run')

  if (flags.has('--uninstall')) {
    const { removed, kept } = uninstallPack(dest, pack, dryRun)
    console.log(`${dryRun ? 'would remove' : 'removed'} ${removed.length} skill(s) from ${dest}`)
    if (kept.length > 0) console.log(`kept (edited since install): ${kept.join(', ')}`)
    return
  }

  const report = await installPack({
    pack, manifest, dest, dryRun, force: flags.has('--force'),
    fetchBytes: async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  })
  console.log(`${dryRun ? 'would install' : 'installed'} ${report.installed.length}, unchanged ${report.unchanged.length}, skipped ${report.skipped.length} → ${dest}`)
  for (const { name, reason } of report.skipped) console.log(`  skipped ${name}: ${reason}`)
  console.log(`source: ${manifest.repository}@${manifest.commit.slice(0, 7)}; skills remain under their authors' licenses:`)
  for (const author of new Set(manifest.skills.map(skill => skill.author))) console.log(`  https://github.com/${author}`)
  if (report.skipped.length > 0) process.exitCode = 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error((error as Error).message)
    process.exitCode = 1
  })
}
