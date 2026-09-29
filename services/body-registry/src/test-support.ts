/**
 * Test support for @arena/body-registry-fabric (Work Order A024;
 * mirrors the package-level test-support — internal, NOT exported).
 *
 * Deterministic REAL sibling-protocol fixtures (A003 BodyVersion, A023
 * CertificationRecord, A022 CompatibilityRecord, A021 ForgeRecord)
 * resolved through in-memory evidence stores.
 */

import { createBodyVersion } from '@arena/agent-body';
import type { BodyVersion } from '@arena/agent-body';
import { createCertificationRecord, createCertificationSuite } from '@arena/certification';
import type { CertificationRecord } from '@arena/certification';
import { createCompatibilityRegistry } from '@arena/compatibility';
import type { CompatibilityRecord } from '@arena/compatibility';
import { createForgeRecord } from '@arena/body-forge';
import type { ReleaseCandidateInput, ReleaseEvidenceStores } from '@arena/body-registry';

export const T0 = '2026-09-29T10:00:00.000Z';
export const T1 = '2026-09-29T10:05:00.000Z';
export const T2 = '2026-09-29T10:10:00.000Z';
export const T3 = '2026-09-29T10:15:00.000Z';

export const TENANT = 'acme';
export const BODY_NAME = 'structural-engineer-body';

export const RIGHTS = {
  license: 'Proprietary',
  commercialUse: 'requires-license',
  redistribution: 'tenant-only',
  customerData: 'derived',
  professionalLimitations: ['not a licensed engineering system'],
};

export const PUBLISHER = { type: 'service', tenant: TENANT, principalId: 'release-bot' };

export async function makeBodyVersion(version = '1.4.0'): Promise<BodyVersion> {
  return createBodyVersion({
    body: { tenant: TENANT, name: BODY_NAME },
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
          target: { type: 'expert', tenant: TENANT, principalId: 'reviewer-1' },
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
      creator: { type: 'service', tenant: TENANT, principalId: 'arena-forge' },
      createdAt: T0,
      rights: RIGHTS,
      records: [],
    },
    lineage: { parents: [] },
  } as Parameters<typeof createBodyVersion>[0]);
}

export async function makeCertification(
  bodyVersion: BodyVersion,
  levelGrant = 'CERTIFIED',
): Promise<CertificationRecord> {
  const suite = await createCertificationSuite({
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
      correlationId: 'corr-cert-1',
      idempotencyKey: 'idem-cert-1',
      tenantId: null,
      workspaceId: null,
      startedAt: T0,
      finishedAt: T1,
      provenance: { executedBy: 'certification-runner', recordedAt: T1, notes: null },
    },
    suite,
  );
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

export interface ServiceScenario {
  readonly bodyVersion: BodyVersion;
  readonly certification: CertificationRecord;
  readonly compatibility: CompatibilityRecord;
  readonly stores: ReleaseEvidenceStores;
  readonly candidate: ReleaseCandidateInput;
}

export async function makeScenario(
  options: { channel?: string; levelGrant?: string; bodyVersion?: string } = {},
): Promise<ServiceScenario> {
  const bodyVersion = await makeBodyVersion(options.bodyVersion);
  const certification = await makeCertification(bodyVersion, options.levelGrant);
  const compatibility = await makeCompatibility(bodyVersion);
  const stores: ReleaseEvidenceStores = {
    bodyVersions: (digest) => (digest === bodyVersion.digest ? bodyVersion : null),
    certificationRecords: (digest) => (digest === certification.digest ? certification : null),
    compatibilityRecords: (digest) => (digest === compatibility.recordDigest ? compatibility : null),
  };
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
  return { bodyVersion, certification, compatibility, stores, candidate };
}

/** Forge a record for provenance-citation scenarios. */
export async function makeForgeRecordFor(bodyVersion: BodyVersion) {
  return createForgeRecord({
    forgeKey: 'forge-key-fixture-1',
    correlationId: 'corr-forge-1',
    manifestDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    policyDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    bodyVersionDigest: bodyVersion.digest,
    bodyVersionRef: {
      tenant: bodyVersion.body.tenant,
      name: bodyVersion.body.name,
      version: bodyVersion.version,
      digest: bodyVersion.digest,
    },
    provenance: { forgedBy: 'arena-forge', recordedAt: T0, notes: null },
  });
}
