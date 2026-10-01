/**
 * Deterministic test fixtures for @arena/marketplace-artifacts-fabric
 * (Work Order A032). Mirrors the house test-support convention: fixed
 * ms-UTC timestamps, fixed tenants/principals, a seeded LCG, REAL
 * domain objects built through the owning packages' public factories
 * (A002/A009/A012/A013/A014), and builders that compose them.
 *
 * NOT exported from the package index (hygiene asserts this).
 */

import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { createDatasetManifest } from '@arena/datasets';
import { createEnvironmentDefinition } from '@arena/environment-protocol';
import { createEvaluationCriteria } from '@arena/evaluation';
import { createProvenanceRecord, provenanceRecordDigest } from '@arena/provenance';
import { createVerifierDescriptor, createVerificationRecord } from '@arena/verification';

import type { MarketplaceEvidenceRef } from './gate.js';
import type { OfferCandidateInput } from './fabric.js';

// ---------------------------------------------------------------------------
// Fixed timeline + tenants + principals
// ---------------------------------------------------------------------------

export const T0 = '2026-01-15T09:30:00.000Z';
export const T1 = '2026-01-15T09:30:01.000Z';
export const T2 = '2026-01-15T09:30:02.000Z';
export const T3 = '2026-01-15T09:30:03.000Z';
export const T4 = '2026-01-15T09:30:04.000Z';
export const T5 = '2026-01-15T09:30:05.000Z';
export const T6 = '2026-01-15T09:30:06.000Z';
export const T7 = '2026-01-15T09:30:07.000Z';
export const T_LATE = '2026-06-01T00:00:00.000Z';

export const TENANT_A = 'tenant-a';
export const TENANT_B = 'tenant-b';

export const PUBLISHER_A = { type: 'service', tenant: TENANT_A, principalId: 'publisher-a-001' };
export const PUBLISHER_B = { type: 'service', tenant: TENANT_B, principalId: 'publisher-b-001' };
export const GRANTEE_B = { type: 'user', tenant: TENANT_B, principalId: 'user-b-001' };
export const GRANTEE_A = { type: 'user', tenant: TENANT_A, principalId: 'user-a-001' };

export const CORR_A = 'corr-marketplace-0001';
export const CORR_B = 'corr-marketplace-0002';
export const CORR_C = 'corr-marketplace-0003';
export const CORR_D = 'corr-marketplace-0004';
export const IDEM_A = 'idem-marketplace-0001';
export const IDEM_B = 'idem-marketplace-0002';
export const IDEM_C = 'idem-marketplace-0003';
export const IDEM_D = 'idem-marketplace-0004';
export const IDEM_E = 'idem-marketplace-0005';

// ---------------------------------------------------------------------------
// Rights fixtures (A002 vocabulary)
// ---------------------------------------------------------------------------

export const RIGHTS_OPEN = {
  license: 'CC-BY-4.0',
  commercialUse: 'allowed',
  redistribution: 'allowed',
  customerData: 'none',
};
export const RIGHTS_TENANT_ONLY = {
  license: 'Arena-Internal-1.0',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'none',
};
export const RIGHTS_PROPRIETARY = {
  license: 'Proprietary-1.0',
  commercialUse: 'prohibited',
  redistribution: 'prohibited',
  customerData: 'derived',
};

// ---------------------------------------------------------------------------
// Seeded LCG (deterministic pseudo-randomness, house pattern)
// ---------------------------------------------------------------------------

export class TestLcg {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }
  pick<T>(items: readonly T[]): T {
    return items[this.next() % items.length] as T;
  }
}

// ---------------------------------------------------------------------------
// Domain object builders (REAL factories, deterministic content)
// ---------------------------------------------------------------------------

export interface EvidenceArtifactOverrides {
  readonly namespace?: string;
  readonly name?: string;
  readonly version?: string;
  readonly content?: unknown;
}

