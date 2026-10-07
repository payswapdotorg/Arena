/**
 * The append-only, provenance-addressable PerformanceEvidenceRecord (Work
 * Order C005; architecture-lock rules 6/18 — append-only, provenance-
 * addressable evidence; rule 35 — performance evidence ≠ authorization ≠
 * correctness verification).
 *
 * One record belongs to EXACTLY ONE Expert-quality dimension (the closed
 * quality-model vocabulary — dimensions.ts) and carries:
 *
 *   - the dimension's closed OUTCOME vocabulary;
 *   - the applicability context the evidence applies in (capability /
 *     task family / domain / jurisdiction — required per dimension);
 *   - the SAMPLE SIZE the observation rests on;
 *   - the PROVENANCE: which dep source family produced it (C004 verdict /
 *     A007 qualification/match history / A019 skill-extraction outcome /
 *     A020 attribution record) + the content digest of that dep record —
 *     the record itself is content-addressed, so its own digest is the
 *     provenance address of this piece of evidence;
 *   - the ATTRIBUTION (LE1.0 vocabulary via A020): expert-change |
 *     evaluator-change | measurement-variance, plus the evaluator version
 *     digest the observation was taken under.
 *
 * ATTRIBUTION LAW (spec/learning.md: "a changed evaluator score is not
 * automatically a capability improvement"): a record whose evaluator
 * version digest CHANGED relative to the prior evaluator version for the
 * expert can NEVER be recorded as an expert performance change —
 * `createEvidenceRecord` with attribution kind 'expert-change' and a
 * changed evaluator version digest fails closed with
 * EXPERT_PERFORMANCE_ATTRIBUTION_VIOLATION. The evaluator-version change
 * is recorded as evaluator-change evidence, never laundered into
 * expert-change.
 *
 * APPEND-ONLY: there is no update or delete path — the only constructor is
 * `createEvidenceRecord`, and every mutation attempt fails closed
 * (`sealEvidenceRecord` freezes the record; any later structural change
 * produces a digest mismatch caught by `verifyEvidenceRecordDigest`).
 */

import { digestCanonical } from '@arena/protocol-core';
import { isCapabilityNodeRefView } from '@arena/expert-qualification';
import type { CapabilityNodeRefView } from '@arena/expert-qualification';
import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  expectNumberInRange,
  expectPositiveInteger,
  screenFieldNames,
  toPerformanceContentDigest,
  toPerformanceLocator,
  toPerformanceNeutralText,
  toPerformanceRecordId,
  toPerformanceTaskFamily,
  toPerformanceTenant,
  toPerformanceTimestamp,
  isPerformanceContentDigest,
} from './shared.js';
import type { PerformanceContentDigest, PerformanceTimestamp } from './shared.js';
import {
  DIMENSION_REQUIRED_CONTEXT,
  isEvidenceSourceFamily,
  toDimensionOutcome,
  toPerformanceDimension,
} from './dimensions.js';
import type {
  DimensionOutcome,
  EvidenceSourceFamily,
  PerformanceDimension,
} from './dimensions.js';

