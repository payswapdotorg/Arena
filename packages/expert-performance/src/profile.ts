/**
 * The canonical dimensional PerformanceProfile + its two read LENSES (Work
 * Order C005; spec/roles-and-contexts.md same-object/different-lens rule).
 *
 * The profile is the DETERMINISTIC fold of one expert's append-only
 * evidence records: per quality-model dimension — the record count, the
 * total sample size, the outcome frequencies, the latest outcome, the
 * attribution separation (expert-change vs evaluator-change vs
 * measurement-variance), the evaluator version lineage, the ordered
 * record digests and the read-time freshness assessment under the
 * versioned policy.
 *
 * THE NO-SINGLE-GLOBAL-SCORE LAW IS STRUCTURAL (spec/quality-model.md
 * "Do not collapse expert quality into a single global score"): the
 * profile type HAS NO score field, and exact-field validation rejects any
 * smuggled cross-dimension key; the only aggregate surface is the typed,
 * versioned, single-dimension summary in aggregate.ts.
 *
 * Two lenses over the SAME canonical profile object (both deterministic
 * given the same records + policy + injected time — no hidden clocks):
 *
 *   - toRoutingLens            — the C002 routing input (demonstrated
 *     performance / historical task fit / freshness per dimension);
 *   - toCapabilityHistoryLens  — the expert-facing capability history
 *     (the chronological evidence timeline with attribution).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  toPerformanceTimestamp,
  toPerformanceTenant,
} from './shared.js';
import type { PerformanceTimestamp } from './shared.js';
import { PERFORMANCE_DIMENSIONS, toPerformanceDimension } from './dimensions.js';
import type { PerformanceDimension } from './dimensions.js';
import { evaluateFreshness } from './freshness.js';
import type { FreshnessAssessment, FreshnessPolicy } from './freshness.js';
import type { AttributionKind, PerformanceEvidenceRecord } from './record.js';

/** Wire version of the canonical profile fold. */
export const PERFORMANCE_PROFILE_VERSION = 1 as const;

/** The per-dimension evidence summary of the canonical profile. */
export interface DimensionalEvidence {
  readonly dimension: PerformanceDimension;
  readonly recordCount: number;
  readonly totalSampleSize: number;
  /** Outcome frequencies over the append-only history (closed vocabulary). */
  readonly outcomeCounts: Readonly<Record<string, number>>;
  /** The outcome of the LATEST record (deterministic ordering). */
  readonly latestOutcome: string | null;
  readonly lastObservedAt: PerformanceTimestamp | null;
  /** Attribution separation (LE1.0 vocabulary) over the dimension's records. */
  readonly attributionCounts: Readonly<Record<AttributionKind, number>>;
  /** The ordered distinct evaluator version digests observed (the lineage). */
  readonly evaluatorVersions: readonly string[];
  /** Read-time freshness under the in-force policy (never silent decay). */
  readonly freshness: FreshnessAssessment;
  /** The ordered record digests (observedAt, then recordId — deterministic). */
  readonly recordDigests: readonly string[];
}

export interface PerformanceProfileView {
  readonly profileVersion: typeof PERFORMANCE_PROFILE_VERSION;
  readonly tenant: string;
  readonly expertId: string;
  readonly policyVersion: number;
  /** The fixed projection time (determinism anchor — injected). */
  readonly asOf: PerformanceTimestamp;
  readonly dimensions: Readonly<Record<PerformanceDimension, DimensionalEvidence>>;
}

/** A frozen, content-addressed canonical profile (+ digest). */
export interface PerformanceProfile extends PerformanceProfileView {
  readonly digest: string;
}

export interface AssembleProfileInput {
  readonly tenant: string;
  readonly expertId: string;
  readonly records: readonly PerformanceEvidenceRecord[];
  readonly policy: FreshnessPolicy;
  readonly asOf: string;
}

function emptyDimensionalEvidence(
  dimension: PerformanceDimension,
  policy: FreshnessPolicy,
  asOf: PerformanceTimestamp,
): DimensionalEvidence {
  return deepFreeze({
    dimension,
    recordCount: 0,
    totalSampleSize: 0,
    outcomeCounts: Object.freeze({}) as Readonly<Record<string, number>>,
    latestOutcome: null,
    lastObservedAt: null,
    attributionCounts: Object.freeze({
      'expert-change': 0,
      'evaluator-change': 0,
      'measurement-variance': 0,
    }),
    evaluatorVersions: Object.freeze([]),
    freshness: evaluateFreshness(dimension, null, policy, asOf),
    recordDigests: Object.freeze([]),
  });
}

/**
 * Assemble the canonical dimensional profile. PURE and DETERMINISTIC: the
 * records are folded in (observedAt, recordId) order; a record belonging
 * to another tenant/expert fails closed (TENANT_MISMATCH — profiles are
 * per-tenant objects); a record whose recordedAt postdates `asOf` is
 * EXCLUDED (no time travel — the profile is the evidence known at asOf).
 */