export async function makeEvidenceArtifact(
  index: number,
  overrides: EvidenceArtifactOverrides = {},
): Promise<MaterialArtifact<unknown>> {
  return createMaterialArtifact({
    identity: {
      namespace: overrides.namespace ?? TENANT_A,
      name: overrides.name ?? `fixture-artifact-${String(index).padStart(3, '0')}`,
      version: overrides.version ?? '1.0.0',
    },
    refs: [],
    content:
      overrides.content === undefined
        ? { kind: 'fixture', index, payload: `fixture payload ${String(index)}` }
        : overrides.content,
  });
}

export async function makeDatasetManifestFor(
  subject: MaterialArtifact<unknown>,
  rights: unknown = RIGHTS_OPEN,
) {
  return createDatasetManifest({
    identity: {
      namespace: subject.identity.namespace,
      name: `${subject.identity.name}-manifest`,
      version: '1.0.0',
    },
    entries: [
      {
        role: 'input',
        artifact: {
          namespace: subject.identity.namespace,
          name: subject.identity.name,
          version: subject.identity.version,
          digest: subject.digest,
        },
      },
    ],
    provenance: {
      creator: { type: 'expert', tenant: TENANT_A, principalId: 'expert-001' },
      createdAt: T0,
      rights,
      verification: [],
    },
  });
}

export async function makeProvenanceRecordFor(
  artifact: { namespace: string; name: string; version: string; digest: string },
) {
  return createProvenanceRecord({
    artifact,
    creator: { type: 'expert', tenant: TENANT_A, principalId: 'expert-001' },
    createdAt: T0,
    recordedAt: T0,
    parents: [],
    transformation: {
      transform: artifact,
      inputs: [],
    },
    rights: RIGHTS_OPEN,
    verification: [],
  });
}

export async function makePassingVerificationFor(
  artifact: { namespace: string; name: string; version: string; digest: string },
  options: { readonly outcomeOverride?: 'pass' | 'fail' | 'unknown' } = {},
) {
  const descriptor = await createVerifierDescriptor({
    verifierId: 'marketplace-fixture-verifier',
    version: '1.0.0',
    method: 'constraint_check',
    requiredEvidence: [
      {
        requirementId: 'requirement-001',
        evidenceKind: 'test-report',
        claim: 'the listing subject passes the marketplace admission constraints',
        artifact: null,
        requiredProducer: null,
      },
    ],
    outcomeSemantics: {
      pass: 'all admission constraints are satisfied',
      fail: 'at least one admission constraint is violated',
      unknown: 'the evidence was insufficient to decide',
    },
    reproducibility: { policy: 'deterministic', seed: null, parameters: null },
    inputSchema: { namespace: 'verification', name: 'run-verification-command', version: '1.0.0' },
    outputSchema: { namespace: 'verification', name: 'verification-record', version: '1.0.0' },
    provenance: { authoredBy: 'marketplace-fixture-verifier', submittedAt: T0, notes: null },
  });

  const status =
    options.outcomeOverride === 'fail'
      ? 'present-unsupported'
      : options.outcomeOverride === 'unknown'
        ? 'present-indeterminate'
        : 'present-supported';

  const record = await createVerificationRecord(
    {
      verifierRef: descriptor.digest,
      evidence: [
        {
          evidenceKind: 'test-report',
          artifact,
          provenance: { producedBy: 'marketplace-fixture-verifier', producedAt: T0, notes: null },
        },
      ],
      evidenceSupport: [
        { requirementId: 'requirement-001', status, evidenceDigest: artifact.digest, notes: null },
      ],
      correlationId: 'corr-verification-fixture',
      idempotencyKey: 'idem-verification-fixture',
      startedAt: T0,
      finishedAt: T1,
      provenance: { executedBy: 'marketplace-fixture-verifier', recordedAt: T1, notes: null },
    },
    descriptor,
  );
  return { descriptor, record };
}

export async function makeEvaluationCriteriaFixture() {
  return createEvaluationCriteria({
    criteriaId: 'criteria-solder-qa',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-001',
        weight: 1,
        description: 'defect detection recall meets the reference floor',
        targetRef: 'a'.repeat(64),
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.8 },
  });
}

