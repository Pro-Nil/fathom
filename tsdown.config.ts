import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

/**
 * The workspace packages to build: every `vendor/*` and `packages/*\/*` folder
 * that still has a package.json, plus apps/cli. A glob would also match folders
 * of packages that were deleted upstream: `git pull` removes their tracked
 * sources but leaves the untracked `lib/` build output and `node_modules/`, and
 * bundling that stale `lib/` fails on imports that no longer exist. Those
 * leftover folders are skipped and named, so a pull never breaks the build.
 */
function workspacePackages(): string[] {
  const found: string[] = []
  const leftovers: string[] = []
  const visit = (dir: string): void => {
    if (existsSync(join(dir, 'package.json'))) found.push(dir)
    else leftovers.push(dir)
  }
  const subdirs = (dir: string): string[] => existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => `${dir}/${entry.name}`)
    : []
  for (const dir of subdirs('vendor')) visit(dir)
  for (const group of subdirs('packages')) {
    for (const dir of subdirs(group)) visit(dir)
  }
  if (leftovers.length > 0) {
    console.warn(`tsdown: skipping ${leftovers.length.toString()} folder(s) with no package.json (leftovers of removed packages; safe to delete):`
      + `\n  ${leftovers.join('\n  ')}`)
  }
  return [...found, 'apps/cli']
}

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.FATHOM_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.FATHOM_BUILD_FACE)
  return {
    workspace: workspacePackages(),
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
