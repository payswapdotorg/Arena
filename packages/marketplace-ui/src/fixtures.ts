/**
 * Deterministic fixtures for marketplace-ui view-model tests (Work Order
 * B013; issue #88; packages/marketplace-ui) — and for the app-level
 * marketplace suites, which import them relatively.
 *
 * Every timestamp is a fixed ms-UTC constant and every digest is a fixed
 * 64-hex string: building any view model from these fixtures is
 * byte-deterministic. The fixtures mirror the canonical shapes the app
 * runtime composes from the A031/A032/A033 package public APIs (marketplace
 * offer profiles + provenance records, A007 qualification records, A033
 * entitlement grants, read-model certification payloads) — as PLAIN DATA,
 * never as a second domain model.
 */

/** Fixed 64-hex digest fixtures (deterministic, sha-shaped). */
const hex = (seed: string): string =>
  seed.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, '1');

/** The single evaluation time every fixture state derives against. */
export const MARKETPLACE_FIXTURE_AT = '2026-10-01T08:00:00.000Z' as const;

/** The fixed fixture timeline (UTC, ms precision). */
export const MARKETPLACE_FIXTURE_TIMELINE = Object.freeze({
  createdAt: '2026-09-01T09:00:00.000Z',
  recordedAt: '2026-09-02T09:00:00.000Z',
  grantedAt: '2026-09-04T09:00:00.000Z',
  validFrom: '2026-09-04T09:00:00.000Z',
  expiresAt: '2026-09-15T09:00:00.000Z',
  revokedAt: '2026-09-05T09:00:00.000Z',
  pendingFrom: '2027-01-01T00:00:00.000Z',
  certifiedAt: '2026-08-01T09:00:00.000Z',
  publishedAt: '2026-09-05T09:00:00.000Z',
} as const);

/** Fixed 64-hex digest fixtures. */
export const MARKETPLACE_FIXTURE_DIGESTS = Object.freeze({
  artifact: hex('a1b2c3d4e5'),
  parent: hex('b2c3d4e5f6'),
  transform: hex('c3d4e5f6a7'),
  verification: hex('3333333333'),
  work1: hex('5555555555'),
  work2: hex('6666666666'),
  offerDigest: hex('7777777777'),
  claim: hex('8888888888'),
  qualificationRecord: hex('9999999999'),
  suite: hex('abcabcabca'),
  issuance: hex('bababababa'),
} as const);

const D = MARKETPLACE_FIXTURE_DIGESTS;
const T = MARKETPLACE_FIXTURE_TIMELINE;

/** The open rights block (A002 RightsMetadata shape). */
const RIGHTS_OPEN = Object.freeze({
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
});

/** The professional engagement terms block (expert rights posture input). */
const RIGHTS_ENGAGEMENT = Object.freeze({
  license: 'Professional engagement terms',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'none',
  professionalLimitations: Object.freeze(['Advisory code review only.']),
});

/** The A002 provenance record fixture (full evidence chain). */
export function provenanceRecordInput(): unknown {
  return Object.freeze({
    recordVersion: 1,
    artifact: Object.freeze({
      namespace: 'tenant-a',
      name: 'solder-joint-defects',
      version: '1.0.0',
      digest: D.artifact,
    }),
    creator: Object.freeze({ type: 'expert', tenant: 'tenant-a', principalId: 'expert-001' }),
    createdAt: T.createdAt,
    recordedAt: T.recordedAt,
    parents: Object.freeze([
      Object.freeze({
        parent: Object.freeze({
          namespace: 'tenant-a',
          name: 'corpus-source-images',
          version: '1.0.0',
          digest: D.parent,
        }),
        relation: 'derived-from',
      }),
    ]),
    transformation: Object.freeze({
      transform: Object.freeze({
        namespace: 'tenant-a',
        name: 'label-transform',
        version: '1.0.0',
        digest: D.transform,
      }),
      inputs: Object.freeze([
        Object.freeze({
          namespace: 'tenant-a',
          name: 'corpus-source-images',
          version: '1.0.0',
          digest: D.parent,
        }),
      ]),
    }),
    rights: RIGHTS_OPEN,
    verification: Object.freeze([
      Object.freeze({
        kind: 'verification',
        evidence: Object.freeze({
          namespace: 'tenant-a',
          name: 'verification-record',
          version: '1.0.0',
          digest: D.verification,
        }),
      }),
    ]),
  });
}

