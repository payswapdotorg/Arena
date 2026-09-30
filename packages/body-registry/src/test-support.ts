/**
 * Test support for @arena/body-registry (Work Order A024; mirrors the
 * sibling packages' test-support modules — internal, NOT exported from
 * the package index).
 *
 * Deterministic fixtures built through the REAL sibling constructors:
 *   - a REAL A003 BodyVersion (createBodyVersion);
 *   - a REAL A023 CertificationSuite + CertificationRecord (satisfied,
 *     CERTIFIED-grant, scoped to the fixture body version);
 *   - a REAL A022 CompatibilityRecord (compatible, canonical package
 *     digest, addressing the fixture body version);
 *   - a REAL A021 ForgeRecord (createForgeRecord, provenance citation).
 *
 * Fixed timestamps, fixed digests where only shape matters, no
 * Math.random anywhere.
 */

import { createBodyVersion } from '@arena/agent-body';
import type { BodyVersion } from '@arena/agent-body';
import { createCertificationRecord, createCertificationSuite } from '@arena/certification';
import type { CertificationRecord, CertificationSuite } from '@arena/certification';
import { createCompatibilityRegistry } from '@arena/compatibility';
import type { CompatibilityRecord } from '@arena/compatibility';
import { createForgeRecord } from '@arena/body-forge';
import type { ForgeRecord } from '@arena/body-forge';
import type { ReleaseCandidateInput, ReleaseEvidenceStores } from './gate.js';

export const T0 = '2026-09-29T10:00:00.000Z';
export const T1 = '2026-09-29T10:05:00.000Z';
export const T2 = '2026-09-29T10:10:00.000Z';
export const T3 = '2026-09-29T10:15:00.000Z';

export const DIGEST_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const DIGEST_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const DIGEST_C =
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

export const TENANT = 'acme';
export const BODY_NAME = 'structural-engineer-body';
export const BODY_VERSION = '1.4.0';

export const CORRELATION_ID = 'corr-release-1';
export const IDEMPOTENCY_KEY = 'idem-release-1';

// ---------------------------------------------------------------------------
// REAL A003 BodyVersion fixture
// ---------------------------------------------------------------------------

export async function makeBodyVersion(
  overrides: Record<string, unknown> = {},
): Promise<BodyVersion> {
  const digest = overrides['digest'] as string | undefined;
  const version = (overrides['version'] as string | undefined) ?? BODY_VERSION;
  return createBodyVersion({
    body: { tenant: TENANT, name: BODY_NAME },
    version,
    mission: 'Deliver structural engineering review under explicit authority boundaries.',
    role: 'structural-engineer',
    domainScope: ['structural-engineering', 'code-review'],
    capabilities: ['static-analysis', 'load-path-review'],
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
      { namespace: 'arena', name: 'structural-eval', version: '1.2.0', digest: DIGEST_A },
    ],
    verificationSuites: [
      { namespace: 'arena', name: 'structural-verify', version: '1.1.0', digest: DIGEST_B },
    ],
    environmentRequirements: [
      { namespace: 'arena', name: 'structural-env', version: '3.2.0', digest: DIGEST_C },
    ],
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 1000 },
    },
    provenance: {
      creator: { type: 'service', tenant: TENANT, principalId: 'arena-forge' },
      createdAt: T0,
      rights: {
        license: 'Proprietary',
        commercialUse: 'requires-license',
        redistribution: 'tenant-only',
        customerData: 'derived',
        professionalLimitations: ['not a licensed engineering system'],
      },
      records: [],
    },
    lineage: { parents: [] },
    ...(digest !== undefined ? {} : {}),
    ...overrides,
  } as Parameters<typeof createBodyVersion>[0]);
}

/** The canonical A003 ref key for the fixture body version. */
export function fixtureBodyVersionRefKey(
  version: string = BODY_VERSION,
  digest: string,
): string {
  return `${TENANT}/${BODY_NAME}@${version}#${digest}`;
}

// ---------------------------------------------------------------------------
// REAL A023 certification evidence fixture
// ---------------------------------------------------------------------------

export const CERT_SCHEMA = {
  namespace: 'certification',
  name: 'certification-record',
  version: '1.0.0',
};

export async function makeCertificationSuite(
  overrides: Record<string, unknown> = {},
): Promise<CertificationSuite> {
  return createCertificationSuite({
    suiteId: 'structural-certification',
    version: '2.1.0',
    levelGrant: 'CERTIFIED',
    stages: [
      {
        stageId: 'verify-1',
        kind: 'verification',
        evaluatorRef: null,
        criteriaRef: null,
        verifierRef: DIGEST_C,
        requiredTestSuites: [],
        datasetRef: null,
        environmentRequirement: null,
        runtimeRequirement: null,
      },
    ],
    constraints: [],
    limitations: null,
    supersedes: null,
    inputSchema: CERT_SCHEMA,
    outputSchema: CERT_SCHEMA,
    provenance: { authoredBy: 'arena-architect', submittedAt: T0, notes: null },
    ...overrides,
  } as Parameters<typeof createCertificationSuite>[0]);
}

export interface MakeCertificationRecordOptions {
  readonly bodyVersionDigest: string;
  readonly bodyVersion?: string;
  readonly levelGrant?: string;
  readonly verdictStages?: readonly { outcome: string; reason: string }[];
}

