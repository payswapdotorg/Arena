/**
 * Test support for @arena/api-fabric (Work Order A025; mirrors the
 * package-level test-support convention — internal, NOT exported).
 *
 * Deterministic REAL sibling-protocol fixtures (A003 BodyVersion, A023
 * CertificationSuite/CertificationRecord, A022 CompatibilityRecord,
 * A024 ReleaseRecord/ReleasePublicationRecord, including supersession
 * and retirement lineage) built through the REAL constructors, with a
 * REAL release admission evaluated by evaluateReleaseGate.
 */

import { createBodyVersion } from '@arena/agent-body';
import type { BodyVersion } from '@arena/agent-body';
import {
  createCertificationRecord,
  createCertificationSuite,
  createRevocationRecord,
} from '@arena/certification';
import type { CertificationRecord, CertificationSuite } from '@arena/certification';
import { createCompatibilityRegistry } from '@arena/compatibility';
import type { CompatibilityRecord } from '@arena/compatibility';
import {
  createReleaseRegistrationRecord,
  createReleaseRetirementRecord,
  createReleaseSupersessionRecord,
  evaluateReleaseGate,
  publishRelease,
} from '@arena/body-registry';
import type {
  ReleaseCandidateInput,
  ReleaseEvidenceStores,
  ReleasePublicationRecord,
  ReleaseRecord,
} from '@arena/body-registry';

export const T0 = '2026-09-30T08:00:00.000Z';
export const T1 = '2026-09-30T08:05:00.000Z';
export const T2 = '2026-09-30T08:10:00.000Z';
export const T3 = '2026-09-30T08:15:00.000Z';

export const TENANT = 'acme';
export const OTHER_TENANT = 'globex';
export const BODY_NAME = 'structural-engineer-body';

export const RIGHTS = {
  license: 'Proprietary',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'derived',
  professionalLimitations: ['not a licensed engineering system'],
};

export const PUBLISHER = { type: 'service', tenant: TENANT, principalId: 'release-bot' };

