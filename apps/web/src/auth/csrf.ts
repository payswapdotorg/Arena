/**
 * CSRF origin-check posture (Work Order B004; BRIEF.md §4.3).
 *
 * Every STATE-CHANGING session handler (login POST, logout POST) performs
 * an ORIGIN CHECK before doing any work: the `Origin` request header must
 * be present AND either match the request's own origin (same-origin) or
 * appear in the composition's explicit allowlist. Cross-site form posts
 * are additionally mitigated by the `SameSite=Lax` session cookie (the
 * cookie contract never relaxes it).
 *
 * Chosen posture: origin-check (not double-submit) — documented in the
 * README and the PR. Rejections are boundary-level (HTTP 403) with a
 * closed boundary error vocabulary; they never touch session state.
 */

/** The closed boundary-level rejection code (outside the AUTH_* domain). */
export const CSRF_ORIGIN_REJECTED = 'BOUNDARY_ORIGIN_REJECTED' as const;

/** A boundary-level rejection (wire-safe, closed vocabulary). */
export interface BoundaryRejection {
  readonly code: typeof CSRF_ORIGIN_REJECTED;
  readonly message: string;
}

/**
 * Check the Origin header of a state-changing request.
 * Returns null when allowed; a typed boundary rejection otherwise.
 * An ABSENT or `null` Origin is REJECTED (strict posture — no exception
 * for legacy clients; disclose at composition time if that must change).
 */
export function checkOriginAllowed(
  request: Request,
  allowedOrigins: readonly string[],
): BoundaryRejection | null {
  const origin = request.headers.get('origin');
  if (origin === null || origin.length === 0) {
    return {
      code: CSRF_ORIGIN_REJECTED,
      message: 'state-changing session requests must carry an Origin header',
    };
  }
  if (origin === 'null') {
    return {
      code: CSRF_ORIGIN_REJECTED,
      message: 'an opaque Origin header is not allowed for state-changing session requests',
    };
  }
  try {
    if (origin === new URL(request.url).origin) return null; // same-origin
  } catch {
    return {
      code: CSRF_ORIGIN_REJECTED,
      message: 'the request URL is not parseable for the origin check',
    };
  }
  for (const allowed of allowedOrigins) {
    if (origin === allowed) return null;
  }
  return {
    code: CSRF_ORIGIN_REJECTED,
    message: 'the request origin is not allowed for state-changing session operations',
  };
}
