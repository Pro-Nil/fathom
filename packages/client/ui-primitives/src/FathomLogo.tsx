/**
 * The Fathom mark: a source point and three wavefronts reaching down, each
 * narrower than the last, like a sonar beam taking the depth. Drawn on the
 * 24-unit icon grid; the same geometry produces the favicon, the desktop app
 * icon and the README banner (`scripts/make-brand-assets.py`).
 * @module
 */

import type { IconProps } from './icons/props.ts'

/** Fathom teal. */
export const FATHOM_TEAL = '#2DD4BF'

/** Path data of the mark on the 24-unit grid, top to bottom, with each part's opacity in the color mark. */
export const FATHOM_MARK_PARTS: ReadonlyArray<{ readonly d: string; readonly opacity: number }> = [
  { d: 'M9.9 3.4a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0Z', opacity: 1 },
  { d: 'M18.269 6.733A7.100 7.100 0 0 1 5.731 6.733A1.100 1.100 0 0 1 7.674 5.700A4.900 4.900 0 0 0 16.326 5.700A1.100 1.100 0 0 1 18.269 6.733Z', opacity: 1 },
  { d: 'M17.312 13.825A11.700 11.700 0 0 1 6.688 13.825A1.100 1.100 0 0 1 7.687 11.865A9.500 9.500 0 0 0 16.313 11.865A1.100 1.100 0 0 1 17.312 13.825Z', opacity: 0.72 },
  { d: 'M15.528 19.314A16.300 16.300 0 0 1 8.472 19.314A1.100 1.100 0 0 1 8.948 17.166A14.100 14.100 0 0 0 15.052 17.166A1.100 1.100 0 0 1 15.528 19.314Z', opacity: 0.45 },
]

/** The whole mark as one path (single-color uses). */
export const FATHOM_MARK_PATH = FATHOM_MARK_PARTS.map(part => part.d).join('')

/** Render options for the Fathom mark. */
export interface FathomLogoProps extends IconProps {
  /** One solid shape in the surrounding ink (currentColor) instead of the teal mark. */
  mono?: boolean | undefined
}

/**
 * Render the Fathom mark.
 * @param props.size - edge length in px (default 24; square).
 * @param props.className - extra class for layout placement.
 * @param props.mono - draw in currentColor without the depth fade.
 * @returns the mark svg (aria-hidden; pair it with the name for accessibility).
 */
export function FathomLogo({ size = 24, className, mono = false }: FathomLogoProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {mono
        ? <path d={FATHOM_MARK_PATH} fill="currentColor" />
        : FATHOM_MARK_PARTS.map(part => (
          <path key={part.d} d={part.d} fill={FATHOM_TEAL} fillOpacity={part.opacity < 1 ? part.opacity : undefined} />
        ))}
    </svg>
  )
}
