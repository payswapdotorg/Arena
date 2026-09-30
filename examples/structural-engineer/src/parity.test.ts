/**
 * PARITY tests: cross-protocol contracts that MUST stay byte-identical
 * across packages (environment refs, manifest→BodyVersion projection,
 * certification stage pins, SDK loopback reads).
 */

import { describe, expect, it } from 'vitest';
import { environmentVersionRef } from '@arena/environment-protocol';
import { ArenaApiClient, createLoopbackTransport } from '@arena/arena-sdk';
import { createApiFabric } from '@arena/api-fabric';
import { createPossession } from '@arena/agent-body';
import { runReferenceScenario } from './walkthrough.js';
import { SCENARIO } from './walkthrough.js';

describe('parity — environment references', () => {
  it('TaskSpec initialState.environment === manifest.environmentRequirements[0] === environmentVersionRef(definition)', async () => {
    const receipt = await runReferenceScenario();
    const ref = environmentVersionRef(receipt.environment);
    expect(receipt.taskSpec.initialState.environment).toEqual(ref);
    expect(receipt.bodyBuild.evolved.manifest.environmentRequirements[0]).toEqual(ref);
    expect(receipt.caseRecord.environmentRequirements.environments[0]).toEqual(ref);
    expect(receipt.trajectory.header.run.environmentVersion).toEqual({
      namespace: ref.namespace,
      name: ref.name,
      version: ref.version,
      digest: ref.digest,
    });
  });

  it('the compiled TaskSpec carries the case evaluator/verifier bindings verbatim', async () => {
    const receipt = await runReferenceScenario();
    const caseEvaluator = receipt.caseRecord.evaluationRequirements.evaluators[0]!;
    expect(receipt.taskSpec.evaluatorBindings[0]!.evaluatorId).toBe(caseEvaluator.id);
    expect(receipt.taskSpec.evaluatorBindings[0]!.version).toBe(caseEvaluator.version);
    expect(receipt.taskSpec.evaluatorBindings[0]!.descriptorDigest).toBe(caseEvaluator.digest);
    const caseVerifier = receipt.caseRecord.verificationRequirements.verifiers[0]!;
    expect(receipt.taskSpec.verifierBindings[0]!.verifierId).toBe(caseVerifier.id);
    expect(receipt.taskSpec.verifierBindings[0]!.descriptorDigest).toBe(caseVerifier.digest);
  });
});

describe('parity — manifest → BodyVersion projection (A021)', () => {
  it('projects capabilities, surface refs, policies and compatibility profile verbatim', async () => {
    const receipt = await runReferenceScenario();
    const manifest = receipt.bodyBuild.evolved.manifest;
    const bodyVersion = receipt.bodyBuild.evolved.bodyVersion;
    expect(bodyVersion.capabilities).toEqual(manifest.capabilities.map((c) => c.id));
    expect(bodyVersion.tools).toEqual(manifest.tools);
    expect(bodyVersion.skills).toEqual(manifest.skills);
    expect(bodyVersion.knowledge).toEqual(manifest.knowledge);
    expect(bodyVersion.procedures).toEqual(manifest.procedures);
    expect(bodyVersion.mission).toBe(manifest.mission);
    expect(bodyVersion.role).toBe(manifest.role);
    expect(bodyVersion.substrateCompatibility).toEqual(manifest.substrateCompatibility);
    expect(bodyVersion.evaluationSuites).toEqual(manifest.evaluationSuites);
    expect(bodyVersion.verificationSuites).toEqual(manifest.verificationSuites);
    expect(bodyVersion.environmentRequirements).toEqual(manifest.environmentRequirements);
    expect(bodyVersion.provenance.rights).toEqual(manifest.rights);
  });
});

