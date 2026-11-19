// @vitest-environment jsdom
/** Section, setup-card, and hand-written editor behavior over a scripted wire face. */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Schema from '@pentest-harness/schemastery'
import { bindSnapshotSelector } from '@pentest-harness/dsh-client-test-runtime'
import type { RpcResponse, SettingsNamespaceView } from '@pentest-harness/dsh-api-remotes/client'
import {
  ModelsSection, needsSetup, providerCopy, providerTargetLabel, removeProviderProfile,
} from '../src/client/ModelsSection.tsx'
import type { ModelsSectionInjected, ModelsSectionProps } from '../src/client/ModelsSection.tsx'
import { pathOps } from '../src/client/ProviderEditor.tsx'
import {
  formatCapacity, modelDrafts, parseCapacity, validateModelCatalog,
} from '../src/client/model-catalog.ts'
import { apiKeyFailure } from '../src/client/apiKey.ts'
import { SettingsDescribeMirror } from '@pentest-harness/dsh-client-ui-settings/src/client/settings-mirror.ts'
import { deriveKeyRef, ModelsSettingsStore } from '../src/client/store.ts'
import type { ProviderRow } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'
import { settingsSchema } from './settings-schema.client.ts'

afterEach(cleanup)

const t: ModelsSectionInjected['t'] = key => en[key]
const OPENAI_TARGET = { provider: 'openai', displayName: 'openai' }
const openaiCopy = (template: string): string => providerCopy(template, OPENAI_TARGET)

const PiAiConfig = Schema.object({
  providers: Schema.dict(Schema.object({
    apiKeyEnv: Schema.string().role('credential-ref'),
    baseURL: Schema.string(),
    reasoning: Schema.union(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
    headers: Schema.dict(Schema.string()),
  })),
})

const AcmeConfig = Schema.object({
  apiKeyEnv: Schema.string().role('credential-ref'),
  baseURL: Schema.string().pattern(/^https:\/\//),
  reasoningEffort: Schema.union(['off', 'low', 'high', 'max']),
  defaultContextWindow: Schema.number().step(1).min(1),
  models: Schema.array(Schema.object({
    id: Schema.string().required(),
    name: Schema.string(),
    description: Schema.string(),
    contextWindow: Schema.number().step(1).min(1),
  // The adapter declares its catalog as a schema default rather than a
  // composition entry, which is what the restore-defaults path has to read.
  })).default([
    {
      id: 'acme-v4-flash',
      name: 'Acme-V4-Flash',
      description: '',
      contextWindow: 1_000_000,
    },
    {
      id: 'acme-v4-pro',
      name: 'Acme-V4-Pro',
      description: '',
      contextWindow: 1_000_000,
    },
  ]),
})

const DEFAULT_ACME_MODELS = [
  {
    id: 'acme-v4-flash',
    name: 'Acme-V4-Flash',
    description: 'Preserved hidden detail',
    contextWindow: 1_000_000,
  },
  { id: 'acme-v4-pro', name: 'Acme-V4-Pro', contextWindow: 1_000_000 },
]

function wireNamespaces(): SettingsNamespaceView[] {
  return [
    {
      ns: 'llm-acme',
      schema: JSON.parse(JSON.stringify(AcmeConfig.toJSON())) as unknown,
      value: {
        apiKeyEnv: 'ACME_API_KEY',
        baseURL: 'https://base',
        defaultContextWindow: 1_000_000,
        maxTokens: 256_000,
        models: DEFAULT_ACME_MODELS,
      },
      base: { defaultContextWindow: 1_000_000, maxTokens: 256_000, models: DEFAULT_ACME_MODELS },
      user: { baseURL: 'https://base' },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-plain',
      schema: JSON.parse(JSON.stringify(Schema.object({
        profiles: Schema.dict(Schema.object({ note: Schema.string() })),
      }).toJSON())) as unknown,
      value: {},
      applies: 'live',
      secrets: [],
      revision: 0,
    },
    {
      ns: 'llm-pi-ai',
      schema: JSON.parse(JSON.stringify(PiAiConfig.toJSON())) as unknown,
      value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      user: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://proxy', headers: { 'X-Team': 'a' } }, zombie: {} } },
      applies: 'live',
      secrets: [],
      revision: 0,
    },
  ]
}

let nextRpc = 0
function ok<T>(value: T): RpcResponse<T> {
  return { rpcId: `r-${nextRpc++}` as never, result: { ok: true, value } }
}
function fail<T>(message: string, code = 'settings-rejected'): RpcResponse<T> {
  return {
    rpcId: `r-${nextRpc++}` as never,
    result: { ok: false, error: { code, message, details: { ns: 'x' } } as never },
  }
}

function scriptedFace(overrides: {
  update?: ReturnType<typeof vi.fn>
  replace?: ReturnType<typeof vi.fn>
  mutate?: ReturnType<typeof vi.fn>
  set?: ReturnType<typeof vi.fn>
  unset?: ReturnType<typeof vi.fn>
} = {}) {
  const update = overrides.update ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[2])))
  const replace = overrides.replace ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[2])))
  const mutate = overrides.mutate ?? vi.fn(() => Promise.resolve(ok(wireNamespaces()[2])))
  const set = overrides.set ?? vi.fn(() => Promise.resolve(ok({})))
  const unset = overrides.unset ?? vi.fn(() => Promise.resolve(ok({})))
  const face = {
    llm: {
      providers: vi.fn(() => Promise.resolve(ok({
        providers: [
          { provider: 'acme-official', displayName: 'Acme', settingsNs: 'llm-acme', settingsPath: [], active: true },
          { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], active: true },
          { provider: 'anthropic', displayName: 'anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], active: false },
          { provider: 'zombie', displayName: 'zombie', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'zombie'], active: false },
          { provider: 'broken', displayName: 'broken', settingsNs: 'llm-pi-ai', settingsPath: ['nope', 'x'], active: false },
          { provider: 'plain', displayName: 'plain', settingsNs: 'llm-plain', settingsPath: ['profiles', 'plain'], active: false },
        ],
      }))),
      models: vi.fn(() => Promise.resolve(ok({ groups: [], failures: [] }))),
    },
    settings: {
      describe: vi.fn(() => Promise.resolve(ok({ writable: true, hasDocument: false, namespaces: wireNamespaces() }))),
      update,
      replace,
      mutate,
    },
    credentials: {
      describe: vi.fn((payload: { refs: string[] }) => Promise.resolve(ok({
        credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
          configured: ref === 'OPENAI_API_KEY',
          ...ref === 'OPENAI_API_KEY' ? { source: 'file' } : {},
          writable: true,
        }])),
      }))),
      set,
      unset,
    },
  }
  return { face, update, replace, mutate, set, unset }
}

