/**
 * MatchResult — the deterministic, per-requirement-evidence result of one
 * match run (Work Order A007; requirement R8 "Match expert requirements
 * to qualified experts"; "no silent best-effort").
 *
 * Every candidate entry carries, FOR EACH request requirement, the
 * satisfaction evidence (the matched claim digest, the in-force
 * qualification record digest and the qualifying evidence digests) or an
 * EXPLICIT unmatched reason from the closed vocabulary below. There is no
 * aggregate score, no reputation input and no silent dropping — an expert
 * absent from the result is either tenant-invisible (a security boundary,
 * not a match judgment) or capped by the declared maxCandidates AFTER
 * deterministic ranking.
 *
 * `requirementsUnmet` lists the request requirements NO returned candidate
 * satisfies — the explicit negative space of the match (dispatchers can
 * see exactly which requirements cannot be staffed from the qualified
 * pool).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  isExpertQualificationTimestamp,
  isNeutralExpertId,
  isTenantScope,
  toContentDigest,
  toNeutralExpertId,
  toTenantScope,
} from './shared.js';
import type { ContentDigest, NeutralExpertId, TenantScope } from './shared.js';

/** Wire version of the match-result record shape. */
export const MATCH_RESULT_VERSION = 1 as const;

/**
 * The CLOSED per-requirement unmatched-reason vocabulary (no silent
 * best-effort — every unsatisfied requirement carries exactly one):
 *   - `no-competency-claim` — the expert has no active claim for the
 *     capability;
 *   - `qualification-missing` — a claim exists but no qualification
 *     record was computed for it;
 *   - `qualification-unqualified` / `qualification-stale` /
 *     `qualification-expired` / `qualification-revoked` — the latest
 *     qualification record for the claim carries that status (or a
 *     qualified record whose validity window has elapsed reads as
 *     expired);
 *   - `proficiency-below-threshold` — the claim's proficiency is below
 *     the requirement threshold;
 *   - `domain-mismatch` / `jurisdiction-mismatch` /
 *     `availability-conflict` — the request-level scope constraints fail.
 */
export const UNMATCHED_REASONS = Object.freeze([
  'no-competency-claim',
  'qualification-missing',
  'qualification-unqualified',
  'qualification-stale',
  'qualification-expired',
  'qualification-revoked',
  'proficiency-below-threshold',
  'domain-mismatch',
  'jurisdiction-mismatch',
  'availability-conflict',
] as const);

export type UnmatchedReason = (typeof UNMATCHED_REASONS)[number];

export function isUnmatchedReason(value: unknown): value is UnmatchedReason {
  return (
    typeof value === 'string' &&
    (UNMATCHED_REASONS as readonly string[]).includes(value)
  );
}

/** Stable field list for the result (tests + contracts mirror it). */
export const MATCH_RESULT_FIELDS = Object.freeze([
  'resultVersion',
  'requestDigest',
  'matchingPolicyDigest',
  'evaluatedAt',
  'candidates',
  'requirementsUnmet',
  'truncated',
  'digest',
] as const) as readonly string[];

/** Stable field list for one candidate. */
export const MATCH_CANDIDATE_FIELDS = Object.freeze([
  'expertId',
  'tenant',
  'satisfiedAll',
  'satisfiedCount',
  'evidenceCount',
  'perRequirement',
] as const);

/** Stable field list for one per-requirement entry. */
export const PER_REQUIREMENT_ENTRY_FIELDS = Object.freeze([
  'requirementId',
  'satisfied',
  'matchedProficiency',
  'claimDigest',
  'recordDigest',
  'evidenceDigests',
  'unmatchedReason',
] as const);

/**
 * One per-requirement entry: either the satisfaction evidence (matched
 * proficiency, claim digest, qualification record digest, qualifying
 * evidence digests) or the explicit unmatched reason.
 */
export interface PerRequirementEntry {
  readonly requirementId: string;
  readonly satisfied: boolean;
  /** Present iff satisfied — the claim's proficiency that met the threshold. */
  readonly matchedProficiency?: string;
  /** Present iff satisfied — the matched claim. */
  readonly claimDigest?: ContentDigest;
  /** Present iff satisfied — the in-force qualification record. */
  readonly recordDigest?: ContentDigest;
  /** Present iff satisfied — the record's qualifying evidence digests. */
  readonly evidenceDigests: readonly ContentDigest[];
  /** Present iff NOT satisfied — the closed-vocabulary reason. */
  readonly unmatchedReason?: UnmatchedReason;
}

