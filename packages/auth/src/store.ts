/**
 * The SessionStore port (Work Order B004; issue #69).
 *
 * The server-side session state port: issue / validate (fresh +
 * not-revoked + not-expired) / rotate / revoke / revoke-all-for-principal.
 * Deliberately a PORT (interface + typed outcomes), not an ORM — the
 * in-memory fake (local parity) and the control-plane-backed store (B002
 * ports, injected) both implement it and both run the SAME behavioral
 * contract suite (src/testing/contract-suite.ts — parity is executed, not
 * asserted).
 *
 * SEMANTICS every implementation MUST honor (asserted by the shared
 * contract suite):
 *   - `issue` stamps the principal's CURRENT revocation epoch onto the
 *     stored record; replaying an identical insert returns the stored
 *     record; a conflicting insert under a live id throws
 *     AUTH_SESSION_EXISTS;
 *   - `validate` returns a typed closed-vocabulary outcome — 'valid' (with
 *     the frozen record) | 'expired' | 'revoked' | 'rotated' | 'unknown'.
 *     Authentication failures FAIL CLOSED: no outcome degrades to an
 *     anonymous session;
 *   - `rotate(oldId, next)` is ONE-TIME: the old id is tombstoned as
 *     'rotated' (superseded), the next record is stored (epoch-stamped)
 *     and returned; rotating an unknown/revoked/rotated/expired session
 *     throws the matching typed error;
 *   - `revoke` tombstones a LIVE session (true); absent/expired/already
 *     tombstoned sessions return false;
 *   - `revokeAllForPrincipal` bumps the principal's revocation epoch:
 *     every previously issued session for that principal validates as
 *     'revoked' from then on; returns the number of LIVE sessions
 *     invalidated (expired sessions do not count);
 *   - every returned record is deep-frozen and structurally identical to
 *     the issued record (read discipline).
 */

import { AUTH_ERROR_CODES, AuthError } from './errors.js';
import { isSessionRecord, toSessionRecord } from './session.js';
import type { SessionRecord } from './session.js';
import type { AuthClock } from './shared.js';
import { isSessionId } from './shared.js';

/** The closed validation-outcome vocabulary (fail closed — no anonymous fallback). */
export const SESSION_VALIDATION_STATUSES = Object.freeze([
  'valid',
  'expired',
  'revoked',
  'rotated',
  'unknown',
] as const);

export type SessionValidationStatus = (typeof SESSION_VALIDATION_STATUSES)[number];

/** Typed validate outcome: the session record is present ONLY when valid. */
export interface SessionValidationOutcome {
  readonly status: SessionValidationStatus;
  readonly session: SessionRecord | null;
}

/** Internal guard shared by implementations (fail closed on malformed ids). */
export function assertSessionStoreId(sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_ID, {
      message: `session store addressed an invalid session id: ${JSON.stringify(sessionId)}`,
    });
  }
  return sessionId;
}

/**
 * Validate a store-input record (fail closed — implementations MUST reject
 * malformed records, never store them). Structurally valid records pass
 * through unchanged (preserving frozen-object identity); anything else is
 * re-run through the strict parser for a precise typed error.
 */
export function toSessionStoreRecord(value: unknown): SessionRecord {
  if (isSessionRecord(value)) return value;
  try {
    return toSessionRecord(value);
  } catch (cause) {
    throw new AuthError(AUTH_ERROR_CODES.INVALID_SESSION_RECORD, {
      message: 'session store rejected a malformed session record',
      cause,
    });
  }
}

export interface SessionStore {
  /**
   * Store a session record (idempotent replay on identical input; typed
   * AUTH_SESSION_EXISTS on a conflicting live id). Returns the stored,
   * epoch-stamped, frozen record.
   */
  issue(session: SessionRecord): Promise<SessionRecord>;
  /** The live session record, or null when absent/expired/revoked/rotated. */
  get(sessionId: string): Promise<SessionRecord | null>;
  /** The typed fail-closed validation outcome for a session id. */
  validate(sessionId: string): Promise<SessionValidationOutcome>;
  /**
   * One-time rotation: tombstone `sessionId` as rotated, store `next`
   * (epoch-stamped), return the stored record. Typed failures:
   * AUTH_SESSION_NOT_FOUND / AUTH_SESSION_REVOKED / AUTH_SESSION_ROTATED /
   * AUTH_SESSION_EXPIRED / AUTH_ROTATION_CONFLICT (concurrent rotation).
   */
  rotate(sessionId: string, next: SessionRecord): Promise<SessionRecord>;
  /** Tombstone a live session (true); absent/expired/tombstoned => false. */
  revoke(sessionId: string): Promise<boolean>;
  /**
   * Bump the principal's revocation epoch — every live session for the
   * principal becomes 'revoked'. Returns the number of LIVE sessions
   * invalidated.
   */
  revokeAllForPrincipal(principalId: string): Promise<number>;
}

/** The injected clock seam implementations receive at construction time. */
export type { AuthClock };