export async function makeEnvironmentDefinitionFixture(
  overrides: { namespace?: string; name?: string } = {},
) {
  return createEnvironmentDefinition({
    identity: { namespace: overrides.namespace ?? TENANT_B, name: overrides.name ?? 'engineering-sandbox' },
    version: '1.2.0',
    image: { imageKind: 'content-addressed-image', digest: 'b'.repeat(64), buildDigest: null },
    initialState: {
      snapshot: { snapshotId: 'snapshot-initial', digest: 'c'.repeat(64) },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: { mode: 'deterministic', capture: null, note: null },
      seed: null,
      seedAlgorithm: null,
      reseedPolicy: 'forbidden',
      note: null,
    },
    actionSurface: {
      actions: [
        { actionId: 'run-step', description: 'Execute one declared procedure step.' },
        { actionId: 'submit-result', description: null },
      ],
      tools: [{ toolId: 'file-tool', description: null }],
    },
    observationSurface: {
      observations: [
        { observationId: 'obs-stdout', channel: 'stdout', description: null },
        { observationId: 'obs-files', channel: 'files', description: null },
      ],
    },
    resourceLimits: { cpuMillis: 2000, memoryMiB: 1024, wallClockSeconds: 3600 },
    networkPolicy: { egress: 'default-deny', allows: [{ host: 'packages.internal', port: 443, protocol: 'https' }] },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [{ mountPath: '/workspace', access: 'read-write', source: 'workspace' }],
    },
    secretPolicy: { isolation: 'isolation-boundary', injectionPoints: [] },
    timeLimits: { startupSeconds: 60, cleanupGraceSeconds: 30, deadlineBehavior: 'grace-then-stop' },
    resetSemantics: { mode: 'recreate', checkpoint: null, cleanup: 'destroy' },
    checkpointSemantics: { supported: false, triggers: [], retention: null },
    evidenceOutputs: {
      outputs: [{ outputId: 'ev-trajectory', kind: 'trajectory', addressing: 'content-addressed', description: null }],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'eval-standard-suite',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/evaluation/suite-run@1.0.0',
          description: null,
        },
      ],
      verifiers: [
        {
          hookId: 'verify-output-contracts',
          role: 'verifier',
          phase: 'on-evidence',
          invocationSchema: 'arena:schema/verification/check@1.0.0',
          description: null,
        },
      ],
    },
  });
}

// ---------------------------------------------------------------------------
// Offer candidates
// ---------------------------------------------------------------------------

export interface OfferFixture {
  readonly artifact: { namespace: string; name: string; version: string; digest: string };
  readonly provenanceRecord: Awaited<ReturnType<typeof makeProvenanceRecordFor>>;
  readonly verification: Awaited<ReturnType<typeof makePassingVerificationFor>>;
  readonly provenanceDigest: string;
}

/** Build a fully-evidenced subject: artifact ref + provenance + PASSING verification. */
export async function makeEvidencedSubjectFor(
  artifact: { namespace: string; name: string; version: string; digest: string },
  options: { readonly outcomeOverride?: 'pass' | 'fail' | 'unknown' } = {},
): Promise<OfferFixture> {
  const provenanceRecord = await makeProvenanceRecordFor(artifact);
  const verification = await makePassingVerificationFor(artifact, options);
  const provenanceDigest = await provenanceRecordDigest(provenanceRecord);
  return { artifact, provenanceRecord, verification, provenanceDigest };
}

/** Build a fully-evidenced subject from a material artifact. */
export async function makeEvidencedSubject(
  subject: MaterialArtifact<unknown>,
  options: { readonly outcomeOverride?: 'pass' | 'fail' | 'unknown' } = {},
): Promise<OfferFixture> {
  return makeEvidencedSubjectFor(
    {
      namespace: subject.identity.namespace,
      name: subject.identity.name,
      version: subject.identity.version,
      digest: subject.digest,
    },
    options,
  );
}

// ---------------------------------------------------------------------------
// Seeded fabric (the reference marketplace scenario)
// ---------------------------------------------------------------------------

import {
  createMarketplaceArtifactsFabric,
  type MarketplaceArtifactsFabric,
} from './fabric.js';