/** The read-model certification payload fixture (body composition scope). */
export function certificationRecordInput(): unknown {
  return Object.freeze({
    certificationId: 'cert-software-engineer-1-1-0',
    subject: Object.freeze({ bodyId: 'body-software-engineer', bodyVersion: '1.1.0' }),
    certificationKind: 'body-release',
    verdict: 'certified',
    basis: 'evaluation pass + independent verification pass',
    certifiedAt: T.certifiedAt,
  });
}

/** The composition-scoped certification record fixture (subject refs + suite). */
export function compositionCertificationRecordInput(): unknown {
  return Object.freeze({
    kind: 'certification-run',
    certificationId: 'cert-structural-engineer-1-4-0',
    subject: Object.freeze({
      bodyVersionRef: Object.freeze({
        tenant: 'acme',
        name: 'structural-engineer-body',
        version: '1.4.0',
        digest: hex('d4e5f6a7b8'),
      }),
      substrateRef: Object.freeze({ substrateId: 'substrate-llm-a', substrateVersion: '2.0.1', digest: hex('e5f6a7b8c9') }),
      environmentRef: Object.freeze({ environmentId: 'env-prod-eu', environmentVersion: '3.1.0', constraints: [] }),
      runtimeProfile: Object.freeze({ runtimeId: 'runtime-arena-1', runtimeVersion: '1.9.0', configuration: {} }),
    }),
    suiteRef: D.suite,
    verdict: 'satisfied',
    certifiedAt: T.certifiedAt,
    basis: 'suite stages satisfied',
  });
}

/** The artifact listing input fixture (granted entitlement, NOT certified). */
export function artifactListingInput(): unknown {
  return Object.freeze({
    offerId: 'solder-defect-dataset',
    title: 'Solder joint defect dataset',
    summary: 'Labeled solder joint inspection imagery for capability evaluation.',
    artifactKind: 'dataset',
    visibility: 'public',
    tenant: 'tenant-a',
    state: 'registered',
    offerDigest: D.offerDigest,
    artifactIdentity: `tenant-a/solder-joint-defects@1.0.0#${D.artifact}`,
    rights: RIGHTS_OPEN,
    evidence: Object.freeze([
      Object.freeze({ kind: 'provenance', digest: D.parent, outcome: null }),
      Object.freeze({ kind: 'verification', digest: D.verification, outcome: 'pass' }),
    ]),
    provenanceRecord: provenanceRecordInput(),
    certificationRecord: undefined,
    grants: Object.freeze([
      Object.freeze({
        recordVersion: 1,
        kind: 'grant-issuance',
        grantId: 'grant-fixture-001',
        offer: Object.freeze({ offerId: 'solder-defect-dataset', offerDigest: D.offerDigest }),
        grantee: Object.freeze({ type: 'user', tenant: 'tenant-a', principalId: 'user-a-001' }),
        granteeTenant: 'tenant-a',
        permittedUse: 'evaluation',
        grantedAt: T.grantedAt,
        expiresAt: null,
        revokes: null,
        grounds: null,
        correlationId: 'corr-fixture-grant-001',
        idempotencyKey: 'idem-fixture-grant-001',
        provenance: Object.freeze({ grantedBy: 'publisher-a-001', recordedAt: T.grantedAt, notes: null }),
      }),
    ]),
    reviews: Object.freeze([
      Object.freeze({
        rating: 5,
        verdict: 'recommend',
        body: 'Well-labeled and the provenance chain is auditable.',
        reviewerTenant: 'tenant-b',
        reviewerId: 'user-b-001',
      }),
    ]),
    reviewCount: 1,
    averageRating: 5,
    evaluatedAt: MARKETPLACE_FIXTURE_AT,
    mode: 'session',
  });
}

