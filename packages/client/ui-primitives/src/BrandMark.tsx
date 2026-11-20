// Neutral fallback brand mark: the Fathom mark as one shape in the
// surrounding ink, shown only where no brand package fills the brand slot.
// Square, so `size` sets both edges.

import { FATHOM_MARK_PATH } from './FathomLogo.tsx'
import type { IconProps } from './icons/props.ts'

/**
 * Render the fallback brand mark.
 * @param props.size - edge length in px (default 24).
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden; pair with the wordmark for accessibility).
 */
export function BrandMark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d={FATHOM_MARK_PATH} fill="currentColor" />
    </svg>
  )
}
