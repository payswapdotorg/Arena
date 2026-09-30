/**
 * ADVERSARIAL tests: failing trajectories, falsified evidence,
 * incompatible substrates, missing certification evidence, and
 * release-admission rejections.
 */

import { describe, expect, it } from 'vitest';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import { evaluateBodySubstrateCompatibility } from '@arena/compatibility';
import { createCompatibilityRegistry } from '@arena/compatibility';
import { createCertificationFabric } from '@arena/certification-fabric';
import { createVerificationFabric } from '@arena/verification-fabric';
import { EvaluationFabric } from '@arena/evaluation-fabric';
import { evaluateReleaseGate } from '@arena/body-registry';
import {
  SCENARIO,
  buildCriteria,
  buildEvaluatorDescriptor,
  buildReferenceSubstrate,
  buildSubject,
  buildTrajectory,
  buildVerifierDescriptor,
  runReferenceScenario,
} from './walkthrough.js';
import { makeStructuralEngineerEvaluator, makeStructuralEngineerVerifier } from './hooks.js';

describe('adversarial — evaluation', () => {
  it('scores a failed (non-completed) trajectory below the criteria', async () => {
    const receipt = await runReferenceScenario();
    const failedTrajectory = await buildTrajectory(
      receipt.bodyBuild.evolved.bodyVersion,
      receipt.substrate,
      receipt.environment,
      {
        taskId: receipt.taskSpec.identity.taskId,
        version: receipt.taskSpec.version,
      },
      receipt.trajectory.header.run.runRecordDigest ?? receipt.environment.digest,
      { completed: false },
    );
    const criteria = await buildCriteria(receipt.caseRecord.digest, failedTrajectory.chainHead);
    const evaluator = await buildEvaluatorDescriptor(
      receipt.caseRecord.digest,
      failedTrajectory.chainHead,
      criteria.digest,
      receipt.bodyBuild.evolved.bodyVersion.digest,
      receipt.substrate.integrity.contentDigest,
    );
    const fabric = new EvaluationFabric();
    fabric.registry.registerCriteria(criteria);
    fabric.registry.registerEvaluator(evaluator, makeStructuralEngineerEvaluator());
    const record = await fabric.evaluate(evaluator.digest, receipt.caseRecord, failedTrajectory, {
      seed: SCENARIO.seed,
      startedAt: SCENARIO.t5,
      finishedAt: SCENARIO.t6,
    });
    expect(record.aggregate.outcome).toBe('below-criteria');
    expect(record.aggregate.score).toBe(0);
  });
});

