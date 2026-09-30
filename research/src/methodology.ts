/**
 * ScoringMethodology -- the versioned, content-addressed statement of
 * HOW raw per-criterion verdicts become ONE benchmark score (Work Order
 * A030; spec EV1.0 "Evaluation is judgment against explicit criteria";
 * spec/quality-model.md score stability under rerun).
 *
 * A methodology binds:
 *   - `methodologyId` + `version` -- its own versioned identity. The
 *     object is content-addressed: ANY field change changes the digest,
 *     so every historical methodology stays citable forever
 *     (architecture-lock rule 12);
 *   - `aggregation` -- the A012 closed aggregation-policy enum
 *     (weighted-sum | pass-threshold | rubric-level), REUSED BY IMPORT
 *     from @arena/evaluation and never reimplemented here (the parity
 *     suite asserts the enum is the very same object semantics);
 *   - `passAt` -- the aggregate judgment bar, domain-validated per the
 *     aggregation policy exactly like A012 thresholds (fraction in
 *     (0,1] for weighted-sum / pass-threshold; integer level in [1,5]
 *     for rubric-level);
 *   - `scoreDomain` -- the closed per-criterion score domain:
 *     'unit-interval' (scores in [0,1]) for weighted-sum /
 *     pass-threshold, 'rubric-levels' (integer scores in [1,5]) for
 *     rubric-level -- derived, not declared, so it can never contradict
 *     the aggregation policy;
 *   - `tieBreaking` -- the closed tie-break vocabulary for ranked
 *     leaderboards: 'digest-asc' (byte-deterministic) or 'none'
 *     (methodology does not rank);
 *   - `knownLimitations` -- the stated blind spots (quality model:
 *     always stated, never implied);
 *   - `contaminationPolicy` -- the public-benchmark hygiene statement
 *     (what may not enter the task population / how leakage is
 *     mitigated) -- mandatory text, never an implication;
 *   - `provenance` -- who authored the methodology, when, notes.
 *
 * The object is deep-frozen at creation; there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { AGGREGATION_POLICIES, isAggregationPolicy } from '@arena/evaluation';
import type { AggregationPolicy } from '@arena/evaluation';
import { RESEARCH_ERROR_CODES, ResearchError } from './errors.js';
import { researchSchemaRef } from './schemas.js';
import {
  deepFreeze,
  expectFields,
  expectNumberInRange,
  isNeutralText,
  isResearchId,
  isResearchVersion,
  toNeutralText,
  toResearchId,
  toResearchVersion,
} from './shared.js';
import type { ResearchContentDigest, ResearchId, ResearchNeutralText, ResearchVersion } from './shared.js';

/** Wire version of the scoring-methodology shape. */
export const SCORING_METHODOLOGY_VERSION = 1 as const;

/** The closed per-criterion score domains (derived from the aggregation). */
export const SCORE_DOMAINS = Object.freeze(['unit-interval', 'rubric-levels'] as const);
export type ScoreDomain = (typeof SCORE_DOMAINS)[number];

/** The closed tie-break vocabulary (deterministic leaderboards). */
export const TIE_BREAK_POLICIES = Object.freeze(['digest-asc', 'none'] as const);
export type TieBreakPolicy = (typeof TIE_BREAK_POLICIES)[number];

/** The domain of a score under a policy -- derived, never declared. */
export function scoreDomainFor(aggregation: AggregationPolicy): ScoreDomain {
  return aggregation === 'rubric-level' ? 'rubric-levels' : 'unit-interval';
}

/** The pass-bar domain check, mirroring A012's thresholds semantics. */
function validatePassAt(aggregation: AggregationPolicy, passAt: number): number {
  if (aggregation === 'rubric-level') {
    if (!Number.isInteger(passAt) || passAt < 1 || passAt > 5) {
      throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_METHODOLOGY, {
        message: `scoring methodology: passAt must be an integer rubric level in [1,5] for aggregation 'rubric-level' (got ${JSON.stringify(passAt)})`,
        details: { aggregation, passAt },
      });
    }
    return passAt;
  }
  if (passAt <= 0 || passAt > 1) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_METHODOLOGY, {
      message: `scoring methodology: passAt must lie in (0,1] for aggregation '${aggregation}' (got ${JSON.stringify(passAt)})`,
      details: { aggregation, passAt },
    });
  }
  return passAt;
}

