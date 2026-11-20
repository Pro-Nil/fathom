/** Experimental-package publication and dependency constraints. */

import { describe, expect, it } from 'vitest'
import {
  checkExperimentalDependencyIsolation,
  checkExperimentalManifest,
  type WorkspaceManifest,
} from './check-workspace-constraints.ts'

const experimental: WorkspaceManifest = {
  dir: 'packages/experimental/prototype',
  manifest: { name: '@fathom/experimental-prototype', private: true },
}

describe('experimental workspace constraints', () => {
  it('requires the experimental package-name prefix', () => {
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, name: '@fathom/prototype' },
    })).toEqual([
      '@fathom/prototype: experimental package name must start with "@fathom/experimental-"',
    ])
  })

  it('requires private manifests without publication metadata', () => {
    expect(checkExperimentalManifest(experimental)).toEqual([])
    expect(checkExperimentalManifest({
      ...experimental,
      manifest: { ...experimental.manifest, private: false, publishConfig: { access: 'public' } },
    })).toEqual([
      '@fathom/experimental-prototype: experimental package must set "private": true',
      '@fathom/experimental-prototype: experimental package must omit publishConfig',
    ])
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'] as const)(
    'rejects release %s on an experimental package',
    (section) => {
      expect(checkExperimentalDependencyIsolation([experimental, {
        dir: 'packages/core/consumer',
        manifest: {
          name: '@fathom/consumer',
          [section]: { '@fathom/experimental-prototype': 'workspace:^' },
        },
      }])).toEqual([
        `@fathom/consumer: ${section}.@fathom/experimental-prototype must not reference an experimental package`,
      ])
    },
  )

  it('allows development and experimental consumers but rejects the Python release runtime', () => {
    const manifests: WorkspaceManifest[] = [experimental, {
      dir: 'packages/core/test-only',
      manifest: {
        name: '@fathom/test-only',
        devDependencies: { '@fathom/experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'packages/experimental/consumer',
      manifest: {
        name: '@fathom/experimental-consumer',
        dependencies: { '@fathom/experimental-prototype': 'workspace:^' },
      },
    }, {
      dir: 'python/sdk-runtime',
      manifest: {
        name: '@fathom/python-runtime',
        dependencies: { '@fathom/experimental-prototype': 'workspace:^' },
      },
    }]

    expect(checkExperimentalDependencyIsolation(manifests)).toEqual([
      '@fathom/python-runtime: dependencies.@fathom/experimental-prototype must not reference an experimental package',
    ])
  })
})
