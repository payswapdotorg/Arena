/**
 * The append-only, provenance-addressed DIMENSIONAL REPUTATION RECORD
 * (Work Order C020; architecture-lock rules 6/18 — append-only,
 * provenance-addressable evidence; rule 35 — reputation evidence is
 * never authorization and never correctness verification).
 *
 * One record belongs to EXACTLY ONE reputation family (the closed C020
 * vocabulary — vocabulary.ts) and carries:
 *
 *   - the family's closed OUTCOME vocabulary;
 *   - the applicability context the evidence applies in (domain /
 *     task family / jurisdiction -- required per family);
 *   - the SAMPLE SIZE the observation rests on;
 *   - the PROVENANCE: which dep source surface produced it (C009
 *     adjudication / C013 competition / C010 payment / C020-owned) + the
 *     content digest of that dep record -- the record itself is
 *     content-addressed, so its own digest is the provenance address of
 *     this piece of evidence.
 *
 * THE NO-SINGLE-GLOBAL-SCORE LAW IS STRUCTURAL (spec/quality-model.md):
 *   - no reputation record, log or read surface carries a score field;
 *   - the ONLY aggregate is the typed, versioned, single-family
 *     FamilyOutcomeAggregate disclosing its formula, sample sizes and
 *     limitation notes;
 *   - `buildNetworkQualityScore` / `consumeReputationAsGlobalScore` /
 *     `applyReputationWeights` have NO happy paths -- they always throw
 *     NETWORK_QUALITY_GLOBAL_SCORE_REJECTED;
 *   - a silent score-adjustment attempt fails closed
 *     (NETWORK_QUALITY_SILENT_ADJUSTMENT_REJECTED) -- findings PROPOSE
 *     actions into the owning surfaces; nothing here adjusts anything.
 *
 * APPEND-ONLY: there is no update or delete path -- the only constructor
 * is `createReputationRecord`, records are frozen + digest-committed,
 * and any later structural change produces a digest mismatch caught by
 * `verifyReputationRecordDigest` (tamper check).
 */

import { digestCanonical } from '@arena/protocol-core';
import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  expectNumberInRange,
  expectPositiveInteger,
  screenFieldNames,
  toNetworkQualityContentDigest,
  toNetworkQualityLocator,
  toNetworkQualityNeutralText,
  toNetworkQualityRecordId,
  toNetworkQualityTenant,
  toNetworkQualityTimestamp,
  isNetworkQualityContentDigest,
} from './shared.js';
import {
  REPUTATION_FAMILY_REQUIRED_CONTEXT,
  toReputationFamily,
  toReputationFamilyOutcome,
  toSourceSurfaceFamily,
} from './vocabulary.js';
import type { ReputationFamily, ReputationSourceSurface } from './vocabulary.js';

/** Wire version of the reputation record. */
export const REPUTATION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The dimensional reputation record
// ---------------------------------------------------------------------------

/** The provenance ref of the dep record this evidence derives from. */
export interface ReputationSourceRef {
  /** The dep public surface this evidence accumulated from (closed). */
  readonly surface: ReputationSourceSurface;
  /** The content digest of the dep record (provenance address). */
  readonly refDigest: string;
  /** A locator into the dep surface (opaque here, addressable there). */
  readonly locator: string;
}

/** The applicability context the evidence applies in (per-family requirements). */
export interface ReputationApplicabilityContext {
  /** The domain the evidence is ABOUT (e.g. 'software', 'structural'). */
  readonly domain?: string;
  /** The task family the evidence is ABOUT. */
  readonly taskFamily?: string;
  /** The jurisdiction the evidence is ABOUT (when material). */
  readonly jurisdiction?: string;
}

export interface ReputationRecordView {
  readonly recordVersion: typeof REPUTATION_RECORD_VERSION;
  readonly recordId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly family: ReputationFamily;
  readonly outcome: string;
  readonly applicability: ReputationApplicabilityContext;
  /** The sample size the observation rests on (>= 1). */
  readonly sampleSize: number;
  /** Measurement confidence in [0, 1] when the source reports one (null otherwise). */
  readonly confidence: number | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly source: ReputationSourceRef;
  /** Optional neutral-text observation note (never a narrative override). */
  readonly notes?: string;
}

/** A frozen, content-addressed reputation record (+ digest). */
export interface ReputationRecord extends ReputationRecordView {
  readonly digest: string;
}

export interface CreateReputationRecordInput {
  readonly recordId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly family: string;
  readonly outcome: string;
  readonly applicability: ReputationApplicabilityContext;
  readonly sampleSize: number;
  readonly confidence?: number | null;
  readonly observedAt: string;
  readonly recordedAt: string;
  readonly source: {
    readonly surface: string;
    readonly refDigest: string;
    readonly locator: string;
  };
  readonly notes?: string;
}