/** Wire version of the evidence record. */
export const PERFORMANCE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Attribution vocabulary (LE1.0 via A020 — the three distinguishable
// sources of a score MOVEMENT on the expert side)
// ---------------------------------------------------------------------------

export const ATTRIBUTION_KINDS = Object.freeze([
  'expert-change',
  'evaluator-change',
  'measurement-variance',
] as const);

export type AttributionKind = (typeof ATTRIBUTION_KINDS)[number];

export function isAttributionKind(value: unknown): value is AttributionKind {
  return typeof value === 'string' && (ATTRIBUTION_KINDS as readonly string[]).includes(value);
}

/**
 * The attribution classifier (PURE). When the evaluator version digest
 * changed between the prior observation and this one, the attribution is
 * FORCED to 'evaluator-change' — an evaluator version change can never be
 * recorded as an expert performance change (spec/learning.md attribution
 * law; quality-model Q1.0 "changing an evaluator requires a new version
 * and cannot be treated as a pure model improvement").
 */
export function classifyAttribution(input: {
  readonly declaredKind: AttributionKind;
  readonly evaluatorVersion: string | null;
  readonly priorEvaluatorVersion: string | null;
}): AttributionKind {
  if (
    input.evaluatorVersion !== null &&
    input.priorEvaluatorVersion !== null &&
    input.evaluatorVersion !== input.priorEvaluatorVersion
  ) {
    return 'evaluator-change';
  }
  return input.declaredKind;
}

// ---------------------------------------------------------------------------
// The evidence record
// ---------------------------------------------------------------------------

/** The provenance ref of the dep record this evidence derives from. */
export interface EvidenceSourceRef {
  /** The dep public surface this evidence accumulated from (closed). */
  readonly family: EvidenceSourceFamily;
  /** The content digest of the dep record (provenance address). */
  readonly refDigest: PerformanceContentDigest;
  /** A locator into the dep surface (opaque here, addressable there). */
  readonly locator: PerformanceTimestamp | string;
}

/** The applicability context the evidence applies in (per-dimension requirements). */
export interface ApplicabilityContext {
  /** The capability/skill the evidence is ABOUT (A007 vocabulary, consumed). */
  readonly capability?: CapabilityNodeRefView;
  /** The task family the evidence is ABOUT. */
  readonly taskFamily?: string;
  /** The domain the evidence is ABOUT. */
  readonly domain?: string;
  /** The jurisdiction the evidence is ABOUT (A007 jurisdiction vocabulary). */
  readonly jurisdiction?: string;
}

export interface PerformanceEvidenceRecordView {
  readonly recordVersion: typeof PERFORMANCE_RECORD_VERSION;
  readonly recordId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly dimension: PerformanceDimension;
  readonly outcome: DimensionOutcome;
  readonly applicability: ApplicabilityContext;
  /** The sample size the observation rests on (>= 1). */
  readonly sampleSize: number;
  /** Measurement confidence in [0, 1] when the source reports one (null otherwise). */
  readonly confidence: number | null;
  readonly observedAt: PerformanceTimestamp;
  readonly recordedAt: PerformanceTimestamp;
  readonly source: EvidenceSourceRef;
  readonly attribution: {
    readonly kind: AttributionKind;
    /** The evaluator version digest the observation was taken under (null when none). */
    readonly evaluatorVersion: string | null;
  };
  /** Optional neutral-text observation note (never a narrative override of the outcome). */
  readonly notes?: string;
}

/** A frozen, content-addressed evidence record (+ digest). */
export interface PerformanceEvidenceRecord extends PerformanceEvidenceRecordView {
  readonly digest: PerformanceContentDigest;
}

export interface CreateEvidenceRecordInput {
  readonly recordId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly dimension: string;
  readonly outcome: string;
  readonly applicability: ApplicabilityContext;
  readonly sampleSize: number;
  readonly confidence?: number | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly source: {
    readonly family: string;
    readonly refDigest: string;
    readonly locator: string;
  };
  readonly attribution: {
    readonly kind: string;
    readonly evaluatorVersion?: string | null;
  };
  readonly notes?: string;
  /**
   * The evaluator version digest in force for (expert, dimension) BEFORE
   * this record. When it differs from this record's evaluatorVersion, the
   * attribution kind MUST be 'evaluator-change' — claiming
   * 'expert-change' fails closed (attribution law).
   */
  readonly priorEvaluatorVersion?: string | null;
}

function requireSource(value: unknown, context: string): EvidenceSourceRef {
  const record = expectFields(
    value,
    ['family', 'refDigest', 'locator'],
    [],
    EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE,
    context,
  );
  const family = record['family'];
  if (!isEvidenceSourceFamily(family)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_SOURCE, {
      message: `${context}: unknown evidence source family: ${JSON.stringify(String(family))}`,
    });
  }
  return deepFreeze({
    family,
    refDigest: toPerformanceContentDigest(record['refDigest'] as string, `${context}.source.refDigest`),
    locator: toPerformanceLocator(record['locator'] as string, `${context}.source.locator`),
  }) as EvidenceSourceRef;
}

