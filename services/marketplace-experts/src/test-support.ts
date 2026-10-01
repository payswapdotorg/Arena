/**
 * Deterministic test fixtures for the A031 marketplace suites (internal —
 * NOT exported from the package index).
 *
 * Everything is built through the REAL sibling-package constructors:
 *   - @arena/expert-registry (A006): a published ExpertProfile;
 *   - @arena/expert-qualification (A007): evidence, a qualification
 *     policy, a competency claim, a QUALIFIED record (via the REAL
 *     evaluateCompetencyClaim engine) and a qualified-expert card;
 *   - A023/A024 records enter as structural VIEWS (the cross-protocol
 *     pattern — real records satisfy them structurally).
 *
 * Fixed timestamps + fixed digests ⇒ byte-deterministic fixtures.
 */

import { publishProfile } from '@arena/expert-registry';
import { createExpertProfile } from '@arena/expert-registry';
import type { ExpertProfile } from '@arena/expert-registry';
import {
  createCompetencyClaim,
  createQualificationEvidence,
  createQualificationPolicy,
  createQualifiedExpertCard,
  evaluateCompetencyClaim,
} from '@arena/expert-qualification';
import type {
  CompetencyClaim,
  QualificationEvidence,
  QualificationPolicy,
  QualificationRecord,
  QualifiedExpertCard,
} from '@arena/expert-qualification';
import type {
  CertificationRecordView,
  MarketplaceCertificationRecordStore,
  MarketplaceExpertRecordStore,
  MarketplaceReleaseRecordStore,
  ReleaseRecordView,
} from './shared.js';

/** The fixed timeline (all UTC, all deterministic). */
export const T = Object.freeze({
  observed: '2026-09-01T09:00:00.000Z',
  declared: '2026-09-02T09:00:00.000Z',
  evaluated: '2026-09-03T09:00:00.000Z',
  profilePublished: '2026-09-02T10:00:00.000Z',
  listingDeclared: '2026-09-04T09:00:00.000Z',
  publish: '2026-09-05T09:00:00.000Z',
  offerDeclared: '2026-09-04T10:00:00.000Z',
  offerFrom: '2026-09-04T10:00:00.000Z',
  offerUntil: '2027-09-04T10:00:00.000Z',
  engagementRequested: '2026-09-06T09:00:00.000Z',
  engagementScheduled: '2026-09-07T09:00:00.000Z',
  accept: '2026-09-06T10:00:00.000Z',
  complete: '2026-09-08T09:00:00.000Z',
  review: '2026-09-09T09:00:00.000Z',
  search: '2026-09-10T09:00:00.000Z',
});

export const TENANT = 'tenant-alpha';
export const FOREIGN_TENANT = 'tenant-beta';
export const EXPERT = 'expert-ada';
export const EXPERT_B = 'expert-kwame';
export const CUSTOMER = 'customer-acme';

/** Fixed 64-hex digest fixtures. */
const hex = (seed: string): string =>
  seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '1');
export const D = Object.freeze({
  capability: hex('a1b2c3d4e5'),
  domain: hex('b2c3d4e5f6'),
  work1: hex('1111111111'),
  work2: hex('2222222222'),
  verification: hex('3333333333'),
  attestation: hex('4444444444'),
  evidenceOne: hex('5555555555'),
  release: hex('6666666666'),
  certification: hex('7777777777'),
});

const ACTOR = Object.freeze({ type: 'user', tenant: TENANT, principalId: 'expert-intake' });

/** Build the published A006 expert profile (deterministic). */
export async function fixtureProfile(
  overrides: { expertId?: string; tenant?: string; status?: 'published' | 'draft' } = {},
): Promise<ExpertProfile> {
  const draft = await createExpertProfile({
    identity: {
      tenant: overrides.tenant ?? TENANT,
      expertId: overrides.expertId ?? EXPERT,
    },
    identityRefs: [
      {
        kind: 'identity-attestation',
        digest: D.attestation,
        locator: 'urn:arena:test:attestation:1',
      },
    ],
    version: '1.0.0',
    competencies: [
      {
        capability: {
          kind: 'skill',
          id: 'rust-code-review',
          version: '2.1.0',
          digest: D.capability,
        },
        proficiency: 'proficient',
        proficiencyEvidence: [
          { digest: D.evidenceOne, description: 'Reviewed pull requests with verification notes.' },
        ],
      },
    ],
    qualifications: [
      {
        credential: {
          kind: 'certification',
          reference: 'cert-rv-2026-0142',
          issuer: 'Open Certification Board',
        },
        evidence: [D.evidenceOne],
        status: 'verified',
        validFrom: T.evaluated,
        validUntil: '2027-12-31T09:00:00.000Z',
        jurisdiction: { country: 'US' },
      },
    ],
    evidence: [{ digest: D.evidenceOne, description: 'Reference review work product.' }],
    taskHistory: [],
    reliability: [],
    availability: { windows: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }] },
    domainScope: {
      domains: [
        { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: D.domain },
      ],
      jurisdictions: [{ country: 'US' }],
      limitations: [
        { class: 'professional-scope', statement: 'Advisory code review only.' },
      ],
    },
    privacyPolicy: {
      visibility: {
        identityRefs: 'tenant-internal',
        competencies: 'public',
        qualifications: 'public',
        evidence: 'tenant-internal',
        taskHistory: 'tenant-internal',
        reliability: 'tenant-internal',
        availability: 'public',
        domainScope: 'public',
      },
    },
    declaredBy: ACTOR,
    declaredAt: T.declared,
  });
  if (overrides.status === 'draft') return draft;
  return publishProfile(draft, { at: T.profilePublished, actor: ACTOR });
}