export async function assemblePerformanceProfile(
  input: AssembleProfileInput,
): Promise<PerformanceProfile> {
  const record = expectFields(
    input,
    ['tenant', 'expertId', 'records', 'policy', 'asOf'],
    [],
    EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
    'performance profile',
  );
  const tenant = toPerformanceTenant(record['tenant'] as string, 'performance profile tenant');
  const expertId = expectNonEmptyString(
    record['expertId'],
    'expertId',
    EXPERT_PERFORMANCE_ERROR_CODES.INVALID_IDENTITY,
    'performance profile',
  );
  const asOf = toPerformanceTimestamp(record['asOf'] as string, 'performance profile asOf');
  const records = Array.isArray(record['records']) ? (record['records'] as readonly PerformanceEvidenceRecord[]) : [];
  for (const evidence of records) {
    if (evidence.tenant !== tenant || evidence.expertId !== expertId) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.TENANT_MISMATCH, {
        message: `performance profile: record ${JSON.stringify(evidence.recordId)} belongs to tenant/expert (${evidence.tenant}/${evidence.expertId}) — the profile is (${tenant}/${expertId}); cross-tenant profile assembly fails closed`,
        details: { recordTenant: evidence.tenant, profileTenant: tenant },
      });
    }
  }
  const ordered = [...records]
    .filter((evidence) => Date.parse(evidence.recordedAt) <= Date.parse(asOf))
    .sort((left, right) => {
      const byTime = Date.parse(left.observedAt) - Date.parse(right.observedAt);
      return byTime !== 0 ? byTime : left.recordId.localeCompare(right.recordId);
    });

  const dimensions: Partial<Record<PerformanceDimension, DimensionalEvidence>> = {};
  for (const dimension of PERFORMANCE_DIMENSIONS) {
    dimensions[dimension] = emptyDimensionalEvidence(dimension, record['policy'] as FreshnessPolicy, asOf);
  }
  for (const evidence of ordered) {
    const prior = dimensions[evidence.dimension];
    if (prior === undefined) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.INVALID_DIMENSION, {
        message: `performance profile: record ${JSON.stringify(evidence.recordId)} carries unknown dimension ${JSON.stringify(evidence.dimension)}`,
      });
    }
    const outcomeCounts: Record<string, number> = { ...prior.outcomeCounts };
    outcomeCounts[evidence.outcome] = (outcomeCounts[evidence.outcome] ?? 0) + 1;
    const attributionCounts: Record<AttributionKind, number> = { ...prior.attributionCounts };
    attributionCounts[evidence.attribution.kind] += 1;
    const evaluatorVersions =
      evidence.attribution.evaluatorVersion === null
        ? [...prior.evaluatorVersions]
        : prior.evaluatorVersions.includes(evidence.attribution.evaluatorVersion)
          ? [...prior.evaluatorVersions]
          : [...prior.evaluatorVersions, evidence.attribution.evaluatorVersion];
    dimensions[evidence.dimension] = deepFreeze({
      dimension: evidence.dimension,
      recordCount: prior.recordCount + 1,
      totalSampleSize: prior.totalSampleSize + evidence.sampleSize,
      outcomeCounts: Object.freeze(outcomeCounts),
      latestOutcome: evidence.outcome,
      lastObservedAt: evidence.observedAt,
      attributionCounts: Object.freeze(attributionCounts),
      evaluatorVersions: Object.freeze(evaluatorVersions),
      freshness: evaluateFreshness(
        evidence.dimension,
        evidence.observedAt,
        record['policy'] as FreshnessPolicy,
        asOf,
      ),
      recordDigests: Object.freeze([...prior.recordDigests, evidence.digest]),
    });
  }

  const view: PerformanceProfileView = {
    profileVersion: PERFORMANCE_PROFILE_VERSION,
    tenant,
    expertId,
    policyVersion: (record['policy'] as FreshnessPolicy).policyVersion,
    asOf,
    dimensions: deepFreeze({ ...dimensions }) as Readonly<
      Record<PerformanceDimension, DimensionalEvidence>
    >,
  };
  screenProfileFields(view);
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as PerformanceProfile;
}

function screenProfileFields(view: PerformanceProfileView): void {
  for (const key of Object.keys(view)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalized.includes('globalscore') || normalized.includes('overallscore') || normalized.includes('singlerating')) {
      throw new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.GLOBAL_SCORE_REJECTED, {
        message: `performance profile: field '${key}' is score-shaped — the profile is dimensional evidence only (no-single-global-score law)`,
      });
    }
  }
}

/** The digest-free view (what the digest commits to). */
export function performanceProfileView(profile: PerformanceProfile): PerformanceProfileView {
  const { digest: _digest, ...rest } = profile;
  return deepFreeze({ ...rest }) as PerformanceProfileView;
}

// ---------------------------------------------------------------------------
// Lens 1 — the routing input (the C002 seam)
// ---------------------------------------------------------------------------

/** Wire version of the routing lens. */
export const ROUTING_LENS_VERSION = 1 as const;