describe('adversarial — verification', () => {
  it('fails on a falsified (over-utilized) compliance report', async () => {
    const receipt = await runReferenceScenario();
    const verifier = await buildVerifierDescriptor();
    const fabric = createVerificationFabric();
    const falsified = await createMaterialArtifact({
      identity: { namespace: SCENARIO.tenant, name: 'struct-compliance-report-falsified', version: '1.0.0' },
      content: {
        suite: 'reference-compliance-suite',
        checksRun: 4,
        passed: 3,
        failures: ['beam-b1-gravity-uls'],
        maxUtilization: 1.12,
      },
    });
    fabric.putArtifact(falsified);
    fabric.putArtifact(receipt.trajectoryProof);
    fabric.registry.registerVerifier(
      verifier,
      makeStructuralEngineerVerifier({
        chainHead: receipt.trajectory.chainHead,
        entryCount: receipt.trajectory.entries.length,
      }),
    );
    const record = await fabric.verify(
      verifier.digest,
      [
        {
          evidenceKind: 'compliance-report',
          artifact: {
            namespace: falsified.identity.namespace,
            name: falsified.identity.name,
            version: falsified.identity.version,
            digest: falsified.digest,
          },
          provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t8, notes: null },
        },
        {
          evidenceKind: 'trajectory-proof',
          artifact: {
            namespace: receipt.trajectoryProof.identity.namespace,
            name: receipt.trajectoryProof.identity.name,
            version: receipt.trajectoryProof.identity.version,
            digest: receipt.trajectoryProof.digest,
          },
          provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t9, notes: null },
        },
      ],
      {
        correlationId: 'corr-struct-adversarial-1',
        idempotencyKey: 'idem-struct-adversarial-1',
        startedAt: SCENARIO.t6,
        finishedAt: SCENARIO.t7,
      },
    );
    expect(record.outcome).toBe('fail');
  });

  it('marks a trajectory proof that contradicts the observed chain as unsupported', async () => {
    const receipt = await runReferenceScenario();
    const verifier = await buildVerifierDescriptor();
    const fabric = createVerificationFabric();
    const contradictory = await createMaterialArtifact({
      identity: { namespace: SCENARIO.tenant, name: 'struct-trajectory-proof-forged', version: '1.0.0' },
      content: {
        chainHead: '0'.repeat(64),
        outcome: 'completed',
        entryCount: receipt.trajectory.entries.length,
      },
    });
    fabric.putArtifact(contradictory);
    fabric.putArtifact(receipt.complianceReport);
    fabric.registry.registerVerifier(
      verifier,
      makeStructuralEngineerVerifier({
        chainHead: receipt.trajectory.chainHead,
        entryCount: receipt.trajectory.entries.length,
      }),
    );
    const record = await fabric.verify(
      verifier.digest,
      [
        {
          evidenceKind: 'compliance-report',
          artifact: {
            namespace: receipt.complianceReport.identity.namespace,
            name: receipt.complianceReport.identity.name,
            version: receipt.complianceReport.identity.version,
            digest: receipt.complianceReport.digest,
          },
          provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t8, notes: null },
        },
        {
          evidenceKind: 'trajectory-proof',
          artifact: {
            namespace: contradictory.identity.namespace,
            name: contradictory.identity.name,
            version: contradictory.identity.version,
            digest: contradictory.digest,
          },
          provenance: { producedBy: 'arena-reference-runner', producedAt: SCENARIO.t9, notes: null },
        },
      ],
      {
        correlationId: 'corr-struct-adversarial-2',
        idempotencyKey: 'idem-struct-adversarial-2',
        startedAt: SCENARIO.t6,
        finishedAt: SCENARIO.t7,
      },
    );
    expect(record.outcome).toBe('fail');
  });
});