function requireApplicability(
  value: unknown,
  dimension: PerformanceDimension,
  context: string,
): ApplicabilityContext {
  const record = expectFields(
    value,
    [],
    ['capability', 'taskFamily', 'domain', 'jurisdiction'],
    EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
    context,
  );
  const applicability: Record<string, unknown> = {};
  if (record['capability'] !== undefined) {
    if (!isCapabilityNodeRefView(record['capability'])) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_REF, {
        message: `${context}.applicability.capability must be an A007 CapabilityNodeRefView (consumed vocabulary)`,
      });
    }
    applicability['capability'] = deepFreeze({ ...record['capability'] });
  }
  if (record['taskFamily'] !== undefined) {
    applicability['taskFamily'] = toPerformanceTaskFamily(
      record['taskFamily'] as string,
      `${context}.applicability.taskFamily`,
    );
  }
  if (record['domain'] !== undefined) {
    applicability['domain'] = expectNonEmptyString(
      record['domain'],
      'domain',
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
      `${context}.applicability`,
    );
  }
  if (record['jurisdiction'] !== undefined) {
    applicability['jurisdiction'] = expectNonEmptyString(
      record['jurisdiction'],
      'jurisdiction',
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
      `${context}.applicability`,
    );
  }
  for (const required of DIMENSION_REQUIRED_CONTEXT[dimension]) {
    if (applicability[required] === undefined) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD, {
        message: `${context}: dimension '${dimension}' requires applicability context '${required}' (evidence without its applicability context is not admissible)`,
        details: { dimension, required },
      });
    }
  }
  return deepFreeze(applicability) as ApplicabilityContext;
}

/**
 * Create ONE append-only, content-addressed evidence record. Fails closed
 * on unknown dimensions/outcomes/source families, missing applicability
 * context, backdated recording (recordedAt < observedAt), authority/PII-
 * shaped field names — and on the ATTRIBUTION LAW: an expert-change claim
 * under a CHANGED evaluator version digest is rejected.
 */
