// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@fathom/cordis'
import { stubSettingsScope, type StubSettingsScope } from '@fathom/client-test-runtime'
import type { LocaleSettings, LocaleSnapshot } from '@fathom/client-locale/client'
import { FALLBACK_LOCALE, LocaleRuntime } from '@fathom/client-locale/client'
const make = (host?: StubSettingsScope<LocaleSettings>): {
  ctx: Context
  svc: LocaleRuntime
  events: LocaleSnapshot[]
} => {
  const ctx = new Context()
  const events: LocaleSnapshot[] = []
  ctx.on('locale/change', (snapshot) => { events.push(snapshot) })
  return { ctx, svc: new LocaleRuntime(ctx, host?.scope), events }
}

/**
 * Pin the browser environment a fresh service reads its initial locale from.
 * This package's own specs stub the globals directly instead of using
 * `usePinnedBrowserLanguages` (fathom-client-test-runtime): they need the shapes
 * that helper deliberately cannot express — a missing `languages` list, a
 * list decoupled from `language`, and a non-browser run with no `window`.
 */
const stubLanguages = (...tags: string[]): void => {
  vi.stubGlobal('navigator', { languages: tags, language: tags[0] ?? '' })
}

describe('LocaleRuntime', () => {
  beforeEach(() => {
    stubLanguages('en-US')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('translates through the namespace -> key chain', () => {
    const { svc } = make()
    svc.register('ns', 'en', { hello: 'Hello' })
    const t = svc.bind('ns')
    expect(svc.getLocale().active).toBe('en')
    expect(t('hello')).toBe('Hello')
    expect(t('missing.key')).toBe('missing.key')
  })

  it('falls through to the common vocabulary after the namespace misses (production keys)', () => {
    const { svc } = make()
    // The shipped common dictionary is registered by apply; the bench registers
    // it directly to pin the production chain: ns -> common -> key.
    svc.register('common', 'en', { retry: 'Retry' })
    svc.register('ns', 'en', { own: 'Own' })
    const t = svc.bind('ns')
    expect(t('retry')).toBe('Retry')
    expect(t('own')).toBe('Own')
    // common itself must not recurse: a miss inside common echoes the key.
    // (Wide-string ns hits the untyped bind overload — the typed one rejects
    // unknown keys at compile time, which is the point of the typed registry contract.)
    expect(svc.bind('common' as string)('nope')).toBe('nope')
  })

  it('interpolates {name} params and leaves unknown placeholders intact', () => {
    const { svc } = make()
    svc.register('ns', 'en', { greet: 'Hello, {name}! Visit {n}', partial: '{known} and {unknown}' })
    const t = svc.bind('ns')
    expect(t('greet', { name: 'world', n: 2 })).toBe('Hello, world! Visit 2')
    expect(t('partial', { known: 'A' })).toBe('A and {unknown}')
  })

  it('bind returns a stable per-namespace function identity', () => {
    const { svc } = make()
    expect(svc.bind('a')).toBe(svc.bind('a'))
    expect(svc.bind('a')).not.toBe(svc.bind('b'))
  })

  it('rejects duplicate (ns, locale) and disposer only removes its own dict', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'en', { k: 'v1' })
    expect(() => svc.register('ns', 'en', { k: 'v2' })).toThrow('already has locale')
    dispose()
    const t = svc.bind('ns')
    expect(t('k')).toBe('k')
    svc.register('ns', 'en', { k: 'v2' })
    expect(t('k')).toBe('v2')
    dispose()
    expect(t('k')).toBe('v2')
  })

  it('serves the LocaleFace: snapshot revision moves on registration, subscribers fire, unsubscribe stops them', () => {
    const { svc } = make()
    const seen: number[] = []
    const off = svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
    expect(svc.getSnapshot()).toBe(svc.getLocale())
    const r0 = svc.getSnapshot().revision
    svc.register('ns', 'en', { k: 'v' })
    expect(svc.getSnapshot().revision).toBe(r0 + 1)
    svc.register('ns2', 'en', { k: 'v' })
    expect(seen).toEqual([r0 + 1, r0 + 2])
    off()
    svc.register('ns3', 'en', { k: 'v' })
    expect(seen).toHaveLength(2)
  })

  it('isolates a throwing subscriber: the rest still see the new revision', () => {
    const { svc } = make()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const seen: number[] = []
      svc.subscribe(() => { throw new Error('boom') })
      svc.subscribe(() => { seen.push(svc.getSnapshot().revision) })
      svc.register('ns', 'en', { k: 'v' })
      expect(seen).toEqual([1])
      expect(spy).toHaveBeenCalledOnce()
    } finally {
      spy.mockRestore()
    }
  })

  it('register disposer republishes (mounted outlets drop the dead dictionary)', () => {
    const { svc } = make()
    const dispose = svc.register('ns', 'en', { k: 'v' })
    const before = svc.getSnapshot().revision
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
    // Second run hits the idempotent arm: nothing removed, no republish.
    dispose()
    expect(svc.getSnapshot().revision).toBe(before + 1)
  })

  it('setLocale writes through the scope without republishing an unchanged locale', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    // Re-selecting the active locale publishes nothing (no subscriber churn)
    // but still writes: the active value may be a provisional browser-derived
    // resolution nothing has stored, and picking it is an explicit choice that
    // must outlive this browser.
    svc.setLocale('en')
    expect(svc.getLocale().active).toBe('en')
    expect(host.set).toHaveBeenCalledWith('preference', 'en')
    expect(events).toHaveLength(0)
  })

  it('persists an explicit pick of the provisional locale', () => {
    // A browser naming no shipped language opens at FALLBACK_LOCALE with
    // nothing stored; choosing it in the menu must become durable.
    stubLanguages('fr-FR')
    const host = stubSettingsScope<LocaleSettings>()
    const { svc } = make(host)
    expect(svc.getLocale().active).toBe('en')
    expect(host.set).not.toHaveBeenCalled()
    svc.setLocale('en')
    expect(host.set).toHaveBeenCalledWith('preference', 'en')
  })

  it('throws on unknown locale ids', () => {
    const { svc } = make()
    expect(() => { svc.setLocale('fr') }).toThrow('not registered')
    expect(() => { svc.setLocale('zh') }).toThrow('not registered')
  })

  it('adopts a Host preference without writing it back', () => {
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('en')
    expect(events).toHaveLength(0)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('ignores a stored preference this build does not ship', () => {
    // A selection saved by an older build (for example `zh`) still loads and
    // falls back to the browser-derived locale.
    const host = stubSettingsScope<LocaleSettings>()
    const { svc, events } = make(host)
    host.publish({ status: 'ready', value: { preference: 'zh' }, revision: 1, writable: true })
    expect(svc.getLocale().active).toBe('en')
    expect(events).toHaveLength(0)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('adopts a section already standing at construction and releases its subscription on dispose', async () => {
    const host = stubSettingsScope<LocaleSettings>()
    host.publish({ status: 'ready', value: { preference: 'en' }, revision: 1, writable: true })
    const { ctx, svc } = make(host)
    expect(svc.getLocale().active).toBe('en')
    expect(host.listenerCount()).toBe(1)
    await ctx.fiber.dispose()
    expect(host.listenerCount()).toBe(0)
  })

  it('opens in English whatever the browser asks for', () => {
    stubLanguages('en-GB')
    expect(make().svc.getLocale().active).toBe('en')
    stubLanguages('fr-FR', 'en-US')
    expect(make().svc.getLocale().active).toBe('en')
    // Only `language` populated: an empty ordered list, and a host that
    // exposes no `languages` property at all.
    vi.stubGlobal('navigator', { languages: [], language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    vi.stubGlobal('navigator', { language: 'en-US' })
    expect(make().svc.getLocale().active).toBe('en')
    // No shipped language anywhere in the browser's preferences.
    stubLanguages('zh-CN', 'de')
    expect(make().svc.getLocale().active).toBe('en')
  })

  it('runs outside a browser (node boots): the default decides and the machine language does not', () => {
    vi.stubGlobal('window', undefined)
    stubLanguages('fr-FR')
    const { svc } = make()
    expect(svc.getLocale().active).toBe('en')
  })

  it('serves English as both the opening locale and the dictionary fallback', () => {
    expect(FALLBACK_LOCALE).toBe('en')
    const { svc } = make()
    svc.register('ns', 'en', { onlyEn: 'English only' })
    expect(svc.bind('ns')('onlyEn')).toBe('English only')
  })

  it('exposes the shipped locale with its self-described label', () => {
    const { svc } = make()
    expect(svc.getLocale().locales).toEqual([{ id: 'en', label: 'English' }])
  })
})