describe('parity — certification stage pins', () => {
  it('suite stages pin the exact record refs that were produced', async () => {
    const receipt = await runReferenceScenario();
    const verificationStage = receipt.suite.stages.find((s) => s.kind === 'verification')!;
    const evaluationStage = receipt.suite.stages.find((s) => s.kind === 'evaluation')!;
    expect(verificationStage.verifierRef).toBe(receipt.verifier.digest);
    expect(evaluationStage.evaluatorRef).toBe(receipt.evaluator.digest);
    expect(evaluationStage.criteriaRef).toBe(receipt.criteria.digest);
    expect(receipt.evaluationRecord.evaluatorRef).toBe(receipt.evaluator.digest);
    expect(receipt.evaluationRecord.criteriaRef).toBe(receipt.criteria.digest);
    expect(receipt.verificationRecord.verifierRef).toBe(receipt.verifier.digest);
  });

  it('the certification subject matches the release candidate body version ref', async () => {
    const receipt = await runReferenceScenario();
    expect(receipt.subject.bodyVersionRef).toEqual({
      tenant: receipt.bodyBuild.evolved.bodyVersion.body.tenant,
      name: receipt.bodyBuild.evolved.bodyVersion.body.name,
      version: receipt.bodyBuild.evolved.bodyVersion.version,
      digest: receipt.bodyBuild.evolved.bodyVersion.digest,
    });
    expect(receipt.releaseRecord.bodyVersionRef).toEqual(receipt.subject.bodyVersionRef);
  });
});

describe('parity — possession determinism', () => {
  it('rebinding the same composition yields the same possession digest', async () => {
    const receipt = await runReferenceScenario();
    const again = await createPossession({
      bodyVersion: receipt.bodyBuild.evolved.bodyVersion,
      substrate: receipt.substrate,
      runtime: {
        runtimeId: SCENARIO.runtimeId,
        runtimeVersion: '1.0.0',
        configuration: { timeoutMs: 30000, maxSteps: 64 },
      },
      environment: {
        environmentId: receipt.environment.identity.name,
        environmentVersion: receipt.environment.version,
        constraints: ['seeded-simulation', 'declared-mounts-only', 'default-deny-egress'],
      },
      policies: {
        bundleId: 'bundle-struct-reference',
        bundleVersion: '1.0.0',
        policies: [
          { policyId: 'memory-task-scoped', statements: ['retain task-scoped working notes only'] },
          {
            policyId: 'safety-no-silent-capacity',
            statements: ['never silently assume capacity; cite the pinned code edition'],
          },
        ],
      },
      modelSpecificArtifacts: [],
    });
    expect(again.digest).toBe(receipt.possession.digest);
  });
});

describe('parity — SDK loopback reads', () => {
  it('returns the exact records that were registered, published and certified', async () => {
    const receipt = await runReferenceScenario();
    const apiFabric = createApiFabric();
    apiFabric.putReleaseRecord(receipt.releaseRecord);
    apiFabric.putReleasePublication(receipt.publication);
    apiFabric.putCertificationRecord(receipt.certificationRecord);
    apiFabric.putCertificationSuite(receipt.suite);
    apiFabric.putCompatibilityRecord(receipt.compatibilityRecord);
    apiFabric.putBodyVersion(receipt.bodyBuild.evolved.bodyVersion);
    const client = ArenaApiClient.forTenant(
      createLoopbackTransport(apiFabric),
      SCENARIO.tenant,
    );

    const release = await client.resolveActiveRelease(
      SCENARIO.tenant,
      receipt.bodyBuild.evolved.bodyVersion.body.name,
      'stable',
    );
    expect(release?.digest).toBe(receipt.releaseRecord.digest);

    const certification = await client.getCertificationRecord(receipt.certificationRecord.digest);
    expect(certification?.digest).toBe(receipt.certificationRecord.digest);
    expect(certification?.grantedLevel).toBe('CERTIFIED');

    const suite = await client.getCertificationSuite(receipt.suite.digest);
    expect(suite?.digest).toBe(receipt.suite.digest);

    const body = await client.getBodyVersion(receipt.bodyBuild.evolved.bodyVersion.digest);
    expect(body?.digest).toBe(receipt.bodyBuild.evolved.bodyVersion.digest);

    const compatibility = await client.getCompatibilityRecord(
      receipt.compatibilityRecord.recordDigest,
    );
    expect(compatibility?.recordDigest).toBe(receipt.compatibilityRecord.recordDigest);
  });
});