export interface RoutingDimensionSummary {
  readonly dimension: PerformanceDimension;
  /** Read-time freshness (stale evidence must not be treated as fresh by routing). */
  readonly freshness: FreshnessAssessment;
  readonly recordCount: number;
  readonly totalSampleSize: number;
  readonly latestOutcome: string | null;
  readonly lastObservedAt: PerformanceTimestamp | null;
  /** Evaluator-version changes observed in the dimension (attribution discipline). */
  readonly evaluatorVersionChanges: number;
}

export interface RoutingPerformanceInputView {
  readonly lensVersion: typeof ROUTING_LENS_VERSION;
  readonly tenant: string;
  readonly expertId: string;
  readonly asOf: PerformanceTimestamp;
  /** The canonical profile this lens projects (same object, different lens). */
  readonly profileDigest: string;
  /**
   * The eight dimension summaries in CANONICAL quality-model order —
   * demonstrated performance (skill-competency) and historical task fit
   * (task-family-outcome) first-class; NO composite ranking is computed.
   */
  readonly dimensions: readonly RoutingDimensionSummary[];
}

/**
 * Project the ROUTING lens (the C002 demonstrated-performance /
 * historical-task-fit seam input). Deterministic: derived only from the
 * canonical profile. Routing ranks; this lens never does — there is no
 * composite field by construction.
 */
export function toRoutingLens(profile: PerformanceProfile): RoutingPerformanceInputView {
  const dimensions = PERFORMANCE_DIMENSIONS.map((dimension) => {
    const evidence = profile.dimensions[dimension];
    return deepFreeze({
      dimension,
      freshness: evidence.freshness,
      recordCount: evidence.recordCount,
      totalSampleSize: evidence.totalSampleSize,
      latestOutcome: evidence.latestOutcome,
      lastObservedAt: evidence.lastObservedAt,
      evaluatorVersionChanges: Math.max(0, evidence.evaluatorVersions.length - 1),
    });
  });
  return deepFreeze({
    lensVersion: ROUTING_LENS_VERSION,
    tenant: profile.tenant,
    expertId: profile.expertId,
    asOf: profile.asOf,
    profileDigest: profile.digest,
    dimensions: Object.freeze(dimensions),
  });
}

// ---------------------------------------------------------------------------
// Lens 2 — the expert-facing capability history
// ---------------------------------------------------------------------------

/** Wire version of the capability-history lens. */
export const CAPABILITY_HISTORY_LENS_VERSION = 1 as const;

export interface CapabilityHistoryEntry {
  readonly recordDigest: string;
  readonly recordId: string;
  readonly dimension: PerformanceDimension;
  readonly outcome: string;
  readonly observedAt: PerformanceTimestamp;
  readonly attributionKind: AttributionKind;
  readonly evaluatorVersion: string | null;
  readonly sampleSize: number;
}

export interface CapabilityHistoryView {
  readonly lensVersion: typeof CAPABILITY_HISTORY_LENS_VERSION;
  readonly tenant: string;
  readonly expertId: string;
  readonly asOf: PerformanceTimestamp;
  /** The canonical profile this lens projects (same object, different lens). */
  readonly profileDigest: string;
  /** The chronological evidence timeline (observedAt, then recordId). */
  readonly timeline: readonly CapabilityHistoryEntry[];
  readonly totalRecords: number;
}

/**
 * Project the EXPERT-FACING capability-history lens. Deterministic: the
 * timeline is the same (observedAt, recordId) ordering the canonical
 * profile folded — the expert sees the same evidence the network sees.
 */
export function toCapabilityHistoryLens(
  profile: PerformanceProfile,
  records: readonly PerformanceEvidenceRecord[],
): CapabilityHistoryView {
  const ordered = [...records]
    .filter((evidence) => Date.parse(evidence.recordedAt) <= Date.parse(profile.asOf))
    .sort((left, right) => {
      const byTime = Date.parse(left.observedAt) - Date.parse(right.observedAt);
      return byTime !== 0 ? byTime : left.recordId.localeCompare(right.recordId);
    });
  const timeline = ordered.map((evidence) =>
    deepFreeze({
      recordDigest: evidence.digest,
      recordId: evidence.recordId,
      dimension: evidence.dimension,
      outcome: evidence.outcome,
      observedAt: evidence.observedAt,
      attributionKind: evidence.attribution.kind,
      evaluatorVersion: evidence.attribution.evaluatorVersion,
      sampleSize: evidence.sampleSize,
    }),
  );
  return deepFreeze({
    lensVersion: CAPABILITY_HISTORY_LENS_VERSION,
    tenant: profile.tenant,
    expertId: profile.expertId,
    asOf: profile.asOf,
    profileDigest: profile.digest,
    timeline: Object.freeze(timeline),
    totalRecords: timeline.length,
  });
}

/** Dimension accessor (closed vocabulary — fail closed on unknown). */
export function dimensionalEvidenceOf(
  profile: PerformanceProfile,
  dimension: string,
): DimensionalEvidence {
  const target = toPerformanceDimension(dimension, 'dimensional evidence lookup');
  return profile.dimensions[target];
}