type WireFace = ConstructorParameters<typeof ModelsSettingsStore>[0]

async function mountFace(scripted: ReturnType<typeof scriptedFace>) {
  const { face, update, replace, mutate, set, unset } = scripted
  const mirror = new SettingsDescribeMirror(face as never)
  const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, mirror)
  await controller.load()
  const injected: ModelsSectionProps = {
    controller,
    useSnapshot: bindSnapshotSelector(controller.store),
    api: face as never,
    schema: settingsSchema,
    t,
  }
  const view = render(<ModelsSection {...injected} />)
  return { view, face, update, replace, mutate, set, unset, controller, mirror }
}

async function mountSection(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  return mountFace(scriptedFace(overrides))
}

/**
 * Mount for a user who cannot reach any provider yet: no credential is stored
 * anywhere, so the whole-section Acme route owns the first-run setup card.
 */
async function mountFirstRun(overrides: Parameters<typeof scriptedFace>[0] = {}) {
  const scripted = scriptedFace(overrides)
  scripted.face.credentials.describe.mockImplementation((payload: { refs: string[] }) =>
    Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
    })))
  return mountFace(scripted)
}

describe('ModelsSection', () => {
  it('renders nothing before the slot injects its dependencies', () => {
    const uninjected = {} as ModelsSectionProps
    render(<ModelsSection {...uninjected} />)
    expect(document.body.textContent).toBe('')
  })

  it('marks only a confirmed missing reference and leaves native or unavailable state unmarked', async () => {
    const { face } = scriptedFace()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: false, writable: true }])),
    })))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)

    const missing = screen.getByRole('img', { name: en.credentialMissing })
    expect(missing.getAttribute('title')).toBe(en.credentialMissing)
    expect(missing.className).toContain('credentialDotMissing')
    expect(missing.closest('li')?.textContent).toContain('openai')
    expect(screen.queryByRole('img', { name: en.credentialConfigured })).toBeNull()
    expect(screen.getByText('zombie').closest('li')?.querySelector('[role="img"]')).toBeNull()
  })

  it('turns the setup card into a row once the credential reports configured', async () => {
    const { face } = await mountFirstRun()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, { configured: true, writable: true }])),
    })))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)
    // Now a row with an Edit button, not an open card.
    expect(screen.getAllByText(en.edit).length).toBeGreaterThan(1)
    expect(screen.queryByLabelText(en.keyInput)).toBeNull()
  })

  it('decides setup need from the joined credential state and the first-run posture', () => {
    const entry = { provider: 'p', displayName: 'p', settingsNs: 'llm-acme', settingsPath: [], active: true }
    const row = (credential: ProviderRow['credential']): ProviderRow => ({
      entry,
      configured: true,
      removable: false,
      apiKeyEnv: 'X',
      credential,
    })
    expect(needsSetup(row(undefined), false)).toBe(true)
    expect(needsSetup(row({ configured: true, writable: true }), false)).toBe(false)
    const nested = { ...row(undefined), entry: { ...entry, settingsPath: ['providers', 'x'] } }
    expect(needsSetup(nested, false)).toBe(false)
    // A user who can already reach some provider is not in the first-run
    // posture, so nothing on the page opens itself.
    expect(needsSetup(row(undefined), true)).toBe(false)
  })

  it('derives conventional credential references from route ids', () => {
    expect(deriveKeyRef('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(deriveKeyRef('minimax-cn')).toBe('MINIMAX_CN_API_KEY')
  })

  it('uses one stable provider identity in action copy', () => {
    const target = { provider: 'acme-official', displayName: 'Acme' }
    expect(providerTargetLabel(target)).toBe('Acme (acme-official)')
    expect(providerCopy(en.deleteTitle, target)).toBe('Delete Acme (acme-official)?')
    expect(providerTargetLabel(OPENAI_TARGET)).toBe('openai')
  })

  it('names only changed fields instead of rebuilding the section', () => {
    expect(pathOps(['providers', 'openai'], { baseURL: 'https://old', reasoning: 'high' }, { reasoning: 'high' }))
      .toEqual([{ op: 'unset', path: ['providers', 'openai', 'baseURL'] }])
    expect(pathOps([], { b: 1 }, { b: 2, d: 3 }))
      .toEqual([{ op: 'set', path: ['b'], value: 2 }, { op: 'set', path: ['d'], value: 3 }])
    expect(pathOps([], undefined, {})).toEqual([])
    expect(pathOps([], { a: 1 }, { a: 1 })).toEqual([])
  })

  it('validates every adapter-owned model catalog invariant', () => {
    expect(modelDrafts(undefined)).toEqual([])
    expect(modelDrafts([null, 'bad', { id: 'ok' }])).toEqual([{}, {}, { id: 'ok' }])
    expect(validateModelCatalog([{}])).toEqual({ index: 0, key: 'modelIdRequired' })
    expect(validateModelCatalog([{ id: 'same' }, { id: 'same' }]))
      .toEqual({ index: 1, key: 'modelIdDuplicate' })
    expect(validateModelCatalog([{ id: 'model', name: '' }]))
      .toEqual({ index: 0, key: 'modelNameInvalid' })
    expect(validateModelCatalog([{ id: 'model', contextWindow: null }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModelCatalog([{ id: 'model', contextWindow: 1.5 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModelCatalog([{ id: 'model', contextWindow: 0 }]))
      .toEqual({ index: 0, key: 'modelContextInvalid' })
    expect(validateModelCatalog([{ id: 'model', contextWindow: 1 }])).toBeUndefined()
    expect(validateModelCatalog([{ id: 'model', maxTokens: null }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateModelCatalog([{ id: 'model', maxTokens: 1.5 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateModelCatalog([{ id: 'model', maxTokens: 0 }]))
      .toEqual({ index: 0, key: 'modelMaxTokensInvalid' })
    expect(validateModelCatalog([{ id: 'model', maxTokens: 8192 }])).toBeUndefined()
  })

  it('reads context windows written as counts, thousands, or millions', () => {
    expect(parseCapacity('')).toBeUndefined()
    expect(parseCapacity('   ')).toBeUndefined()
    expect(parseCapacity('131072')).toBe(131_072)
    expect(parseCapacity(' 256K ')).toBe(256_000)
    expect(parseCapacity('256k')).toBe(256_000)
    expect(parseCapacity('1M')).toBe(1_000_000)
    expect(parseCapacity('1m')).toBe(1_000_000)
    // 1M is 1000K, not 1024K: capacities are quoted in decimal.
    expect(parseCapacity('1M')).toBe(parseCapacity('1000K'))
    // 2.3 * 1e6 is a few ULPs high in binary floating point; an integral
    // intent must not become a fractional count the validator rejects.
    expect(parseCapacity('2.3M')).toBe(2_300_000)
    expect(Number.isInteger(parseCapacity('1.5M'))).toBe(true)
    // A genuinely fractional count survives as one, for the validator to reject.
    expect(parseCapacity('0.0001K')).toBeCloseTo(0.1)
    expect(parseCapacity('abc')).toBeNaN()
    expect(parseCapacity('1G')).toBeNaN()
    expect(parseCapacity('1M1')).toBeNaN()
  })

  it('spells a stored count in the shortest form that round-trips', () => {
    expect(formatCapacity(1_000_000)).toBe('1M')
    expect(formatCapacity(256_000)).toBe('256K')
    expect(formatCapacity(1_500_000)).toBe('1500K')
    expect(formatCapacity(131_072)).toBe('131072')
    // Values the validator will reject are shown as-is rather than dressed up.
    expect(formatCapacity(Number.NaN)).toBe('NaN')
    expect(formatCapacity(0)).toBe('0')
    for (const text of ['1M', '256K', '131072', '1500K']) {
      expect(formatCapacity(parseCapacity(text) as number)).toBe(text)
    }
  })

  it('edits a pi-ai profile with the curated fields only', async () => {
    const { mutate } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    // The configured credential shows as the stored placeholder.
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyStored) })
    // pi-ai carries Base URL too: the stored override shows as the value and
    // the effective profile endpoint as its placeholder source.
    fireEvent.click(screen.getByText(en.customized))
    const url = screen.getByLabelText<HTMLInputElement>(en.baseUrl)
    expect(url.value).toBe('https://proxy')
    fireEvent.change(url, { target: { value: 'https://proxy/v2' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    // Only the edited field travels: apiKeyEnv and headers were already stored
    // with these values, so no op restates them.
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'openai', 'baseURL'], value: 'https://proxy/v2' }],
      expectedRevision: 0,
    })
  })

  it('adds a dormant provider with a derived reference and stores its key', async () => {
    const { mutate, set } = await mountSection()
    fireEvent.click(screen.getByText(en.add))
    const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)
    expect([...pick.options].map(option => option.value)).toEqual(['anthropic', 'broken', 'plain'])
    expect(pick.value).toBe('anthropic')
    // A dormant profile has no endpoint anywhere: the pi-ai placeholder
    // falls back to the provider-default wording.
    fireEvent.click(screen.getByText(en.customized))
    expect(screen.getByLabelText<HTMLInputElement>(en.baseUrl).placeholder).toBe(en.baseUrlDefault)
    const addKey = screen.getByLabelText<HTMLInputElement>(en.keyInput)
    expect(addKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(addKey, { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'anthropic', 'apiKeyEnv'], value: 'ANTHROPIC_API_KEY' }],
      expectedRevision: 0,
    })
    await waitFor(() => { expect(set).toHaveBeenCalledWith({ ref: 'ANTHROPIC_API_KEY', value: 'sk-ant' }) })
  })

  it('keeps pi-ai provider-native authentication when no key is entered', async () => {
    const { mutate, set } = await mountSection()
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'set', path: ['providers', 'anthropic'], value: {} }],
      expectedRevision: 0,
    })
    expect(set).not.toHaveBeenCalled()
  })

  it('retries only the credential after refreshed settings already committed', async () => {
    const committed = wireNamespaces()[2]!
    const afterSettings: SettingsNamespaceView = {
      ...committed,
      value: { providers: {
        ...(committed.value as { providers: object }).providers,
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      user: { providers: {
        ...(committed.user as { providers: object }).providers,
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      } },
      revision: 1,
    }
    const mutate = vi.fn(() => Promise.resolve(ok(afterSettings)))
    const set = vi.fn()
      .mockResolvedValueOnce(fail('credential store unavailable', 'credential-rejected'))
      .mockResolvedValueOnce(ok({}))
    const { face, controller, mirror } = await mountSection({ mutate, set })
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-ant' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText('credential store unavailable')
    expect(mutate).toHaveBeenCalledOnce()
    face.settings.describe.mockResolvedValue(ok({
      writable: true,
      hasDocument: false,
      namespaces: wireNamespaces().map(namespace => namespace.ns === 'llm-pi-ai' ? afterSettings : namespace),
    }))
    // The refreshed settings answer reaches the page through the mirror's own
    // refresh (the document commit's invalidation in production).
    await act(async () => {
      await mirror.load()
      await controller.load()
    })
    expect(controller.store.getSnapshot().namespaces.get('llm-pi-ai')?.revision).toBe(1)
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(2) })
    expect(mutate).toHaveBeenCalledOnce()
    expect(set).toHaveBeenLastCalledWith({ ref: 'ANTHROPIC_API_KEY', value: 'sk-ant' })
  })

  it('switches the add card target and degrades unknown or broken targets loudly', async () => {
    await mountSection()
    fireEvent.click(screen.getByText(en.add))
    const pick = await screen.findByLabelText<HTMLSelectElement>(en.provider)
    fireEvent.change(pick, { target: { value: 'broken' } })
    await screen.findByText(/unresolvable settings path/)
    fireEvent.change(pick, { target: { value: 'plain' } })
    await waitFor(() => {
      expect(screen.getAllByText(content => content.includes(en.advancedHint)).length).toBeGreaterThan(0)
    })
    // The hint-only card cannot apply anything, and offers no key field.
    expect(screen.getByText<HTMLButtonElement>(en.apply).disabled).toBe(true)
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
  })

  it('surfaces a rejected settings write and never stores the key after it', async () => {
    const { set } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(fail('llm-pi-ai: unknown pi-ai provider "bogus"'))),
    })
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(en.keyInput), { target: { value: 'sk-x' } })
    fireEvent.click(screen.getByText(en.apply))
    await screen.findByText(/unknown pi-ai provider/)
    expect(set).not.toHaveBeenCalled()
  })

  it('locks the key input when the launch environment provides the credential', async () => {
    const { face } = await mountSection()
    face.credentials.describe.mockImplementation((payload: { refs: string[] }) => Promise.resolve(ok({
      credentials: Object.fromEntries(payload.refs.map(ref => [ref, {
        configured: ref === 'OPENAI_API_KEY', source: 'env', writable: false,
      }])),
    })))
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    await waitFor(() => { expect(editorKey.placeholder).toBe(en.keyEnvLocked) })
    expect(editorKey.disabled).toBe(true)
  })

  it('keeps a failed credential describe silent and the input usable', async () => {
    const { face, set } = await mountSection()
    face.credentials.describe.mockImplementation(() => Promise.resolve(fail('down', 'internal')) as never)
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.editProvider) }))
    const editorKey = await screen.findByLabelText<HTMLInputElement>(en.keyInput)
    expect(editorKey.placeholder).toBe(en.keyPlaceholderNative)
    fireEvent.change(editorKey, { target: { value: 'sk-live' } })
    fireEvent.click(screen.getByText(en.apply))
    await waitFor(() => { expect(set).toHaveBeenCalledTimes(1) })
  })

  it('requires confirmation before removing a user-added provider', async () => {
    const { replace, mutate, unset } = await mountSection()
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    expect(dialog.textContent).toContain(openaiCopy(en.deleteDescriptionWithCredential))
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: en.cancel }))
    expect(unset).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: en.cancel }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: en.close }))
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    fireEvent.click(within(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) }))
      .getByRole('button', { name: openaiCopy(en.deleteConfirm) }))
    await waitFor(() => { expect(unset).toHaveBeenCalledWith({ ref: 'OPENAI_API_KEY' }) })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(1) })
    expect(unset.mock.invocationCallOrder[0]).toBeLessThan(mutate.mock.invocationCallOrder[0] as number)
    expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    expect(replace).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', 'openai'] }],
    })
  })

  it('blocks duplicate deletion while the confirmed removal is pending', async () => {
    let resolveRemoval!: (response: RpcResponse<SettingsNamespaceView>) => void
    const mutate = vi.fn(() => new Promise<RpcResponse<SettingsNamespaceView>>((resolve) => {
      resolveRemoval = resolve
    }))
    await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    const confirm = within(dialog).getByRole<HTMLButtonElement>('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(confirm.disabled).toBe(true)
    expect(within(dialog).getByRole<HTMLButtonElement>('button', { name: en.cancel }).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: openaiCopy(en.deleting) })).toBe(confirm)
    fireEvent.click(within(dialog).getByRole('button', { name: en.close }))
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(mutate).toHaveBeenCalledOnce()
    await act(async () => { resolveRemoval(ok(wireNamespaces()[2]!)) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('renders the load failure with a retry control', async () => {
    const face = scriptedFace()
    face.face.llm.providers = vi.fn(() => Promise.resolve(fail('directory down', 'internal'))) as never
    const controller = new ModelsSettingsStore(
      face.face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face.face as never))
    await controller.load()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face.face as never}
      schema={settingsSchema}
      t={t}
    />)
    expect(screen.getByText(/directory down/)).toBeTruthy()
    fireEvent.click(screen.getByText(en.retry))
    await waitFor(() => { expect(screen.queryByText(/directory down/)).toBeNull() })
  })

  it('shows the read-only notice and disables mutations for a read-only provider', async () => {
    const { face } = await mountSection()
    face.settings.describe.mockImplementation(() => Promise.resolve(ok({
      writable: false,
      hasDocument: false,
      namespaces: wireNamespaces(),
    })))
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    await controller.load()
    cleanup()
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)
    expect(screen.getByText(en.readOnly)).toBeTruthy()
    expect(screen.getAllByText<HTMLButtonElement>(en.remove).every(button => button.disabled)).toBe(true)
    expect(screen.getByText<HTMLButtonElement>(en.add).disabled).toBe(true)
  })

  it('toggles the row editor closed on a second edit click and on cancel', async () => {
    const { update } = await mountSection()
    const edit = screen.getByRole('button', { name: openaiCopy(en.editProvider) })
    fireEvent.click(edit)
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(edit)
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    fireEvent.click(edit)
    await waitFor(() => { expect(screen.queryAllByLabelText(en.keyInput).length).toBe(1) })
    fireEvent.click(screen.getByText(en.cancel))
    expect(screen.queryAllByLabelText(en.keyInput)).toHaveLength(0)
    expect(update).not.toHaveBeenCalled()
  })

  it('cancels the add card back to the add button', async () => {
    await mountSection()
    fireEvent.click(screen.getByText(en.add))
    await screen.findByLabelText(en.provider)
    fireEvent.click(screen.getByText(en.cancel))
    await screen.findByText(en.add)
    expect(screen.queryByLabelText(en.provider)).toBeNull()
  })

  it('loads on first render of an idle controller', async () => {
    const { face } = scriptedFace()
    const controller = new ModelsSettingsStore(face as unknown as WireFace, settingsSchema, new SettingsDescribeMirror(face as never))
    render(<ModelsSection
      controller={controller}
      useSnapshot={bindSnapshotSelector(controller.store)}
      api={face as never}
      schema={settingsSchema}
      t={t}
    />)
    await screen.findByText('Acme')
  })

  it('removes by unsetting the profile path, never by rebuilding the section', async () => {
    // The page only needs to name the profile path; rebuilding the section
    // would widen the write for no benefit.
    const { face, mutate, replace, controller } = await mountSection()
    await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-plain', settingsPath: ['ghost-profile'] },
    )
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-plain',
      ops: [{ op: 'unset', path: ['ghost-profile'] }],
    })
    expect(replace).not.toHaveBeenCalled()
  })

  it('keeps the snapshot untouched and reports the message when a removal write is refused', async () => {
    const { face, controller } = await mountSection({
      mutate: vi.fn(() => Promise.resolve(fail('read-only'))),
    })
    const before = controller.store.getSnapshot().rows
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    )
    expect(failure).toBe('read-only')
    expect(controller.store.getSnapshot().rows).toBe(before)
  })

  it('keeps a failed identified deletion recoverable in its confirmation dialog', async () => {
    const mutate = vi.fn()
      .mockResolvedValueOnce(fail('the host refused'))
      .mockResolvedValueOnce(ok(wireNamespaces()[2]!))
    const { unset } = await mountSection({ mutate })
    fireEvent.click(screen.getByRole('button', { name: openaiCopy(en.removeProvider) }))
    const dialog = screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })
    const confirm = within(dialog).getByRole('button', { name: openaiCopy(en.deleteConfirm) })
    fireEvent.click(confirm)
    await within(dialog).findByText('the host refused')
    expect(screen.getByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBe(dialog)
    expect(unset).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledOnce()

    fireEvent.click(confirm)
    await waitFor(() => { expect(unset).toHaveBeenCalledTimes(2) })
    await waitFor(() => { expect(mutate).toHaveBeenCalledTimes(2) })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: openaiCopy(en.deleteTitle) })).toBeNull()
    })
  })

  it('retains credentials that are not identified as page-managed', async () => {
    const { unset, mutate } = await mountSection()
    const target = { provider: 'zombie', displayName: 'zombie' }
    fireEvent.click(screen.getByRole('button', { name: providerCopy(en.removeProvider, target) }))
    const dialog = screen.getByRole('dialog', { name: providerCopy(en.deleteTitle, target) })
    expect(dialog.textContent).toContain(providerCopy(en.deleteDescription, target))
    fireEvent.click(within(dialog).getByRole('button', { name: providerCopy(en.deleteConfirm, target) }))
    await waitFor(() => { expect(mutate).toHaveBeenCalledOnce() })
    expect(unset).not.toHaveBeenCalled()
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      ns: 'llm-pi-ai',
      ops: [{ op: 'unset', path: ['providers', 'zombie'] }],
    })
  })

  it('does not remove provider settings when its managed credential removal is refused', async () => {
    const { face, controller, mutate } = await mountSection({
      unset: vi.fn(() => Promise.resolve(fail('credential is read-only', 'credential-rejected'))),
    })
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      {
        settingsNs: 'llm-pi-ai',
        settingsPath: ['providers', 'openai'],
        credentialRef: 'OPENAI_API_KEY',
      },
    )
    expect(failure).toBe('credential is read-only')
    expect(mutate).not.toHaveBeenCalled()
  })

  it('reports a transport rejection instead of failing the removal silently', async () => {
    const { face, controller } = await mountSection({
      mutate: vi.fn(() => Promise.reject(new Error('connection lost'))),
    })
    const failure = await removeProviderProfile(
      face as unknown as Parameters<typeof removeProviderProfile>[0],
      controller,
      { settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'] },
    )
    expect(failure).toBe('connection lost')
  })
})