export async function makeBodyVersion(
  version = '1.4.0',
  tenant = TENANT,
): Promise<BodyVersion> {
  return createBodyVersion({
    body: { tenant, name: BODY_NAME },
    version,
    mission: 'Deliver structural engineering review under explicit authority boundaries.',
    role: 'structural-engineer',
    domainScope: ['structural-engineering', 'code-review'],
    capabilities: ['static-analysis'],
    skills: [],
    knowledge: [],
    tools: [],
    procedures: [],
    memoryPolicy: { policyId: 'memory-default', statements: ['retain task-scoped notes only'] },
    planningPolicy: { policyId: 'planning-default', statements: ['plan before acting'] },
    escalation: {
      rules: [
        {
          condition: 'jurisdiction-sign-off-required',
          target: { type: 'expert', tenant, principalId: 'reviewer-1' },
        },
      ],
    },
    authorityBoundaries: ['no legal sign-off authority'],
    safetyPolicy: { policyId: 'safety-default', statements: ['fail closed on ambiguity'] },
    evaluationSuites: [
      { namespace: 'arena', name: 'structural-eval', version: '1.2.0', digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ],
    verificationSuites: [
      { namespace: 'arena', name: 'structural-verify', version: '1.1.0', digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    ],
    environmentRequirements: [
      { namespace: 'arena', name: 'structural-env', version: '3.2.0', digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 1000 },
    },
    provenance: {
      creator: { type: 'service', tenant, principalId: 'arena-forge' },
      createdAt: T0,
      rights: RIGHTS,
      records: [],
    },
    lineage: { parents: [] },
  } as Parameters<typeof createBodyVersion>[0]);
}

export async function makeSuite(levelGrant = 'CERTIFIED'): Promise<CertificationSuite> {
  return createCertificationSuite({
    suiteId: 'structural-certification',
    version: '2.1.0',
    levelGrant,
    stages: [
      {
        stageId: 'verify-1',
        kind: 'verification',
        evaluatorRef: null,
        criteriaRef: null,
        verifierRef: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
    ],
    constraints: [],
    limitations: null,
    supersedes: null,
    inputSchema: { namespace: 'certification', name: 'certification-record', version: '1.0.0' },
    outputSchema: { namespace: 'certification', name: 'certification-record', version: '1.0.0' },
    provenance: { authoredBy: 'arena-architect', submittedAt: T0, notes: null },
  } as Parameters<typeof createCertificationSuite>[0]);
}

export async function makeCertification(
  bodyVersion: BodyVersion,
  suite: CertificationSuite,
  suffix = '1',
): Promise<CertificationRecord> {
  return createCertificationRecord(
    {
      subject: {
        bodyVersionRef: {
          tenant: bodyVersion.body.tenant,
          name: bodyVersion.body.name,
          version: bodyVersion.version,
          digest: bodyVersion.digest,
        },
        substrateRef: { substrateId: 'substrate-x', substrateVersion: '6.0.1', digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
        environmentRef: { environmentId: 'structural-env', environmentVersion: '3.2.0', constraints: ['offline'] },
        runtimeProfile: { runtimeId: 'arena-runtime', runtimeVersion: '2.1.0', configuration: { timeoutMs: 30000 } },
        possessionRef: null,
        tenantId: `tenant-${TENANT}`,
        workspaceId: 'ws-main',
      },
      suiteRef: suite.digest,
      stages: [
        {
          stageId: 'verify-1',
          outcome: 'satisfied',
          reason: 'stage-satisfied',
          evidenceDigest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          unknownCause: null,
        },
      ],
      supersedes: null,
      correlationId: `corr-cert-${suffix}`,
      idempotencyKey: `idem-cert-${suffix}`,
      tenantId: null,
      workspaceId: null,
      startedAt: T0,
      finishedAt: T1,
      provenance: { executedBy: 'certification-runner', recordedAt: T1, notes: null },
    },
    suite,
  );
}

export async function makeRevocation(
  target: CertificationRecord,
): Promise<CertificationRecord> {
  return createRevocationRecord({
    revokes: target.digest,
    grounds: 'professional-limitations breached',
    correlationId: 'corr-revoke-1',
    idempotencyKey: 'idem-revoke-1',
    tenantId: null,
    workspaceId: null,
    startedAt: T2,
    finishedAt: T2,
    provenance: { executedBy: 'certification-runner', recordedAt: T2, notes: null },
  });
}

export async function makeCompatibility(bodyVersion: BodyVersion): Promise<CompatibilityRecord> {
  const registry = createCompatibilityRegistry();
  return registry.createAndRegister(
    `${bodyVersion.body.tenant}/${bodyVersion.body.name}@${bodyVersion.version}#${bodyVersion.digest}`,
    'substrate-x@6.0.1#bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    { verdict: 'compatible', reasons: [], details: {} },
    T1,
    undefined,
  );
}

export async function makeReleaseRegistration(
  bodyVersion: BodyVersion,
  certification: CertificationRecord,
  compatibility: CompatibilityRecord,
  options: {
    channel?: string;
    releaseVersion?: string;
    tenantId?: string | null;
    suffix?: string;
    releasedAt?: string;
  } = {},
): Promise<ReleaseRecord> {
  const candidate: ReleaseCandidateInput = {
    bodyVersionRef: {
      tenant: bodyVersion.body.tenant,
      name: bodyVersion.body.name,
      version: bodyVersion.version,
      digest: bodyVersion.digest,
    },
    channel: options.channel ?? 'stable',
    certificationRefs: [certification.digest],
    compatibilityRefs: [compatibility.recordDigest],
    forgeRecordDigest: null,
  };
  const stores: ReleaseEvidenceStores = {
    bodyVersions: (digest) => (digest === bodyVersion.digest ? bodyVersion : null),
    certificationRecords: (digest) => (digest === certification.digest ? certification : null),
    compatibilityRecords: (digest) =>
      digest === compatibility.recordDigest ? compatibility : null,
  };
  const verdict = await evaluateReleaseGate(candidate, stores);
  if (!verdict.admitted || verdict.evidence === null) {
    throw new Error(`fixture release candidate was not admitted: ${JSON.stringify(verdict.rejections)}`);
  }
  const suffix = options.suffix ?? '1';
  return createReleaseRegistrationRecord({
    bodyVersionRef: candidate.bodyVersionRef,
    releaseVersion: options.releaseVersion ?? '2.0.0',
    gate: verdict.evidence,
    tags: ['fixture'],
    releasedAt: options.releasedAt ?? T1,
    correlationId: `corr-release-${suffix}`,
    idempotencyKey: `idem-release-${suffix}`,
    tenantId: options.tenantId === undefined ? TENANT : options.tenantId,
    workspaceId: 'ws-main',
    provenance: { releasedBy: 'release-bot', recordedAt: T1, notes: null },
  });
}

export async function makeSupersession(
  target: ReleaseRecord,
  suffix = '2',
): Promise<ReleaseRecord> {
  return createReleaseSupersessionRecord({
    target: target.digest,
    grounds: 'superseded by a newer release',
    correlationId: `corr-supersede-${suffix}`,
    idempotencyKey: `idem-supersede-${suffix}`,
    tenantId: target.tenantId,
    workspaceId: null,
    provenance: { releasedBy: 'release-bot', recordedAt: T2, notes: null },
  });
}

export async function makeRetirement(target: ReleaseRecord): Promise<ReleaseRecord> {
  return createReleaseRetirementRecord({
    target: target.digest,
    grounds: 'retired for safety review',
    correlationId: 'corr-retire-1',
    idempotencyKey: 'idem-retire-1',
    tenantId: target.tenantId,
    workspaceId: null,
    provenance: { releasedBy: 'release-bot', recordedAt: T3, notes: null },
  });
}

export async function makeReleasePublication(
  registration: ReleaseRecord,
): Promise<ReleasePublicationRecord> {
  return publishRelease({
    registration,
    publisher: PUBLISHER,
    rights: RIGHTS,
    publishedAt: T2,
  });
}

/** The full deterministic scenario: real records over the real constructors. */
export interface ApiScenario {
  readonly bodyVersion: BodyVersion;
  readonly suite: CertificationSuite;
  readonly certification: CertificationRecord;
  readonly compatibility: CompatibilityRecord;
  readonly registration: ReleaseRecord;
  readonly publication: ReleasePublicationRecord;
}

export async function makeScenario(
  options: { channel?: string; tenantId?: string | null } = {},
): Promise<ApiScenario> {
  const bodyVersion = await makeBodyVersion();
  const suite = await makeSuite();
  const certification = await makeCertification(bodyVersion, suite);
  const compatibility = await makeCompatibility(bodyVersion);
  const registration = await makeReleaseRegistration(
    bodyVersion,
    certification,
    compatibility,
    options,
  );
  const publication = await makeReleasePublication(registration);
  return { bodyVersion, suite, certification, compatibility, registration, publication };
}