/** The artifact listing input with a certification record backing a badge. */
export function certifiedArtifactListingInput(): unknown {
  const base = artifactListingInput() as Record<string, unknown>;
  return Object.freeze({ ...base, certificationRecord: certificationRecordInput() });
}

/** The artifact listing input whose latest grant event is a revocation. */
export function revokedArtifactListingInput(): unknown {
  const base = artifactListingInput() as Record<string, unknown>;
  return Object.freeze({
    ...base,
    grants: Object.freeze([
      Object.freeze({
        recordVersion: 1,
        kind: 'grant-issuance',
        grantId: 'grant-fixture-002',
        offer: Object.freeze({ offerId: 'solder-defect-dataset', offerDigest: D.offerDigest }),
        grantee: Object.freeze({ type: 'user', tenant: 'tenant-a', principalId: 'user-a-001' }),
        granteeTenant: 'tenant-a',
        permittedUse: 'evaluation',
        grantedAt: T.grantedAt,
        expiresAt: null,
        revokes: null,
        grounds: null,
        correlationId: 'corr-fixture-grant-002',
        idempotencyKey: 'idem-fixture-grant-002',
        provenance: Object.freeze({ grantedBy: 'publisher-a-001', recordedAt: T.grantedAt, notes: null }),
      }),
      Object.freeze({
        recordVersion: 1,
        kind: 'grant-revocation',
        grantId: 'grant-fixture-002',
        offer: Object.freeze({ offerId: 'solder-defect-dataset', offerDigest: D.offerDigest }),
        grantee: Object.freeze({ type: 'user', tenant: 'tenant-a', principalId: 'user-a-001' }),
        granteeTenant: 'tenant-a',
        permittedUse: null,
        grantedAt: null,
        expiresAt: null,
        revokes: D.issuance,
        grounds: 'licence review — terms breached',
        correlationId: 'corr-fixture-revoke-002',
        idempotencyKey: 'idem-fixture-revoke-002',
        provenance: Object.freeze({ grantedBy: 'publisher-a-001', recordedAt: T.revokedAt, notes: null }),
      }),
    ]),
  });
}

/** The artifact listing input whose single grant expired before the fixture time. */
export function expiredArtifactListingInput(): unknown {
  const base = artifactListingInput() as Record<string, unknown>;
  return Object.freeze({
    ...base,
    grants: Object.freeze([
      Object.freeze({
        recordVersion: 1,
        kind: 'grant-issuance',
        grantId: 'grant-fixture-003',
        offer: Object.freeze({ offerId: 'solder-defect-dataset', offerDigest: D.offerDigest }),
        grantee: Object.freeze({ type: 'user', tenant: 'tenant-a', principalId: 'user-a-001' }),
        granteeTenant: 'tenant-a',
        permittedUse: 'evaluation',
        grantedAt: T.grantedAt,
        expiresAt: T.expiresAt,
        revokes: null,
        grounds: null,
        correlationId: 'corr-fixture-grant-003',
        idempotencyKey: 'idem-fixture-grant-003',
        provenance: Object.freeze({ grantedBy: 'publisher-a-001', recordedAt: T.grantedAt, notes: null }),
      }),
    ]),
  });
}

/** The artifact listing input with NO grant records at all. */
export function noGrantArtifactListingInput(): unknown {
  const base = artifactListingInput() as Record<string, unknown>;
  return Object.freeze({ ...base, grants: Object.freeze([]) });
}

/** The adversarial artifact listing input (foreign-typed fields everywhere). */
export function malformedArtifactListingInput(): unknown {
  return Object.freeze({
    offerId: 42,
    title: null,
    artifactKind: true,
    tenant: '',
    state: {},
    rights: 'nope',
    evidence: 'not-an-array',
    grants: 7,
    reviews: [{ rating: 'five', verdict: 3 }],
    provenanceRecord: { artifact: 'garbage', parents: 'x', verification: [{}] },
  });
}

