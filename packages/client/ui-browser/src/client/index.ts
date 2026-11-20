/**
 * Browser pane: the layout's aside column shows the shared browser the agent
 * drives, with a header for reload, pop-out, maximize and close. Inside a
 * Session a Browser button sits with the conversation header's utilities
 * (beside Session log); on the new-session screen, which has no header, the
 * same button floats at the top right.
 */
import type { ClientContext } from '@fathom/client-runtime/client'
import type {} from '@fathom/client-ui-conversation/client'
import type {} from '@fathom/client-ui-layout/client'
import { BrowserHeaderButton, BrowserPanel, BrowserToggle } from './BrowserPanel.tsx'
import type { BrowserHeaderInjected } from './BrowserPanel.tsx'

/** Required services: the UI slot registry and the layout's panel actions. */
export const inject = ['slots', 'layout']

/** Width the column opens at, as a share of the window. */
const OPEN_RATIO = 0.45

/**
 * Occupy the aside column and add the Browser button to the session header
 * and to the overlay once their owners declare the slots.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const toggleBrowser = (): void => { ctx.layout.toggleAside(Math.round(window.innerWidth * OPEN_RATIO)) }
  ctx.slots.inject('aside', () =>
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.inject('conversation.session.header.utilities', function* () {
        yield ctx.slots.register({ name: 'aside' }, BrowserPanel)
        yield ctx.slots.register({ name: 'shell.overlay', id: 'browser', order: 50 }, BrowserToggle)
        yield ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'browser',
          order: 10,
          inject: (): BrowserHeaderInjected => ({ toggleBrowser }),
        }, BrowserHeaderButton)
      })))
}
