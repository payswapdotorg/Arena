/**
 * MatchingPolicy — the versioned, content-addressed rules of the matching
 * fabric (Work Order A007; requirement R8; spec/quality-model.md: do not
 * collapse expert quality into a single global score).
 *
 * A matching policy is PURE DATA describing HOW a deterministic matcher
 * projects a qualified-expert set into a ranked candidate list:
 *   - `maxCandidates` — the result cap (positive integer);
 *   - `includePartialMatches` — whether experts satisfying only SOME
 *     requirements appear in the result (with explicit per-requirement
 *     unmatched reasons). FULL matches are always included;
 *   - `availabilityRequired` — when true and the request carries an
 *     availability window, only experts with an intersecting availability
 *     window can match (fail closed); when false, availability is
 *     informational and never blocks.
 *
 * The RANKING is fixed, deterministic and declared in the contract (never
 * a policy input, so no policy can smuggle a hidden ordering):
 *   1. fully-satisfying candidates before partial candidates;
 *   2. more satisfied requirements first;
 *   3. more distinct qualifying evidence digests first (evidence depth);
 *   4. tie-break by content digest — the candidate's sorted matched claim
 *      digests, lexicographically ascending, then the expert id — so two
 *      indistinguishable candidates order deterministically by content
 *      address, never by registration order or hidden state.
 *
 * There is NO aggregate quality score and NO reputation input anywhere in
 * the matching protocol — per-requirement evidence only (the hygiene
 * suite enforces the vocabulary separation).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_QUALIFICATION_ERROR_CODES, ExpertQualificationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectPositiveInteger,
  isContentDigest,
  isExpertQualificationId,
  isExpertQualificationVersion,
  isNeutralText,
  toContentDigest,
  toExpertQualificationId,
  toExpertQualificationVersion,
  toNeutralText,
} from './shared.js';
import type {
  ContentDigest,
  ExpertQualificationId,
  ExpertQualificationVersion,
  NeutralText,
} from './shared.js';

/** Wire version of the matching-policy record shape. */
export const MATCHING_POLICY_VERSION = 1 as const;

/** Stable field list for the matching policy (tests + contracts mirror it). */
export const MATCHING_POLICY_FIELDS = Object.freeze([
  'policyVersion',
  'policyId',
  'version',
  'description',
  'maxCandidates',
  'includePartialMatches',
  'availabilityRequired',
  'digest',
] as const) as readonly string[];

/** The digest-free view — exactly what the policy digest commits to. */
export interface MatchingPolicyView {
  readonly policyVersion: typeof MATCHING_POLICY_VERSION;
  readonly policyId: ExpertQualificationId;
  readonly version: ExpertQualificationVersion;
  readonly description: NeutralText;
  readonly maxCandidates: number;
  readonly includePartialMatches: boolean;
  readonly availabilityRequired: boolean;
}

/** A frozen, content-addressed matching policy: view + digest. */
export interface MatchingPolicy extends MatchingPolicyView {
  readonly digest: ContentDigest;
}

export interface CreateMatchingPolicyInput {
  readonly policyId: string;
  readonly version: string;
  readonly description: string;
  readonly maxCandidates: number;
  readonly includePartialMatches: boolean;
  readonly availabilityRequired: boolean;
}

/** Structural (non-throwing) check for the digest-free view. */
export function isMatchingPolicyView(value: unknown): value is MatchingPolicyView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['policyVersion'] === MATCHING_POLICY_VERSION &&
    isExpertQualificationId(candidate['policyId']) &&
    isExpertQualificationVersion(candidate['version']) &&
    isNeutralText(candidate['description']) &&
    typeof candidate['maxCandidates'] === 'number' &&
    Number.isInteger(candidate['maxCandidates']) &&
    candidate['maxCandidates'] > 0 &&
    typeof candidate['includePartialMatches'] === 'boolean' &&
    typeof candidate['availabilityRequired'] === 'boolean'
  );
}

/** Structural (non-throwing) check for the full policy (view + digest). */
export function isMatchingPolicy(value: unknown): value is MatchingPolicy {
  if (!isMatchingPolicyView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

/**
 * Create a validated, deep-frozen, content-addressed matching policy.
 * Rejects non-positive caps, malformed ids/versions/descriptions and
 * unknown fields — typed errors throughout.
 */
export async function createMatchingPolicy(
  input: CreateMatchingPolicyInput,
): Promise<MatchingPolicy> {
  const record = expectFields(
    input,
    [
      'policyId',
      'version',
      'description',
      'maxCandidates',
      'includePartialMatches',
      'availabilityRequired',
    ],
    [],
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_MATCHING_POLICY,
    'matching policy',
  );

  const policyId = toExpertQualificationId(
    typeof record['policyId'] === 'string' ? record['policyId'] : '',
    'matching policy policyId',
  );
  const version = toExpertQualificationVersion(
    typeof record['version'] === 'string' ? record['version'] : '',
    'matching policy version',
  );
  const description = toNeutralText(
    typeof record['description'] === 'string' ? record['description'] : '',
    'matching policy description',
  );
  const maxCandidates = expectPositiveInteger(
    record['maxCandidates'],
    'maxCandidates',
    EXPERT_QUALIFICATION_ERROR_CODES.INVALID_MATCHING_POLICY,
    'matching policy',
  );
  for (const field of ['includePartialMatches', 'availabilityRequired']) {
    if (typeof record[field] !== 'boolean') {
      throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_MATCHING_POLICY, {
        message: `matching policy: ${field} must be a boolean, got: ${String(record[field])}`,
        details: { field },
      });
    }
  }

  const view: MatchingPolicyView = {
    policyVersion: MATCHING_POLICY_VERSION,
    policyId,
    version,
    description,
    maxCandidates,
    includePartialMatches: record['includePartialMatches'] as boolean,
    availabilityRequired: record['availabilityRequired'] as boolean,
  };

  const digest = toContentDigest(
    await digestCanonical(view),
    'matching policy digest',
  );
  return deepFreeze({ ...view, digest }) as MatchingPolicy;
}

/** The digest-free view of a matching policy (what the digest commits to). */
export function matchingPolicyView(policy: MatchingPolicy): MatchingPolicyView {
  const { digest: _digest, ...view } = policy;
  return deepFreeze({ ...view }) as MatchingPolicyView;
}

/**
 * Recompute the matching-policy digest over the digest-free view and
 * compare. Throws EXPERT_QUALIFICATION_TAMPERED on any mismatch.
 */
export async function recomputeMatchingPolicyDigest(
  policy: MatchingPolicy,
  expectedDigest?: string,
): Promise<ContentDigest> {
  if (!isMatchingPolicy(policy)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.INVALID_MATCHING_POLICY, {
      message: 'policy digest recomputation requires a structurally valid matching policy',
    });
  }
  const actual = await digestCanonical(matchingPolicyView(policy));
  if (actual !== policy.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: `matching policy digest mismatch: expected ${expectedDigest ?? policy.digest}, got ${actual}`,
      details: {
        policyId: policy.policyId,
        version: policy.version,
        expected: expectedDigest ?? policy.digest,
        actual,
      },
    });
  }
  return toContentDigest(actual, 'recomputed matching policy digest');
}

/**
 * The matching-policy identity key — "policyId@version" (duplicate
 * detection in the reference fabric: changing a policy requires a new
 * version).
 */
export function matchingPolicyIdentityKey(policy: MatchingPolicy): string {
  return `${policy.policyId}@${policy.version}`;
}
