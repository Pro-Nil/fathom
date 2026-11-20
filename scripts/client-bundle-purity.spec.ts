/**
 * Pins shared client-bundle preset rules: the module-edge purity gate and
 * the physical watch dependencies hidden behind virtual CSS Modules.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { clientBundle, requestedExternals } from '../packages/client/tsdown.client.ts'

type ResolveId = (source: string) => null | { id: string; external: boolean }

interface CssModulePlugin {
  name: string
  resolveId?: (source: string, importer: string | undefined) => null | string
  load?: (this: { addWatchFile: (id: string) => void }, id: string) => Promise<unknown>
}

/** A representative dynamic bundle using the shared client baseline. */
const REQUESTING_PACKAGE = '@fathom/client-ui-conversation'

function clientConfigs(id = REQUESTING_PACKAGE) {
  return clientBundle(id, ['lib/types/index.js', 'lib/types/invariant.js'])(
    { env: { FATHOM_BUILD_FACE: 'client' } },
  ).filter(config => config.platform === 'browser')
}

describe('client bundle build faces', () => {
  it('watches source in development and consumes emitted JavaScript in the Client build', () => {
    const bundle = clientBundle('@fathom/client-test', ['lib/types/index.js'])
    const development = bundle({ env: {} }).find(config => config.platform === 'browser')
    const artifact = bundle({ env: { FATHOM_BUILD_FACE: 'client' } })
      .find(config => config.platform === 'browser')

    expect(development?.entry).toEqual({ client: 'src/client/index.ts' })
    expect(artifact?.entry).toEqual({ client: 'lib/types/client/index.js' })
  })
})

function clientSourceMapPath(packagePath: string): string {
  return fileURLToPath(new URL(`../packages/${packagePath}/lib/client.js.map`, import.meta.url))
}

function purityResolveId(id = REQUESTING_PACKAGE): ResolveId {
  // libEntry is spelled at every call site (no default) so the
  // package-invariants text check can see the invariant entry per package.
  const configs = clientConfigs(id)
  const plugins = (configs[0] as { plugins: { name: string; resolveId?: unknown }[] }).plugins
  const gate = plugins.find(p => p.name === 'fathom-client-bundle-purity')
  if (gate?.resolveId === undefined) throw new Error('purity plugin missing from client config')
  return gate.resolveId as ResolveId
}

function cssModulePlugin(): CssModulePlugin {
  const configs = clientConfigs()
  const plugins = (configs[0] as { plugins: CssModulePlugin[] }).plugins
  const plugin = plugins.find(candidate => candidate.name === 'fathom-css-modules-inline')
  if (plugin?.resolveId === undefined || plugin.load === undefined) {
    throw new Error('CSS Modules plugin missing from client config')
  }
  return plugin
}

describe('client bundle purity gate', () => {
  const resolveId = purityResolveId()

  it('leaves default externals and non-scoped specifiers alone', () => {
    expect(resolveId('@fathom/client-ui-slots')).toBeNull()
    expect(resolveId('@fathom/client-ui-primitives')).toBeNull()
    expect(resolveId('@fathom/client-runtime/client')).toBeNull()
    expect(resolveId('react')).toBeNull()
    expect(resolveId('zod')).toBeNull()
  })

  it('rejects the retired web-react platform package', () => {
    expect(() => resolveId('@fathom/client-web-react')).toThrow(/purity/)
    expect(() => resolveId('@fathom/client-web-react/store')).toThrow(/purity/)
  })

  it('lets inline-safe wire layers inline', () => {
    expect(resolveId('@fathom/host-apiproxy/api')).toBeNull()
    expect(resolveId('@fathom/session/surface')).toBeNull()
    expect(resolveId('@fathom/brand')).toBeNull()
  })

  it('lets exact generated Remote contributions inline without admitting their package implementation', () => {
    expect(resolveId('@fathom/goal/remote')).toBeNull()
    expect(() => resolveId('@fathom/goal')).toThrow(/purity/)
    expect(() => resolveId('@fathom/goal/client')).toThrow(/purity/)
    expect(() => resolveId('@fathom/goal/remote/nested')).toThrow(/purity/)
  })

  it('throws on any other @fathom leak', () => {
    expect(() => resolveId('@fathom/agent')).toThrow(/purity/)
    expect(() => resolveId('@fathom/client-web')).toThrow(/purity/)
  })

  it('throws on cross-plugin value imports — bare plugin names and /client subpaths alike', () => {
    expect(() => resolveId('@fathom/client-connection')).toThrow(/purity/)
    expect(() => resolveId('@fathom/client-runtime')).toThrow(/purity/)
    expect(() => resolveId('@fathom/client-ui-layout/client')).toThrow(/purity/)
  })

  it('admits the parser-preloaded runtime for every dynamic bundle', () => {
    expect(resolveId('@fathom/client-runtime/client')).toBeNull()
    const withoutRequest = purityResolveId('@fathom/client-ui-goal')
    expect(withoutRequest('@fathom/client-runtime/client')).toBeNull()
  })

  it('externalizes the baseline independently of each package manifest', () => {
    const requesting = clientConfigs()[0]?.deps as { neverBundle: (specifier: string) => boolean }
    const plain = clientConfigs('@fathom/client-connection')[0]?.deps as {
      neverBundle: (specifier: string) => boolean
    }

    expect(requesting.neverBundle('react')).toBe(true)
    expect(requesting.neverBundle('zod')).toBe(false)
    expect(plain.neverBundle('react')).toBe(true)
    expect(plain.neverBundle('@fathom/client-runtime/client')).toBe(true)
  })
})

