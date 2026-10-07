/**
 * The CalibrationRecord — predicted confidence/score vs LATER-OBSERVED
 * outcome (Work Order C004; spec/learning.md LE1.0 "Calibration").
 *
 * A CalibrationRecord binds:
 *
 *   - the content-addressed CalibrationProgram + probe the prediction
 *     was elicited under (`programDigest` + `probeId`);
 *   - the PREDICTION (`predicted`: confidence in [0, 1] plus the
 *     predicted score, null when the prediction carried none);
 *   - the LATER-OBSERVED outcome (`observed`: closed vocabulary
 *     correct | incorrect | inconclusive plus the observed score, null
 *     when the observation carried none);
 *   - the APPLICABILITY CONTEXT (`applicability`: the capability, the
 *     optional domain scope and the pinned environment versions — the
 *     context in which the calibration evidence holds, PRESERVED per
 *     LE1.0, never implied);
 *   - `predictedAt` + `observedAt` + provenance.
 *
 * INTEGRITY (append-only, lock rule 6):
 *   - BACKDATED INJECTION FAILS CLOSED — an outcome observed strictly
 *     BEFORE its own prediction is causally impossible and rejected with
 *     BACKDATED_OUTCOME (the adversarial minimum);
 *   - `supersedes` references the prior record this one APPENDS over —
 *     expiry/correction NEVER rewrites history (the prior record keeps
 *     its own digest forever);
 *   - the record is content-addressed: same view ⇒ same digest;
 *     `recomputeCalibrationRecordDigest` detects TAMPERED store entries.
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  isCapabilityNodeRefView,
  toCapabilityNodeRefView,
} from '@arena/expert-qualification';
import type { CapabilityNodeRefView } from '@arena/expert-qualification';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectFiniteNumber,
  expectNonEmptyString,
  expectNumberInRange,
  screenFieldNames,
  toCalibrationContentDigest,
  toCalibrationId,
  toCalibrationNeutralText,
  toCalibrationTimestamp,
} from './shared.js';
import type { CalibrationId, CalibrationTimestamp, CalibrationNeutralText } from './shared.js';

/** Wire version of the calibration-record shape. */
export const CALIBRATION_RECORD_VERSION = 1 as const;

/** The closed observed-outcome vocabulary. */
export const OBSERVED_OUTCOMES = Object.freeze([
  'correct',
  'incorrect',
  'inconclusive',
] as const);

export type ObservedOutcome = (typeof OBSERVED_OUTCOMES)[number];

