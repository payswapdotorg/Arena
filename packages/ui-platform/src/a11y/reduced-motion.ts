/**
 * Reduced-motion helpers (UX1.0 §Motion: "Respect
 * prefers-reduced-motion"). Pure logic + the canonical media query string;
 * the CSS enforcement lives in src/styles/components.css and every
 * animated component consults these helpers for programmatic motion.
 */

/** The canonical media query for reduced motion. */
export const REDUCED_MOTION_MEDIA_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Interpret reduced-motion state from a media-state input. Accepts a
 * matchMedia-like `{ matches }`, a serialized state ("reduce" /
 * "no-preference"), or null/undefined (no signal). Unknown signals are
 * motion-safe by default — but see `motionDuration`, which collapses to
 * zero whenever reduced motion is detected.
 */
export function prefersReducedMotion(
  input: { readonly matches: boolean } | string | null | undefined,
): boolean {
  if (input === null || input === undefined) return false;
  if (typeof input === 'string') {
    return input.trim().toLowerCase() === 'reduce';
  }
  return input.matches === true;
}

/**
 * Resolve an animation duration: `0ms` whenever reduced motion is
 * preferred, otherwise the requested duration unchanged.
 */
export function motionDuration(reduced: boolean, duration: string): string {
  return reduced ? '0ms' : duration;
}