export interface SeededMarketplace {
  readonly fabric: MarketplaceArtifactsFabric;
  readonly datasetOfferId: string;
  readonly datasetOfferDigest: string;
  readonly datasetArtifact: { namespace: string; name: string; version: string; digest: string };
  readonly evaluationOfferId: string;
  readonly environmentOfferId: string;
  readonly environmentOfferDigest: string;
  readonly grantBId: string;
  readonly grantBToDataset: string;
  readonly reviewBId: string;
}

/** Seed the reference marketplace: 3 offers (2 public, 1 tenant-internal), 2 grants, 2 reviews. */
export async function seedMarketplaceFabric(): Promise<SeededMarketplace> {
  const fabric = createMarketplaceArtifactsFabric();

  // --- dataset (tenant-a, public) -------------------------------------------
  const datasetArtifact = await makeEvidenceArtifact(100, { namespace: TENANT_A, name: 'solder-joint-defects' });
  const datasetManifest = await makeDatasetManifestFor(datasetArtifact);
  const datasetRef = {
    namespace: datasetManifest.identity.namespace,
    name: datasetManifest.identity.name,
    version: datasetManifest.identity.version,
    digest: datasetManifest.digest,
  };
  fabric.putDatasetManifest(datasetManifest);
  const datasetFixture = await makeEvidencedSubjectFor(datasetRef);
  await fabric.putProvenanceRecord(datasetFixture.provenanceRecord);
  fabric.putVerificationRecord(datasetFixture.verification.record);
  const datasetOffer = await fabric.registerOffer({
    candidate: makeOfferCandidate({
      offerId: 'solder-defect-dataset',
      artifactKind: 'dataset',
      artifact: datasetRef,
      title: 'Solder joint defect dataset',
      summary: 'Labeled solder joint inspection imagery for capability evaluation.',
      rights: RIGHTS_OPEN,
      visibility: 'public',
      offeredAt: T1,
    }),
    correlationId: CORR_A,
    idempotencyKey: IDEM_A,
    evidence: evidenceRefsOf(datasetFixture),
  });

  // --- evaluation suite (tenant-a, public) ----------------------------------
  const criteria = await makeEvaluationCriteriaFixture();
  fabric.putEvaluationCriteria(criteria);
  const criteriaRef = {
    namespace: TENANT_A,
    name: 'solder-qa-criteria',
    version: criteria.version,
    digest: criteria.digest,
  };
  const criteriaFixture = await makeEvidencedSubjectFor(criteriaRef);
  await fabric.putProvenanceRecord(criteriaFixture.provenanceRecord);
  fabric.putVerificationRecord(criteriaFixture.verification.record);
  await fabric.registerOffer({
    candidate: makeOfferCandidate({
      offerId: 'solder-qa-criteria-suite',
      artifactKind: 'evaluation-suite',
      artifact: criteriaRef,
      title: 'Solder QA evaluation criteria suite',
      summary: 'Weighted-sum criteria over defect detection recall floors.',
      rights: RIGHTS_OPEN,
      visibility: 'public',
      offeredAt: T2,
    }),
    correlationId: CORR_B,
    idempotencyKey: IDEM_B,
    evidence: evidenceRefsOf(criteriaFixture),
  });

  // --- environment (tenant-b, tenant-internal) ------------------------------
  const definition = await makeEnvironmentDefinitionFixture();
  fabric.putEnvironmentDefinition(definition);
  const environmentRef = {
    namespace: definition.identity.namespace,
    name: definition.identity.name,
    version: definition.version,
    digest: definition.digest,
  };
  const environmentFixture = await makeEvidencedSubjectFor(environmentRef);
  await fabric.putProvenanceRecord(environmentFixture.provenanceRecord);
  fabric.putVerificationRecord(environmentFixture.verification.record);
  const environmentOffer = await fabric.registerOffer({
    candidate: makeOfferCandidate({
      offerId: 'engineering-sandbox-environment',
      artifactKind: 'environment',
      artifact: environmentRef,
      title: 'Engineering sandbox environment',
      summary: 'Isolated deterministic engineering sandbox with evidence outputs.',
      publisher: PUBLISHER_B,
      rights: RIGHTS_TENANT_ONLY,
      visibility: 'tenant-internal',
      offeredAt: T3,
      provenance: { offeredBy: 'publisher-b-001', recordedAt: T3, notes: null },
    }),
    correlationId: CORR_C,
    idempotencyKey: IDEM_C,
    evidence: evidenceRefsOf(environmentFixture),
  });

  // --- grants + reviews ------------------------------------------------------
  const grantB = await fabric.grantAccess({
    grantId: 'grant-b-dataset-001',
    offerId: 'solder-defect-dataset',
    grantee: GRANTEE_B,
    permittedUse: 'evaluation',
    asOf: T4,
    correlationId: CORR_D,
    idempotencyKey: IDEM_D,
  });
  await fabric.grantAccess({
    grantId: 'grant-a-dataset-001',
    offerId: 'solder-defect-dataset',
    grantee: GRANTEE_A,
    permittedUse: 'tenant-internal',
    asOf: T4,
    correlationId: 'corr-marketplace-0005',
    idempotencyKey: IDEM_E,
  });
  const reviewB = await fabric.submitReview({
    reviewId: 'review-b-dataset-001',
    offerId: 'solder-defect-dataset',
    reviewer: GRANTEE_B,
    rating: 5,
    verdict: 'recommend',
    body: 'The dataset is well-labeled and reproducible.',
    submittedAt: T5,
    correlationId: 'corr-marketplace-0006',
    idempotencyKey: 'idem-marketplace-0006',
  });
  await fabric.submitReview({
    reviewId: 'review-a-dataset-001',
    offerId: 'solder-defect-dataset',
    reviewer: GRANTEE_A,
    rating: 4,
    verdict: 'mixed',
    body: 'Solid coverage; some labels need review.',
    submittedAt: T6,
    correlationId: 'corr-marketplace-0007',
    idempotencyKey: 'idem-marketplace-0007',
  });

  return {
    fabric,
    datasetOfferId: datasetOffer.record.offerId,
    datasetOfferDigest: datasetOffer.record.digest,
    datasetArtifact: datasetRef,
    evaluationOfferId: 'solder-qa-criteria-suite',
    environmentOfferId: environmentOffer.record.offerId,
    environmentOfferDigest: environmentOffer.record.digest,
    grantBId: 'grant-b-dataset-001',
    grantBToDataset: grantB.record.digest,
    reviewBId: reviewB.record.reviewId,
  };
}

