/**
 * VerifierMethod — the CLOSED verification-method vocabulary of EV1.0
 * (Work Order A013; the EV1.0 spec's "Verification" section):
 *
 *   unit/integration tests | deterministic/formal checks | constraint
 *   checks | simulation | measurement | inspection | expert review |
 *   evidence provenance validation
 *
 * rendered as the exact dispatch tokens (spec/work-items.md A013):
 *
 *   unit_integration_test | deterministic_formal_check |
 *   constraint_check | simulation | measurement | inspection |
 *   expert_review | evidence_provenance_validation
 *
 * The vocabulary is a closed enum: a VerifierDescriptor carrying a method
 * outside this set is REJECTED at construction (negative test), and the
 * generated contract (contracts/verification/verifier-descriptor.v1.json)
 * mirrors the enum so wire-side drift fails parity.
 *
 * Only `constraint_check` and `evidence_provenance_validation` have
 * reference implementations in the A013 reference fabric
 * (services/verification); the other six methods are DECLARED descriptor
 * types with pluggable hook interfaces and no implementations
 * (Work Order A013 scope NOTE).
 */

import { VERIFICATION_ERROR_CODES } from './errors.js';
import { expectEnumMember } from './shared.js';

export const VERIFIER_METHODS = Object.freeze([
  'unit_integration_test',
  'deterministic_formal_check',
  'constraint_check',
  'simulation',
  'measurement',
  'inspection',
  'expert_review',
  'evidence_provenance_validation',
] as const);

export type VerifierMethod = (typeof VERIFIER_METHODS)[number];

/** Structural (non-throwing) check for the closed verifier-method enum. */
export function isVerifierMethod(value: unknown): value is VerifierMethod {
  return (
    typeof value === 'string' &&
    (VERIFIER_METHODS as readonly string[]).includes(value)
  );
}

/**
 * Validate a verifier method. Unknown methods are rejected with
 * VERIFICATION_INVALID_METHOD — the closed-enum negative gate.
 */
export function toVerifierMethod(value: string, context: string): VerifierMethod {
  return expectEnumMember(
    value,
    VERIFIER_METHODS,
    'method',
    VERIFICATION_ERROR_CODES.INVALID_METHOD,
    context,
  );
}