/** One ranked candidate: the expert + per-requirement evidence. */
export interface MatchCandidate {
  readonly expertId: NeutralExpertId;
  readonly tenant: TenantScope;
  readonly satisfiedAll: boolean;
  readonly satisfiedCount: number;
  /** Distinct qualifying evidence digests backing the satisfied requirements. */
  readonly evidenceCount: number;
  readonly perRequirement: readonly PerRequirementEntry[];
}

/** The digest-free view — exactly what the result digest commits to. */
export interface MatchResultView {
  readonly resultVersion: typeof MATCH_RESULT_VERSION;
  readonly requestDigest: ContentDigest;
  readonly matchingPolicyDigest: ContentDigest;
  readonly evaluatedAt: string;
  readonly candidates: readonly MatchCandidate[];
  /** Request requirement ids no returned candidate satisfies. */
  readonly requirementsUnmet: readonly string[];
  /** True iff the candidate list was capped by the policy's maxCandidates. */
  readonly truncated: boolean;
}

/** A frozen, content-addressed match result: view + digest. */
export interface MatchResult extends MatchResultView {
  readonly digest: ContentDigest;
}

/** Structural (non-throwing) check for one per-requirement entry. */
export function isPerRequirementEntry(value: unknown): value is PerRequirementEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['requirementId'] !== 'string' ||
    candidate['requirementId'].length === 0 ||
    typeof candidate['satisfied'] !== 'boolean' ||
    !Array.isArray(candidate['evidenceDigests'])
  ) {
    return false;
  }
  if (!candidate['evidenceDigests'].every((digest) => isContentDigest(digest))) return false;
  if (candidate['satisfied']) {
    if (
      typeof candidate['matchedProficiency'] !== 'string' ||
      !isContentDigest(candidate['claimDigest']) ||
      !isContentDigest(candidate['recordDigest'])
    ) {
      return false;
    }
    return candidate['unmatchedReason'] === undefined;
  }
  return (
    isUnmatchedReason(candidate['unmatchedReason']) &&
    candidate['matchedProficiency'] === undefined &&
    candidate['claimDigest'] === undefined &&
    candidate['recordDigest'] === undefined
  );
}

/** Structural (non-throwing) check for one candidate. */
export function isMatchCandidate(value: unknown): value is MatchCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralExpertId(candidate['expertId']) &&
    isTenantScope(candidate['tenant']) &&
    typeof candidate['satisfiedAll'] === 'boolean' &&
    typeof candidate['satisfiedCount'] === 'number' &&
    Number.isInteger(candidate['satisfiedCount']) &&
    typeof candidate['evidenceCount'] === 'number' &&
    Number.isInteger(candidate['evidenceCount']) &&
    Array.isArray(candidate['perRequirement']) &&
    candidate['perRequirement'].length > 0 &&
    candidate['perRequirement'].every((entry) => isPerRequirementEntry(entry))
  );
}

/** Structural (non-throwing) check for the digest-free view. */
export function isMatchResultView(value: unknown): value is MatchResultView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['resultVersion'] !== MATCH_RESULT_VERSION ||
    !isContentDigest(candidate['requestDigest']) ||
    !isContentDigest(candidate['matchingPolicyDigest']) ||
    !isExpertQualificationTimestamp(candidate['evaluatedAt']) ||
    typeof candidate['truncated'] !== 'boolean'
  ) {
    return false;
  }
  const entries = candidate['candidates'];
  if (!Array.isArray(entries) || !entries.every((entry) => isMatchCandidate(entry))) {
    return false;
  }
  const unmet = candidate['requirementsUnmet'];
  if (
    !Array.isArray(unmet) ||
    !unmet.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    return false;
  }
  return true;
}

