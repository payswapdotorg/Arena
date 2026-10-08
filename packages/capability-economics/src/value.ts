/**
 * THE VALUE SIDE — Q1.0 capability-lift-linked value records (Work Order
 * C016; issue #122; spec/quality-model.md "Principle" + "Capability
 * lift").
 *
 * Q1.0 LAW: Arena optimizes for verified capability gain per unit of
 * expert effort, not raw data volume. A value figure is therefore ONLY
 * representable when the five capability-lift conditions hold:
 *
 *   1. target capability improves on a PINNED evaluation population;
 *   2. improvement survives a VERIFICATION AUDIT;
 *   3. evaluator/version changes are ACCOUNTED FOR;
 *   4. regression on PROTECTED CAPABILITIES is measured;
 *   5. uncertainty/variance is REPORTED where material.
 *
 * ATTRIBUTION DISCIPLINE (LE1.0): a changed evaluator score is not
 * automatically a capability improvement — and NEVER an economics gain.
 * A record whose evaluator version digest changed across the compared
 * runs MUST be attributed `evaluator-change` and CANNOT carry lift
 * points at all (typed ATTRIBUTION_VIOLATION); the conditions and the
 * measured change stay recorded for audit, but no value figure is
 * derived from it.
 *
 * `VerifiedLiftPoints` is constructible ONLY inside this module through
 * the gated path — a lift figure with an unmet condition or an
 * evaluator-change attribution is unrepresentable.
 */

import { digestCanonical } from '@arena/protocol-core';
import { CAPABILITY_ECONOMICS_ERROR_CODES, CapabilityEconomicsError } from './errors.js';
import type { EconomicsTenantId, ValueRecordId } from './shared.js';
import {
  isEconomicsTenantId,
  isValueRecordId,
  requireBoundedString,
  toEconomicsTimestamp,
  toValueRecordId,
} from './shared.js';
import type { EconomicsTimestamp } from './shared.js';
import { rejectCollapsedScoreFields, rejectUnknownFields } from './shared.js';

/** Wire version of the value-record shape. */
export const CAPABILITY_LIFT_VALUE_VERSION = 1 as const;

/** The five Q1.0 capability-lift conditions (closed vocabulary). */
export const LIFT_CONDITIONS = Object.freeze([
  'pinned-evaluation-population',
  'verification-audit',
  'evaluator-version-attribution',
  'protected-capability-regression',
  'reported-uncertainty',
] as const);
export type LiftCondition = (typeof LIFT_CONDITIONS)[number];

export function isLiftCondition(value: unknown): value is LiftCondition {
  return typeof value === 'string' && (LIFT_CONDITIONS as readonly string[]).includes(value);
}

/**
 * The LE1.0 attribution vocabulary — what a measured score change is
 * attributed to. Only `expert-effort` (or `measurement-variance`) may
 * accompany lift points; `evaluator-change` NEVER derives economics
 * gain.
 */
export const VALUE_ATTRIBUTION_KINDS = Object.freeze([
  'expert-effort',
  'evaluator-change',
  'measurement-variance',
] as const);
export type ValueAttributionKind = (typeof VALUE_ATTRIBUTION_KINDS)[number];

