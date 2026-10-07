/**
 * Competition byproducts (Work Order C013; issue #119; spec/
 * adversarial-expert-evaluation.md AE1.0 "Benefits" + "Certification
 * boundary"): adversarial trajectories, disagreement data and benchmark
 * material are recorded as provenance-carrying byproduct records and
 * projected into A030 research/benchmarks as CANDIDATES — with rights
 * attached, never silent reuse.
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';
import { deepFreeze, rejectUnknownFields, requireBoundedString, requireStringArray } from './shared.js';

/** Wire version of the byproduct shapes. */
export const BYPRODUCT_VERSION = 1 as const;

export const BYPRODUCT_KINDS = Object.freeze([
  'adversarial-trajectory',
  'disagreement-data',
  'benchmark-material',
] as const);
export type ByproductKind = (typeof BYPRODUCT_KINDS)[number];

export function isByproductKind(value: unknown): value is ByproductKind {
  return typeof value === 'string' && (BYPRODUCT_KINDS as readonly string[]).includes(value);
}

export interface ByproductRights {
  /** The licence the material is shared under (e.g. 'cc-by-4.0', 'arena-research-only'). */
  readonly license: string;
  /** Provenance statement (who produced it, under what competition). */
  readonly provenance: string;
  /** TRUE when expert consent covers research reuse; false surfaces a research-blocked flag downstream. */
  readonly consentForResearch: boolean;
}

export interface ByproductRecord {
  readonly byproductVersion: typeof BYPRODUCT_VERSION;
  readonly byproductId: string;
  readonly competitionId: string;
  readonly kind: ByproductKind;
  /** Digest/ref-addressed material (never inline content). */
  readonly refs: readonly string[];
  readonly rights: ByproductRights;
  readonly createdAt: string;
}

export const BYPRODUCT_RECORD_FIELDS = Object.freeze([
  'byproductVersion',
  'byproductId',
  'competitionId',
  'kind',
  'refs',
  'rights',
  'createdAt',
] as const);

export function createByproductRecord(input: {
  readonly byproductId: string;
  readonly competitionId: string;
  readonly kind: string;
  readonly refs: readonly string[];
  readonly rights: { readonly license: string; readonly provenance: string; readonly consentForResearch: boolean };
  readonly createdAt: string;
}): ByproductRecord {
  if (typeof input !== 'object' || input === null) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_BYPRODUCT, {
      message: 'byproduct input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    BYPRODUCT_RECORD_FIELDS.filter((field) => field !== 'byproductVersion'),
    'ByproductRecord',
  );
  requireBoundedString(input.byproductId, 'byproductId');
  requireBoundedString(input.competitionId, 'competitionId');
  if (!isByproductKind(input.kind)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_BYPRODUCT, {
      message: `byproduct kind is not in the closed vocabulary: ${JSON.stringify(input.kind)}`,
      details: { vocabulary: BYPRODUCT_KINDS },
    });
  }
  const refs = requireStringArray(input.refs, 'refs');
  requireBoundedString(input.rights.license, 'rights.license');
  requireBoundedString(input.rights.provenance, 'rights.provenance');
  if (typeof input.rights.consentForResearch !== 'boolean') {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_BYPRODUCT, {
      message: 'rights.consentForResearch must be a boolean',
    });
  }
  requireBoundedString(input.createdAt, 'createdAt');
  return deepFreeze({
    byproductVersion: BYPRODUCT_VERSION,
    byproductId: input.byproductId,
    competitionId: input.competitionId,
    kind: input.kind,
    refs,
    rights: deepFreeze({
      license: input.rights.license,
      provenance: input.rights.provenance,
      consentForResearch: input.rights.consentForResearch,
    }),
    createdAt: input.createdAt,
  });
}

// ---------------------------------------------------------------------------
// The A030 research/benchmarks candidate projection
// ---------------------------------------------------------------------------

/** The closed A030 candidate surface this package projects onto. */
export const RESEARCH_CANDIDATE_KINDS = Object.freeze([
  'research-candidate',
  'benchmark-candidate',
] as const);
export type ResearchCandidateKind = (typeof RESEARCH_CANDIDATE_KINDS)[number];

export interface ResearchCandidate {
  readonly candidateVersion: 1;
  readonly candidateId: string;
  readonly competitionId: string;
  readonly kind: ResearchCandidateKind;
  readonly artifactRef: string;
  readonly license: string;
  readonly provenance: string;
  readonly consentForResearch: boolean;
}

/**
 * Project a byproduct record into the A030 research/benchmarks
 * CANDIDATE shape (rights/provenance-carrying; the A030 surfaces own
 * admission — candidates only, never direct writes).
 */
export function toResearchCandidates(record: ByproductRecord): readonly ResearchCandidate[] {
  const kind: ResearchCandidateKind =
    record.kind === 'benchmark-material' ? 'benchmark-candidate' : 'research-candidate';
  return Object.freeze(
    record.refs.map((artifactRef) =>
      deepFreeze({
        candidateVersion: 1 as const,
        candidateId: `rc_${record.byproductId}_${artifactRef}`,
        competitionId: record.competitionId,
        kind,
        artifactRef,
        license: record.rights.license,
        provenance: record.rights.provenance,
        consentForResearch: record.rights.consentForResearch,
      }),
    ),
  );
}

/** Structural guard for wire values claiming to be byproduct records. */
export function isByproductRecord(value: unknown): value is ByproductRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['byproductVersion'] === BYPRODUCT_VERSION &&
    isByproductKind(candidate['kind']) &&
    typeof candidate['competitionId'] === 'string' &&
    Array.isArray(candidate['refs']) &&
    candidate['refs'].length > 0
  );
}