/** The full evidence citation set for an evidenced subject. */
export function evidenceRefsOf(fixture: OfferFixture): readonly MarketplaceEvidenceRef[] {
  return [
    { kind: 'provenance', digest: fixture.provenanceDigest },
    { kind: 'verification', digest: fixture.verification.record.digest },
  ];
}

/** A content-bearing offer candidate. */
export function makeOfferCandidate(
  overrides: Partial<OfferCandidateInput> & { offerId: string; artifactKind: string; artifact: { namespace: string; name: string; version: string; digest: string } },
): OfferCandidateInput {
  return {
    offerId: overrides.offerId,
    artifactKind: overrides.artifactKind as OfferCandidateInput['artifactKind'],
    artifact: overrides.artifact,
    title: overrides.title ?? 'Fixture listing',
    summary: overrides.summary ?? 'A deterministic fixture marketplace listing.',
    publisher: overrides.publisher ?? PUBLISHER_A,
    rights: overrides.rights ?? RIGHTS_OPEN,
    visibility: overrides.visibility ?? 'public',
    offeredAt: overrides.offeredAt ?? T1,
    supersedes: overrides.supersedes ?? null,
    retires: overrides.retires ?? null,
    grounds: overrides.grounds ?? null,
    provenance: overrides.provenance ?? {
      offeredBy: 'publisher-a-001',
      recordedAt: T1,
      notes: null,
    },
    kind: overrides.kind ?? 'offer-registration',
  };
}
