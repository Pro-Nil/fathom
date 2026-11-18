// Neutral fallback brand mark: a shield outline with a terminal prompt,
// shown only where no brand package fills the brand slot. Color rides
// currentColor (wordmark ink); square, so `size` sets both edges.

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
      <path
        d="M12 2.5 4 5.5v6c0 4.9 3.4 8.8 8 10 4.6-1.2 8-5.1 8-10v-6l-8-3Zm-3.2 7.3 2.6 2.2-2.6 2.2M12.6 14.6h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
