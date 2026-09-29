/**
 * Certification levels (Work Order A023; spec/quality-model.md
 * "Certification levels").
 *
 * The implementation MAY support:
 *   - DEVELOPMENT — internal test evidence;
 *   - CANDIDATE — suite complete, not production-cleared;
 *   - CERTIFIED — suite pass under declared composition;
 *   - CONDITIONAL — passes with declared constraints;
 *   - REVOKED — prior claim no longer valid.
 *
 * These are LIFECYCLE STATES OF A SCOPED CERTIFICATION CLAIM, never
 * universal professional ratings (spec/quality-model.md: "These are
 * lifecycle states, not universal professional ratings"). The grant
 * vocabulary (what a SATISFIED run may grant) is DEVELOPMENT |
 * CANDIDATE | CERTIFIED; CONDITIONAL is derived (a satisfied run whose
 * suite declares constraints); REVOKED is never granted by a run — it
 * is the effective state of a prior claim after an append-only
 * revocation record names it.
 */

import { CERTIFICATION_ERROR_CODES } from './errors.js';
import { expectEnumMember } from './shared.js';

/** The full lifecycle-level vocabulary (quality-model "Certification levels"). */
export const CERTIFICATION_LEVELS = Object.freeze([
  'DEVELOPMENT',
  'CANDIDATE',
  'CERTIFIED',
  'CONDITIONAL',
  'REVOKED',
] as const);

export type CertificationLevel = (typeof CERTIFICATION_LEVELS)[number];

/** The levels a SATISFIED run may grant (REVOKED is never granted). */
export const CERTIFICATION_GRANT_LEVELS = Object.freeze([
  'DEVELOPMENT',
  'CANDIDATE',
  'CERTIFIED',
] as const);

export type CertificationGrantLevel = (typeof CERTIFICATION_GRANT_LEVELS)[number];

/** Structural (non-throwing) check for the full level vocabulary. */
export function isCertificationLevel(value: unknown): value is CertificationLevel {
  return (
    typeof value === 'string' &&
    (CERTIFICATION_LEVELS as readonly string[]).includes(value)
  );
}

/** Structural (non-throwing) check for the grant vocabulary. */
export function isCertificationGrantLevel(value: unknown): value is CertificationGrantLevel {
  return (
    typeof value === 'string' &&
    (CERTIFICATION_GRANT_LEVELS as readonly string[]).includes(value)
  );
}

/** Validating constructor for the full vocabulary — unknown levels rejected. */
export function toCertificationLevel(value: string, context: string): CertificationLevel {
  return expectEnumMember(
    value,
    CERTIFICATION_LEVELS,
    'level',
    CERTIFICATION_ERROR_CODES.INVALID_LEVEL,
    context,
  );
}

/** Validating constructor for the grant vocabulary — unknown grants rejected. */
export function toCertificationGrantLevel(value: string, context: string): CertificationGrantLevel {
  return expectEnumMember(
    value,
    CERTIFICATION_GRANT_LEVELS,
    'levelGrant',
    CERTIFICATION_ERROR_CODES.INVALID_LEVEL,
    context,
  );
}

/**
 * Derive the granted level for a satisfied run (quality-model mapping):
 * a suite declaring constraints grants CONDITIONAL (passes WITH declared
 * constraints); otherwise the suite's declared grant level stands.
 * Non-satisfied runs grant NOTHING (null) — a failed or indeterminate
 * run must never mint a level.
 */
export function deriveGrantedLevel(
  levelGrant: CertificationGrantLevel,
  constraints: readonly string[],
): CertificationLevel {
  if (constraints.length > 0) return 'CONDITIONAL';
  return levelGrant;
}