describe('adversarial — compatibility + certification', () => {
  it('rejects a substrate that cannot satisfy the body profile', async () => {
    const receipt = await runReferenceScenario();
    const weak = await buildReferenceSubstrate({
      toolCallingProfile: 'none',
      conditions: ['deprecated'],
      contextUnits: 128,
    });
    const result = await evaluateBodySubstrateCompatibility(
      receipt.bodyBuild.evolved.bodyVersion.substrateCompatibility,
      weak,
    );
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('downgrades certification to not-satisfied when the compatibility record is incompatible', async () => {
    const receipt = await runReferenceScenario();
    const weak = await buildReferenceSubstrate({ toolCallingProfile: 'none' });
    const registry = createCompatibilityRegistry();
    const incompatibleRecord = await registry.createAndRegister(
      `${receipt.bodyBuild.evolved.bodyVersion.body.tenant}/${receipt.bodyBuild.evolved.bodyVersion.body.name}@${receipt.bodyBuild.evolved.bodyVersion.version}#${receipt.bodyBuild.evolved.bodyVersion.digest}`,
      `${weak.modelId}@1.0.0#${weak.integrity.contentDigest}`,
      { verdict: 'incompatible-with-reasons', reasons: ['tool-calling below requirement'], details: {} },
      SCENARIO.t7,
    );
    const subject = buildSubject(
      receipt.bodyBuild.evolved.bodyVersion,
      weak,
      receipt.environment,
      receipt.possession.digest,
    );
    const fabric = createCertificationFabric();
    fabric.registry.registerSuite(receipt.suite);
    fabric.putVerificationRecord(receipt.verificationRecord);
    fabric.putEvaluationRecord(receipt.evaluationRecord);
    fabric.putCompatibilityRecord(incompatibleRecord);
    const record = await fabric.certify(
      receipt.suite.digest,
      subject,
      [
        receipt.verificationRecord.digest,
        receipt.evaluationRecord.digest,
        incompatibleRecord.recordDigest,
      ],
      {
        correlationId: 'corr-struct-adversarial-3',
        idempotencyKey: 'idem-struct-adversarial-3',
        startedAt: SCENARIO.t7,
        finishedAt: SCENARIO.t8,
      },
    );
    expect(record.verdict).toBe('not-satisfied');
    expect(record.grantedLevel).toBeNull();
  });

  it('returns unknown (fail-closed, missing-evidence) when evidence refs are absent', async () => {
    const receipt = await runReferenceScenario();
    const fabric = createCertificationFabric();
    fabric.registry.registerSuite(receipt.suite);
    const record = await fabric.certify(receipt.suite.digest, receipt.subject, [], {
      correlationId: 'corr-struct-adversarial-4',
      idempotencyKey: 'idem-struct-adversarial-4',
      startedAt: SCENARIO.t7,
      finishedAt: SCENARIO.t8,
    });
    expect(record.verdict).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('missing-evidence');
    expect(record.grantedLevel).toBeNull();
  });
});

describe('adversarial — release admission', () => {
  it('rejects a release candidate without certification citations', async () => {
    const receipt = await runReferenceScenario();
    const verdict = await evaluateReleaseGate(
      {
        bodyVersionRef: {
          tenant: receipt.bodyBuild.evolved.bodyVersion.body.tenant,
          name: receipt.bodyBuild.evolved.bodyVersion.body.name,
          version: receipt.bodyBuild.evolved.bodyVersion.version,
          digest: receipt.bodyBuild.evolved.bodyVersion.digest,
        },
        channel: 'stable',
        certificationRefs: [],
        compatibilityRefs: [receipt.compatibilityRecord.recordDigest],
        forgeRecordDigest: null,
      },
      {
        bodyVersions: (digest: string) =>
          digest === receipt.bodyBuild.evolved.bodyVersion.digest
            ? receipt.bodyBuild.evolved.bodyVersion
            : null,
        certificationRecords: () => null,
        compatibilityRecords: (digest: string) =>
          digest === receipt.compatibilityRecord.recordDigest ? receipt.compatibilityRecord : null,
      },
    );
    expect(verdict.admitted).toBe(false);
    expect(verdict.rejections.some((r) => r.reason === 'certification-required')).toBe(true);
  });

  it('rejects a stable-channel candidate whose grant is below CERTIFIED', async () => {
    const receipt = await runReferenceScenario();
    // Forge a DEVELOPMENT-grant certification record for the same subject.
    const { createCertificationRecord, createCertificationSuite } = await import(
      '@arena/certification'
    );
    const devSuite = await createCertificationSuite({
      suiteId: 'suite-struct-dev-only',
      version: '1.0.0',
      levelGrant: 'DEVELOPMENT',
      stages: receipt.suite.stages.map((stage) => ({ ...stage })),
      constraints: [],
      limitations: null,
      supersedes: null,
      inputSchema: receipt.suite.inputSchema,
      outputSchema: receipt.suite.outputSchema,
      provenance: { authoredBy: 'arena-reference-fabric', submittedAt: SCENARIO.t0, notes: null },
    });
    const devRecord = await createCertificationRecord(
      {
        subject: receipt.subject,
        suiteRef: devSuite.digest,
        stages: receipt.certificationRecord.stages.map((stage) => ({ ...stage })),
        supersedes: null,
        correlationId: 'corr-struct-adversarial-5',
        idempotencyKey: 'idem-struct-adversarial-5',
        tenantId: null,
        workspaceId: null,
        startedAt: SCENARIO.t7,
        finishedAt: SCENARIO.t8,
        provenance: { executedBy: 'certification-runner', recordedAt: SCENARIO.t8, notes: null },
      },
      devSuite,
    );
    const verdict = await evaluateReleaseGate(
      {
        bodyVersionRef: {
          tenant: receipt.bodyBuild.evolved.bodyVersion.body.tenant,
          name: receipt.bodyBuild.evolved.bodyVersion.body.name,
          version: receipt.bodyBuild.evolved.bodyVersion.version,
          digest: receipt.bodyBuild.evolved.bodyVersion.digest,
        },
        channel: 'stable',
        certificationRefs: [devRecord.digest],
        compatibilityRefs: [receipt.compatibilityRecord.recordDigest],
        forgeRecordDigest: null,
      },
      {
        bodyVersions: (digest: string) =>
          digest === receipt.bodyBuild.evolved.bodyVersion.digest
            ? receipt.bodyBuild.evolved.bodyVersion
            : null,
        certificationRecords: (digest: string) => (digest === devRecord.digest ? devRecord : null),
        compatibilityRecords: (digest: string) =>
          digest === receipt.compatibilityRecord.recordDigest ? receipt.compatibilityRecord : null,
      },
    );
    expect(verdict.admitted).toBe(false);
    expect(
      verdict.rejections.some((r) => r.reason === 'certification-insufficient-for-channel'),
    ).toBe(true);
  });
});
