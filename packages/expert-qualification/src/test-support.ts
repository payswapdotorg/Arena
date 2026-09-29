/**
 * Shared test fixtures for @arena/expert-qualification (NOT part of the
 * public surface — hygiene.test.ts asserts it is not exported).
 *
 * Everything is deterministic: fixed timestamps, fixed digests, a seeded
 * LCG (Numerical Recipes constants, mirroring A011/A012/A013) — no
 * Math.random, no wall-clock reads.
 */

export const DIGEST_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C =
  '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D =
  '4444444444444444444444444444444444444444444444444444444444444444';
export const DIGEST_E =
  '5555555555555555555555555555555555555555555555555555555555555555';
export const DIGEST_F =
  '6666666666666666666666666666666666666666666666666666666666666666';

export const T0 = '2026-01-15T09:30:00.000Z';
export const T1 = '2026-01-15T09:30:01.000Z';
export const T2 = '2026-01-15T09:30:02.000Z';
export const T3 = '2026-01-15T09:30:03.000Z';
export const T4 = '2026-01-15T09:30:04.000Z';
export const T5 = '2026-01-15T09:30:05.000Z';
export const T6 = '2026-01-15T09:30:06.000Z';
export const T7 = '2026-01-15T09:30:07.000Z';

/** Freshness: observed 5 days before T0 (within a 30-day window). */
export const T_FRESH = '2026-01-10T09:30:00.000Z';
/** Staleness: observed 400 days before T0 (outside a 30-day window). */
export const T_STALE = '2024-12-11T09:30:00.000Z';

export const CORR_A = 'corr-qualification-0001';
export const IDEM_A = 'idem-qualification-0001';

/** A capability-node ref (capability-graph shaped, A006 view). */
export const SKILL_RUST_REVIEW = {
  kind: 'skill',
  id: 'rust-code-review',
  version: '2.1.0',
  digest: DIGEST_A,
} as const;

/** A second capability-node ref. */
export const SKILL_SCENARIO_MODELING = {
  kind: 'skill',
  id: 'scenario-modeling',
  version: '1.3.0',
  digest: DIGEST_B,
} as const;

/** A domain-node ref. */
export const DOMAIN_SOFTWARE = {
  kind: 'domain',
  id: 'software-engineering',
  version: '1.0.0',
  digest: DIGEST_C,
} as const;

/** Deterministic seeded LCG (Numerical Recipes constants). */
export class TestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 4294967296;
  }

  /** Next integer in [0, bound). */
  int(bound: number): number {
    if (bound <= 0) return 0;
    return Math.floor(this.next() * bound);
  }
}

// ---------------------------------------------------------------------------
// Evidence fixtures (real content-addressed records)
// ---------------------------------------------------------------------------

import { createQualificationEvidence } from './evidence.js';
import type { QualificationEvidence } from './evidence.js';

export interface EvidenceOverrides {
  readonly kind?: 'credential-ref' | 'work-product-ref' | 'verification-ref' | 'evaluation-ref';
  readonly observedAt?: string;
  readonly supersedes?: string;
  readonly note?: string;
}

/** A legal credential-ref evidence record. */
export async function makeCredentialEvidence(
  overrides: EvidenceOverrides = {},
): Promise<QualificationEvidence> {
  return createQualificationEvidence({
    kind: 'credential-ref',
    observedAt: overrides.observedAt ?? T_FRESH,
    credential: {
      kind: 'certification',
      reference: 'cert-rust-2026-0142',
      issuer: 'Open Certification Board',
    },
    ...(overrides.supersedes !== undefined ? { supersedes: overrides.supersedes } : {}),
    ...(overrides.note !== undefined ? { note: overrides.note } : {}),
  });
}

/** A legal work-product-ref evidence record. */
export async function makeWorkProductEvidence(
  index: number,
  overrides: EvidenceOverrides = {},
): Promise<QualificationEvidence> {
  return createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt: overrides.observedAt ?? T_FRESH,
    workProduct: {
      digest: DIGEST_D,
      description: `reference work product ${index}: reviewed pull request with verification notes`,
    },
    ...(overrides.supersedes !== undefined ? { supersedes: overrides.supersedes } : {}),
  });
}