export async function createEvidenceRecord(
  input: CreateEvidenceRecordInput,
): Promise<PerformanceEvidenceRecord> {
  const record = expectFields(
    input,
    [
      'recordId',
      'tenant',
      'expertId',
      'dimension',
      'outcome',
      'applicability',
      'sampleSize',
      'observedAt',
      'recordedAt',
      'source',
      'attribution',
    ],
    ['confidence', 'notes', 'priorEvaluatorVersion'],
    EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
    'evidence record',
  );

  const dimension = toPerformanceDimension(record['dimension'], 'evidence record');
  const outcome = toDimensionOutcome(dimension, record['outcome'], 'evidence record');
  const observedAt = toPerformanceTimestamp(record['observedAt'] as string, 'evidence record observedAt');
  const recordedAt = toPerformanceTimestamp(record['recordedAt'] as string, 'evidence record recordedAt');
  if (Date.parse(recordedAt) < Date.parse(observedAt)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.BACKDATED_RECORD, {
      message: `evidence record: recordedAt (${recordedAt}) precedes observedAt (${observedAt}) — backdated recording fails closed`,
      details: { observedAt, recordedAt },
    });
  }

  const attributionRaw = expectFields(
    record['attribution'],
    ['kind'],
    ['evaluatorVersion'],
    EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
    'evidence record attribution',
  );
  const kind = attributionRaw['kind'];
  if (!isAttributionKind(kind)) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.ATTRIBUTION_VIOLATION, {
      message: `evidence record: unknown attribution kind: ${JSON.stringify(String(kind))} (closed LE1.0 vocabulary: expert-change | evaluator-change | measurement-variance)`,
      details: { known: ATTRIBUTION_KINDS },
    });
  }
  const evaluatorVersionRaw = attributionRaw['evaluatorVersion'] ?? null;
  const evaluatorVersion =
    evaluatorVersionRaw === null
      ? null
      : toPerformanceContentDigest(evaluatorVersionRaw as string, 'attribution.evaluatorVersion');
  const priorEvaluatorVersionRaw = record['priorEvaluatorVersion'] ?? null;
  const priorEvaluatorVersion =
    priorEvaluatorVersionRaw === null
      ? null
      : toPerformanceContentDigest(
          priorEvaluatorVersionRaw as string,
          'priorEvaluatorVersion',
        );

  // THE ATTRIBUTION LAW — an evaluator version change can NEVER be
  // recorded as an expert performance change (spec/learning.md).
  if (
    kind === 'expert-change' &&
    priorEvaluatorVersion !== null &&
    evaluatorVersion !== null &&
    priorEvaluatorVersion !== evaluatorVersion
  ) {
    throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.ATTRIBUTION_VIOLATION, {
      message: `evidence record: attribution law violated — the evaluator version digest changed (${priorEvaluatorVersion.slice(0, 12)}… → ${evaluatorVersion.slice(0, 12)}…), so this observation CANNOT be recorded as expert-change; record it as evaluator-change evidence (a changed evaluator score is not automatically a capability improvement)`,
      details: { priorEvaluatorVersion, evaluatorVersion },
    });
  }

  const confidenceRaw = record['confidence'] ?? null;
  const confidence =
    confidenceRaw === null
      ? null
      : expectNumberInRange(
          confidenceRaw,
          'confidence',
          0,
          1,
          EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
          'evidence record',
        );

  const view: PerformanceEvidenceRecordView = {
    recordVersion: PERFORMANCE_RECORD_VERSION,
    recordId: toPerformanceRecordId(record['recordId'] as string, 'evidence record recordId'),
    tenant: toPerformanceTenant(record['tenant'] as string, 'evidence record tenant'),
    expertId: expectNonEmptyString(
      record['expertId'],
      'expertId',
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_IDENTITY,
      'evidence record',
    ),
    dimension,
    outcome,
    applicability: requireApplicability(record['applicability'], dimension, 'evidence record'),
    sampleSize: expectPositiveInteger(
      record['sampleSize'],
      'sampleSize',
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
      'evidence record',
    ),
    confidence,
    observedAt,
    recordedAt,
    source: requireSource(record['source'], 'evidence record source'),
    attribution: deepFreeze({ kind, evaluatorVersion }),
    ...(record['notes'] === undefined
      ? {}
      : {
          notes: toPerformanceNeutralText(record['notes'] as string, 'evidence record notes'),
        }),
  };
  screenFieldNames(view, 'evidenceRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as PerformanceEvidenceRecord;
}

/** The digest-free view (what the digest commits to). */
export function evidenceRecordView(
  record: PerformanceEvidenceRecord,
): PerformanceEvidenceRecordView {
  const { digest: _digest, ...rest } = record;
  return deepFreeze({ ...rest }) as PerformanceEvidenceRecordView;
}

/** Recompute the content digest of a stored record (tamper check). */
export async function recomputeEvidenceRecordDigest(
  record: PerformanceEvidenceRecord,
): Promise<string> {
  const { digest: _digest, ...view } = record;
  return digestCanonical({ ...(view as PerformanceEvidenceRecordView) });
}

/** Verify the content digest of a stored record (append-only integrity). */
export async function verifyEvidenceRecordDigest(
  record: PerformanceEvidenceRecord,
): Promise<boolean> {
  return (await recomputeEvidenceRecordDigest(record)) === record.digest;
}

/** Structural equality of the digest-free views (append-only idempotence). */
export function sameEvidence(
  left: PerformanceEvidenceRecord,
  right: PerformanceEvidenceRecord,
): boolean {
  return left.digest === right.digest;
}

/**
 * The append-only invariant guard: there is NO record mutation API — this
 * function exists so consumers fail closed when they attempt one. A
 * "revised" record is a NEW record with a NEW recordId; the prior record
 * remains in the log forever (lock rule 6).
 */
export function mutateEvidenceRecord(): never {
  throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.APPEND_ONLY_VIOLATION, {
    message:
      'evidence records are append-only — there is no update or delete path; a correction is a new record (lock rule 6)',
  });
}

/** Type guard for content digests from untrusted input (store reload). */
export function asContentDigest(value: unknown): value is PerformanceContentDigest {
  return isPerformanceContentDigest(value);
}
