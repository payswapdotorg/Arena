/**
 * ValidatedTrajectoryRef — the typed reference bundle that gates skill
 * extraction (Work Order A019; requirement R17 — "Extract reusable Skills
 * from validated trajectories"; architecture-lock rules 6, 7 — historical
 * evidence is append-only; evaluation and verification are distinct
 * responsibilities).
 *
 * A trajectory is an extraction input ONLY when it is VALIDATED, and
 * validated means exactly this bundle:
 *
 *   - `trajectory` — the REAL A011 TrajectoryRecord (structural guard
 *     from @arena/trajectory, never reimplemented), which must be
 *     COMPLETED (frozen by its terminal completion entry — mining an
 *     still-open trajectory would read content that may still grow;
 *     append-only means frozen-at-completion is the only stable read);
 *   - `evaluations` — the REAL A012 EvaluationRecords that judged it
 *     (each record's trajectoryRef MUST equal the trajectory's
 *     chainHead — an evaluation of a DIFFERENT trajectory establishes
 *     nothing here);
 *   - `verifications` — the REAL A013 VerificationRecords that verified
 *     its evidence. A VerificationRecord binds its subject through its
 *     evidence bundle (A013 has no dedicated trajectoryRef field): a
 *     verification references the trajectory iff its evidence bundle
 *     names the trajectory's chainHead as an artifact digest. At least
 *     ONE such verification is REQUIRED — a trajectory without
 *     verification evidence is NOT an extraction input and the guard
 *     rejects it with UNVALIDATED_TRAJECTORY (the R17 'validated' gate;
 *     negative tests prove unvalidated trajectories are refused).
 *
 * The bundle is READ-ONLY over its sources (lock rule 6 — learning never
 * rewrites historical evidence): construction deep-freezes the bundled
 * view and never mutates any input record. The ref carries a
 * content-addressed digest over {trajectory chainHead, evaluation
 * digests, verification digests} so runs can address their inputs
 * deterministically.
 */

import { digestCanonical } from '@arena/protocol-core';
import { isTrajectoryRecord, isTrajectoryCompleted } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { isEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { isVerificationRecord } from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';
import { deepFreeze, expectFields, toContentDigest } from './shared.js';
import type { ContentDigest } from './shared.js';

/** Wire version of the validated-trajectory-ref shape. */
export const VALIDATED_TRAJECTORY_REF_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// ValidatedTrajectoryRef
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the ref digest commits to. */
export interface ValidatedTrajectoryRefView {
  readonly recordVersion: typeof VALIDATED_TRAJECTORY_REF_VERSION;
  /** The completed A011 trajectory whose content is mined (read-only). */
  readonly trajectory: TrajectoryRecord;
  /** The A012 evaluation records judging THIS trajectory (≥ 0; policies may require ≥ 1). */
  readonly evaluations: readonly EvaluationRecord[];
  /** The A013 verification records verifying THIS trajectory (≥ 1 — the R17 gate). */
  readonly verifications: readonly VerificationRecord[];
}

/** A frozen validated-trajectory ref: the view plus its content digest. */
export interface ValidatedTrajectoryRef extends ValidatedTrajectoryRefView {
  readonly digest: ContentDigest;
}

/** Stable field list for the view (tests mirror it). */
export const VALIDATED_TRAJECTORY_REF_FIELDS = Object.freeze([
  'recordVersion',
  'trajectory',
  'evaluations',
  'verifications',
] as const) as readonly string[];

export interface ValidatedTrajectoryRefInput {
  readonly trajectory: TrajectoryRecord;
  readonly evaluations: readonly EvaluationRecord[];
  readonly verifications: readonly VerificationRecord[];
}

/**
 * True iff a verification record's evidence bundle names the given
 * trajectory digest as an artifact digest — the A013-side binding of a
 * verification to the trajectory it helped validate (A013 records bind
 * subjects through their evidence bundle; see packages/verification
 * evidence.ts — 'trajectory' is one of the documented open evidence
 * kinds).
 */
export function verificationReferencesTrajectory(
  record: VerificationRecord,
  trajectoryDigest: string,
): boolean {
  return record.evidence.some((entry) => entry.artifact.digest === trajectoryDigest);
}

/** Structural (non-throwing) shape check for the digest-free view. */
export function isValidatedTrajectoryRefView(value: unknown): value is ValidatedTrajectoryRefView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === VALIDATED_TRAJECTORY_REF_VERSION &&
    isTrajectoryRecord(candidate['trajectory']) &&
    Array.isArray(candidate['evaluations']) &&
    (candidate['evaluations'] as unknown[]).every((entry) => isEvaluationRecord(entry)) &&
    Array.isArray(candidate['verifications']) &&
    (candidate['verifications'] as unknown[]).length > 0 &&
    (candidate['verifications'] as unknown[]).every((entry) => isVerificationRecord(entry))
  );
}

