import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectFathomPackageLicenses } from './verify-fathom-package-licenses.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function writeManifest(root: string, file: string, manifest: Record<string, unknown>): void {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'fathom-package-licenses-'))
  roots.push(root)
  writeManifest(root, 'package.json', {
    name: '@fathom/root',
    license: 'MIT',
    workspaces: ['apps/*', 'packages/*/*', 'vendor/*'],
  })
  return root
}

describe('FATHOM package license gate', () => {
  it('checks root, CLI and first-party package names while ignoring vendored packages', () => {
    const root = createWorkspace()
    writeManifest(root, 'apps/cli/package.json', { name: '@fathom/cli', license: 'MIT' })
    writeManifest(root, 'packages/core/agent/package.json', {
      name: '@fathom/agent',
      license: 'BSD-3-Clause',
    })
    writeManifest(root, 'vendor/cordis/package.json', {
      name: '@fathom/cordis',
      license: 'BSD-3-Clause',
    })

    expect(inspectFathomPackageLicenses(root)).toEqual({
      packageCount: 3,
      failures: [
        'packages/core/agent/package.json: @fathom/agent must declare "license": "MIT"; found "BSD-3-Clause".',
      ],
    })
  })

  it('rejects a missing license declaration', () => {
    const root = createWorkspace()
    writeManifest(root, 'packages/core/agent/package.json', { name: '@fathom/agent' })

    expect(inspectFathomPackageLicenses(root).failures).toEqual([
      'packages/core/agent/package.json: @fathom/agent must declare "license": "MIT"; found undefined.',
    ])
  })
})