function requireApplicability(
  value: unknown,
  family: ReputationFamily,
  context: string,
): ReputationApplicabilityContext {
  const record = expectFields(
    value,
    [],
    ['domain', 'taskFamily', 'jurisdiction'],
    NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    context,
  );
  const applicability: Record<string, unknown> = {};
  if (record['domain'] !== undefined) {
    applicability['domain'] = expectNonEmptyString(
      record['domain'],
      'domain',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      `${context}.applicability`,
    );
  }
  if (record['taskFamily'] !== undefined) {
    applicability['taskFamily'] = expectNonEmptyString(
      record['taskFamily'],
      'taskFamily',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      `${context}.applicability`,
    );
  }
  if (record['jurisdiction'] !== undefined) {
    applicability['jurisdiction'] = expectNonEmptyString(
      record['jurisdiction'],
      'jurisdiction',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      `${context}.applicability`,
    );
  }
  for (const required of REPUTATION_FAMILY_REQUIRED_CONTEXT[family]) {
    if (applicability[required] === undefined) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
        message: `${context}: reputation family '${family}' requires applicability context '${required}' (evidence without its applicability context is not admissible)`,
        details: { family, required },
      });
    }
  }
  return deepFreeze(applicability) as ReputationApplicabilityContext;
}

/**
 * Create ONE append-only, content-addressed dimensional reputation
 * record. Fails closed on unknown families/outcomes/source surfaces,
 * missing applicability context, backdated recording, authority/PII-
 * shaped field names.
 */
export async function createReputationRecord(
  input: CreateReputationRecordInput,
): Promise<ReputationRecord> {
  const record = expectFields(
    input,
    [
      'recordId',
      'tenant',
      'expertId',
      'family',
      'outcome',
      'applicability',
      'sampleSize',
      'observedAt',
      'recordedAt',
      'source',
    ],
    ['confidence', 'notes'],
    NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    'reputation record',
  );

  const family = toReputationFamily(record['family'], 'reputation record');
  const outcome = toReputationFamilyOutcome(family, record['outcome'], 'reputation record');
  const observedAt = toNetworkQualityTimestamp(
    record['observedAt'] as string,
    'reputation record observedAt',
  );
  const recordedAt = toNetworkQualityTimestamp(
    record['recordedAt'] as string,
    'reputation record recordedAt',
  );
  if (Date.parse(recordedAt) < Date.parse(observedAt)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD, {
      message: `reputation record: recordedAt (${recordedAt}) precedes observedAt (${observedAt}) -- backdated recording fails closed`,
      details: { observedAt, recordedAt },
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
          NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
          'reputation record',
        );

  // Validate the (surface  family) mapping through the closed table.
  const sourceRaw = expectFields(
    record['source'],
    ['surface', 'refDigest', 'locator'],
    [],
    NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE,
    'reputation record source',
  );
  toSourceSurfaceFamily(sourceRaw['surface'], family, 'reputation record');

  const view: ReputationRecordView = {
    recordVersion: REPUTATION_RECORD_VERSION,
    recordId: toNetworkQualityRecordId(
      record['recordId'] as string,
      'reputation record recordId',
    ),
    tenant: toNetworkQualityTenant(record['tenant'] as string, 'reputation record tenant'),
    expertId: expectNonEmptyString(
      record['expertId'],
      'expertId',
      NETWORK_QUALITY_ERROR_CODES.INVALID_IDENTITY,
      'reputation record',
    ),
    family,
    outcome,
    applicability: requireApplicability(record['applicability'], family, 'reputation record'),
    sampleSize: expectPositiveInteger(
      record['sampleSize'],
      'sampleSize',
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      'reputation record',
    ),
    confidence,
    observedAt,
    recordedAt,
    source: deepFreeze({
      surface: sourceRaw['surface'],
      refDigest: toNetworkQualityContentDigest(
        sourceRaw['refDigest'] as string,
        'reputation record source.refDigest',
      ),
      locator: toNetworkQualityLocator(
        sourceRaw['locator'] as string,
        'reputation record source.locator',
      ),
    }) as ReputationSourceRef,
    ...(record['notes'] === undefined
      ? {}
      : {
          notes: toNetworkQualityNeutralText(
            record['notes'] as string,
            'reputation record notes',
          ),
        }),
  };
  screenFieldNames(view, 'reputationRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as ReputationRecord;
}

/** The digest-free view (what the digest commits to). */
export function reputationRecordView(record: ReputationRecord): ReputationRecordView {
  const { digest: _digest, ...rest } = record;
  return deepFreeze({ ...rest }) as ReputationRecordView;
}

/** Recompute the content digest of a stored record (tamper check). */
export async function recomputeReputationRecordDigest(
  record: ReputationRecord,
): Promise<string> {
  const { digest: _digest, ...view } = record;
  return digestCanonical({ ...(view as ReputationRecordView) });
}

/** Verify the content digest of a stored record (append-only integrity). */
export async function verifyReputationRecordDigest(
  record: ReputationRecord,
): Promise<boolean> {
  return (await recomputeReputationRecordDigest(record)) === record.digest;
}

/** Structural equality of the digest-free views (append-only idempotence). */
export function sameReputationEvidence(
  left: ReputationRecord,
  right: ReputationRecord,
): boolean {
  return left.digest === right.digest;
}

/**
 * The append-only invariant guard: there is NO record mutation API -- this
 * function exists so consumers fail closed when they attempt one. A
 * "corrected" record is a NEW record with a NEW recordId; the prior
 * record remains in the log forever (lock rule 6).
 */
export function mutateReputationRecord(): never {
  throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.APPEND_ONLY_VIOLATION, {
    message:
      'reputation records are append-only — there is no update or delete path; a correction is a new record (lock rule 6)',
  });
}

// ---------------------------------------------------------------------------
// The single-family aggregate (typed, versioned, formula-disclosing)
// ---------------------------------------------------------------------------

/**
 * The ONLY aggregate over the reputation log: ONE family, outcome
 * frequencies, sample sizes, and MANDATORY limitation disclosures. A
 * cross-family or "overall reputation" aggregate has no construction
 * path.
 */
export interface FamilyOutcomeAggregate {
  readonly aggregateVersion: 1;
  readonly tenant: string;
  readonly expertId: string;
  readonly family: ReputationFamily;
  /** The closed aggregate formula identifier (disclosed, versioned). */
  readonly formula: 'family-outcome-frequency';
  readonly formulaVersion: string;
  readonly sampleSize: number;
  readonly recordCount: number;
  /** Per-outcome counts within the ONE family (closed vocabulary). */
  readonly outcomeCounts: Readonly<Record<string, number>>;
  /** MANDATORY limitation disclosures (never empty when sample is small). */
  readonly limitations: readonly string[];
  readonly aggregateDigest: string;
}

export const FAMILY_AGGREGATE_FORMULA_VERSION = '1.0.0' as const;

/** Deterministic fold of ONE family's records into the single-family aggregate. */
export async function aggregateFamilyOutcomes(
  records: readonly ReputationRecord[],
): Promise<FamilyOutcomeAggregate> {
  const first = records[0];
  if (first === undefined) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD, {
      message: 'family-outcome aggregate requires at least one reputation record',
    });
  }
  const { tenant, expertId, family } = first;
  const outcomeCounts: Record<string, number> = {};
  let sampleSize = 0;
  for (const record of records) {
    if (record.tenant !== tenant || record.expertId !== expertId) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.TENANT_MISMATCH, {
        message:
          'family-outcome aggregate is per (tenant, expert) -- cross-tenant/cross-expert aggregation fails closed',
        details: { tenant, expertId },
      });
    }
    if (record.family !== family) {
      throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_AGGREGATE, {
        message: `family-outcome aggregate is single-family -- record family '${record.family}' does not match '${family}'`,
      });
    }
    outcomeCounts[record.outcome] = (outcomeCounts[record.outcome] ?? 0) + 1;
    sampleSize += record.sampleSize;
  }
  const limitations: string[] = [
    'single-family outcome frequency -- not a competency or quality judgment',
    'reputation evidence is data, never authorization (architecture-lock rule 35)',
  ];
  if (records.length < 5) {
    limitations.push(`small-sample: ${records.length} record(s) -- treat as indicative only`);
  }
  const base = {
    aggregateVersion: 1 as const,
    tenant,
    expertId,
    family,
    formula: 'family-outcome-frequency' as const,
    formulaVersion: FAMILY_AGGREGATE_FORMULA_VERSION,
    sampleSize,
    recordCount: records.length,
    outcomeCounts: Object.freeze({ ...outcomeCounts }),
    limitations: Object.freeze([...limitations]),
  };
  const aggregateDigest = await digestCanonical({ ...base });
  return deepFreeze({ ...base, aggregateDigest });
}

