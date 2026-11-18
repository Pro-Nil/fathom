/**
 * Browser pane: the layout's aside column shows the shared browser the agent
 * drives, with a header for reload, pop-out, maximize and close; a frame-wide
 * toggle opens it while it is closed.
 */
import type { ClientContext } from '@pentest-harness/dsh-client-runtime/client'
import type {} from '@pentest-harness/dsh-client-ui-layout/client'
import { BrowserPanel, BrowserToggle } from './BrowserPanel.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Occupy the aside column and add the open toggle to the overlay once the
 * layout declares both slots.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('aside', () =>
    ctx.slots.inject('shell.overlay', function* () {
      yield ctx.slots.register({ name: 'aside' }, BrowserPanel)
      yield ctx.slots.register({ name: 'shell.overlay', id: 'browser', order: 50 }, BrowserToggle)
    }))
}