export function isValueAttributionKind(value: unknown): value is ValueAttributionKind {
  return (
    typeof value === 'string' &&
    (VALUE_ATTRIBUTION_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A verified capability-lift figure — constructible ONLY through
 * `createCapabilityLiftValueRecord`'s gated path. The brand is nominal:
 * the gate is the law, enforced at construction and asserted by tests.
 */
export type VerifiedLiftPoints = number & { readonly __verifiedLift: unique symbol };

const HEX64 = /^[0-9a-f]{64}$/;

/** The measured regression on one protected capability. */
export interface ProtectedCapabilityRegression {
  readonly capabilityId: string;
  /**
   * Signed measured delta on the protected capability (negative =
   * regression). Reported as a plain JSON number — display-only,
   * never money.
   */
  readonly measuredDelta: number;
}

export interface CapabilityLiftValueRecord {
  readonly valueVersion: typeof CAPABILITY_LIFT_VALUE_VERSION;
  readonly valueRecordId: ValueRecordId;
  readonly requestId: string;
  readonly tenantId: EconomicsTenantId;
  /** The target capability whose lift is claimed. */
  readonly capabilityId: string;
  /** Condition 1: the pinned evaluation population reference (null until pinned). */
  readonly pinnedEvaluationPopulationRef: string | null;
  /** Condition 2: the verification audit reference (null until audited). */
  readonly verificationAuditRef: string | null;
  /** Condition 3: evaluator/version attribution — before/after digests. */
  readonly evaluatorVersionBefore: string;
  readonly evaluatorVersionAfter: string;
  /** Condition 4: the measured protected-capability regression. */
  readonly protectedCapabilityRegression: ProtectedCapabilityRegression;
  /** Condition 5: uncertainty reporting posture. */
  readonly uncertainty: {
    readonly reported: boolean;
    readonly variance: string | null;
    readonly material: boolean;
  };
  /** The per-condition status (disclosed, never collapsed). */
  readonly liftConditionsMet: Readonly<Record<LiftCondition, boolean>>;
  /** LE1.0 attribution of the measured change. */
  readonly attribution: ValueAttributionKind;
  /** Verified lift points — present ONLY through the gated path. */
  readonly liftPoints: VerifiedLiftPoints | null;
  /** The unit of expert effort this lift is stated against (minutes). */
  readonly effortMinutes: number | null;
  readonly recordedAt: EconomicsTimestamp;
  /** Content digest over the digest-free view. */
  readonly digest: string;
}

export const CAPABILITY_LIFT_VALUE_FIELDS = Object.freeze([
  'valueVersion',
  'valueRecordId',
  'requestId',
  'tenantId',
  'capabilityId',
  'pinnedEvaluationPopulationRef',
  'verificationAuditRef',
  'evaluatorVersionBefore',
  'evaluatorVersionAfter',
  'protectedCapabilityRegression',
  'uncertainty',
  'liftConditionsMet',
  'attribution',
  'liftPoints',
  'effortMinutes',
  'recordedAt',
  'digest',
] as const);

/** Structural guard for wire values claiming to be lift value records. */
export function isCapabilityLiftValueRecord(
  value: unknown,
): value is CapabilityLiftValueRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['valueVersion'] !== CAPABILITY_LIFT_VALUE_VERSION) return false;
  if (!isValueRecordId(candidate['valueRecordId'])) return false;
  if (typeof candidate['requestId'] !== 'string') return false;
  if (!isEconomicsTenantId(candidate['tenantId'])) return false;
  if (typeof candidate['capabilityId'] !== 'string') return false;
  if (
    candidate['pinnedEvaluationPopulationRef'] !== null &&
    typeof candidate['pinnedEvaluationPopulationRef'] !== 'string'
  ) {
    return false;
  }
  if (
    candidate['verificationAuditRef'] !== null &&
    typeof candidate['verificationAuditRef'] !== 'string'
  ) {
    return false;
  }
  if (
    typeof candidate['evaluatorVersionBefore'] !== 'string' ||
    typeof candidate['evaluatorVersionAfter'] !== 'string'
  ) {
    return false;
  }
  if (candidate['liftPoints'] !== null && typeof candidate['liftPoints'] !== 'number') {
    return false;
  }
  if (candidate['effortMinutes'] !== null && typeof candidate['effortMinutes'] !== 'number') {
    return false;
  }
  if (!isValueAttributionKind(candidate['attribution'])) return false;
  rejectUnknownFields(candidate, CAPABILITY_LIFT_VALUE_FIELDS, 'CapabilityLiftValueRecord');
  rejectCollapsedScoreFields(candidate, 'CapabilityLiftValueRecord');
  return true;
}

export interface CreateCapabilityLiftValueRecordInput {
  readonly valueRecordId?: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly capabilityId: string;
  /** Null until the evaluation population is pinned (condition 1 unmet). */
  readonly pinnedEvaluationPopulationRef: string | null;
  /** Null until the verification audit ran (condition 2 unmet). */
  readonly verificationAuditRef: string | null;
  readonly evaluatorVersionBefore: string;
  readonly evaluatorVersionAfter: string;
  readonly protectedCapabilityRegression: ProtectedCapabilityRegression;
  readonly uncertainty: {
    readonly reported: boolean;
    readonly variance: string | null;
    readonly material: boolean;
  };
  /**
   * The claimed lift figure. REQUIRES every Q1.0 condition met AND a
   * non-evaluator-change attribution — otherwise the record is created
   * WITHOUT points (gated) or rejected (evaluator change may never
   * claim points).
   */
  readonly claimedLiftPoints?: number;
  readonly effortMinutes?: number;
  readonly recordedAt: string | number | Date;
}

function toConditionStatuses(input: {
  readonly pinnedEvaluationPopulationRef: string | null;
  readonly verificationAuditRef: string | null;
  readonly evaluatorVersionBefore: string;
  readonly evaluatorVersionAfter: string;
  readonly protectedCapabilityRegression: ProtectedCapabilityRegression;
  readonly uncertainty: { readonly reported: boolean; readonly variance: string | null; readonly material: boolean };
}): Readonly<Record<LiftCondition, boolean>> {
  return Object.freeze({
    'pinned-evaluation-population':
      input.pinnedEvaluationPopulationRef !== null &&
      input.pinnedEvaluationPopulationRef.length > 0,
    'verification-audit':
      input.verificationAuditRef !== null && input.verificationAuditRef.length > 0,
    'evaluator-version-attribution': true, // the before/after pair IS the attribution
    'protected-capability-regression':
      input.protectedCapabilityRegression.capabilityId.length > 0 &&
      Number.isFinite(input.protectedCapabilityRegression.measuredDelta),
    // Where variance is material it must actually be reported.
    'reported-uncertainty': input.uncertainty.material
      ? input.uncertainty.reported && input.uncertainty.variance !== null
      : input.uncertainty.reported,
  });
}

/**
 * Create one capability-lift value record — THE gated value path.
 *
 *   - all five Q1.0 conditions met + attribution !== 'evaluator-change'
 *     ⇒ the claimed points ride the record as `VerifiedLiftPoints`;
 *   - any condition unmet ⇒ the record is created WITHOUT points (the
 *     unmet conditions are disclosed per-condition) — a value figure
 *     without the gate is unrepresentable;
 *   - attribution 'evaluator-change' + claimed points ⇒ typed
 *     ATTRIBUTION_VIOLATION — a changed evaluator score is never an
 *     economics gain.
 */
export async function createCapabilityLiftValueRecord(
  input: CreateCapabilityLiftValueRecordInput,
): Promise<CapabilityLiftValueRecord> {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
      message: 'capability-lift value record input must be an object',
    });
  }
  const requestId = requireBoundedString(input.requestId, 'requestId');
  const tenantId = input.tenantId;
  if (!isEconomicsTenantId(tenantId)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `invalid tenant id: ${JSON.stringify(tenantId)}`,
    });
  }
  const capabilityId = requireBoundedString(input.capabilityId, 'capabilityId');
  const populationRef =
    input.pinnedEvaluationPopulationRef === null
      ? null
      : requireBoundedString(input.pinnedEvaluationPopulationRef, 'pinnedEvaluationPopulationRef');
  const auditRef =
    input.verificationAuditRef === null
      ? null
      : requireBoundedString(input.verificationAuditRef, 'verificationAuditRef');
  if (!HEX64.test(input.evaluatorVersionBefore) || !HEX64.test(input.evaluatorVersionAfter)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
      message: 'evaluator version digests must be 64-hex content digests (before AND after)',
    });
  }
  if (
    typeof input.protectedCapabilityRegression !== 'object' ||
    input.protectedCapabilityRegression === null ||
    !Number.isFinite(input.protectedCapabilityRegression.measuredDelta)
  ) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
      message: 'protectedCapabilityRegression must carry a capabilityId and a finite measuredDelta',
    });
  }
  if (
    typeof input.uncertainty !== 'object' ||
    input.uncertainty === null ||
    typeof input.uncertainty.reported !== 'boolean' ||
    typeof input.uncertainty.material !== 'boolean' ||
    (input.uncertainty.variance !== null && typeof input.uncertainty.variance !== 'string')
  ) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
      message: 'uncertainty must declare { reported, variance, material }',
    });
  }
  const recordedAt = toEconomicsTimestamp(input.recordedAt);

  const evaluatorChanged = input.evaluatorVersionBefore !== input.evaluatorVersionAfter;
  const attribution: ValueAttributionKind = evaluatorChanged
    ? 'evaluator-change'
    : 'expert-effort';
  const conditions = toConditionStatuses({
    pinnedEvaluationPopulationRef: populationRef,
    verificationAuditRef: auditRef,
    evaluatorVersionBefore: input.evaluatorVersionBefore,
    evaluatorVersionAfter: input.evaluatorVersionAfter,
    protectedCapabilityRegression: input.protectedCapabilityRegression,
    uncertainty: input.uncertainty,
  });
  const allMet = (Object.values(conditions) as readonly boolean[]).every((met) => met);

  let liftPoints: VerifiedLiftPoints | null = null;
  if (input.claimedLiftPoints !== undefined) {
    if (!Number.isFinite(input.claimedLiftPoints) || input.claimedLiftPoints < 0) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
        message: `claimed lift points must be a finite number >= 0: ${JSON.stringify(input.claimedLiftPoints)}`,
      });
    }
    if (attribution === 'evaluator-change') {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.ATTRIBUTION_VIOLATION, {
        message:
          'evaluator version changed across the compared runs — the measured change is attributed to the EVALUATOR, not to expert effort; a changed evaluator score is never a capability improvement and never an economics gain (LE1.0)',
        details: {
          requestId,
          evaluatorVersionBefore: input.evaluatorVersionBefore,
          evaluatorVersionAfter: input.evaluatorVersionAfter,
        },
      });
    }
    if (!allMet) {
      const unmet = (Object.keys(conditions) as LiftCondition[]).filter((key) => !conditions[key]);
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.LIFT_GATED, {
        message: `lift points are gated by the five Q1.0 capability-lift conditions; unmet: ${unmet.join(', ')}`,
        details: { unmet },
      });
    }
    liftPoints = input.claimedLiftPoints as VerifiedLiftPoints;
  }

  const effortMinutes =
    input.effortMinutes === undefined || input.effortMinutes === null
      ? null
      : input.effortMinutes;

  const substantiveView = {
    valueVersion: CAPABILITY_LIFT_VALUE_VERSION,
    requestId,
    tenantId,
    capabilityId,
    pinnedEvaluationPopulationRef: populationRef,
    verificationAuditRef: auditRef,
    evaluatorVersionBefore: input.evaluatorVersionBefore,
    evaluatorVersionAfter: input.evaluatorVersionAfter,
    protectedCapabilityRegression: input.protectedCapabilityRegression,
    uncertainty: input.uncertainty,
    liftConditionsMet: conditions,
    attribution,
    liftPoints,
    effortMinutes,
    recordedAt,
  };
  const valueRecordId =
    input.valueRecordId !== undefined
      ? toValueRecordId(input.valueRecordId)
      : // Deterministic derivation: identical substantive inputs address the
        // same value record identity (no wall-clock, no randomness).
        toValueRecordId(`val_${(await digestCanonical(substantiveView)).slice(0, 32)}`);

  const digestFree = {
    ...substantiveView,
    valueRecordId,
  };
  const digest = await digestCanonical(digestFree);
  const record: CapabilityLiftValueRecord = Object.freeze({
    ...digestFree,
    digest,
  });
  if (!isCapabilityLiftValueRecord(record)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
      message: 'constructed capability-lift value record failed its own structural guard',
    });
  }
  return record;
}

/**
 * Read the verified lift points of a record (null when gated). The ONLY
 * read path — the value side of the Q1.0 ratio.
 */
export function verifiedLiftPointsOf(record: CapabilityLiftValueRecord): VerifiedLiftPoints | null {
  return record.liftPoints;
}