describe('client bundle module requests', () => {
  it('requests what the declaration lists', () => {
    const requests = requestedExternals('@fathom/client-fixture', {
      external: ['react', 'react/jsx-runtime', '@fathom/client-ui-slots'],
    })

    expect([...requests].sort()).toEqual([
      '@fathom/client-ui-slots', 'react', 'react/jsx-runtime',
    ])
  })

  it('requests nothing when the declaration is absent', () => {
    expect(requestedExternals('@fathom/client-fixture', {}).size).toBe(0)
  })

  it('rejects a malformed declaration instead of reading past it', () => {
    expect(() => requestedExternals('@fathom/client-fixture', { external: 'react' }))
      .toThrow(/fathom\.client\.external must be a string array/)
  })
})

describe('client bundle debug artifacts', () => {
  it('emits source maps for plugin TS and TSX outside the Vite module graph', () => {
    const configs = clientConfigs()
    expect(configs[0]?.sourcemap).toBe(true)
  })

  it('maps first-party sources to their repository package paths', () => {
    const configs = clientConfigs('@fathom/client-ui-goal')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const source = transform('../src/client/GoalBar.tsx', clientSourceMapPath('client/ui-goal'))
    expect(source).toBe('../../../packages/client/ui-goal/src/client/GoalBar.tsx')
    const resolved = new URL(source, 'https://fathom.test/plugins/@fathom/client-ui-goal/client.js.map')
    expect(resolved.pathname).toBe('/packages/client/ui-goal/src/client/GoalBar.tsx')
  })

  it('maps dual-face host sources to the host package group', () => {
    const configs = clientConfigs('@fathom/host-directory-picker-native')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const source = transform('../src/client/index.ts', clientSourceMapPath('host/directory-picker-native'))
    expect(source).toBe('../../../packages/host/directory-picker-native/src/client/index.ts')
  })

  it('maps inlined workspace sources to packages and leaves dependencies outside it unchanged', () => {
    const configs = clientConfigs('@fathom/client-connection')
    const outputOptions = configs[0]?.outputOptions
    if (typeof outputOptions !== 'object' || outputOptions === null) throw new Error('client output options missing')
    const transform = outputOptions.sourcemapPathTransform
    if (transform === undefined) throw new Error('client sourcemap path transform missing')

    const sourceMapPath = clientSourceMapPath('client/connection')
    const workspaceSource = transform('../../../host/apiproxy/src/api/rpc.ts', sourceMapPath)
    expect(workspaceSource).toBe('../../../packages/host/apiproxy/src/api/rpc.ts')
    const resolved = new URL(workspaceSource, 'https://fathom.test/plugins/@fathom/client-connection/client.js.map')
    expect(resolved.pathname).toBe('/packages/host/apiproxy/src/api/rpc.ts')

    const dependencySource = '../../../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/index.js'
    expect(transform(dependencySource, sourceMapPath)).toBe(dependencySource)
  })
})

describe('client bundle CSS Modules watch graph', () => {
  it('registers the physical stylesheet read behind a virtual module', async () => {
    const plugin = cssModulePlugin()
    const importer = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.tsx',
      import.meta.url,
    ))
    const stylesheet = fileURLToPath(new URL(
      '../packages/client/ui-conversation/src/client/queue/QueueDock.module.css',
      import.meta.url,
    ))
    const virtualId = plugin.resolveId?.('./QueueDock.module.css', importer)
    if (virtualId === null || virtualId === undefined) throw new Error('CSS Modules import was not resolved')
    const addWatchFile = vi.fn()

    await plugin.load?.call({ addWatchFile }, virtualId)

    expect(addWatchFile).toHaveBeenCalledExactlyOnceWith(stylesheet)
  })
})
