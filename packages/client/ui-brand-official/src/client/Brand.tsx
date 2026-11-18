import { PentestLogo } from '@pentest-harness/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@pentest-harness/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@pentest-harness/dsh-client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark with the presentation requested by its host surface:
 * the line-drawn shield and reticle in the surrounding ink, so it sits quietly
 * beside type in both themes.
 * @param props - Host-supplied mark presentation.
 * @returns the pentest logo mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <PentestLogo mono size={size} className={className} />
}

/** Wordmark type: one family, two weights, tight tracking. */
const WORDMARK_STYLE = {
  display: 'inline-flex',
  alignItems: 'baseline',
  gap: '0.28em',
  fontSize: 15,
  lineHeight: '20px',
  letterSpacing: '-0.02em',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'nowrap',
} as const

/**
 * Render the official name as set type rather than artwork, so it stays crisp
 * at any density and follows the theme's ink.
 * @returns the "Pentest Harness" wordmark.
 */
export function OfficialBrandName() {
  return (
    <span style={WORDMARK_STYLE}>
      <span style={{ fontWeight: 650 }}>Pentest</span>
      <span style={{ fontWeight: 400, color: 'var(--dsw-alias-label-secondary)' }}>Harness</span>
    </span>
  )
}
