/**
 * Shared test fixtures for @arena/expert-matching-fabric (NOT part of the
 * public surface — hygiene.test.ts asserts it is not exported).
 *
 * Everything deterministic: fixed timestamps, a seeded LCG, real
 * content-addressed @arena/expert-qualification objects.
 */

import {
  createCompetencyClaim,
  createMatchRequest,
  createMatchingPolicy,
  createQualifiedExpertCard,
  createQualificationPolicy,
  evaluateCompetencyClaim,
} from '@arena/expert-qualification';
import type {
  CompetencyClaim,
  MatchRequest,
  MatchingPolicy,
  QualificationPolicy,
  QualificationRecord,
  QualifiedExpertCard,
} from '@arena/expert-qualification';

export const T0 = '2026-01-15T09:30:00.000Z';
export const T_FRESH = '2026-01-10T09:30:00.000Z';
export const CORR_A = 'corr-matching-0001';
export const IDEM_A = 'idem-matching-0001';
export const IDEM_B = 'idem-matching-0002';

/** Digest-shaped constants for capability node refs. */
export const NODE_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
export const NODE_B =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const NODE_C =
  '3333333333333333333333333333333333333333333333333333333333333333';

export const SKILL_RUST = {
  kind: 'skill',
  id: 'rust-code-review',
  version: '2.1.0',
  digest: NODE_A,
} as const;

export const SKILL_SCENARIO = {
  kind: 'skill',
  id: 'scenario-modeling',
  version: '1.3.0',
  digest: NODE_B,
} as const;

export const DOMAIN_SOFTWARE = {
  kind: 'domain',
  id: 'software-engineering',
  version: '1.0.0',
  digest: NODE_C,
} as const;

/** Deterministic seeded LCG (Numerical Recipes constants). */
export class TestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  int(bound: number): number {
    if (bound <= 0) return 0;
    return Math.floor(this.next() * bound);
  }
}

/** A legal expert card. */
export async function makeCard(
  overrides: {
    expertId?: string;
    tenant?: string;
    withDomain?: boolean;
    withJurisdiction?: boolean;
    withAvailability?: boolean;
  } = {},
): Promise<QualifiedExpertCard> {
  return createQualifiedExpertCard({
    expertId: overrides.expertId ?? 'expert-ada',
    tenant: overrides.tenant ?? 'tenant-alpha',
    ...(overrides.withDomain === false ? {} : { domainRefs: [DOMAIN_SOFTWARE] }),
    ...(overrides.withJurisdiction === false ? {} : { jurisdictions: [{ country: 'US' }] }),
    ...(overrides.withAvailability === false
      ? {}
      : { availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }] }),
  });
}

/** A legal qualification policy (2 fresh work products + 1 passing verification). */
export async function makePolicy(
  overrides: { freshnessWindowDays?: number; validityWindowDays?: number } = {},
): Promise<QualificationPolicy> {
  return createQualificationPolicy({
    policyId: 'policy-rust-review',
    version: '1.4.0',
    description: 'Two fresh work products plus one passing verification record',
    requirements: [
      { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
      { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: overrides.freshnessWindowDays ?? 30,
    validityWindowDays: overrides.validityWindowDays ?? 180,
    conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'fail' }],
  });
}

/** A legal matching policy. */
export async function makeMatchingPolicy(
  overrides: {
    maxCandidates?: number;
    includePartialMatches?: boolean;
    availabilityRequired?: boolean;
  } = {},
): Promise<MatchingPolicy> {
  return createMatchingPolicy({
    policyId: 'policy-match-standard',
    version: '1.2.0',
    description: 'Standard deterministic matching with digest tie-breaks',
    maxCandidates: overrides.maxCandidates ?? 10,
    includePartialMatches: overrides.includePartialMatches ?? false,
    availabilityRequired: overrides.availabilityRequired ?? false,
  });
}

/** A legal match request. */
export async function makeRequest(
  overrides: {
    tenant?: string;
    minimumProficiency?: string;
    evaluatedAt?: string;
    domain?: { kind: string; id: string; version: string; digest: string } | null;
    jurisdictions?: { country: string; region?: string }[] | null;
    availabilityWindow?: { from: string; until: string } | null;
  } = {},
): Promise<MatchRequest> {
  return createMatchRequest({
    tenant: overrides.tenant ?? 'tenant-alpha',
    requirements: [
      {
        requirementId: 'req-rust',
        capability: SKILL_RUST,
        minimumProficiency: overrides.minimumProficiency ?? 'proficient',
      },
    ],
    evaluatedAt: overrides.evaluatedAt ?? T0,
    ...(overrides.domain === null || overrides.domain === undefined
      ? {}
      : { domainRef: overrides.domain }),
    ...(overrides.jurisdictions === null || overrides.jurisdictions === undefined
      ? {}
      : { jurisdictions: overrides.jurisdictions }),
    ...(overrides.availabilityWindow === null || overrides.availabilityWindow === undefined
      ? {}
      : { availabilityWindow: overrides.availabilityWindow }),
  });
}

/**
 * A fully-qualified scenario for one expert: card + evidence (2 work
 * products + 1 passing verification) + claim + a QUALIFIED record
 * computed by the real engine at T0.
 */
export async function makeQualifiedScenario(
  overrides: {
    expertId?: string;
    tenant?: string;
    proficiency?: string;
    evaluatedAt?: string;
    withDomain?: boolean;
    withJurisdiction?: boolean;
    withAvailability?: boolean;
  } = {},
): Promise<{
  card: QualifiedExpertCard;
  evidence: import('@arena/expert-qualification').QualificationEvidence[];
  claim: CompetencyClaim;
  policy: QualificationPolicy;
  record: QualificationRecord;
}> {
  const { createQualificationEvidence } = await import('@arena/expert-qualification');
  const work1 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: T_FRESH,
    workProduct: {
      digest: '4444444444444444444444444444444444444444444444444444444444444444',
      description: 'reviewed pull request with verification notes',
    },
  });
  const work2 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: T_FRESH,
    workProduct: {
      digest: '5555555555555555555555555555555555555555555555555555555555555555',
      description: 'reviewed pull request with follow-up fixes',
    },
  });
  const verification = await createQualificationEvidence({
    kind: 'verification-ref',
    observedAt: T_FRESH,
    verification: {
      recordDigest: '6666666666666666666666666666666666666666666666666666666666666666',
      outcome: 'pass',
    },
  });
  const card = await makeCard({
    ...(overrides.expertId !== undefined ? { expertId: overrides.expertId } : {}),
    ...(overrides.tenant !== undefined ? { tenant: overrides.tenant } : {}),
    ...(overrides.withDomain !== undefined ? { withDomain: overrides.withDomain } : {}),
    ...(overrides.withJurisdiction !== undefined
      ? { withJurisdiction: overrides.withJurisdiction }
      : {}),
    ...(overrides.withAvailability !== undefined
      ? { withAvailability: overrides.withAvailability }
      : {}),
  });
  const claim = await createCompetencyClaim({
    expertId: overrides.expertId ?? 'expert-ada',
    tenant: overrides.tenant ?? 'tenant-alpha',
    capability: SKILL_RUST,
    proficiency: overrides.proficiency ?? 'proficient',
    evidence: [work1.digest, work2.digest, verification.digest],
    declaredAt: T_FRESH,
  });
  const policy = await makePolicy();
  const record = await evaluateCompetencyClaim({
    claim,
    policy,
    evidence: [work1, work2, verification],
    evaluatedAt: overrides.evaluatedAt ?? T0,
  });
  return { card, evidence: [work1, work2, verification], claim, policy, record };
}