/**
 * Build a REAL, tamper-verifiable A023 certification-run record scoped
 * to the fixture body version (satisfied, granted) — or a deliberately
 * failing/indeterminate one via overrides.
 */
export async function makeCertificationRecord(
  options: MakeCertificationRecordOptions,
): Promise<{ suite: CertificationSuite; record: CertificationRecord }> {
  const suite = await makeCertificationSuite({
    ...(options.levelGrant !== undefined ? { levelGrant: options.levelGrant } : {}),
  });
  const stages =
    options.verdictStages !== undefined
      ? options.verdictStages
      : [{ outcome: 'satisfied', reason: 'stage-satisfied' }];
  const record = await createCertificationRecord(
    {
      subject: {
        bodyVersionRef: {
          tenant: TENANT,
          name: BODY_NAME,
          version: options.bodyVersion ?? BODY_VERSION,
          digest: options.bodyVersionDigest,
        },
        substrateRef: {
          substrateId: 'substrate-x',
          substrateVersion: '6.0.1',
          digest: DIGEST_B,
        },
        environmentRef: {
          environmentId: 'structural-env',
          environmentVersion: '3.2.0',
          constraints: ['offline'],
        },
        runtimeProfile: {
          runtimeId: 'arena-runtime',
          runtimeVersion: '2.1.0',
          configuration: { timeoutMs: 30000 },
        },
        possessionRef: null,
        tenantId: `tenant-${TENANT}`,
        workspaceId: 'ws-main',
      },
      suiteRef: suite.digest,
      stages: stages.map((stage, index) => ({
        stageId: `verify-${index + 1}`,
        outcome: stage.outcome,
        reason: stage.reason,
        evidenceDigest: DIGEST_C,
        unknownCause: null,
      })),
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
  return { suite, record };
}

// ---------------------------------------------------------------------------
// REAL A022 compatibility evidence fixture
// ---------------------------------------------------------------------------

/**
 * Build a REAL, tamper-verifiable A022 compatibility record (canonical
 * package digest, compatible verdict, addressing the fixture body
 * version) through the A022 package's own registry constructor.
 */
export async function makeCompatibilityRecord(
  bodyVersionDigest: string,
  overrides: {
    verdict?: string;
    bodyVersionAddress?: string;
    substrateRef?: string;
    tenantId?: string;
  } = {},
): Promise<CompatibilityRecord> {
  const registry = createCompatibilityRegistry();
  return registry.createAndRegister(
    overrides.bodyVersionAddress ?? fixtureBodyVersionRefKey(BODY_VERSION, bodyVersionDigest),
    overrides.substrateRef ?? `substrate-x@6.0.1#${DIGEST_B}`,
    {
      verdict: (overrides.verdict ?? 'compatible') as 'compatible',
      reasons: [],
      details: {},
    },
    T1,
    undefined,
    overrides.tenantId,
  );
}

// ---------------------------------------------------------------------------
// REAL A021 forge provenance fixture
// ---------------------------------------------------------------------------

export async function makeForgeRecord(
  bodyVersionDigest: string,
  version: string = BODY_VERSION,
): Promise<ForgeRecord> {
  return createForgeRecord({
    forgeKey: 'forge-key-fixture-1',
    correlationId: 'corr-forge-1',
    manifestDigest: DIGEST_A,
    policyDigest: DIGEST_B,
    bodyVersionDigest,
    bodyVersionRef: {
      tenant: TENANT,
      name: BODY_NAME,
      version,
      digest: bodyVersionDigest,
    },
    provenance: { forgedBy: 'arena-forge', recordedAt: T0, notes: null },
  });
}

// ---------------------------------------------------------------------------
// Evidence stores + candidate
// ---------------------------------------------------------------------------

/** In-memory digest-addressed evidence stores for one scenario. */
export interface FixtureScenario {
  readonly bodyVersion: BodyVersion;
  readonly certification: CertificationRecord;
  readonly compatibility: CompatibilityRecord;
  readonly forgeRecord: ForgeRecord | null;
  readonly stores: ReleaseEvidenceStores;
  readonly candidate: ReleaseCandidateInput;
}

/** Build the happy-path scenario: REAL evidence, admitted candidate. */
export async function makeAdmittedScenario(
  options: {
    channel?: string;
    levelGrant?: string;
    includeForge?: boolean;
  } = {},
): Promise<FixtureScenario> {
  const bodyVersion = await makeBodyVersion();
  const { record: certification } = await makeCertificationRecord({
    bodyVersionDigest: bodyVersion.digest,
    ...(options.levelGrant !== undefined ? { levelGrant: options.levelGrant } : {}),
  });
  const compatibility = await makeCompatibilityRecord(bodyVersion.digest);
  const forgeRecord =
    options.includeForge === true ? await makeForgeRecord(bodyVersion.digest) : null;
  const stores: ReleaseEvidenceStores = {
    bodyVersions: (digest) => (digest === bodyVersion.digest ? bodyVersion : null),
    certificationRecords: (digest) => (digest === certification.digest ? certification : null),
    compatibilityRecords: (digest) => (digest === compatibility.recordDigest ? compatibility : null),
    ...(forgeRecord !== null
      ? { forgeRecords: (digest: string) => (digest === forgeRecord.digest ? forgeRecord : null) }
      : {}),
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
    forgeRecordDigest: forgeRecord !== null ? forgeRecord.digest : null,
  };
  return { bodyVersion, certification, compatibility, forgeRecord, stores, candidate };
}
