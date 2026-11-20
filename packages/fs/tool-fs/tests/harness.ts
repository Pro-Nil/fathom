import { Context } from '@fathom/cordis'
import type { Agent } from '@fathom/agent'
import AgentLoop from '@fathom/agent-loop'
import { mountAgentLoopTestDependencies } from '@fathom/agent-loop-testkit'
import LocalFileSystem from '@fathom/fs-local'
import * as FsPolicy from '@fathom/fs-observation-policy'
import * as ToolFs from '@fathom/tool-fs'
import * as LlmPiAi from '@fathom/llm-pi-ai'

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

/**
 * Build the real fs-tool stack for with-key e2e tests. Agents have no session
 * cwd, so `fsCwd` is their workspace; `persona` configures the deployment prompt.
 * This helper lives outside the e2e glob so imports do not register tests.
 */
export async function fsHarness(fsCwd: string, persona = ''): Promise<Context> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona } })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LlmPiAi, acmeRoute())
  await ctx.plugin(LocalFileSystem, { cwd: fsCwd })
  await ctx.plugin(FsPolicy)
  await ctx.plugin(ToolFs)
  return ctx
}

export function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}
