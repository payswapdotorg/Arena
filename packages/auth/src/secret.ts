/**
 * The ARENA_SESSION_SECRET contract (Work Order B004; issue #69; AGENTS.md
 * "Secrets are never committed").
 *
 * The session subsystem seals tokens with an HMAC-SHA256 key derived from a
 * server-held secret. The secret is resolved from the environment ONCE, at
 * composition time, through an INJECTED lookup (this package never reads
 * `process.env` itself and never logs the value).
 *
 * FAIL-CLOSED POSTURE (mirroring B002's DISABLED posture): a missing, empty
 * or too-short secret resolves to `disabled` — and the sealed-token factory
 * (`createSessionTokenSealer`) REFUSES TO CONSTRUCT with a typed
 * AUTH_DISABLED error. There is no default key, no generated fallback and no
 * warning-level downgrade anywhere in this package: a weak key is not a
 * representable state.
 *
 * ENTROPY FLOOR: the enforced minimum length is 32 characters
 * (`MIN_SESSION_SECRET_LENGTH`). A secret generated as 32 random bytes in
 * base64url (43 chars) or hex (64 chars) carries 256 bits of entropy — the
 * documented floor. Length is the enforced proxy; the generation guidance
 * is: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
 */

import { AUTH_ERROR_CODES, AuthError } from './errors.js';

/** The ONE environment variable this subsystem understands (name only). */
export const SESSION_SECRET_ENV_VAR = 'ARENA_SESSION_SECRET';

/** Enforced minimum secret length in characters (>= 256 bits via random base64url/hex). */
export const MIN_SESSION_SECRET_LENGTH = 32;

/** Closed vocabulary of DISABLED reasons (never a weak-key path). */
export const SESSION_SECRET_DISABLED_REASONS = Object.freeze([
  'missing',
  'too-short',
] as const);

export type SessionSecretDisabledReason =
  (typeof SESSION_SECRET_DISABLED_REASONS)[number];

/** The resolution of the session-secret contract. */
export type SessionSecretResolution =
  | { readonly status: 'enabled'; readonly secret: string }
  | {
      readonly status: 'disabled';
      readonly reason: SessionSecretDisabledReason;
      /** The env-var NAME (never the value) the operator must provide. */
      readonly envVar: string;
    };

/**
 * Resolve the session secret through an injected lookup (e.g.
 * `(name) => env[name]`). Missing/whitespace-only values are `missing`;
 * values shorter than `MIN_SESSION_SECRET_LENGTH` are `too-short`. Both
 * resolve to the DISABLED posture — the caller refuses to construct the
 * sealing subsystem, never a weak default key.
 */
export function resolveSessionSecret(
  lookup: (name: string) => string | undefined,
): SessionSecretResolution {
  const raw = lookup(SESSION_SECRET_ENV_VAR);
  if (raw === undefined) {
    return { status: 'disabled', reason: 'missing', envVar: SESSION_SECRET_ENV_VAR };
  }
  if (typeof raw !== 'string') {
    return { status: 'disabled', reason: 'missing', envVar: SESSION_SECRET_ENV_VAR };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { status: 'disabled', reason: 'missing', envVar: SESSION_SECRET_ENV_VAR };
  }
  if (trimmed.length < MIN_SESSION_SECRET_LENGTH) {
    return { status: 'disabled', reason: 'too-short', envVar: SESSION_SECRET_ENV_VAR };
  }
  return { status: 'enabled', secret: trimmed };
}

/**
 * Fail-closed guard for the ENABLED posture: throws the typed AUTH_DISABLED
 * error when the resolution is disabled (used by the sealed-token factory —
 * the factory refuses to construct). The error carries the env-var NAME and
 * the reason, NEVER any secret material.
 */
export function assertSessionSecretEnabled(
  resolution: SessionSecretResolution,
): string {
  if (resolution.status === 'enabled') return resolution.secret;
  throw new AuthError(AUTH_ERROR_CODES.DISABLED, {
    message: `the session subsystem is DISABLED: ${SESSION_SECRET_ENV_VAR} is ${resolution.reason} (minimum ${String(MIN_SESSION_SECRET_LENGTH)} characters, 256-bit entropy floor; provide a generated value — never a weak default key)`,
    details: {
      envVar: SESSION_SECRET_ENV_VAR,
      reason: resolution.reason,
      minimumLength: MIN_SESSION_SECRET_LENGTH,
    },
  });
}
