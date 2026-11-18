import { useState } from 'react'
import type { AsideOwnerProps, OverlayOwnerProps } from '@pentest-harness/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@pentest-harness/dsh-client-ui-slots'
import css from './BrowserPanel.module.css'

/** Address of the live view the host's browser plugin serves. */
const VIEW_PATH = '/browser/view'

/** Current shell theme, read when the view (re)loads. */
function shellTheme(): 'dark' | 'light' {
  return document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
}

function Icon(props: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={props.d} />
    </svg>
  )
}

const ICONS = {
  globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  reload: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  popout: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  maximize: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  restore: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
  close: 'M6 6l12 12M18 6L6 18',
} as const

/**
 * The aside occupant: a header bar and the live view of the shared browser.
 * While the column is closed it renders nothing, which drops the iframe and
 * stops the frame stream.
 * @param props - aside owner share from the layout.
 * @returns the panel.
 */
export function BrowserPanel(props: PropsRuntime<'aside'> & AsideOwnerProps) {
  const { width, maximized, close, toggleMaximized } = props
  const [nonce, setNonce] = useState(0)
  if (width === 0) return null
  const src = `${VIEW_PATH}?theme=${shellTheme()}`
  return (
    <section className={css.panel} aria-label="Browser">
      <header className={css.header}>
        <span className={css.title}>
          <Icon d={ICONS.globe} />
          Browser
        </span>
        <span className={css.actions}>
          <button type="button" title="Reconnect the view" aria-label="Reconnect the view" onClick={() => { setNonce(nonce + 1) }}>
            <Icon d={ICONS.reload} />
          </button>
          <button type="button" title="Open in a new window" aria-label="Open in a new window" onClick={() => { window.open(src, 'dsh-browser', 'popup,width=1280,height=860') }}>
            <Icon d={ICONS.popout} />
          </button>
          <button type="button" title={maximized ? 'Restore' : 'Maximize'} aria-label={maximized ? 'Restore' : 'Maximize'} onClick={toggleMaximized}>
            <Icon d={maximized ? ICONS.restore : ICONS.maximize} />
          </button>
          <button type="button" title="Close the browser" aria-label="Close the browser" onClick={close}>
            <Icon d={ICONS.close} />
          </button>
        </span>
      </header>
      <iframe key={nonce} className={css.frame} src={src} title="Shared browser" />
    </section>
  )
}

/**
 * The overlay toggle that opens the Browser column; hidden while it is open
 * (the panel header has its own close button).
 * @param props - overlay owner share from the layout.
 * @returns the toggle, or nothing while the column is open.
 */
export function BrowserToggle(props: PropsRuntime<'shell.overlay'> & OverlayOwnerProps) {
  if (props.asideWidth > 0) return null
  return (
    <button type="button" className={css.toggle} onClick={props.openAside} title="Show the browser the agent uses">
      <Icon d={ICONS.globe} />
      <span>Browser</span>
    </button>
  )
}