/** Provenance of the methodology declaration. */
export interface MethodologyProvenance {
  readonly authoredBy: ResearchId;
  readonly submittedAt: string;
  readonly notes: ResearchNeutralText | null;
}

/** Stable field list for methodology provenance. */
export const METHODOLOGY_PROVENANCE_FIELDS = Object.freeze([
  'authoredBy',
  'submittedAt',
  'notes',
] as const) as readonly string[];

function toMethodologyProvenance(value: unknown): MethodologyProvenance {
  const record = expectFields(
    value,
    ['authoredBy', 'submittedAt', 'notes'],
    [],
    RESEARCH_ERROR_CODES.INVALID_PROVENANCE,
    'scoring methodology provenance',
  );
  const submittedAt = record['submittedAt'];
  const notes = record['notes'];
  if (
    typeof submittedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(submittedAt) ||
    Number.isNaN(Date.parse(submittedAt))
  ) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'scoring methodology provenance: submittedAt must be a ms-precision UTC timestamp',
    });
  }
  if (notes !== null && typeof notes !== 'string') {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'scoring methodology provenance: notes must be neutral text or null',
    });
  }
  return deepFreeze({
    authoredBy: toResearchId(
      typeof record['authoredBy'] === 'string' ? record['authoredBy'] : '',
      'methodology provenance authoredBy',
    ),
    submittedAt,
    notes: notes === null ? null : toNeutralText(notes, 'methodology provenance notes'),
  });
}

/** The digest-free view -- exactly what the methodology digest commits to. */
export interface ScoringMethodologyView {
  readonly recordVersion: typeof SCORING_METHODOLOGY_VERSION;
  readonly methodologyId: ResearchId;
  readonly version: ResearchVersion;
  readonly aggregation: AggregationPolicy;
  readonly passAt: number;
  readonly scoreDomain: ScoreDomain;
  readonly tieBreaking: TieBreakPolicy;
  readonly knownLimitations: ResearchNeutralText;
  readonly contaminationPolicy: ResearchNeutralText;
  readonly outputSchema: SchemaRef;
  readonly provenance: MethodologyProvenance;
}

/** A frozen, content-addressed scoring methodology: the view plus its digest. */
export interface ScoringMethodology extends ScoringMethodologyView {
  readonly digest: ResearchContentDigest;
}

/** Stable field list for the methodology view (tests mirror it). */
export const SCORING_METHODOLOGY_FIELDS = Object.freeze([
  'recordVersion',
  'methodologyId',
  'version',
  'aggregation',
  'passAt',
  'scoreDomain',
  'tieBreaking',
  'knownLimitations',
  'contaminationPolicy',
  'outputSchema',
  'provenance',
] as const) as readonly string[];

export interface CreateScoringMethodologyInput {
  readonly methodologyId: string;
  readonly version: string;
  readonly aggregation: string;
  readonly passAt: number;
  readonly tieBreaking: string;
  readonly knownLimitations: string;
  readonly contaminationPolicy: string;
  readonly provenance: {
    readonly authoredBy: string;
    readonly submittedAt: string;
    readonly notes: string | null;
  };
}

/** Structural (non-throwing) check for the digest-free view. */
export function isScoringMethodologyView(value: unknown): value is ScoringMethodologyView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === SCORING_METHODOLOGY_VERSION &&
    isResearchId(candidate['methodologyId']) &&
    isResearchVersion(candidate['version']) &&
    isAggregationPolicy(candidate['aggregation']) &&
    typeof candidate['passAt'] === 'number' &&
    Number.isFinite(candidate['passAt']) &&
    (candidate['scoreDomain'] === 'unit-interval' || candidate['scoreDomain'] === 'rubric-levels') &&
    (candidate['tieBreaking'] === 'digest-asc' || candidate['tieBreaking'] === 'none') &&
    isNeutralText(candidate['knownLimitations']) &&
    isNeutralText(candidate['contaminationPolicy']) &&
    typeof candidate['outputSchema'] === 'object' &&
    candidate['outputSchema'] !== null &&
    typeof candidate['provenance'] === 'object' &&
    candidate['provenance'] !== null
  );
}

