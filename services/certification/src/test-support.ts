/**
 * Test support for @arena/certification-fabric (internal — mirrors the
 * domain package's test-support; deterministic fixtures only).
 */

import {
  createCertificationSubject,
  createCertificationSuite,
} from '@arena/certification';
import type { CertificationSuite, CertificationSubject } from '@arena/certification';
import type { SchemaRef } from '@arena/protocol-core';

export const T0 = '2026-09-29T10:00:00.000Z';
export const T1 = '2026-09-29T10:05:00.000Z';
export const T2 = '2026-09-29T10:10:00.000Z';

export const DIGEST_A =
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const DIGEST_B =
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const DIGEST_C =
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
export const DIGEST_D =
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
export const DIGEST_E =
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

const CERT_SCHEMA: SchemaRef = {
  namespace: 'certification',
  name: 'certification-record',
  version: '1.0.0',
};

export function makeSubject(): CertificationSubject {
  return createCertificationSubject({
    bodyVersionRef: {
      tenant: 'acme',
      name: 'structural-engineer-body',
      version: '1.4.0',
      digest: DIGEST_A,
    },
    substrateRef: { substrateId: 'substrate-x', substrateVersion: '6.0.1', digest: DIGEST_B },
    environmentRef: {
      environmentId: 'structural-env',
      environmentVersion: '3.2.0',
      constraints: ['offline', 'sandboxed-tools'],
    },
    runtimeProfile: {
      runtimeId: 'arena-runtime',
      runtimeVersion: '2.1.0',
      configuration: { timeoutMs: 30000 },
    },
    possessionRef: null,
    tenantId: 'tenant-acme',
    workspaceId: 'ws-main',
  });
}

export async function makeSuite(
  stages: readonly unknown[],
  overrides: Record<string, unknown> = {},
): Promise<CertificationSuite> {
  return createCertificationSuite({
    suiteId: 'structural-certification',
    version: '2.1.0',
    levelGrant: 'CERTIFIED',
    stages,
    constraints: [],
    limitations: null,
    supersedes: null,
    inputSchema: CERT_SCHEMA,
    outputSchema: CERT_SCHEMA,
    provenance: { authoredBy: 'arena-architect', submittedAt: T0, notes: null },
    ...overrides,
  } as Parameters<typeof createCertificationSuite>[0]);
}

export function verificationStage(stageId: string, verifierRef: string): Record<string, unknown> {
  return {
    stageId,
    kind: 'verification',
    evaluatorRef: null,
    criteriaRef: null,
    verifierRef,
    requiredTestSuites: [],
    datasetRef: null,
    environmentRequirement: null,
    runtimeRequirement: null,
  };
}

export function evaluationStage(
  stageId: string,
  evaluatorRef: string,
  criteriaRef: string,
): Record<string, unknown> {
  return {
    stageId,
    kind: 'evaluation',
    evaluatorRef,
    criteriaRef,
    verifierRef: null,
    requiredTestSuites: [],
    datasetRef: null,
    environmentRequirement: null,
    runtimeRequirement: null,
  };
}

export function compatibilityStage(stageId: string): Record<string, unknown> {
  return {
    stageId,
    kind: 'compatibility',
    evaluatorRef: null,
    criteriaRef: null,
    verifierRef: null,
    requiredTestSuites: [],
    datasetRef: null,
    environmentRequirement: null,
    runtimeRequirement: null,
  };
}

// --- guard-valid sibling evidence records (the REAL public guards accept them) ---

export function makeVerificationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordVersion: 1,
    verifierRef: DIGEST_C,
    evidence: [
      {
        evidenceKind: 'constraint-report',
        artifact: { namespace: 'acme', name: 'constraint-report', version: '1.0.0', digest: DIGEST_D },
        provenance: { producedBy: 'arena-runner', producedAt: T0, notes: null },
      },
    ],
    evidenceSupport: [
      { requirementId: 'req-1', status: 'present-supported', evidenceDigest: DIGEST_D, notes: null },
    ],
    outcome: 'pass',
    unknownCause: null,
    correlationId: 'corr-verification-1',
    idempotencyKey: 'idem-verification-1',
    inputDigest: DIGEST_E,
    startedAt: T0,
    finishedAt: T1,
    provenance: { executedBy: 'constraint-verifier', recordedAt: T1, notes: null },
    digest: DIGEST_A,
    ...overrides,
  };
}

export function makeEvaluationRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordVersion: 1,
    evaluatorRef: DIGEST_B,
    caseRef: DIGEST_D,
    trajectoryRef: DIGEST_E,
    criteriaRef: DIGEST_C,
    seed: null,
    verdicts: [{ criterionId: 'criterion-1', score: 0.95, judgment: null, notes: null }],
    aggregate: { score: 0.95, outcome: 'meets-criteria' },
    confidence: 0.9,
    limitations: null,
    startedAt: T0,
    finishedAt: T1,
    provenance: { executedBy: 'reference-evaluator', recordedAt: T1, notes: null },
    digest: DIGEST_E,
    ...overrides,
  };
}

export function makeCompatibilityRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordVersion: 1,
    recordDigest: DIGEST_C,
    bodyVersionRef: `acme/structural-engineer-body@1.4.0#${DIGEST_A}`,
    substrateRef: `substrate-x@6.0.1#${DIGEST_B}`,
    evaluatedAt: T1,
    verdict: 'compatible',
    reasons: [],
    details: {},
    tenantId: 'tenant-acme',
    workspaceId: 'ws-main',
    ...overrides,
  };
}