export function isObservedOutcome(value: unknown): value is ObservedOutcome {
  return (
    typeof value === 'string' && (OBSERVED_OUTCOMES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the calibration record commits to. */
export interface CalibrationRecordView {
  readonly recordVersion: typeof CALIBRATION_RECORD_VERSION;
  readonly calibrationId: CalibrationId;
  readonly tenant: string;
  readonly expertId: string;
  /** The content-addressed CalibrationProgram the prediction belongs to. */
  readonly programDigest: string;
  /** The program probe that elicited the prediction. */
  readonly probeId: string;
  readonly predicted: {
    /** The expert's predicted confidence of a correct outcome, in [0, 1]. */
    readonly confidence: number;
    /** The predicted score, when the probe's output schema carries one. */
    readonly score: number | null;
  };
  readonly observed: {
    readonly outcome: ObservedOutcome;
    /** The observed score, when the outcome measurement carried one. */
    readonly score: number | null;
  };
  readonly applicability: {
    /** The capability the calibration evidence holds FOR (preserved, not implied). */
    readonly capability: CapabilityNodeRefView;
    /** The domain scope, when the prediction was domain-scoped. */
    readonly domain?: CapabilityNodeRefView;
    /** The pinned environment versions the prediction applies in. */
    readonly environment: readonly {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly digest: string;
    }[];
  };
  readonly predictedAt: CalibrationTimestamp;
  readonly observedAt: CalibrationTimestamp;
  readonly provenance: {
    readonly recordedBy: string;
    readonly recordedAt: CalibrationTimestamp;
    readonly notes: CalibrationNeutralText | null;
  };
  /** The prior record this one APPENDS over (append-only history, lock rule 6). */
  readonly supersedes?: string;
}

/** A frozen, content-addressed calibration record: the view plus its sha256 digest. */
export interface CalibrationRecord extends CalibrationRecordView {
  readonly digest: string;
}

export interface CreateCalibrationRecordInput {
  readonly calibrationId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly programDigest: string;
  readonly probeId: string;
  readonly predicted: { readonly confidence: number; readonly score: number | null };
  readonly observed: { readonly outcome: string; readonly score: number | null };
  readonly applicability: {
    readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
    readonly domain?: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
    readonly environment: readonly {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly digest: string;
    }[];
  };
  readonly predictedAt: string;
  readonly observedAt: string;
  readonly provenance: {
    readonly recordedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
  readonly supersedes?: string;
}

function toNullableFiniteNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return expectFiniteNumber(
    value,
    field,
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
    'calibration record',
  );
}

function toEnvironmentRef(
  entry: unknown,
): { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string } {
  const record = expectFields(
    entry,
    ['namespace', 'name', 'version', 'digest'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
    'calibration record applicability environment entry',
  );
  return deepFreeze({
    namespace: expectNonEmptyString(record['namespace'], 'namespace', EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, 'calibration record environment'),
    name: expectNonEmptyString(record['name'], 'name', EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, 'calibration record environment'),
    version: expectNonEmptyString(record['version'], 'version', EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, 'calibration record environment'),
    digest: toCalibrationContentDigest(
      typeof record['digest'] === 'string' ? record['digest'] : '',
      'calibration record environment digest',
    ),
  });
}

/**
 * Create a validated, deep-frozen, content-addressed calibration record.
 * Rejects malformed refs, out-of-range confidence, unknown observed
 * outcomes, malformed applicability context, BACKDATED outcomes
 * (observed strictly before predicted — causally impossible) and
 * authority-shaped fields (masquerade screen) with typed errors.
 */
export async function createCalibrationRecord(
  input: CreateCalibrationRecordInput,
): Promise<CalibrationRecord> {
  const record = expectFields(
    input,
    [
      'calibrationId',
      'tenant',
      'expertId',
      'programDigest',
      'probeId',
      'predicted',
      'observed',
      'applicability',
      'predictedAt',
      'observedAt',
      'provenance',
    ],
    ['supersedes'],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
    'calibration record',
  );

  const predicted = expectFields(
    record['predicted'],
    ['confidence', 'score'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
    'calibration record predicted',
  );
  const observed = expectFields(
    record['observed'],
    ['outcome', 'score'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
    'calibration record observed',
  );
  const applicability = expectFields(
    record['applicability'],
    ['capability', 'environment'],
    ['domain'],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
    'calibration record applicability',
  );
  const provenance = expectFields(
    record['provenance'],
    ['recordedBy', 'recordedAt', 'notes'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
    'calibration record provenance',
  );

  const outcome = observed['outcome'];
  if (!isObservedOutcome(outcome)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, {
      message: `calibration record: observed.outcome must be one of [${OBSERVED_OUTCOMES.join(', ')}], got: ${String(outcome)}`,
      details: { known: [...OBSERVED_OUTCOMES] },
    });
  }

  const capability = toCapabilityNodeRefView(
    applicability['capability'] as { kind: string; id: string; version: string; digest: string },
  );
  const domainRaw = applicability['domain'];
  const domain =
    domainRaw === undefined
      ? undefined
      : toCapabilityNodeRefView(domainRaw as { kind: string; id: string; version: string; digest: string }, ['domain']);
  const rawEnvironment = applicability['environment'];
  if (!Array.isArray(rawEnvironment) || rawEnvironment.length === 0) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, {
      message:
        'calibration record applicability: environment must be a non-empty pinned set of content-addressed environment refs (applicability context is preserved, not implied)',
    });
  }
  const environment = rawEnvironment.map((entry) => toEnvironmentRef(entry));

  const predictedAt = toCalibrationTimestamp(
    typeof record['predictedAt'] === 'string' ? record['predictedAt'] : '',
    'calibration record predictedAt',
  );
  const observedAt = toCalibrationTimestamp(
    typeof record['observedAt'] === 'string' ? record['observedAt'] : '',
    'calibration record observedAt',
  );

  // --- backdated injection fails closed (LE1.0: LATER-observed) ----------
  if (Date.parse(observedAt) < Date.parse(predictedAt)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.BACKDATED_OUTCOME, {
      message: `calibration record: observedAt ${JSON.stringify(observedAt)} is strictly before predictedAt ${JSON.stringify(predictedAt)} — an outcome observed before its own prediction is causally impossible (backdated outcome injection fails closed)`,
      details: { predictedAt, observedAt },
    });
  }

  const supersedesRaw = record['supersedes'];
  const supersedes =
    supersedesRaw === undefined
      ? undefined
      : toCalibrationContentDigest(supersedesRaw as string, 'calibration record supersedes');

  const notes = provenance['notes'];
  if (notes !== null && typeof notes !== 'string') {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, {
      message: 'calibration record provenance: notes must be neutral text or null',
    });
  }

  const view: CalibrationRecordView = {
    recordVersion: CALIBRATION_RECORD_VERSION,
    calibrationId: toCalibrationId(
      typeof record['calibrationId'] === 'string' ? record['calibrationId'] : '',
      'calibration record calibrationId',
    ),
    tenant: expectNonEmptyString(record['tenant'], 'tenant', EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, 'calibration record'),
    expertId: expectNonEmptyString(record['expertId'], 'expertId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, 'calibration record'),
    programDigest: toCalibrationContentDigest(
      typeof record['programDigest'] === 'string' ? record['programDigest'] : '',
      'calibration record programDigest',
    ),
    probeId: expectNonEmptyString(record['probeId'], 'probeId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, 'calibration record'),
    predicted: deepFreeze({
      confidence: expectNumberInRange(
        predicted['confidence'],
        'predicted.confidence',
        0,
        1,
        EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD,
        'calibration record',
      ),
      score: toNullableFiniteNumber(predicted['score'], 'predicted.score'),
    }),
    observed: deepFreeze({
      outcome,
      score: toNullableFiniteNumber(observed['score'], 'observed.score'),
    }),
    applicability: deepFreeze({
      capability,
      ...(domain !== undefined ? { domain } : {}),
      environment: Object.freeze([...environment]),
    }),
    predictedAt,
    observedAt,
    provenance: deepFreeze({
      recordedBy: expectNonEmptyString(provenance['recordedBy'], 'recordedBy', EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, 'calibration record provenance'),
      recordedAt: toCalibrationTimestamp(
        typeof provenance['recordedAt'] === 'string' ? provenance['recordedAt'] : '',
        'calibration record provenance recordedAt',
      ),
      notes: notes === null ? null : toCalibrationNeutralText(notes, 'calibration record notes'),
    }),
    ...(supersedes !== undefined ? { supersedes } : {}),
  };
  screenFieldNames(view, 'calibrationRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as CalibrationRecord;
}

/** The digest-free view of a record (what the digest commits to). */
export function calibrationRecordView(record: CalibrationRecord): CalibrationRecordView {
  const { digest: _digest, ...view } = record;
  return deepFreeze({ ...view }) as CalibrationRecordView;
}

/**
 * Recompute the record digest over the digest-free view and compare.
 * Throws EXPERT_CALIBRATION_TAMPERED on any mismatch — tampered store
 * entries fail closed.
 */
export async function recomputeCalibrationRecordDigest(
  record: CalibrationRecord,
): Promise<string> {
  if (!isCalibrationRecord(record)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, {
      message: 'record digest recomputation requires a structurally valid calibration record',
    });
  }
  const actual = await digestCanonical(calibrationRecordView(record));
  if (actual !== record.digest) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.TAMPERED, {
      message: `calibration record digest mismatch for ${record.calibrationId}`,
      details: { calibrationId: record.calibrationId, expected: record.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Structural (non-throwing) guards
// ---------------------------------------------------------------------------

function isEnvironmentRef(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['version'] === 'string' &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** Structural (non-throwing) check for the digest-free view. */
export function isCalibrationRecordView(value: unknown): value is CalibrationRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const predicted = candidate['predicted'];
  const observed = candidate['observed'];
  const applicability = candidate['applicability'];
  const provenance = candidate['provenance'];
  if (typeof predicted !== 'object' || predicted === null || Array.isArray(predicted)) return false;
  if (typeof observed !== 'object' || observed === null || Array.isArray(observed)) return false;
  if (typeof applicability !== 'object' || applicability === null || Array.isArray(applicability)) return false;
  if (typeof provenance !== 'object' || provenance === null || Array.isArray(provenance)) return false;
  const applicabilityRecord = applicability as Record<string, unknown>;
  const provenanceRecord = provenance as Record<string, unknown>;
  return (
    candidate['recordVersion'] === CALIBRATION_RECORD_VERSION &&
    typeof candidate['calibrationId'] === 'string' &&
    /^cal-[a-z0-9][a-z0-9-]{0,62}$/.test(candidate['calibrationId']) &&
    typeof candidate['tenant'] === 'string' &&
    candidate['tenant'].length > 0 &&
    typeof candidate['expertId'] === 'string' &&
    candidate['expertId'].length > 0 &&
    typeof candidate['programDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['programDigest']) &&
    typeof candidate['probeId'] === 'string' &&
    candidate['probeId'].length > 0 &&
    typeof (predicted as Record<string, unknown>)['confidence'] === 'number' &&
    typeof (observed as Record<string, unknown>)['outcome'] === 'string' &&
    isObservedOutcome((observed as Record<string, unknown>)['outcome']) &&
    isCapabilityNodeRefView(applicabilityRecord['capability']) &&
    (applicabilityRecord['domain'] === undefined ||
      isCapabilityNodeRefView(applicabilityRecord['domain'])) &&
    Array.isArray(applicabilityRecord['environment']) &&
    (applicabilityRecord['environment'] as unknown[]).length > 0 &&
    (applicabilityRecord['environment'] as unknown[]).every((entry) => isEnvironmentRef(entry)) &&
    typeof candidate['predictedAt'] === 'string' &&
    typeof candidate['observedAt'] === 'string' &&
    typeof provenanceRecord['recordedBy'] === 'string' &&
    provenanceRecord['recordedBy'].length > 0
  );
}

/** Structural (non-throwing) check for the full record (view + digest). */
export function isCalibrationRecord(value: unknown): value is CalibrationRecord {
  if (!isCalibrationRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}