describe('apiKeyFailure', () => {
  it('treats a blank field as no failure — it means keep the stored key', () => {
    expect(apiKeyFailure('')).toBeUndefined()
  })

  it.each([
    ['a printable-ASCII key', 'sk-0123456789'],
    ['a padded key, which the caller trims', '  sk-abc  '],
    ['the printable-ASCII boundary characters', '!~'],
    ['a hyphenated key carrying an equals sign', 'sk-ABC=xyz'],
    ['an all-upper-case key ending in base64 padding', 'ABCD=='],
    ['an all-upper-case key ending in one padding character', 'MNOPQRST='],
  ])('accepts %s', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBeUndefined()
  })

  it.each([
    ['spaces', '   '],
    ['a tab', '\t'],
  ])('fails a field holding only %s instead of silently dropping it', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyBlank')
  })

  it.each([
    ['an emoji', 'sk-\u{1F600}'],
    ['CJK text', 'sk-몴섻'],
    ['full-width punctuation', 'sk-abc，'],
    ['an interior space', 'sk-abc def'],
    ['a C0 control character', 'sk-abc\x01'],
    ['a latin-1 character', 'sk-café'],
  ])('fails %s as illegal characters', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it.each([
    ['a pasted environment line', 'ACME_API_KEY=sk-abc'],
    ['double quotes', '"sk-abc"'],
    ['single quotes', '\'sk-abc\''],
    ['backticks', '`sk-abc`'],
  ])('fails %s as a format failure', (_label, draft) => {
    expect(apiKeyFailure(draft)).toBe('keyIllegalCharacters')
  })

  it('needs a matching closing quote before it calls a value wrapped', () => {
    // A lone quote and an unbalanced one are legal printable ASCII, so the
    // heuristic leaves them alone rather than guessing at a paste error.
    expect(apiKeyFailure('"')).toBeUndefined()
    expect(apiKeyFailure('"a')).toBeUndefined()
  })
})