/** Structural (non-throwing) check for the full methodology (view + digest). */
export function isScoringMethodology(value: unknown): value is ScoringMethodology {
  if (!isScoringMethodologyView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed scoring
 * methodology. Rejects unknown aggregation policies (the A012 closed
 * enum), out-of-domain pass bars, unknown tie-break policies, empty
 * limitations/contamination statements and unknown fields.
 */
export async function createScoringMethodology(
  input: CreateScoringMethodologyInput,
): Promise<ScoringMethodology> {
  const record = expectFields(
    input,
    [
      'methodologyId',
      'version',
      'aggregation',
      'passAt',
      'tieBreaking',
      'knownLimitations',
      'contaminationPolicy',
      'provenance',
    ],
    [],
    RESEARCH_ERROR_CODES.INVALID_METHODOLOGY,
    'scoring methodology',
  );

  const aggregation = record['aggregation'];
  if (!isAggregationPolicy(aggregation)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_METHODOLOGY, {
      message: `scoring methodology: unknown aggregation policy ${JSON.stringify(aggregation)} (the A012 closed enum is reused: ${AGGREGATION_POLICIES.join(' | ')})`,
      details: { allowed: [...AGGREGATION_POLICIES] },
    });
  }
  const tieBreaking = record['tieBreaking'];
  if (
    typeof tieBreaking !== 'string' ||
    !(TIE_BREAK_POLICIES as readonly string[]).includes(tieBreaking)
  ) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_METHODOLOGY, {
      message: `scoring methodology: unknown tie-break policy ${JSON.stringify(tieBreaking)}`,
      details: { allowed: [...TIE_BREAK_POLICIES] },
    });
  }
  const tieBreakingPolicy = tieBreaking as TieBreakPolicy;
  const passAt = validatePassAt(
    aggregation,
    expectNumberInRange(
      record['passAt'],
      'passAt',
      0,
      5,
      RESEARCH_ERROR_CODES.INVALID_METHODOLOGY,
      'scoring methodology',
    ),
  );

  const view: ScoringMethodologyView = {
    recordVersion: SCORING_METHODOLOGY_VERSION,
    methodologyId: toResearchId(
      typeof record['methodologyId'] === 'string' ? record['methodologyId'] : '',
      'scoring methodology methodologyId',
    ),
    version: toResearchVersion(
      typeof record['version'] === 'string' ? record['version'] : '',
      'scoring methodology version',
    ),
    aggregation,
    passAt,
    scoreDomain: scoreDomainFor(aggregation),
    tieBreaking: tieBreakingPolicy,
    knownLimitations: toNeutralText(
      typeof record['knownLimitations'] === 'string' ? record['knownLimitations'] : '',
      'scoring methodology knownLimitations',
    ),
    contaminationPolicy: toNeutralText(
      typeof record['contaminationPolicy'] === 'string' ? record['contaminationPolicy'] : '',
      'scoring methodology contaminationPolicy',
    ),
    outputSchema: researchSchemaRef('research/scoring-methodology'),
    provenance: toMethodologyProvenance(record['provenance']),
  };
  const digest = await digestCanonical(view);
  return deepFreeze({ ...view, digest }) as ScoringMethodology;
}

/** The digest-free view of a methodology (what the digest commits to). */
export function scoringMethodologyView(methodology: ScoringMethodology): ScoringMethodologyView {
  const { digest: _digest, ...view } = methodology;
  return deepFreeze({ ...view }) as ScoringMethodologyView;
}

/**
 * Recompute the methodology digest over the digest-free view and
 * compare. Throws RESEARCH_TAMPERED on any mismatch.
 */
export async function recomputeScoringMethodologyDigest(
  methodology: ScoringMethodology,
  expectedDigest?: string,
): Promise<ResearchContentDigest> {
  if (!isScoringMethodology(methodology)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_METHODOLOGY, {
      message: 'methodology digest recomputation requires a structurally valid scoring methodology',
    });
  }
  const actual = await digestCanonical(scoringMethodologyView(methodology));
  if (actual !== methodology.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.TAMPERED, {
      message: `scoring methodology digest mismatch: expected ${expectedDigest ?? methodology.digest}, got ${actual}`,
      details: {
        methodologyId: methodology.methodologyId,
        version: methodology.version,
        expected: expectedDigest ?? methodology.digest,
        actual,
      },
    });
  }
  return actual as ResearchContentDigest;
}

/** The methodology identity key -- "methodologyId@version". */
export function methodologyIdentityKey(methodology: ScoringMethodology): string {
  return `${methodology.methodologyId}@${methodology.version}`;
}
