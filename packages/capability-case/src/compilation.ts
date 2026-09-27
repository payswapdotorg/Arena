/**
 * TaskCompilationTarget — the typed data contract between Capability Cases
 * and the future TaskSpec compiler (Work Order A005 gate 7; requirement R6
 * "Compile Capability Cases into reproducible TaskSpecs").
 *
 * IMPORTANT: this module is a PURE DATA CONTRACT. It contains types, a
 * derivation/validation function (`deriveCompilationTarget`) and NOTHING
 * ELSE — no compilation logic, no task generation, no scheduling. The
 * TaskSpec compiler itself is Work Order A008; it consumes these targets.
 *
 * A target flattens a case's requirement surface into compiler-consumable
 * refs:
 *   - the exact case state the target was derived from (content-addressed —
 *     the compiler can always trace a task back to the case version AND
 *     lifecycle state that motivated it);
 *   - domain + target capability refs (graph addressing);
 *   - task requirements (objectives, constraints, allowed tools, forbidden
 *     shortcuts, success conditions, evidence criteria, difficulty);
 *   - environment requirements (content-addressed environment declarations
 *     + constraints);
 *   - evaluation requirements and verification requirements (kept DISTINCT
 *     — lock rule 7);
 *   - the evidence digests backing the case (audit trail);
 *   - the OPTIONAL current body/substrate context (§5: "when known").
 *
 * Eligibility: a case must be TRIAGED or ACTIVE — task design happens after
 * triage (spec CC1.0 lifecycle: OPEN → TRIAGED → TASK_DESIGNED) and stops
 * at resolution. DRAFT/SUBMITTED cases are not yet actionable; RESOLVED/
 * SUPERSEDED cases are terminal (a follow-up case is the way to reopen
 * work — spec CC1.0: "Branches may create follow-up cases").
 *
 * The target itself is content-addressed (sha256 over its digest-free view,
 * via @arena/protocol-core's digestCanonical) and deep-frozen.
 */

import { digestCanonical } from '@arena/protocol-core';
import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';
import type { CapabilityCase } from './case.js';
import { caseVersionRef as toRef } from './case.js';
import { isCaseStatus, isTerminalCaseStatus } from './lifecycle.js';
import type { CaseStatus } from './lifecycle.js';
import { deepFreeze, isContentDigest } from './shared.js';
import type {
  BodyVersionRefView,
  CapabilityNodeRefView,
  EvidenceRef,
  SubstrateRefView,
} from './shared.js';
import type { CaseVersionRef } from './identity.js';
import type {
  EnvironmentRequirements,
  EvaluationRequirements,
  TaskRequirements,
  VerificationRequirements,
} from './requirements.js';
import { toCapabilityCaseTimestamp } from './timestamp.js';
import type { CapabilityCaseTimestamp } from './timestamp.js';

/** Wire version of the compilation-target shape. */
export const TASK_COMPILATION_TARGET_VERSION = 1 as const;

/** The case statuses a compilation target may be derived from. */
export const COMPILABLE_CASE_STATUSES = ['triaged', 'active'] as const;

export type CompilableCaseStatus = (typeof COMPILABLE_CASE_STATUSES)[number];

/**
 * The typed compilation target derived from one exact case state: the
 * requirements flattened into compiler-consumable refs (gate 7). Pure data.
 */
export interface TaskCompilationTarget {
  readonly targetVersion: typeof TASK_COMPILATION_TARGET_VERSION;
  /** The exact case state this target was derived from (content-addressed). */
  readonly caseRef: CaseVersionRef;
  /** Domain ref (graph addressing). */
  readonly domain: CapabilityNodeRefView;
  /** Target capability ref (graph addressing). */
  readonly targetCapability: CapabilityNodeRefView;
  /** Task requirements (flattened from the case). */
  readonly taskRequirements: TaskRequirements;
  /** Environment requirements (flattened from the case). */
  readonly environmentRequirements: EnvironmentRequirements;
  /** Evaluation requirements (flattened; distinct from verification — rule 7). */
  readonly evaluationRequirements: EvaluationRequirements;
  /** Verification requirements (flattened; distinct from evaluation — rule 7). */
  readonly verificationRequirements: VerificationRequirements;
  /** The evidence digests backing the case (audit trail — lock rule 6). */
  readonly evidence: readonly EvidenceRef[];
  /** OPTIONAL current body context (a case may predate a body). */
  readonly currentBody?: BodyVersionRefView;
  /** OPTIONAL current substrate context (never the case's identity — rule 2). */
  readonly currentSubstrate?: SubstrateRefView;
  /** When the target was derived (UTC, ms precision). */
  readonly derivedAt: CapabilityCaseTimestamp;
  /** sha256 over the canonical serialization of the digest-free view. */
  readonly digest: string;
}

