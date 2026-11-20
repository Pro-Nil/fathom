/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

const roots: string[] = []

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'fathom-release-build-'))
  roots.push(root)
  write(join(root, 'apps/web/dist/index.html'), '<main></main>')
  write(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('release families', () => {
  it('excludes private experimental packages from the fathom release', () => {
    const members = releaseFamily('fathom').members(resolve(import.meta.dirname, '../..'))

    expect(members.some(member => member.directory.startsWith('packages/experimental/'))).toBe(false)
    expect(members.map(member => member.name)).not.toContain('@fathom/experimental-agent-team')
  })

  it('bumps private fathom packages without adding release tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'fathom-release-version-'))
    roots.push(root)
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'packages/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/core/unselected/package.json'), '{"version":"0.0.1"}\n')

    const fathom = releaseFamily('fathom')
    const published = member('packages/core/published', '@fathom/published')
    const { planned } = planShared(fathom, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'packages/core/published/package.json', tag: 'fathom-v0.0.2' },
      { path: 'packages/experimental/prototype/package.json', tag: undefined },
    ])
  })

  it('names one tag for the whole fathom family and one per vendored package', () => {
    const fathom = releaseFamily('fathom')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', '@fathom/cli')
    const cordis = { ...member('vendor/cordis', '@fathom/cordis'), version: '4.0.1' }

    expect(fathom.tagFor(cli)).toBe('fathom-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const fathom = releaseFamily('fathom')
    const members = [member('apps/cli', '@fathom/cli'), { ...member('apps/web', '@fathom/web-frontend'), version: '0.0.2' }]

    expect(() => { fathom.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { fathom.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@fathom/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@fathom/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('requires a current official client build only for fathom artifacts', () => {
    const fathom = releaseFamily('fathom')
    const vendor = releaseFamily('vendor')
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../..'))
    vi.stubEnv('FATHOM_CLIENT_COMMIT_HASH', officialEnvironment.FATHOM_CLIENT_COMMIT_HASH)
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})

    expect(() => { fathom.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { fathom.verifyBuildArtifacts(defaultBuild) }).toThrow(/FATHOM_CLIENT_TITLE/)
    expect(() => { fathom.verifyBuildArtifacts(join(defaultBuild, 'missing')) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(join(defaultBuild, 'missing')) }).not.toThrow()

    write(join(official, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { fathom.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const fathom = releaseFamily('fathom')
    const members = [
      member('packages/a/consumer', '@fathom/consumer', { dependencies: { '@fathom/library': 'workspace:^' } }),
      member('packages/a/library', '@fathom/library'),
      member('packages/a/zebra', '@fathom/zebra'),
    ]

    expect(fathom.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@fathom/library',
      '@fathom/consumer',
      '@fathom/zebra',
    ])
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const fathom = releaseFamily('fathom')
    const members = [
      member('packages/a/left', '@fathom/left', { dependencies: { '@fathom/right': 'workspace:^' } }),
      member('packages/a/right', '@fathom/right', { dependencies: { '@fathom/left': 'workspace:^' } }),
    ]

    expect(() => { fathom.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const fathom = releaseFamily('fathom')
    const members = [
      member('packages/a/consumer', '@fathom/consumer', { peerDependencies: { '@fathom/zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@fathom/zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(fathom.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@fathom/zebra',
      '@fathom/consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const fathom = releaseFamily('fathom')
    const members = [
      member('packages/a/left', '@fathom/left', { peerDependencies: { '@fathom/right': 'workspace:^' } }),
      member('packages/a/right', '@fathom/right', { peerDependencies: { '@fathom/left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    const plan = fathom.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@fathom/right',
      '@fathom/left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@fathom/right', peer: '@fathom/left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const fathom = releaseFamily('fathom')
    const members = [
      member('packages/a/base', '@fathom/base', { peerDependencies: { '@fathom/consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@fathom/consumer', {
        dependencies: { '@fathom/base': 'workspace:^' },
        peerDependencies: { '@fathom/base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    const plan = fathom.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@fathom/base',
      '@fathom/consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@fathom/base', peer: '@fathom/consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    const fathom = releaseFamily('fathom')
    const members = [
      member('packages/a/alpha', '@fathom/alpha', { peerDependencies: { '@fathom/bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@fathom/bravo', { peerDependencies: { '@fathom/charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@fathom/charlie', { dependencies: { '@fathom/alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { fathom.publishOrder(members) })
      .toThrow(/no publish order honours @fathom\/charlie -> @fathom\/alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    const fathom = releaseFamily('fathom')
    const members = [
      member('packages/a/alpha', '@fathom/alpha', { devDependencies: { '@fathom/zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@fathom/zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(fathom.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@fathom/alpha',
      '@fathom/zebra',
    ])
  })

  it('applies the harness payload policy to fathom and keeps upstream payloads for vendored packages', () => {
    const fathom = releaseFamily('fathom')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@fathom/library')
    const vendored = member('vendor/cordis', '@fathom/cordis')

    expect(() => { fathom.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('fathom').installedEntry).toEqual({ packageName: '@fathom/cli', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('vendor/cosmokit', '@fathom/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('vendor/cordis', '@fathom/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@fathom/library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
