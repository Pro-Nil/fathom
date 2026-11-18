/**
 * Background-job plugin, browser half: contributes one session-header action
 * that renders this session's `ctx.jobs` records. The data arrives entirely
 * through the `jobsBySession` list mirror; the one RPC is the user's Stop on a
 * running job (`session.killJob`).
 */
import { createElement } from 'react'
import type { ClientContext } from '@pentest-harness/dsh-client-runtime/client'
import { JobListAction, type JobListActionProps } from './JobListAction.tsx'
import type {} from '@pentest-harness/dsh-client-locale/client'
import { en, NS, zh, type JobKey } from './locales.ts'

declare module '@pentest-harness/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Background-job list copy. */
    'job': JobKey
  }
}

export type { JobListActionProps, StopJobResult } from './JobListAction.tsx'

/** Required services for locale registration and header-slot contribution. */
export const inject = ['sessions', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries and the header action.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-job: dictionaries')
  // The only RPC this plugin makes: the user's Stop on one running job.
  const stopJob: NonNullable<JobListActionProps['stopJob']> = async (sessionId, jobId) => {
    const result = await ctx.sessions.killJob(sessionId, jobId)
    return result.ok ? null : result.error.message
  }
  const JobListWithStop = (props: JobListActionProps) => createElement(JobListAction, { ...props, stopJob })
  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'job-list',
      // After the subagent catalog: session lineage reads before process work.
      order: 20,
      locale: NS,
    }, JobListWithStop),
  )
}
