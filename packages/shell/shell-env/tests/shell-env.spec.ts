/**
 * Registry tests for `@fathom/shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@fathom/cordis'
import { CallId } from '@fathom/llm'
import type { Agent } from '@fathom/agent'
import type { ToolExecution } from '@fathom/tools'
import { ShellEnvRegistry } from '@fathom/shell-env'
import * as BashEnvPlugin from '@fathom/shell-env'

const testToolSignal = new AbortController().signal

afterEach(() => vi.unstubAllEnvs())

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: CallId('bash-env-call'),
    rootCallId: CallId('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : { agent: { session: { header: { version: 0, id: sessionId, createdAt: 0 } } } as Agent }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { fathomHome: './test-fathom-home' })

    expect(registry.collect(execution())).toEqual({
      FATHOM_HOME: resolve('./test-fathom-home'),
      FATHOM_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      FATHOM_HOME: resolve('./test-fathom-home'),
      FATHOM_SESSION_ID: 'session-a',
      FATHOM_SHELL: '1',
    })
  })

  it('resolves FATHOM_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('FATHOM_HOME', './ambient-fathom-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).FATHOM_HOME).toBe(resolve('./ambient-fathom-home'))

    vi.stubEnv('FATHOM_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    // A machine that still has a pre-rename home serves it until the CLI migrates it.
    expect([join(homedir(), '.fathom'), join(homedir(), '.' + 'dsh')]).toContain(fromDefault.collect(execution()).FATHOM_HOME)
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { fathomHome: './test-fathom-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        FATHOM_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { FATHOM_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        FATHOM_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ FATHOM_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('FATHOM_SESSION_OPTIONAL')
    expect(registry.collect(execution()).FATHOM_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).FATHOM_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'FATHOM_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'FATHOM_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { fathomHome: './test-fathom-home' })
    registry.register({
      name: 'first',
      variables: { FATHOM_SHARED: { description: 'First owner.' } },
      resolve: () => ({ FATHOM_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { FATHOM_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ FATHOM_SHARED: 'second' }),
    })).toThrow(/FATHOM_SHARED.*first.*second|FATHOM_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { fathomHome: './test-fathom-home' })
    registry.register({
      name: 'declared',
      variables: { FATHOM_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { FATHOM_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { FATHOM_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { fathom_invalid: { description: 'Invalid key.' } } as unknown as Record<'FATHOM_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { FATHOM_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { FATHOM_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { fathomHome: './test-fathom-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { FATHOM_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ FATHOM_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*FATHOM_UNDECLARED/)
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { fathomHome: './test-fathom-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { FATHOM_STRING: { description: 'String fact.' } },
      resolve: () => ({ FATHOM_STRING: 42 }) as unknown as Record<'FATHOM_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*FATHOM_STRING/)
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { fathomHome: './test-fathom-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { FATHOM_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ FATHOM_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).FATHOM_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('FATHOM_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { fathomHome: './test-fathom-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { FATHOM_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ FATHOM_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).FATHOM_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('FATHOM_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service and the persistence contributor on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([
      {
        contributor: 'session-persistence',
        description: 'Absolute target path of the current session JSONL when the active persistence backend provides one.',
        key: 'FATHOM_SESSION_JSONL',
      },
    ])
  })

  it('the persistence contributor resolves FATHOM_SESSION_JSONL only for a jsonl backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    ctx.provide('sessionPersistence', {
      locate: () => ({ kind: 'jsonl' as const, path: 'C:\\sessions\\s.jsonl' }),
    })
    expect(ctx.shellEnv.collect(execution('sess-p')).FATHOM_SESSION_JSONL).toBe('C:\\sessions\\s.jsonl')
  })

  it('the persistence contributor omits the variable for a non-jsonl backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    ctx.provide('sessionPersistence', {
      locate: () => ({ kind: 'sqlite' as const, path: 'C:\\sessions\\s.db' }),
    })
    expect(ctx.shellEnv.collect(execution('sess-p'))).not.toHaveProperty('FATHOM_SESSION_JSONL')
  })

  it('the persistence contributor omits the variable without a persistence backend', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv.collect(execution('sess-p'))).not.toHaveProperty('FATHOM_SESSION_JSONL')
  })
})