/** A legal verification-ref evidence record (A013 record ref + derived outcome). */
export async function makeVerificationEvidence(
  outcome: 'pass' | 'fail' | 'unknown',
  overrides: EvidenceOverrides = {},
): Promise<QualificationEvidence> {
  return createQualificationEvidence({
    kind: 'verification-ref',
    observedAt: overrides.observedAt ?? T_FRESH,
    verification: { recordDigest: DIGEST_E, outcome },
    ...(overrides.supersedes !== undefined ? { supersedes: overrides.supersedes } : {}),
  });
}

/** A legal evaluation-ref evidence record (A012 record ref). */
export async function makeEvaluationEvidence(
  overrides: EvidenceOverrides = {},
): Promise<QualificationEvidence> {
  return createQualificationEvidence({
    kind: 'evaluation-ref',
    observedAt: overrides.observedAt ?? T_FRESH,
    evaluation: { recordDigest: DIGEST_F },
    ...(overrides.supersedes !== undefined ? { supersedes: overrides.supersedes } : {}),
  });
}

// ---------------------------------------------------------------------------
// Claim / policy fixtures
// ---------------------------------------------------------------------------

import { createCompetencyClaim } from './claim.js';
import type { CompetencyClaim } from './claim.js';
import { createQualificationPolicy } from './policy.js';
import type { QualificationPolicy } from './policy.js';
import { createMatchingPolicy } from './matching-policy.js';
import type { MatchingPolicy } from './matching-policy.js';
import { createQualifiedExpertCard } from './qualified-expert.js';
import type { QualifiedExpertCard } from './qualified-expert.js';

export interface ClaimOverrides {
  readonly expertId?: string;
  readonly tenant?: string;
  readonly proficiency?: string;
  readonly declaredAt?: string;
  readonly supersedes?: string;
}

/** A legal competency claim backed by the given evidence digests. */
export async function makeClaim(
  evidenceDigests: readonly string[],
  overrides: ClaimOverrides = {},
): Promise<CompetencyClaim> {
  return createCompetencyClaim({
    expertId: overrides.expertId ?? 'expert-ada',
    tenant: overrides.tenant ?? 'tenant-alpha',
    capability: SKILL_RUST_REVIEW,
    proficiency: overrides.proficiency ?? 'proficient',
    evidence: evidenceDigests,
    declaredAt: overrides.declaredAt ?? T0,
    ...(overrides.supersedes !== undefined ? { supersedes: overrides.supersedes } : {}),
  });
}

export interface PolicyOverrides {
  readonly freshnessWindowDays?: number;
  readonly validityWindowDays?: number;
  readonly minimumCount?: number;
}

/** A legal qualification policy: 2 fresh work products, 1 verification pass. */
export async function makeQualificationPolicy(
  overrides: PolicyOverrides = {},
): Promise<QualificationPolicy> {
  return createQualificationPolicy({
    policyId: 'policy-rust-review',
    version: '1.4.0',
    description:
      'Qualifies rust-code-review competency claims: two fresh work products plus one passing verification record, valid for 180 days',
    requirements: [
      { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: overrides.minimumCount ?? 2 },
      { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: overrides.freshnessWindowDays ?? 30,
    validityWindowDays: overrides.validityWindowDays ?? 180,
    conflictEvidence: [
      { evidenceKind: 'verification-ref', outcome: 'fail' },
      { evidenceKind: 'credential-ref', outcome: null },
    ],
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
    description:
      'Standard deterministic matching: rank by satisfied requirements, evidence depth, then content-digest tie-break',
    maxCandidates: overrides.maxCandidates ?? 10,
    includePartialMatches: overrides.includePartialMatches ?? false,
    availabilityRequired: overrides.availabilityRequired ?? false,
  });
}

export interface CardOverrides {
  readonly expertId?: string;
  readonly tenant?: string;
  readonly withDomain?: boolean;
  readonly withJurisdiction?: boolean;
  readonly withAvailability?: boolean;
}

/** A legal qualified-expert card. */
export async function makeExpertCard(
  overrides: CardOverrides = {},
): Promise<QualifiedExpertCard> {
  return createQualifiedExpertCard({
    expertId: overrides.expertId ?? 'expert-ada',
    tenant: overrides.tenant ?? 'tenant-alpha',
    ...(overrides.withDomain === false
      ? {}
      : { domainRefs: [DOMAIN_SOFTWARE] }),
    ...(overrides.withJurisdiction === false
      ? {}
      : { jurisdictions: [{ country: 'US' }] }),
    ...(overrides.withAvailability === false
      ? {}
      : {
          availability: [
            { recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' },
          ],
        }),
  });
}