/** Digest-free view of a target — exactly what the digest covers. */
export type TaskCompilationTargetView = Omit<TaskCompilationTarget, 'digest'>;

export function isCompilableCaseStatus(value: unknown): value is CompilableCaseStatus {
  return (
    typeof value === 'string' &&
    (COMPILABLE_CASE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Derive a compilation target from one exact case state (the VALIDATOR of
 * gate 7): checks compilation eligibility (status TRIAGED or ACTIVE;
 * structurally valid case), flattens the requirement surface, computes the
 * target's content digest and deep-freezes the result.
 *
 * Throws CAPABILITY_CASE_INVALID_COMPILATION_TARGET when the case is not
 * compilable (draft/submitted: not yet triaged; resolved/superseded:
 * terminal — open a follow-up case instead).
 */
export async function deriveCompilationTarget(
  caseRecord: CapabilityCase,
  input: { derivedAt: string },
): Promise<TaskCompilationTarget> {
  if (!isCaseStatus(caseRecord.status)) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_COMPILATION_TARGET,
      {
        message: `not a valid case status: ${JSON.stringify(caseRecord.status)}`,
        details: { status: caseRecord.status },
      },
    );
  }
  if (!isCompilableCaseStatus(caseRecord.status)) {
    const reason = isTerminalCaseStatus(caseRecord.status as CaseStatus)
      ? 'terminal — open a follow-up case instead (spec CC1.0: branches may create follow-up cases)'
      : 'not yet triaged';
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_COMPILATION_TARGET,
      {
        message: `case ${JSON.stringify(caseRecord.identity.caseId)} is ${caseRecord.status}: compilation targets are derived from TRIAGED or ACTIVE cases (${reason})`,
        details: {
          status: caseRecord.status,
          compilable: [...COMPILABLE_CASE_STATUSES],
        },
      },
    );
  }
  const derivedAt = toCapabilityCaseTimestamp(input.derivedAt);
  const view: TaskCompilationTargetView = {
    targetVersion: TASK_COMPILATION_TARGET_VERSION,
    caseRef: toRef(caseRecord),
    domain: caseRecord.domain,
    targetCapability: caseRecord.targetCapability,
    taskRequirements: caseRecord.taskRequirements,
    environmentRequirements: caseRecord.environmentRequirements,
    evaluationRequirements: caseRecord.evaluationRequirements,
    verificationRequirements: caseRecord.verificationRequirements,
    evidence: caseRecord.evidence,
    ...(caseRecord.currentBody !== undefined
      ? { currentBody: caseRecord.currentBody }
      : {}),
    ...(caseRecord.currentSubstrate !== undefined
      ? { currentSubstrate: caseRecord.currentSubstrate }
      : {}),
    derivedAt,
  };
  const digest = await digestCanonical(view);
  const target: TaskCompilationTarget = deepFreeze({ ...view, digest });
  return target;
}

export function isTaskCompilationTarget(
  value: unknown,
): value is TaskCompilationTarget {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['targetVersion'] !== TASK_COMPILATION_TARGET_VERSION) return false;
  const caseRef = candidate['caseRef'];
  return (
    typeof caseRef === 'object' &&
    caseRef !== null &&
    typeof (caseRef as Record<string, unknown>)['caseId'] === 'string' &&
    typeof (caseRef as Record<string, unknown>)['version'] === 'string' &&
    isContentDigest((caseRef as Record<string, unknown>)['digest']) &&
    typeof candidate['derivedAt'] === 'string' &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Verify a target's claimed digest against its content (fail-closed
 * tamper detection, the package convention).
 */
export async function verifyTaskCompilationTarget(
  target: TaskCompilationTarget,
): Promise<string> {
  if (!isTaskCompilationTarget(target)) {
    throw new CapabilityCaseError(
      CAPABILITY_CASE_ERROR_CODES.INVALID_COMPILATION_TARGET,
      {
        message: 'not a structurally valid task compilation target',
      },
    );
  }
  const { digest: _digest, ...view } = target;
  const actual = await digestCanonical(view);
  if (actual !== target.digest) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.TAMPERED, {
      message: `task compilation target digest mismatch: expected ${target.digest}, recomputed ${actual}`,
      details: { expected: target.digest, actual },
    });
  }
  return actual;
}