/** The A007 qualification record fixture (evidence-chain input). */
export function qualificationRecordInput(): unknown {
  return Object.freeze({
    qualificationVersion: 1,
    expertId: 'expert-ada',
    tenant: 'tenant-a',
    capability: Object.freeze({
      kind: 'skill',
      id: 'rust-code-review',
      version: '2.1.0',
      digest: D.claim,
    }),
    proficiency: 'proficient',
    evidence: Object.freeze([D.work1, D.work2, D.verification]),
    evaluatedAt: T.recordedAt,
    claimRef: D.claim,
    policyId: 'policy-review-qualified',
    outcome: 'qualified',
  });
}

/** The expert-service listing input fixture. */
export function expertListingInput(): unknown {
  return Object.freeze({
    listingRef: hex('f1e2d3c4b5'),
    listingId: 'listing-ada-review',
    tenant: 'tenant-a',
    expertId: 'expert-ada',
    headline: 'Senior Rust code review, evidence-backed',
    description: 'Qualified code-review engagements grounded in verified work products.',
    capabilities: Object.freeze(['rust-code-review']),
    domains: Object.freeze(['software-engineering']),
    jurisdictions: Object.freeze(['US']),
    qualificationProofs: Object.freeze([
      Object.freeze({
        claimRef: D.claim,
        recordRef: D.qualificationRecord,
        status: 'qualified',
        inForce: true,
        validUntil: '2027-03-01T09:00:00.000Z',
      }),
    ]),
    offers: Object.freeze([
      Object.freeze({
        offerId: 'offer-review-session',
        kind: 'code-review',
        headline: 'One 60-minute Rust review session',
        rate: Object.freeze({ currency: 'USD', amountMinor: 12500, unit: 'per-session' }),
      }),
    ]),
    engagements: 1,
    completed: 1,
    reviews: 1,
    averageRating: 5,
    publishedAt: T.publishedAt,
    qualificationRecord: qualificationRecordInput(),
    rights: RIGHTS_ENGAGEMENT,
    evaluatedAt: MARKETPLACE_FIXTURE_AT,
    mode: 'session',
  });
}

/** The adversarial expert listing input. */
export function malformedExpertListingInput(): unknown {
  return Object.freeze({
    listingId: 7,
    tenant: false,
    qualificationProofs: 'nope',
    offers: [{ headline: 9 }],
    qualificationRecord: 3,
    rights: [],
  });
}

/**
 * The A033 entitlement grant fixture by state (deterministic lineage and
 * time boundaries around the fixture evaluation time).
 */
export function entitlementGrantInput(
  state: 'granted' | 'pending' | 'expired' | 'revoked' | 'malformed',
): unknown {
  if (state === 'malformed') {
    return Object.freeze({ grantId: 42, lineage: 'nope', validFrom: 'not-a-time' });
  }
  const lineage = Object.freeze([
    Object.freeze({ sequence: 1, kind: 'granted', occurredAt: T.grantedAt, note: 'initial grant' }),
    ...(state === 'revoked'
      ? Object.freeze([
          Object.freeze({
            sequence: 2,
            kind: 'revoked',
            occurredAt: T.revokedAt,
            note: 'policy violation — terminal',
          }),
        ])
      : []),
  ]);
  return Object.freeze({
    recordVersion: 1,
    grantId: `grant-fixture-${state}`,
    tenantId: 'tenant-a',
    featureKey: 'marketplace.artifact-access',
    kind: 'quota',
    limit: 100,
    window: 'day',
    issuedAt: T.grantedAt,
    validFrom: state === 'pending' ? T.pendingFrom : T.validFrom,
    ...(state === 'expired' ? { expiresAt: T.expiresAt } : {}),
    lineage,
  });
}

/** The purchase action input fixture by family and mode. */
export function purchaseActionInput(
  family: 'artifact' | 'expert-service',
  mode: 'session' | 'demo',
): unknown {
  return Object.freeze({
    family,
    mode,
    state: 'registered',
    offers:
      family === 'expert-service'
        ? Object.freeze([
            Object.freeze({
              offerId: 'offer-review-session',
              rate: Object.freeze({ currency: 'USD', amountMinor: 12500, unit: 'per-session' }),
            }),
          ])
        : Object.freeze([]),
    rights: family === 'expert-service' ? RIGHTS_ENGAGEMENT : RIGHTS_OPEN,
  });
}
