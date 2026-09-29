/**
 * Certification verdict discipline (Work Order A023; requirements R21,
 * R43; architecture-lock rule 4).
 *
 * CLOSED vocabularies, machine-readable reasons, structured
 * unknown-causes — never a bare score. Mirrors the sibling verdict
 * disciplines (@arena/verification's pass/fail/unknown with structured
 * unknown causes, @arena/compatibility's closed verdict kinds):
 *
 *   - suite verdict: satisfied | not-satisfied | unknown
 *     (the composition under test satisfied / did not satisfy / could
 *     not be determined against the suite);
 *   - stage outcome: satisfied | not-satisfied | unknown (one per
 *     declared suite stage);
 *   - stage unknownCause reasons (closed):
 *       missing-evidence    — no evidence record resolves the stage pin;
 *       evidence-mismatch   — evidence exists but does not match the
 *                             pin (wrong digest / wrong refs) — fail
 *                             closed, never a silent pass;
 *       invalid-evidence    — the supplied evidence record is not a
 *                             structurally valid sibling record;
 *       method-limitation   — the consumed verdict is itself
 *                             indeterminate/unknown (e.g. a
 *                             compatibility engine unknown), so the
 *                             certification cannot decide;
 *   - suite unknownCause reasons (closed): missing-evidence |
 *     evidence-mismatch | invalid-evidence | method-limitation (the
 *     driving stage reasons roll up, with the driving stage ids in the
 *     detail).
 *
 * Derivation is a PURE total function over the stage outcomes:
 *   - ANY not-satisfied stage ⇒ not-satisfied (a failed stage fails the
 *     suite — machine-readable reasons list the failing stages);
 *   - else ANY unknown stage ⇒ unknown (fail-closed: missing or
 *     mismatched evidence can NEVER certify);
 *   - else satisfied.
 */

import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import { expectEnumMember } from './shared.js';

/** The closed suite-verdict vocabulary. */
export const CERTIFICATION_VERDICTS = Object.freeze([
  'satisfied',
  'not-satisfied',
  'unknown',
] as const);

export type CertificationVerdict = (typeof CERTIFICATION_VERDICTS)[number];

/** The closed stage-outcome vocabulary (same members as the suite verdict). */
export const STAGE_OUTCOMES = CERTIFICATION_VERDICTS;

export type StageOutcome = CertificationVerdict;

/** The closed unknown-cause reason taxonomy. */
export const CERTIFICATION_UNKNOWN_REASONS = Object.freeze([
  'missing-evidence',
  'evidence-mismatch',
  'invalid-evidence',
  'method-limitation',
  'tenant-mismatch',
] as const);

export type CertificationUnknownReason = (typeof CERTIFICATION_UNKNOWN_REASONS)[number];

/** Structural (non-throwing) check for the verdict vocabulary. */
export function isCertificationVerdict(value: unknown): value is CertificationVerdict {
  return (
    typeof value === 'string' &&
    (CERTIFICATION_VERDICTS as readonly string[]).includes(value)
  );
}

/** Structural (non-throwing) check for the unknown-reason taxonomy. */
export function isCertificationUnknownReason(
  value: unknown,
): value is CertificationUnknownReason {
  return (
    typeof value === 'string' &&
    (CERTIFICATION_UNKNOWN_REASONS as readonly string[]).includes(value)
  );
}

/** Validating constructor for verdicts — unknown verdicts rejected. */
export function toCertificationVerdict(value: string, context: string): CertificationVerdict {
  return expectEnumMember(
    value,
    CERTIFICATION_VERDICTS,
    'verdict',
    CERTIFICATION_ERROR_CODES.INVALID_VERDICT,
    context,
  );
}

/** Validating constructor for unknown reasons — unknown reasons rejected. */
export function toCertificationUnknownReason(
  value: string,
  context: string,
): CertificationUnknownReason {
  return expectEnumMember(
    value,
    CERTIFICATION_UNKNOWN_REASONS,
    'reason',
    CERTIFICATION_ERROR_CODES.INVALID_VERDICT,
    context,
  );
}

/**
 * The structured WHY of an unknown stage/suite outcome: a closed reason
 * plus deterministic neutral-text detail. An unknown without a recorded
 * reason is rejected by construction (mirrors the A013 UnknownCause).
 */
export interface CertificationUnknownCause {
  readonly reason: CertificationUnknownReason;
  readonly detail: string;
}

/** Stable field list for unknown causes (tests + contracts mirror it). */
export const CERTIFICATION_UNKNOWN_CAUSE_FIELDS = Object.freeze([
  'reason',
  'detail',
] as const) as readonly string[];

/** Structural (non-throwing) check for an unknown cause. */
export function isCertificationUnknownCause(
  value: unknown,
): value is CertificationUnknownCause {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCertificationUnknownReason(candidate['reason']) &&
    typeof candidate['detail'] === 'string' &&
    candidate['detail'].length > 0
  );
}