/** Structural (non-throwing) check for the full ref (view + digest). */
export function isValidatedTrajectoryRef(value: unknown): value is ValidatedTrajectoryRef {
  if (!isValidatedTrajectoryRefView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return (
    typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/**
 * Create a validated, deep-frozen, content-addressed
 * ValidatedTrajectoryRef — the R17 'validated' gate. Throws typed
 * SkillExtractionError on every failure mode:
 *
 *   - INVALID_REF          — malformed bundle shape;
 *   - INVALID_REF          — trajectory is not a structurally valid A011
 *                            record (REAL @arena/trajectory guard);
 *   - TRAJECTORY_NOT_COMPLETED — the trajectory has no completion entry
 *                            (still appendable — not a stable read);
 *   - EVIDENCE_MISMATCH    — an evaluation record judges a different
 *                            trajectory (trajectoryRef ≠ chainHead);
 *   - EVIDENCE_MISMATCH    — a verification record's evidence bundle does
 *                            not name the trajectory chainHead;
 *   - UNVALIDATED_TRAJECTORY — no verification evidence at all (the
 *                            R17 gate: unvalidated trajectories are
 *                            refused as extraction inputs).
 */
export async function toValidatedTrajectoryRef(
  input: ValidatedTrajectoryRefInput,
): Promise<ValidatedTrajectoryRef> {
  const record = expectFields(
    input,
    ['trajectory', 'evaluations', 'verifications'],
    [],
    SKILL_EXTRACTION_ERROR_CODES.INVALID_REF,
    'validated trajectory ref',
  );

  const trajectory = record['trajectory'];
  if (!isTrajectoryRecord(trajectory)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_REF, {
      message:
        'validated trajectory ref: trajectory must be a structurally valid A011 TrajectoryRecord (REAL @arena/trajectory guard)',
    });
  }
  if (!isTrajectoryCompleted(trajectory)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.TRAJECTORY_NOT_COMPLETED, {
      message: `trajectory ${trajectory.header.trajectoryId} has no completion entry — only trajectories frozen at completion are stable, validated extraction inputs`,
      details: { trajectoryId: trajectory.header.trajectoryId, chainHead: trajectory.chainHead },
    });
  }
  const chainHead = trajectory.chainHead as string;

  const rawEvaluations = record['evaluations'];
  if (!Array.isArray(rawEvaluations)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_REF, {
      message: 'validated trajectory ref: evaluations must be an array of A012 evaluation records',
    });
  }
  const evaluations: EvaluationRecord[] = [];
  for (const entry of rawEvaluations) {
    if (!isEvaluationRecord(entry)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_REF, {
        message:
          'validated trajectory ref: evaluations must contain structurally valid A012 EvaluationRecords (REAL @arena/evaluation guard)',
      });
    }
    if ((entry.trajectoryRef as string) !== chainHead) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.EVIDENCE_MISMATCH, {
        message: `evaluation record ${entry.digest} judges trajectory ${entry.trajectoryRef}, not this trajectory ${chainHead} (an evaluation of a different trajectory establishes nothing here)`,
        details: { evaluationDigest: entry.digest, judged: entry.trajectoryRef, expected: chainHead },
      });
    }
    evaluations.push(entry);
  }

  const rawVerifications = record['verifications'];
  if (!Array.isArray(rawVerifications) || rawVerifications.length === 0) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.UNVALIDATED_TRAJECTORY, {
      message: `trajectory ${trajectory.header.trajectoryId} carries no verification evidence — unvalidated trajectories are NOT extraction inputs (requirement R17 'validated' gate)`,
      details: { trajectoryId: trajectory.header.trajectoryId, chainHead },
    });
  }
  const verifications: VerificationRecord[] = [];
  for (const entry of rawVerifications) {
    if (!isVerificationRecord(entry)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_REF, {
        message:
          'validated trajectory ref: verifications must contain structurally valid A013 VerificationRecords (REAL @arena/verification guard)',
      });
    }
    if (!verificationReferencesTrajectory(entry, chainHead)) {
      throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.EVIDENCE_MISMATCH, {
        message: `verification record ${entry.digest} does not reference trajectory ${chainHead} in its evidence bundle (a verification of other evidence establishes nothing here)`,
        details: { verificationDigest: entry.digest, expected: chainHead },
      });
    }
    verifications.push(entry);
  }

  const view: ValidatedTrajectoryRefView = {
    recordVersion: VALIDATED_TRAJECTORY_REF_VERSION,
    trajectory,
    evaluations: Object.freeze([...evaluations]),
    verifications: Object.freeze([...verifications]),
  };
  const digest = await computeValidatedTrajectoryRefDigest(view);
  return deepFreeze({ ...view, digest }) as ValidatedTrajectoryRef;
}

/** The ref digest: sha256 over the canonical address of the bundle. */
export async function computeValidatedTrajectoryRefDigest(
  view: ValidatedTrajectoryRefView,
): Promise<ContentDigest> {
  return toContentDigest(
    await digestCanonical({
      recordVersion: view.recordVersion,
      trajectory: view.trajectory.chainHead,
      evaluations: view.evaluations.map((entry) => entry.digest),
      verifications: view.verifications.map((entry) => entry.digest),
    }),
    'validated trajectory ref digest',
  );
}

/** The digest-free view of a ref (what the digest commits to). */
export function validatedTrajectoryRefView(
  ref: ValidatedTrajectoryRef,
): ValidatedTrajectoryRefView {
  const { digest: _digest, ...view } = ref;
  return deepFreeze({ ...view }) as ValidatedTrajectoryRefView;
}

/**
 * Stable string key for a validated trajectory ref (map/registry
 * friendly): the trajectory chain head it mines.
 */
export function validatedTrajectoryRefKey(ref: ValidatedTrajectoryRef): string {
  return ref.trajectory.chainHead as string;
}
