/**
 * The seeded marketplace corpus (Work Order A032 — the A018 corpus.mjs
 * house pattern).
 *
 * Plain .mjs ON PURPOSE: @arena/web's manifest is frozen (only
 * @arena/protocol-core) and the app tsconfig cannot compile a
 * cross-tree import of the marketplace fabric, so the corpus builder
 * imports the workspace TypeScript sources via relative paths and the
 * loader shim (loader.mjs) resolves them under
 * node --experimental-strip-types.
 *
 * Everything is DETERMINISTIC: fixed ms-UTC timestamps, fixed
 * principals/tenants, fixed fixture content — the domain packages'
 * content addressing (sha256 over canonical JSON) makes every digest
 * reproducible byte-for-byte. The corpus is deep-frozen.
 *
 * The corpus drives the REAL marketplace service: offers are admitted
 * through the gate, grants through the license + data-rights rules,
 * reviews through grant gating — then the profiles are read back
 * through the service's query surface.
 */

import { createMarketplaceArtifactsService } from '../../../../../services/marketplace-artifacts/src/index.ts';
import { createMaterialArtifact } from '../../../../../packages/artifact-protocol/src/index.ts';
import { createDatasetManifest } from '../../../../../packages/datasets/src/index.ts';
import { createEvaluationCriteria } from '../../../../../packages/evaluation/src/index.ts';
import { createEnvironmentDefinition } from '../../../../../packages/environment-protocol/src/index.ts';
import { createProvenanceRecord, provenanceRecordDigest } from '../../../../../packages/provenance/src/index.ts';
import { createVerifierDescriptor, createVerificationRecord } from '../../../../../packages/verification/src/index.ts';

// ---------------------------------------------------------------------------
// Fixed timeline, tenants and principals (deterministic corpus)
// ---------------------------------------------------------------------------

const T0 = '2026-01-15T09:30:00.000Z';
const T1 = '2026-01-15T09:30:01.000Z';
const T2 = '2026-01-15T09:30:02.000Z';
const T3 = '2026-01-15T09:30:03.000Z';
const T4 = '2026-01-15T09:30:04.000Z';
const T5 = '2026-01-15T09:30:05.000Z';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const PUBLISHER_A = { type: 'service', tenant: TENANT_A, principalId: 'publisher-a-001' };
const PUBLISHER_B = { type: 'service', tenant: TENANT_B, principalId: 'publisher-b-001' };
const GRANTEE_A = { type: 'user', tenant: TENANT_A, principalId: 'user-a-001' };
const GRANTEE_B = { type: 'user', tenant: TENANT_B, principalId: 'user-b-001' };

const RIGHTS_OPEN = { license: 'CC-BY-4.0', commercialUse: 'allowed', redistribution: 'allowed', customerData: 'none' };
const RIGHTS_TENANT_ONLY = { license: 'Arena-Internal-1.0', commercialUse: 'requires-license', redistribution: 'tenant-only', customerData: 'none' };

// ---------------------------------------------------------------------------
// Domain fixtures (REAL factories — the A002/A009/A012/A013/A014 APIs)
// ---------------------------------------------------------------------------

async function makeEvidenceArtifact(index, overrides = {}) {
  return createMaterialArtifact({
    identity: {
      namespace: overrides.namespace ?? TENANT_A,
      name: overrides.name ?? `corpus-artifact-${String(index).padStart(3, '0')}`,
      version: '1.0.0',
    },
    refs: [],
    content: { kind: 'corpus-fixture', index, payload: `corpus fixture ${String(index)}` },
  });
}

async function makeVerifierFixture() {
  return createVerifierDescriptor({
    verifierId: 'corpus-marketplace-verifier',
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
    provenance: { authoredBy: 'corpus-marketplace-verifier', submittedAt: T0, notes: null },
  });
}

