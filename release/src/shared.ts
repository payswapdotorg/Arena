/**
 * REL1.0 primitives (Work Order A036): closed vocabularies and typed
 * errors for the release-record surface.
 */

/** Wire version of every release record. */
export const RELEASE_RECORD_VERSION = 1 as const;

/** Closed launch-readiness verdicts. */
export const LAUNCH_VERDICTS = Object.freeze(['go', 'no-go'] as const);
export type LaunchVerdict = (typeof LAUNCH_VERDICTS)[number];

export function isLaunchVerdict(value: unknown): value is LaunchVerdict {
  return (
    typeof value === 'string' &&
    (LAUNCH_VERDICTS as readonly string[]).includes(value)
  );
}

/**
 * Closed evidence-citation kinds. A GO record must cite at least one
 * of each kind (fail-closed evidence completeness).
 */
export const EVIDENCE_KINDS = Object.freeze([
  'health-gate-report',
  'performance-evidence',
  'security-audit',
  'checklist-evaluation',
  'manifest',
  'benchmark',
] as const);
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export function isEvidenceKind(value: unknown): value is EvidenceKind {
  return (
    typeof value === 'string' &&
    (EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

export const RELEASE_ERROR_CODES = Object.freeze({
  INVALID_RECORD: 'REL_INVALID_RECORD',
  UNSIGNED_EVIDENCE: 'REL_UNSIGNED_EVIDENCE',
  BROKEN_CHAIN: 'REL_BROKEN_CHAIN',
  DUPLICATE_RELEASE: 'REL_DUPLICATE_RELEASE',
  MISSING_EVIDENCE: 'REL_MISSING_EVIDENCE',
  VERDICT_MISMATCH: 'REL_VERDICT_MISMATCH',
} as const);
export type ReleaseErrorCode =
  (typeof RELEASE_ERROR_CODES)[keyof typeof RELEASE_ERROR_CODES];

export class ReleaseError extends Error {
  readonly code: ReleaseErrorCode;
  constructor(code: ReleaseErrorCode, detail: string) {
    super(`[${code}] ${detail}`);
    this.name = 'ReleaseError';
    this.code = code;
  }
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;

export function isDigestHex(value: unknown): value is string {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isReleaseId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