/** One per-stage outcome entry: stage id + closed outcome + machine reason. */
export interface StageResult {
  /** The suite stage this result speaks for (set-equal to the suite's stages). */
  readonly stageId: string;
  readonly outcome: StageOutcome;
  /** Machine-readable reason code (closed per-stage reason vocabulary). */
  readonly reason: string;
  /** The digest of the evidence record that drove the stage (null when none resolved). */
  readonly evidenceDigest: string | null;
  /** Structured unknown cause — REQUIRED iff outcome === 'unknown', else null. */
  readonly unknownCause: CertificationUnknownCause | null;
}

/** Stable field list for a stage result (tests + contracts mirror it). */
export const STAGE_RESULT_FIELDS = Object.freeze([
  'stageId',
  'outcome',
  'reason',
  'evidenceDigest',
  'unknownCause',
] as const) as readonly string[];

/** The closed per-stage machine reason codes (what drove each outcome). */
export const STAGE_REASONS = Object.freeze([
  // satisfied
  'stage-satisfied',
  // not-satisfied
  'stage-failed',
  'composition-mismatch',
  // unknown
  'missing-evidence',
  'evidence-mismatch',
  'invalid-evidence',
  'method-limitation',
  'tenant-mismatch',
] as const);

export type StageReason = (typeof STAGE_REASONS)[number];

/** Structural (non-throwing) check for the per-stage reason vocabulary. */
export function isStageReason(value: unknown): value is StageReason {
  return typeof value === 'string' && (STAGE_REASONS as readonly string[]).includes(value);
}

/** The derived suite-level outcome of the stage outcomes (pure, total). */
export interface DerivedCertificationOutcome {
  readonly verdict: CertificationVerdict;
  /** REQUIRED iff verdict === 'unknown'; null otherwise. */
  readonly unknownCause: CertificationUnknownCause | null;
  /** Machine-readable reason list — the stage ids that drove the verdict. */
  readonly reasons: readonly string[];
}

/**
 * Derive the suite verdict PURELY from the stage results (never
 * caller-supplied):
 *   any not-satisfied ⇒ not-satisfied (reasons name the failed stages);
 *   else any unknown   ⇒ unknown (fail-closed; the structured cause
 *                        carries the closed reason of the FIRST driving
 *                        unknown stage and the driving stage ids);
 *   else               ⇒ satisfied.
 */
export function deriveCertificationOutcome(
  stages: readonly StageResult[],
): DerivedCertificationOutcome {
  const failed = stages.filter((stage) => stage.outcome === 'not-satisfied');
  if (failed.length > 0) {
    return {
      verdict: 'not-satisfied',
      unknownCause: null,
      reasons: Object.freeze(
        failed.map((stage) => `stage ${stage.stageId}: ${stage.reason}`),
      ),
    };
  }
  const unknown = stages.filter((stage) => stage.outcome === 'unknown');
  if (unknown.length > 0) {
    const first = unknown[0]!;
    const cause =
      first.unknownCause !== null
        ? first.unknownCause
        : { reason: 'method-limitation' as const, detail: 'undetermined stage' };
    return {
      verdict: 'unknown',
      unknownCause: {
        reason: cause.reason,
        detail: `stages ${unknown.map((stage) => stage.stageId).join(', ')}: ${cause.detail}`,
      },
      reasons: Object.freeze(
        unknown.map((stage) => `stage ${stage.stageId}: ${stage.reason}`),
      ),
    };
  }
  return {
    verdict: 'satisfied',
    unknownCause: null,
    reasons: Object.freeze(['all stages satisfied']),
  };
}

/** Structural (non-throwing) check for one stage result. */
export function isStageResult(value: unknown): value is StageResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['stageId'] === 'string' &&
    candidate['stageId'].length > 0 &&
    isCertificationVerdict(candidate['outcome']) &&
    typeof candidate['reason'] === 'string' &&
    candidate['reason'].length > 0 &&
    (candidate['evidenceDigest'] === null ||
      (typeof candidate['evidenceDigest'] === 'string' &&
        /^[0-9a-f]{64}$/.test(candidate['evidenceDigest']))) &&
    ((candidate['outcome'] === 'unknown') === (candidate['unknownCause'] !== null)) &&
    (candidate['unknownCause'] === null || isCertificationUnknownCause(candidate['unknownCause']))
  );
}

/** Validate a stage-result input (throwing form used by the record constructor). */
export function toStageResult(value: unknown): StageResult {
  const record = value as Record<string, unknown>;
  if (!isStageResult(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_STAGE, {
      message: `invalid stage result: ${JSON.stringify(value)} (outcome/unknownCause pairing and closed vocabularies are enforced)`,
    });
  }
  return {
    stageId: record['stageId'] as string,
    outcome: toCertificationVerdict(record['outcome'] as string, 'stage result'),
    reason: record['reason'] as string,
    evidenceDigest: (record['evidenceDigest'] as string | null) ?? null,
    unknownCause: record['unknownCause'] as CertificationUnknownCause | null,
  };
}
