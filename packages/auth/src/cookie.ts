/**
 * The arena_session cookie contract (Work Order B004; issue #69).
 *
 * ONE session cookie, issued and validated server-side:
 *
 *   - name:     `arena_session`
 *   - HttpOnly: always (no script access — the cookie is server-only state)
 *   - SameSite: `Lax` (the CSRF baseline; state-changing handlers add an
 *               origin check on top)
 *   - Secure:   in production (composition-supplied; plain HTTP local
 *               development may set it false)
 *   - Path:     `/`
 *   - value:    ONLY the opaque sealed session token (the session id + its
 *               HMAC seal). NEVER principal, tenant or role data — the
 *               token payload shape makes that structural (see token.ts).
 *
 * Everything here is PURE string handling: no Next.js imports, no request
 * APIs. The web boundary (apps/web/src/auth) adapts these specs onto real
 * cookie stores; parity tests assert the adaptation matches this contract.
 */

import { AUTH_ERROR_CODES, AuthError } from './errors.js';

/** The single session cookie name (the whole product speaks this one name). */
export const SESSION_COOKIE_NAME = 'arena_session';

/** Cookie attributes — FIXED parts of the contract. */
export const SESSION_COOKIE_PATH = '/' as const;
export const SESSION_COOKIE_SAME_SITE = 'Lax' as const;
export const SESSION_COOKIE_HTTP_ONLY = true as const;

/** Cookie attributes — environment-supplied. */
export interface SessionCookieSecurity {
  /** True in production (HTTPS); false only for plain-HTTP local dev. */
  readonly secure: boolean;
}

/** The full, versioned cookie spec the web boundary must materialize. */
export interface SessionCookieSpec {
  readonly name: typeof SESSION_COOKIE_NAME;
  readonly value: string;
  readonly httpOnly: typeof SESSION_COOKIE_HTTP_ONLY;
  readonly sameSite: typeof SESSION_COOKIE_SAME_SITE;
  readonly secure: boolean;
  readonly path: typeof SESSION_COOKIE_PATH;
  /** Max-age in seconds (bounded to the session TTL). */
  readonly maxAgeSeconds: number;
}

/** Max-age ceiling (mirrors MAX_SESSION_TTL_MS; defensive bound). */
export const MAX_SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Build the session cookie spec for a live session. `maxAgeSeconds` is
 * bounded to the cookie ceiling (typed rejection beyond it — a cookie must
 * never outlive the protocol's maximum session TTL).
 */
export function sessionCookieSpec(
  value: string,
  options: SessionCookieSecurity & { readonly maxAgeSeconds: number },
): SessionCookieSpec {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_COOKIE, {
      message: 'session cookie value must be a non-empty string',
    });
  }
  if (
    !Number.isInteger(options.maxAgeSeconds) ||
    options.maxAgeSeconds <= 0 ||
    options.maxAgeSeconds > MAX_SESSION_COOKIE_MAX_AGE_SECONDS
  ) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_COOKIE, {
      message: `session cookie maxAgeSeconds must be an integer in 1..${String(MAX_SESSION_COOKIE_MAX_AGE_SECONDS)}`,
      details: { received: options.maxAgeSeconds },
    });
  }
  return Object.freeze({
    name: SESSION_COOKIE_NAME,
    value,
    httpOnly: SESSION_COOKIE_HTTP_ONLY,
    sameSite: SESSION_COOKIE_SAME_SITE,
    secure: options.secure,
    path: SESSION_COOKIE_PATH,
    maxAgeSeconds: options.maxAgeSeconds,
  });
}

/** The logout/clearing cookie spec: same contract, max-age 0, empty value. */
export function clearedSessionCookieSpec(
  options: SessionCookieSecurity,
): SessionCookieSpec {
  return Object.freeze({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: SESSION_COOKIE_HTTP_ONLY,
    sameSite: SESSION_COOKIE_SAME_SITE,
    secure: options.secure,
    path: SESSION_COOKIE_PATH,
    maxAgeSeconds: 0,
  });
}

/**
 * Serialize a spec into a `Set-Cookie` header value (pure; the single
 * serialization authority so every adapter emits byte-identical headers).
 */
export function serializeSessionCookie(spec: SessionCookieSpec): string {
  const parts = [
    `${spec.name}=${spec.value}`,
    `Path=${spec.path}`,
    spec.httpOnly ? 'HttpOnly' : '',
    `SameSite=${spec.sameSite}`,
    spec.secure ? 'Secure' : '',
    `Max-Age=${String(spec.maxAgeSeconds)}`,
  ];
  return parts.filter((part) => part !== '').join('; ');
}

/** Parse `arena_session` out of a raw `Cookie` request header (null when absent). */
export function parseSessionCookieHeader(
  cookieHeader: string | null | undefined,
): string | null {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return null;
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = pair.slice(separator + 1).trim();
    if (value.length === 0) return null;
    return value;
  }
  return null;
}