// ---------------------------------------------------------------------------
// The no-single-global-score law (structural — no happy paths)
// ---------------------------------------------------------------------------

/** A single global network-quality score has NO happy path. */
export function buildNetworkQualityScore(): never {
  throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
    message:
      'network-quality reputation is dimensional -- a single global expert score has no construction path (spec/quality-model.md no-single-global-score law)',
  });
}

/** Consuming reputation as a global score has NO happy path. */
export function consumeReputationAsGlobalScore(): never {
  throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
    message:
      'reputation evidence is data, never a score to consume -- read the dimensional families (lock rule 35)',
  });
}

/** Cross-family weighting has NO happy path. */
export function applyReputationWeights(): never {
  throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
    message:
      'applyReputationWeights has no happy path -- cross-family weighting would collapse dimensional reputation into a single score',
  });
}

/**
 * THE SILENT-ADJUSTMENT LAW (C020): a control that "adjusts" a reputation
 * record, score, routing decision or adjudication outcome without an
 * explicit proposal + acceptance in the owning surface fails closed.
 * Findings PROPOSE; they never adjust.
 */
export function silentlyAdjustReputation(): never {
  throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED, {
    message:
      'network-quality controls never silently adjust reputation, routing or adjudication state -- findings propose actions into the owning surfaces; there is no silent-adjustment code path',
  });
}

/** Type guard for content digests from untrusted input (store reload). */
export function asReputationContentDigest(value: unknown): value is string {
  return isNetworkQualityContentDigest(value);
}