async function makeEvidencedSubject(artifactRef, descriptor) {
  const provenanceRecord = createProvenanceRecord({
    artifact: artifactRef,
    creator: { type: 'expert', tenant: TENANT_A, principalId: 'expert-001' },
    createdAt: T0,
    recordedAt: T0,
    parents: [],
    transformation: { transform: artifactRef, inputs: [] },
    rights: RIGHTS_OPEN,
    verification: [],
  });
  const verificationRecord = await createVerificationRecord(
    {
      verifierRef: descriptor.digest,
      evidence: [
        {
          evidenceKind: 'test-report',
          artifact: artifactRef,
          provenance: { producedBy: 'corpus-marketplace-verifier', producedAt: T0, notes: null },
        },
      ],
      evidenceSupport: [
        { requirementId: 'requirement-001', status: 'present-supported', evidenceDigest: artifactRef.digest, notes: null },
      ],
      correlationId: 'corr-corpus-verification',
      idempotencyKey: 'idem-corpus-verification',
      startedAt: T0,
      finishedAt: T1,
      provenance: { executedBy: 'corpus-marketplace-verifier', recordedAt: T1, notes: null },
    },
    descriptor,
  );
  return {
    provenanceRecord,
    verificationRecord,
    provenanceDigest: await provenanceRecordDigest(provenanceRecord),
  };
}

// ---------------------------------------------------------------------------
// Corpus build
// ---------------------------------------------------------------------------

/**
 * Build the deep-frozen, byte-deterministic seeded corpus.
 *
 * @returns {Promise<SeededMarketplaceCorpus>} the frozen corpus
 */
