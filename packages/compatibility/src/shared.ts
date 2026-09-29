/**
 * @arena/compatibility — shared types and utilities (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 */

import { deepFreeze, isContentDigest, isVersionedArtifactRef } from '@arena/agent-body';

// Compatibility verdict vocabulary (closed, never scores)
export const COMPATIBILITY_VERDICTS = Object.freeze([
  'compatible',
  'incompatible-with-reasons',
  'unknown-with-structured-causes',
] as const);

export type CompatibilityVerdictKind = (typeof COMPATIBILITY_VERDICTS)[number];

// Structural check for verdict kind
export function isCompatibilityVerdictKind(value: unknown): value is CompatibilityVerdictKind {
  return typeof value === 'string' && COMPATIBILITY_VERDICTS.includes(value as CompatibilityVerdictKind);
}

// Validating constructor - unknown verdicts are rejected
export function toCompatibilityVerdictKind(value: string, context: string): CompatibilityVerdictKind {
  if (!isCompatibilityVerdictKind(value)) {
    throw new Error(`invalid compatibility verdict: ${JSON.stringify(value)} (context: ${context})`);
  }
  return value;
}

// Compatibility evaluation result
export interface CompatibilityResult {
  readonly verdict: CompatibilityVerdictKind;
  readonly reasons: readonly string[];
  readonly details: Record<string, unknown>;
}

// Structural check for compatibility result
export function isCompatibilityResult(value: unknown): value is CompatibilityResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCompatibilityVerdictKind(candidate.verdict) &&
    Array.isArray(candidate.reasons) &&
    typeof candidate.details === 'object' &&
    candidate.details !== null
  );
}

// Compatibility record lineage (append-only)
export interface CompatibilityRecord {
  readonly recordVersion: 1;
  readonly recordDigest: string;
  readonly bodyVersionRef: string;
  readonly substrateRef: string;
  readonly evaluatedAt: string;
  readonly verdict: CompatibilityVerdictKind;
  readonly reasons: readonly string[];
  readonly details: Record<string, unknown>;
  readonly parentDigest?: string | undefined;
}

// Structural check for compatibility record
export function isCompatibilityRecord(value: unknown): value is CompatibilityRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.recordVersion === 1 &&
    typeof candidate.recordDigest === 'string' &&
    isContentDigest(candidate.recordDigest) &&
    typeof candidate.bodyVersionRef === 'string' &&
    typeof candidate.substrateRef === 'string' &&
    typeof candidate.evaluatedAt === 'string' &&
    isCompatibilityVerdictKind(candidate.verdict) &&
    Array.isArray(candidate.reasons) &&
    typeof candidate.details === 'object' &&
    candidate.details !== null &&
    (candidate.parentDigest === undefined || isContentDigest(candidate.parentDigest))
  );
}

// Create a compatibility result
export function createCompatibilityResult(
  verdict: CompatibilityVerdictKind,
  reasons: readonly string[],
  details: Record<string, unknown> = {},
): CompatibilityResult {
  return deepFreeze({
    verdict,
    reasons: Object.freeze([...reasons]),
    details: Object.freeze(details),
  });
}

// Validate compatibility test suite references
export function validateTestSuiteRefs(
  testSuites: readonly { namespace: string; name: string; version: string; digest: string }[],
): void {
  const seen = new Set<string>();
  for (const suite of testSuites) {
    if (!isVersionedArtifactRef(suite)) {
      throw new Error(`invalid test suite reference: ${JSON.stringify(suite)}`);
    }
    const key = `${suite.namespace}/${suite.name}@${suite.version}#${suite.digest}`;
    if (seen.has(key)) {
      throw new Error(`duplicate test suite reference: ${key}`);
    }
    seen.add(key);
  }
}