/** Structural (non-throwing) check for the full result (view + digest). */
export function isMatchResult(value: unknown): value is MatchResult {
  if (!isMatchResultView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Build a validated, deep-frozen, content-addressed match result from
 * candidate entries (plain-string input shape — the house convention).
 * Internal consistency is enforced: satisfiedCount matches the entries;
 * satisfiedAll iff every entry is satisfied; evidenceCount is the count
 * of DISTINCT evidence digests across satisfied entries.
 */
export interface CreateMatchResultInput {
  readonly requestDigest: string;
  readonly matchingPolicyDigest: string;
  readonly evaluatedAt: string;
  readonly candidates: readonly {
    readonly expertId: string;
    readonly tenant: string;
    readonly satisfiedAll: boolean;
    readonly satisfiedCount: number;
    readonly evidenceCount: number;
    readonly perRequirement: readonly {
      readonly requirementId: string;
      readonly satisfied: boolean;
      readonly matchedProficiency?: string;
      readonly claimDigest?: string;
      readonly recordDigest?: string;
      readonly evidenceDigests: readonly string[];
      readonly unmatchedReason?: string;
    }[];
  }[];
  readonly requirementsUnmet: readonly string[];
  readonly truncated: boolean;
}

export async function createMatchResult(
  input: CreateMatchResultInput,
): Promise<MatchResult> {
  const record = expectFields(
    input,
    [
      'requestDigest',
      'matchingPolicyDigest',
      'evaluatedAt',
      'candidates',
      'requirementsUnmet',
      'truncated',
    ],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT,
    'match result',
  );

  const requestDigest = toContentDigest(
    typeof record['requestDigest'] === 'string' ? record['requestDigest'] : '',
    'match result requestDigest',
  );
  const matchingPolicyDigest = toContentDigest(
    typeof record['matchingPolicyDigest'] === 'string' ? record['matchingPolicyDigest'] : '',
    'match result matchingPolicyDigest',
  );
  const evaluatedAt =
    typeof record['evaluatedAt'] === 'string' ? record['evaluatedAt'] : '';
  if (!isExpertQualificationTimestamp(evaluatedAt)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
      message: `match result evaluatedAt must be an ms-precision UTC timestamp: ${JSON.stringify(evaluatedAt)}`,
    });
  }
  const candidateInputs = Array.isArray(record['candidates'])
    ? (record['candidates'] as CreateMatchResultInput['candidates'])
    : [];

  // Validate + brand each candidate entry; enforce internal consistency
  // (no silent drift between entries and counters).
  const candidates: MatchCandidate[] = candidateInputs.map((candidateInput) => {
    const expertId = toNeutralExpertId(candidateInput.expertId, 'match candidate expertId');
    const tenant = toTenantScope(candidateInput.tenant, 'match candidate tenant');
    if (!Array.isArray(candidateInput.perRequirement) || candidateInput.perRequirement.length === 0) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
        message: `candidate ${candidateInput.expertId}: perRequirement must be a non-empty list`,
        details: { expertId: candidateInput.expertId },
      });
    }
    const perRequirement = candidateInput.perRequirement.map((entry) => {
      const satisfied = entry.satisfied === true;
      if (typeof entry.requirementId !== 'string' || entry.requirementId.length === 0) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
          message: 'per-requirement entries require a requirementId',
        });
      }
      const evidenceDigests = Object.freeze(
        (Array.isArray(entry.evidenceDigests) ? entry.evidenceDigests : []).map((digest: string) =>
          toContentDigest(digest, 'per-requirement evidence digest'),
        ),
      );
      if (satisfied) {
        if (typeof entry.matchedProficiency !== 'string' || entry.claimDigest === undefined || entry.recordDigest === undefined) {
          throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
            message: `a satisfied per-requirement entry must carry matchedProficiency, claimDigest and recordDigest (requirement ${entry.requirementId})`,
            details: { requirementId: entry.requirementId },
          });
        }
        if (entry.unmatchedReason !== undefined) {
          throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
            message: `a satisfied per-requirement entry cannot carry an unmatchedReason (requirement ${entry.requirementId})`,
            details: { requirementId: entry.requirementId },
          });
        }
        return Object.freeze({
          requirementId: entry.requirementId,
          satisfied: true,
          matchedProficiency: entry.matchedProficiency,
          claimDigest: toContentDigest(entry.claimDigest, 'entry claimDigest'),
          recordDigest: toContentDigest(entry.recordDigest, 'entry recordDigest'),
          evidenceDigests,
        }) satisfies PerRequirementEntry;
      }
      if (entry.unmatchedReason === undefined || !isUnmatchedReason(entry.unmatchedReason)) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
          message: `an unsatisfied per-requirement entry must carry an unmatchedReason from the closed vocabulary (requirement ${entry.requirementId})`,
          details: { requirementId: entry.requirementId, known: [...UNMATCHED_REASONS] },
        });
      }
      if (entry.evidenceDigests.length > 0 || entry.matchedProficiency !== undefined || entry.claimDigest !== undefined || entry.recordDigest !== undefined) {
        throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
          message: `an unsatisfied per-requirement entry carries no match evidence (requirement ${entry.requirementId})`,
          details: { requirementId: entry.requirementId },
        });
      }
      return Object.freeze({
        requirementId: entry.requirementId,
        satisfied: false,
        evidenceDigests,
        unmatchedReason: entry.unmatchedReason,
      }) satisfies PerRequirementEntry;
    });

    const satisfiedCount = perRequirement.filter((entry) => entry.satisfied).length;
    if (satisfiedCount !== candidateInput.satisfiedCount) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
        message: `candidate ${candidateInput.expertId}: satisfiedCount ${candidateInput.satisfiedCount} does not match the per-requirement entries (${satisfiedCount} satisfied)`,
        details: { expertId: candidateInput.expertId },
      });
    }
    const satisfiedAll = perRequirement.every((entry) => entry.satisfied);
    if (satisfiedAll !== candidateInput.satisfiedAll) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
        message: `candidate ${candidateInput.expertId}: satisfiedAll ${String(candidateInput.satisfiedAll)} does not match the per-requirement entries`,
        details: { expertId: candidateInput.expertId },
      });
    }
    const distinctEvidence = new Set(
      perRequirement
        .filter((entry) => entry.satisfied)
        .flatMap((entry) => [...entry.evidenceDigests]),
    );
    if (distinctEvidence.size !== candidateInput.evidenceCount) {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
        message: `candidate ${candidateInput.expertId}: evidenceCount ${candidateInput.evidenceCount} does not match the distinct qualifying evidence digests (${distinctEvidence.size})`,
        details: { expertId: candidateInput.expertId },
      });
    }
    return Object.freeze({
      expertId,
      tenant,
      satisfiedAll,
      satisfiedCount,
      evidenceCount: candidateInput.evidenceCount,
      perRequirement: Object.freeze(perRequirement),
    }) satisfies MatchCandidate;
  });
  const truncated = record['truncated'];
  if (typeof truncated !== 'boolean') {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
      message: 'match result truncated must be a boolean',
    });
  }
  const requirementsUnmet = Array.isArray(record['requirementsUnmet'])
    ? (record['requirementsUnmet'] as readonly string[])
    : [];
  if (!requirementsUnmet.every((id) => typeof id === 'string' && id.length > 0)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
      message: 'match result requirementsUnmet must be a list of requirement ids',
    });
  }

  const frozenView: MatchResultView = {
    resultVersion: MATCH_RESULT_VERSION,
    requestDigest,
    matchingPolicyDigest,
    evaluatedAt,
    candidates: Object.freeze(candidates),
    requirementsUnmet: Object.freeze([...requirementsUnmet]),
    truncated,
  };

  const digest = toContentDigest(
    await digestCanonical(frozenView),
    'match result digest',
  );
  return deepFreeze({ ...frozenView, digest }) as MatchResult;
}

/** The digest-free view of a result (what the digest commits to). */
export function matchResultView(result: MatchResult): MatchResultView {
  const { digest: _digest, ...view } = result;
  return deepFreeze({ ...view }) as MatchResultView;
}

/**
 * Recompute the result digest over the digest-free view and compare.
 * Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeMatchResultDigest(
  result: MatchResult,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isMatchResult(result)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
      message: 'result digest recomputation requires a structurally valid match result',
    });
  }
  const actual = await digestCanonical(matchResultView(result));
  if (actual !== result.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `match result digest mismatch: expected ${expectedDigest ?? result.digest}, got ${actual}`,
      details: {
        requestDigest: result.requestDigest,
        candidateCount: result.candidates.length,
        expected: expectedDigest ?? result.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed result digest');
}

/**
 * Replay an unknown value as a MatchResult (strict shape + digest
 * verification) — the wire path.
 */
export async function replayMatchResult(value: unknown): Promise<MatchResult> {
  if (!isMatchResult(value)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_RESULT, {
      message: 'match result replay requires a structurally valid match result',
    });
  }
  const candidate = value as MatchResult;
  await recomputeMatchResultDigest(candidate);
  return candidate;
}