export async function buildMarketplaceCorpus() {
  const service = createMarketplaceArtifactsService();
  const fabric = service.fabric;
  const descriptor = await makeVerifierFixture();
  const profiles = [];

  async function admitOffer({
    offerId,
    artifactKind,
    artifactRef,
    title,
    summary,
    publisher,
    rights,
    visibility,
    offeredAt,
    correlationId,
    idempotencyKey,
  }) {
    const evidence = await makeEvidencedSubject(artifactRef, descriptor);
    await fabric.putProvenanceRecord(evidence.provenanceRecord);
    fabric.putVerificationRecord(evidence.verificationRecord);
    const registration = await fabric.registerOffer({
      candidate: {
        kind: 'offer-registration',
        offerId,
        artifactKind,
        artifact: artifactRef,
        title,
        summary,
        publisher,
        rights,
        visibility,
        offeredAt,
        provenance: { offeredBy: publisher.principalId, recordedAt: offeredAt, notes: null },
      },
      correlationId,
      idempotencyKey,
      evidence: [
        { kind: 'provenance', digest: evidence.provenanceDigest },
        { kind: 'verification', digest: evidence.verificationRecord.digest },
      ],
    });
    profiles.push({
      offerId,
      artifactKind,
      visibility,
      tenant: publisher.tenant,
      offerDigest: registration.record.digest,
      evidence: [
        { kind: 'provenance', digest: evidence.provenanceDigest, outcome: null },
        { kind: 'verification', digest: evidence.verificationRecord.digest, outcome: evidence.verificationRecord.outcome },
      ],
    });
    return registration;
  }

  // --- dataset listing (tenant-a, public) ---------------------------------
  const datasetArtifact = await makeEvidenceArtifact(1, { name: 'solder-joint-defects' });
  const datasetManifest = await createDatasetManifest({
    identity: { namespace: TENANT_A, name: 'solder-joint-defects', version: '1.0.0' },
    entries: [
      {
        role: 'input',
        artifact: {
          namespace: datasetArtifact.identity.namespace,
          name: datasetArtifact.identity.name,
          version: datasetArtifact.identity.version,
          digest: datasetArtifact.digest,
        },
      },
    ],
    provenance: {
      creator: { type: 'expert', tenant: TENANT_A, principalId: 'expert-001' },
      createdAt: T0,
      rights: RIGHTS_OPEN,
      verification: [],
    },
  });
  fabric.putDatasetManifest(datasetManifest);
  const datasetRegistration = await admitOffer({
    offerId: 'solder-defect-dataset',
    artifactKind: 'dataset',
    artifactRef: {
      namespace: datasetManifest.identity.namespace,
      name: datasetManifest.identity.name,
      version: datasetManifest.identity.version,
      digest: datasetManifest.digest,
    },
    title: 'Solder joint defect dataset',
    summary: 'Labeled solder joint inspection imagery for capability evaluation.',
    publisher: PUBLISHER_A,
    rights: RIGHTS_OPEN,
    visibility: 'public',
    offeredAt: T1,
    correlationId: 'corr-corpus-offer-001',
    idempotencyKey: 'idem-corpus-offer-001',
  });

  // --- evaluation suite listing (tenant-a, public) ------------------------
  const criteria = await createEvaluationCriteria({
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
  fabric.putEvaluationCriteria(criteria);
  await admitOffer({
    offerId: 'solder-qa-criteria-suite',
    artifactKind: 'evaluation-suite',
    artifactRef: { namespace: TENANT_A, name: 'solder-qa-criteria', version: criteria.version, digest: criteria.digest },
    title: 'Solder QA evaluation criteria suite',
    summary: 'Weighted-sum criteria over defect detection recall floors.',
    publisher: PUBLISHER_A,
    rights: RIGHTS_OPEN,
    visibility: 'public',
    offeredAt: T2,
    correlationId: 'corr-corpus-offer-002',
    idempotencyKey: 'idem-corpus-offer-002',
  });

  // --- environment listing (tenant-b, tenant-internal) --------------------
  const definition = await createEnvironmentDefinition({
    identity: { namespace: TENANT_B, name: 'engineering-sandbox' },
    version: '1.2.0',
    image: { imageKind: 'content-addressed-image', digest: 'b'.repeat(64), buildDigest: null },
    initialState: { snapshot: { snapshotId: 'snapshot-initial', digest: 'c'.repeat(64) }, snapshotSupport: 'supported' },
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
  fabric.putEnvironmentDefinition(definition);
  await admitOffer({
    offerId: 'engineering-sandbox-environment',
    artifactKind: 'environment',
    artifactRef: {
      namespace: definition.identity.namespace,
      name: definition.identity.name,
      version: definition.version,
      digest: definition.digest,
    },
    title: 'Engineering sandbox environment',
    summary: 'Isolated deterministic engineering sandbox with evidence outputs.',
    publisher: PUBLISHER_B,
    rights: RIGHTS_TENANT_ONLY,
    visibility: 'tenant-internal',
    offeredAt: T3,
    correlationId: 'corr-corpus-offer-003',
    idempotencyKey: 'idem-corpus-offer-003',
  });

  // --- grants + reviews (through the real license/data-rights paths) ------
  await fabric.grantAccess({
    grantId: 'grant-b-dataset-001',
    offerId: 'solder-defect-dataset',
    grantee: GRANTEE_B,
    permittedUse: 'evaluation',
    asOf: T4,
    correlationId: 'corr-corpus-grant-001',
    idempotencyKey: 'idem-corpus-grant-001',
  });
  await fabric.grantAccess({
    grantId: 'grant-a-dataset-001',
    offerId: 'solder-defect-dataset',
    grantee: GRANTEE_A,
    permittedUse: 'tenant-internal',
    asOf: T4,
    correlationId: 'corr-corpus-grant-002',
    idempotencyKey: 'idem-corpus-grant-002',
  });
  await fabric.grantAccess({
    grantId: 'grant-b-env-001',
    offerId: 'engineering-sandbox-environment',
    grantee: GRANTEE_B,
    permittedUse: 'tenant-internal',
    asOf: T4,
    correlationId: 'corr-corpus-grant-003',
    idempotencyKey: 'idem-corpus-grant-003',
  });
  await fabric.submitReview({
    reviewId: 'review-b-dataset-001',
    offerId: 'solder-defect-dataset',
    reviewer: GRANTEE_B,
    rating: 5,
    verdict: 'recommend',
    body: 'The dataset is well-labeled and the provenance chain is auditable.',
    submittedAt: T5,
    correlationId: 'corr-corpus-review-001',
    idempotencyKey: 'idem-corpus-review-001',
  });
  await fabric.submitReview({
    reviewId: 'review-a-dataset-001',
    offerId: 'solder-defect-dataset',
    reviewer: GRANTEE_A,
    rating: 4,
    verdict: 'mixed',
    body: 'Solid coverage; some split balance needs review.',
    submittedAt: T5,
    correlationId: 'corr-corpus-review-002',
    idempotencyKey: 'idem-corpus-review-002',
  });

  // --- project the corpus through the service QUERY surface ----------------
  const grantedOffers = new Map();
  for (const tenant of [TENANT_A, TENANT_B]) {
    const grantsResponse = await fabric.handleQueryRequest({
      requestVersion: 1,
      kind: 'list-grants',
      params: { tenant },
      scope: { tenant },
    });
    for (const grant of grantsResponse.result) {
      const list = grantedOffers.get(grant.offer.offerId) ?? [];
      list.push({
        grantId: grant.grantId,
        state: 'active',
        permittedUse: grant.permittedUse,
        granteeTenant: grant.granteeTenant,
      });
      grantedOffers.set(grant.offer.offerId, list);
    }
  }

  const profileViews = [];
  for (const partial of profiles) {
    const queryResponse = await fabric.handleQueryRequest({
      requestVersion: 1,
      kind: 'get-offer',
      params: { offerId: partial.offerId },
      scope: { tenant: partial.tenant },
    });
    const profile = queryResponse.result;
    const registration = profile.registration;
    let reviews = [];
    try {
      const reviewsResponse = await fabric.handleQueryRequest({
        requestVersion: 1,
        kind: 'list-reviews',
        params: { offerId: partial.offerId },
        scope: { tenant: partial.tenant },
      });
      reviews = reviewsResponse.result;
    } catch {
      reviews = [];
    }
    profileViews.push({
      offerId: partial.offerId,
      title: registration.title,
      summary: registration.summary,
      artifactKind: partial.artifactKind,
      visibility: partial.visibility,
      tenant: partial.tenant,
      state: profile.state,
      offerDigest: partial.offerDigest,
      artifactIdentity: `${registration.artifact.namespace}/${registration.artifact.name}@${registration.artifact.version}#${registration.artifact.digest}`,
      rights: registration.rights,
      evidence: partial.evidence,
      grants: grantedOffers.get(partial.offerId) ?? [],
      reviews: reviews.map((review) => ({
        rating: review.rating,
        verdict: review.verdict,
        body: review.body,
        reviewerTenant: review.reviewerTenant,
        reviewerId: review.reviewer.principalId,
      })),
      reviewCount: profile.reviewCount,
      averageRating: profile.averageRating,
    });
  }

  const counts = fabric.counts();
  const corpus = {
    seedTenant: TENANT_A,
    datasetOfferId: datasetRegistration.record.offerId,
    profiles: profileViews,
    counts: {
      offers: counts.offers,
      grants: counts.grants,
      reviews: counts.reviews,
      datasets: counts.datasets,
      'evaluation suites': counts.evaluationCriteria,
      environments: counts.environments,
      'provenance records': counts.provenanceRecords,
      'verification records': counts.verificationRecords,
    },
  };
  deepFreeze(corpus);
  return corpus;
}

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    Object.freeze(value);
  }
  return value;
}

export const SEED_TENANT = TENANT_A;
export const SEED_DATASET_OFFER_ID = 'solder-defect-dataset';
export const SEED_ENVIRONMENT_OFFER_ID = 'engineering-sandbox-environment';
