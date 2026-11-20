import { FathomLogo } from '@fathom/client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@fathom/client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@fathom/client-ui-sidebar/client'

type OfficialBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the official mark at the size its host surface asks for: the teal
 * Fathom sounding, drawn as vectors so it stays crisp at any density.
 * @param props - Host-supplied mark presentation.
 * @returns the Fathom mark.
 */
export function OfficialBrandMark({ size, className }: OfficialBrandMarkProps) {
  return <FathomLogo size={size} className={className} />
}

/** Wordmark type: the UI family, semibold, tight tracking. */
const WORDMARK_STYLE = {
  display: 'inline-flex',
  alignItems: 'baseline',
  fontSize: 15,
  fontWeight: 650,
  lineHeight: '20px',
  letterSpacing: '-0.02em',
  color: 'var(--dsw-alias-label-primary)',
  whiteSpace: 'nowrap',
} as const

/**
 * Render the official name as set type rather than artwork, so it stays crisp
 * at any density and follows the theme's ink.
 * @returns the "Fathom" wordmark.
 */
export function OfficialBrandName() {
  return (
    <span style={WORDMARK_STYLE}>Fathom</span>
  )
}