/** The full A007 qualification fixture set for one expert. */
export interface QualificationFixture {
  readonly evidence: readonly QualificationEvidence[];
  readonly policy: QualificationPolicy;
  readonly claim: CompetencyClaim;
  readonly record: QualificationRecord;
  readonly card: QualifiedExpertCard;
}

/**
 * Build the qualification fixture (a QUALIFIED record via the REAL A007
 * engine). `weaken` produces a NOT-QUALIFIED record (single work product
 * against a two-work-product policy); `lapse` evaluates far in the past
 * so the record is out of force at T.publish.
 */
export async function fixtureQualification(
  overrides: {
    expertId?: string;
    tenant?: string;
    weaken?: boolean;
    lapse?: boolean;
  } = {},
): Promise<QualificationFixture> {
  const expertId = overrides.expertId ?? EXPERT;
  const tenant = overrides.tenant ?? TENANT;
  const observedAt = overrides.lapse ? '2025-01-01T09:00:00.000Z' : T.observed;
  const evaluatedAt = overrides.lapse ? '2025-01-02T09:00:00.000Z' : T.evaluated;

  const work1 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt,
    workProduct: { digest: D.work1, description: 'reviewed pull request with notes' },
  });
  const work2 = await createQualificationEvidence({
    kind: 'work-product-ref',
    observedAt,
    workProduct: { digest: D.work2, description: 'reviewed pull request with fixes' },
  });
  const verification = await createQualificationEvidence({
    kind: 'verification-ref',
    observedAt,
    verification: { recordDigest: D.verification, outcome: 'pass' },
  });
  const evidence = overrides.weaken ? [work1, verification] : [work1, work2, verification];

  const policy = await createQualificationPolicy({
    policyId: 'policy-review-qualified',
    version: '1.0.0',
    description: 'Two fresh work products plus one passing verification, valid 180 days',
    requirements: [
      { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
      { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: 30,
    validityWindowDays: 180,
    conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'fail' }],
  });

  const claim = await createCompetencyClaim({
    expertId,
    tenant,
    capability: {
      kind: 'skill',
      id: 'rust-code-review',
      version: '2.1.0',
      digest: D.capability,
    },
    proficiency: 'proficient',
    evidence: evidence.map((entry) => entry.digest),
    declaredAt: overrides.lapse ? '2024-12-31T09:00:00.000Z' : T.declared,
  });

  const record = await evaluateCompetencyClaim({
    claim,
    policy,
    evidence,
    evaluatedAt,
  });

  const card = await createQualifiedExpertCard({
    expertId,
    tenant,
    domainRefs: [
      { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: D.domain },
    ],
    jurisdictions: [{ country: 'US' }],
    availability: [{ recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }],
  });

  return Object.freeze({ evidence, policy, claim, record, card });
}

/** A map-backed expert-record store (the injected A006/A007 surface). */
export class MapExpertRecordStore implements MarketplaceExpertRecordStore {
  private readonly profiles = new Map<string, ExpertProfile>();
  private readonly cards = new Map<string, QualifiedExpertCard>();
  private readonly claims = new Map<string, CompetencyClaim>();
  private readonly records = new Map<string, QualificationRecord>();

  addProfile(profile: ExpertProfile): this {
    this.profiles.set(profile.digest, profile);
    return this;
  }
  addQualification(fixture: QualificationFixture): this {
    this.cards.set(fixture.card.digest, fixture.card);
    this.claims.set(fixture.claim.digest, fixture.claim);
    this.records.set(fixture.record.digest, fixture.record);
    for (const entry of fixture.evidence) {
      void entry;
    }
    return this;
  }
  addRecord(record: QualificationRecord): this {
    this.records.set(record.digest, record);
    return this;
  }
  async getExpertProfile(digest: string): Promise<ExpertProfile | undefined> {
    return this.profiles.get(digest);
  }
  async getQualifiedExpertCard(digest: string): Promise<QualifiedExpertCard | undefined> {
    return this.cards.get(digest);
  }
  async getCompetencyClaim(digest: string): Promise<CompetencyClaim | undefined> {
    return this.claims.get(digest);
  }
  async getQualificationRecord(digest: string): Promise<QualificationRecord | undefined> {
    return this.records.get(digest);
  }
}

/** A map-backed release-record store (A024 views). */
export class MapReleaseRecordStore implements MarketplaceReleaseRecordStore {
  private readonly releases = new Map<string, ReleaseRecordView>();
  add(release: ReleaseRecordView): this {
    this.releases.set(release.digest, release);
    return this;
  }
  async getReleaseRecord(digest: string): Promise<ReleaseRecordView | undefined> {
    return this.releases.get(digest);
  }
}

/** A map-backed certification-record store (A023 views). */
export class MapCertificationRecordStore implements MarketplaceCertificationRecordStore {
  private readonly records = new Map<string, CertificationRecordView>();
  add(record: CertificationRecordView): this {
    this.records.set(record.digest, record);
    return this;
  }
  async getCertificationRecord(digest: string): Promise<CertificationRecordView | undefined> {
    return this.records.get(digest);
  }
}

/** A satisfied A023 certification view fixture. */
export function satisfiedCertification(
  digest: string = D.certification,
): CertificationRecordView {
  return Object.freeze({ digest, verdict: 'satisfied', grantedLevel: 'CERTIFIED' });
}

/** A registered A024 release view fixture citing one certification. */
export function registeredRelease(
  digest: string = D.release,
  certificationRefs: readonly string[] = [D.certification],
): ReleaseRecordView {
  return Object.freeze({
    digest,
    kind: 'release-registration',
    channel: 'stable',
    gate: Object.freeze({ certificationRefs: Object.freeze([...certificationRefs]) }),
  });
}
