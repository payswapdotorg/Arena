/**
 * ComponentKind — the CLOSED vocabulary of sibling protocol components a
 * CertificationSuite can compose (Work Order A023; spec AB1.0 design law;
 * the dependency chain in spec/work-items.md A023: A013 verification +
 * A022 compatibility + A014 artifacts/datasets — the suite composes
 * evaluation + verification + compatibility references, mirroring the
 * composition-of-evidence principle).
 *
 *   evaluation     — a digest ref to an @arena/evaluation EvaluatorDescriptor
 *                    (A012; the criteria-based assessment protocol).
 *   verification   — a digest ref to an @arena/verification VerifierDescriptor
 *                    (A013; the evidence-establishment protocol).
 *   compatibility  — a digest ref to an @arena/compatibility
 *                    CompatibilityRecord (A022; the body/substrate
 *                    compatibility verdict protocol).
 *
 * The vocabulary is a closed enum: a CertificationSuiteDescriptor carrying
 * a component ref outside this set is REJECTED at construction (negative
 * test), and the generated contract (contracts/certification/certification-suite.v1.json)
 * mirrors the enum so wire-side drift fails parity. Future suites extend
 * by adding to this enum + re-running the contract generator (architecture-lock
 * rule 21 — new domains extend, they do not fork).
 */

import { CERTIFICATION_ERROR_CODES } from './errors.js';
import { expectEnumMember } from './shared.js';

export const COMPONENT_KINDS = Object.freeze([
  'evaluation',
  'verification',
  'compatibility',
] as const);

export type ComponentKind = (typeof COMPONENT_KINDS)[number];

/** Structural (non-throwing) check for the closed component-kind enum. */
export function isComponentKind(value: unknown): value is ComponentKind {
  return (
    typeof value === 'string' &&
    (COMPONENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Validate a component kind. Unknown kinds are rejected with
 * CERTIFICATION_INVALID_COMPONENT_KIND — the closed-enum negative gate.
 */
export function toComponentKind(value: string, context: string): ComponentKind {
  return expectEnumMember(
    value,
    COMPONENT_KINDS,
    'refKind',
    CERTIFICATION_ERROR_CODES.INVALID_COMPONENT_KIND,
    context,
  );
}
