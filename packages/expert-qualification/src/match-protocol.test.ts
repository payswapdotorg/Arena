/**
 * Matching data-contract tests (Work Order A007 §3.6-3.7) — MatchRequest,
 * MatchingPolicy, QualifiedExpertCard and MatchResult guards, content
 * addressing, negative inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  MATCH_REQUEST_FIELDS,
  MATCH_REQUEST_VERSION,
  createMatchRequest,
  isMatchRequest,
  matchRequestView,
  recomputeMatchRequestDigest,
} from './match-request.js';
import {
  MATCHING_POLICY_FIELDS,
  createMatchingPolicy,
  isMatchingPolicy,
  matchingPolicyIdentityKey,
  recomputeMatchingPolicyDigest,
} from './matching-policy.js';
import {
  QUALIFIED_EXPERT_FIELDS,
  createQualifiedExpertCard,
  isQualifiedExpertCard,
  qualifiedExpertCardIdentityKey,
  recomputeQualifiedExpertCardDigest,
} from './qualified-expert.js';
import {
  MATCH_RESULT_VERSION,
  UNMATCHED_REASONS,
  createMatchResult,
  isMatchCandidate,
  isMatchResult,
  isPerRequirementEntry,
  matchResultView,
  recomputeMatchResultDigest,
  replayMatchResult,
} from './match-result.js';
import { ExpertQualificationError } from './errors.js';
import { toContentDigest } from './shared.js';
import {
  DIGEST_A,
  DOMAIN_SOFTWARE,
  SKILL_RUST_REVIEW,
  T0,
  T2,
  makeExpertCard,
  makeMatchingPolicy,
} from './test-support.js';

const REQUEST_BASE = {
  tenant: 'tenant-alpha',
  requirements: [
    {
      requirementId: 'req-rust',
      capability: SKILL_RUST_REVIEW,
      minimumProficiency: 'proficient',
    },
  ],
  evaluatedAt: T0,
};

describe('MatchRequest', () => {
  it('creates a content-addressed, deep-frozen request', async () => {
    const request = await createMatchRequest(REQUEST_BASE);
    expect(request.tenant).toBe('tenant-alpha');
    expect(request.requirements).toHaveLength(1);
    expect(request.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(request)).toBe(true);
    expect(isMatchRequest(request)).toBe(true);
    expect(matchRequestView(request).requestVersion).toBe(MATCH_REQUEST_VERSION);
    await expect(recomputeMatchRequestDigest(request, request.digest)).resolves.toBe(
      request.digest,
    );
  });

  it('accepts optional domain/jurisdictions/availability window', async () => {
    const request = await createMatchRequest({
      ...REQUEST_BASE,
      domainRef: DOMAIN_SOFTWARE,
      jurisdictions: [{ country: 'US' }, { country: 'GH' }],
      availabilityWindow: { from: T0, until: T2 },
    });
    expect(request.domainRef?.kind).toBe('domain');
    expect(request.jurisdictions).toHaveLength(2);
    expect(request.availabilityWindow?.until).toBe(T2);
  });

  it('determinism + tamper detection', async () => {
    const a = await createMatchRequest(REQUEST_BASE);
    const b = await createMatchRequest({ ...REQUEST_BASE, requirements: [...REQUEST_BASE.requirements] });
    expect(a.digest).toBe(b.digest);
    const tampered = { ...a, tenant: 'tenant-beta' } as typeof a;
    await expect(recomputeMatchRequestDigest(tampered)).rejects.toThrow(/digest mismatch/);
  });

  it('negative inputs: empty/duplicate requirements, bad kinds, inverted windows', async () => {
    await expect(createMatchRequest({ ...REQUEST_BASE, requirements: [] })).rejects.toThrow(
      /at least one competency requirement/,
    );
    await expect(
      createMatchRequest({
        ...REQUEST_BASE,
        requirements: [
          ...REQUEST_BASE.requirements,
          { requirementId: 'req-rust', capability: SKILL_RUST_REVIEW, minimumProficiency: 'working' },
        ],
      }),
    ).rejects.toThrow(/duplicate match requirement id/);
    await expect(
      createMatchRequest({
        ...REQUEST_BASE,
        requirements: [
          {
            requirementId: 'req-domain',
            capability: DOMAIN_SOFTWARE,
            minimumProficiency: 'working',
          },
        ],
      }),
    ).rejects.toThrow(/is not allowed here/);
    await expect(
      createMatchRequest({
        ...REQUEST_BASE,
        availabilityWindow: { from: T2, until: T0 },
      }),
    ).rejects.toThrow(/window is empty/);
    await expect(
      createMatchRequest({
        ...REQUEST_BASE,
        domainRef: { ...DOMAIN_SOFTWARE, kind: 'skill' },
      }),
    ).rejects.toThrow(/is not allowed here/);
    await expect(
      createMatchRequest({ ...REQUEST_BASE, score: 1 } as never),
    ).rejects.toThrow(/unknown field/);
    expect([...MATCH_REQUEST_FIELDS]).toContain('availabilityWindow');
  });
});

describe('MatchingPolicy', () => {
  it('creates a content-addressed policy and identity key', async () => {
    const policy = await makeMatchingPolicy();
    expect(policy.maxCandidates).toBe(10);
    expect(policy.includePartialMatches).toBe(false);
    expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isMatchingPolicy(policy)).toBe(true);
    expect(matchingPolicyIdentityKey(policy)).toBe('policy-match-standard@1.2.0');
    await expect(recomputeMatchingPolicyDigest(policy, policy.digest)).resolves.toBe(policy.digest);
  });

  it('negative inputs: non-positive caps, wrong types, unknown fields', async () => {
    await expect(createMatchingPolicy({
      policyId: 'p',
      version: '1.0.0',
      description: 'd',
      maxCandidates: 0,
      includePartialMatches: false,
      availabilityRequired: false,
    })).rejects.toThrow(/maxCandidates must be a positive integer/);
    await expect(createMatchingPolicy({
      policyId: 'p',
      version: '1.0.0',
      description: 'd',
      maxCandidates: 5,
      includePartialMatches: 'yes',
      availabilityRequired: false,
    } as never)).rejects.toThrow(/boolean/);
    await expect(createMatchingPolicy({
      policyId: 'p',
      version: '1.0.0',
      description: 'd',
      maxCandidates: 5,
      includePartialMatches: false,
      availabilityRequired: false,
      reputation: true,
    } as never)).rejects.toThrow(/unknown field/);
    expect([...MATCHING_POLICY_FIELDS]).toContain('includePartialMatches');
  });
});

describe('QualifiedExpertCard', () => {
  it('creates a content-addressed card with scope metadata', async () => {
    const card = await makeExpertCard();
    expect(card.expertId).toBe('expert-ada');
    expect(card.tenant).toBe('tenant-alpha');
    expect(card.domainRefs[0]?.id).toBe('software-engineering');
    expect(card.jurisdictions[0]?.country).toBe('US');
    expect(card.availability[0]?.startUtc).toBe('08:00');
    expect(card.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isQualifiedExpertCard(card)).toBe(true);
    expect(qualifiedExpertCardIdentityKey(card)).toBe('expert-ada@tenant-alpha');
    await expect(recomputeQualifiedExpertCardDigest(card, card.digest)).resolves.toBe(card.digest);
  });

  it('negative inputs: non-domain refs, bad jurisdictions', async () => {
    await expect(
      createQualifiedExpertCard({
        expertId: 'expert-ada',
        tenant: 'tenant-alpha',
        domainRefs: [SKILL_RUST_REVIEW as never],
      }),
    ).rejects.toThrow(/is not allowed here/);
    await expect(
      createQualifiedExpertCard({
        expertId: 'expert-ada',
        tenant: 'tenant-alpha',
        jurisdictions: [{ country: 'zz' }],
      }),
    ).rejects.toThrow(ExpertQualificationError);
    expect([...QUALIFIED_EXPERT_FIELDS]).toContain('availability');
  });
});

describe('MatchResult', () => {
  const digestOf = (hex: string) => toContentDigest(hex, 'test digest');

  function candidateEntry(satisfied: boolean, overrides: Record<string, unknown> = {}) {
    return {
      requirementId: 'req-rust',
      satisfied,
      ...(satisfied
        ? {
            matchedProficiency: 'proficient',
            claimDigest: digestOf(DIGEST_A),
            recordDigest: digestOf(DIGEST_A),
            evidenceDigests: [digestOf(DIGEST_A)],
          }
        : { unmatchedReason: 'no-competency-claim' as const, evidenceDigests: [] }),
      ...overrides,
    };
  }

  it('creates a consistent, content-addressed result', async () => {
    const result = await createMatchResult({
      requestDigest: digestOf(DIGEST_A),
      matchingPolicyDigest: digestOf(DIGEST_A),
      evaluatedAt: T0,
      candidates: [
        {
          expertId: 'expert-ada',
          tenant: 'tenant-alpha',
          satisfiedAll: true,
          satisfiedCount: 1,
          evidenceCount: 1,
          perRequirement: [candidateEntry(true)],
        },
      ],
      requirementsUnmet: [],
      truncated: false,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.resultVersion).toBe(MATCH_RESULT_VERSION);
    expect(isMatchResult(result)).toBe(true);
    expect(matchResultView(result).truncated).toBe(false);
    await expect(recomputeMatchResultDigest(result, result.digest)).resolves.toBe(result.digest);
    await expect(replayMatchResult(result)).resolves.toBe(result);
  });

  it('internal consistency is enforced (no silent counter drift)', async () => {
    await expect(
      createMatchResult({
        requestDigest: digestOf(DIGEST_A),
        matchingPolicyDigest: digestOf(DIGEST_A),
        evaluatedAt: T0,
        candidates: [
          {
            expertId: 'expert-ada',
            tenant: 'tenant-alpha',
            satisfiedAll: false,
            satisfiedCount: 1, // inconsistent: entry is satisfied
            evidenceCount: 1,
            perRequirement: [candidateEntry(true)],
          },
        ],
        requirementsUnmet: [],
        truncated: false,
      }),
    ).rejects.toThrow(/does not match the per-requirement entries/);
    await expect(
      createMatchResult({
        requestDigest: digestOf(DIGEST_A),
        matchingPolicyDigest: digestOf(DIGEST_A),
        evaluatedAt: T0,
        candidates: [
          {
            expertId: 'expert-ada',
            tenant: 'tenant-alpha',
            satisfiedAll: true,
            satisfiedCount: 1,
            evidenceCount: 2, // inconsistent: only 1 distinct digest
            perRequirement: [candidateEntry(true)],
          },
        ],
        requirementsUnmet: [],
        truncated: false,
      }),
    ).rejects.toThrow(/evidenceCount 2 does not match/);
  });

  it('per-requirement entries are XOR: evidence OR reason, never both/none', () => {
    expect(isPerRequirementEntry(candidateEntry(true))).toBe(true);
    expect(isPerRequirementEntry(candidateEntry(false))).toBe(true);
    expect(
      isPerRequirementEntry({
        requirementId: 'req-rust',
        satisfied: true,
        evidenceDigests: [],
        // satisfied but no claim digest
      }),
    ).toBe(false);
    expect(
      isPerRequirementEntry({
        requirementId: 'req-rust',
        satisfied: false,
        unmatchedReason: 'made-up-reason',
        evidenceDigests: [],
      }),
    ).toBe(false);
    // satisfied entry carrying a reason is rejected
    expect(
      isPerRequirementEntry({
        ...candidateEntry(true),
        unmatchedReason: 'no-competency-claim',
      }),
    ).toBe(false);
  });

  it('isMatchCandidate rejects malformed entries', () => {
    expect(
      isMatchCandidate({
        expertId: 'expert-ada',
        tenant: 'tenant-alpha',
        satisfiedAll: true,
        satisfiedCount: 1,
        evidenceCount: 1,
        perRequirement: [candidateEntry(true)],
      }),
    ).toBe(true);
    expect(
      isMatchCandidate({
        expertId: 'expert-ada',
        tenant: 'tenant-alpha',
        satisfiedAll: true,
        satisfiedCount: 1,
        evidenceCount: 1,
        perRequirement: [], // empty
      }),
    ).toBe(false);
  });

  it('the unmatched-reason vocabulary is closed', () => {
    expect([...UNMATCHED_REASONS]).toContain('no-competency-claim');
    expect([...UNMATCHED_REASONS]).toContain('availability-conflict');
    expect([...UNMATCHED_REASONS]).toHaveLength(10);
  });

  it('tampered results fail replay', async () => {
    const result = await createMatchResult({
      requestDigest: digestOf(DIGEST_A),
      matchingPolicyDigest: digestOf(DIGEST_A),
      evaluatedAt: T0,
      candidates: [],
      requirementsUnmet: ['req-rust'],
      truncated: false,
    });
    await expect(replayMatchResult({ ...result, truncated: true })).rejects.toThrow(
      ExpertQualificationError,
    );
  });
});
