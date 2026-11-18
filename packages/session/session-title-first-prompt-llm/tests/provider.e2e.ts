import { createUserMessage } from '@pentest-harness/dsh-llm'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@pentest-harness/cordis'
import LlmRuntime from '@pentest-harness/dsh-llm'
import * as LlmPiAi from '@pentest-harness/dsh-llm-pi-ai'
import SessionStore, { SessionId } from '@pentest-harness/dsh-session'
import SessionTitleService from '@pentest-harness/dsh-session-title'
import * as FirstMessageTitleProvider from '@pentest-harness/dsh-session-title-first-prompt-llm'

/** Live e2e route: any OpenAI-compatible endpoint named by ACME_BASE_URL and ACME_API_KEY. */
function acmeRoute(models: readonly Record<string, unknown>[] = [{ id: 'acme-v4-flash' }, { id: 'acme-v4-pro' }]): never {
  return {
    providers: {
      'acme-official': {
        displayName: 'Acme',
        api: 'openai-completions',
        baseURL: process.env['ACME_BASE_URL'] ?? 'https://api.acme.test/v1',
        apiKeyEnv: 'ACME_API_KEY',
        models,
      },
    },
  } as never
}

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

describe.skipIf(!process.env.ACME_API_KEY)('first-prompt title provider with real Acme API', () => {
  it('replaces the fallback with a short model title', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, acmeRoute())
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionTitleService, {
      fallbackMaxWords: 5,
      fallbackMaxBytes: 40,
      maxTitleBytes: 80,
    })
    await ctx.plugin(FirstMessageTitleProvider, {
      targetWords: 5,
      targetCjkCharacters: 10,
      maxInputBytes: 4_096,
      maxOutputTokens: 64,
      timeoutMs: 60_000,
      provider: 'acme-official',
      model: 'acme-v4-flash',
    })
    const session = ctx.sessions.create(SessionId('real-title-provider'))
    session.append('turn/start', {
      turn: 1,
    })
    const message = session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Explain why append-only logs make session titles durable.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const title = await ctx.sessionTitle.refresh(session)

    expect(title).toMatchObject({
      messageSeqs: [message.seq],
      source: {
        kind: 'provider',
        provider: 'session-title-first-prompt-llm',
        model: { provider: 'acme-official', model: 'acme-v4-flash' },
      },
    })
    expect(title?.title.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(title?.title ?? '', 'utf8')).toBeLessThanOrEqual(80)
  })
})
