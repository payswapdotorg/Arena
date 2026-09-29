/**
 * Forge core tests (Work Order A021): the deterministic compose, the
 * REAL A003 BodyVersion output (by construction), provenance
 * projection, lineage, policy enforcement (requirements, learning
 * admission, lineage rules) and the A003 acceptance of the emitted
 * proposal (registerBodyVersion on a fresh AgentBody — the forge
 * emits, the body registry appends; the forge itself never
 * registers).
 */

import { describe, expect, it } from 'vitest';
import {
  createAgentBody,
  isBodyVersion,
  registerBodyVersion,
  verifyBodyVersion,
} from '@arena/agent-body';
import {
  BODY_FORGE_ERROR_CODES,
  FORGE_IMPLEMENTATION_VERSION,
  applyForgePolicy,
  createBodyManifest,
  createForgePolicy,
  defaultForgePolicyInput,
  forge,
  forgeBodyVersion,
} from './index.js';
import {
  CORR_ID,
  DIGEST_B,
  DIGEST_G,
  FORGE_KEY,
  T1,
  expectSyncCode,
  makeManifestInput,
  makeRecipe,
  parentRefV1,
} from './test-support.js';

const RECIPE = makeRecipe();

async function fixtures() {
  const manifest = await createBodyManifest(makeManifestInput());
  const policy = await createForgePolicy(defaultForgePolicyInput());
  return { manifest, policy };
}

describe('the deterministic compose (positive)', () => {
  it('emits a REAL, verified A003 BodyVersion (by construction, not by resemblance)', async () => {
    const { manifest, policy } = await fixtures();
    const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
    expect(isBodyVersion(bodyVersion)).toBe(true);
    expect(await verifyBodyVersion(bodyVersion)).toBe(bodyVersion.digest);
    expect(Object.isFrozen(bodyVersion)).toBe(true);
    // A003 AB1.0 field completeness on the emitted shape.
    expect(bodyVersion.body.tenant).toBe('tenant-a');
    expect(bodyVersion.body.name).toBe('ledger-reconciler');
    expect(bodyVersion.version).toBe('1.0.0');
    expect(bodyVersion.mission).toBe(manifest.mission);
    expect(bodyVersion.role).toBe(manifest.role);
    expect(bodyVersion.domainScope).toEqual([...manifest.domainScope]);
    expect(bodyVersion.capabilities).toEqual(['capability-reconciliation']);
    expect(bodyVersion.skills).toEqual([...manifest.skills]);
    expect(bodyVersion.knowledge).toEqual([...manifest.knowledge]);
    expect(bodyVersion.tools).toEqual([...manifest.tools]);
    expect(bodyVersion.procedures).toEqual([...manifest.procedures]);
    expect(bodyVersion.memoryPolicy.policyId).toBe('memory-append-only');
    expect(bodyVersion.planningPolicy.policyId).toBe('planning-checklist-first');
    expect(bodyVersion.safetyPolicy.policyId).toBe('safety-four-eyes');
    expect(bodyVersion.escalation.rules[0]?.condition).toBe('discrepancy-above-threshold');
    expect(bodyVersion.authorityBoundaries).toEqual([...manifest.authorityBoundaries]);
    expect(bodyVersion.evaluationSuites).toEqual([...manifest.evaluationSuites]);
    expect(bodyVersion.verificationSuites).toEqual([...manifest.verificationSuites]);
    expect(bodyVersion.environmentRequirements).toEqual([...manifest.environmentRequirements]);
    expect(bodyVersion.substrateCompatibility.requiredToolCalling).toBe('json-schema');
    expect(bodyVersion.provenance.rights).toEqual(manifest.rights);
    expect(bodyVersion.provenance.creator.principalId).toBe('arena-body-forge-fabric');
    expect(bodyVersion.provenance.createdAt).toBe(T1);
    expect(bodyVersion.lineage.parents).toEqual([]);
  });

  it('projects provenance.records = EXACTLY [manifest ref, policy ref] (deterministic, closed)', async () => {
    const { manifest, policy } = await fixtures();
    const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
    expect(bodyVersion.provenance.records).toHaveLength(2);
    expect(bodyVersion.provenance.records[0]).toEqual({
      namespace: 'body-forge',
      name: manifest.manifestId,
      version: manifest.version,
      digest: manifest.digest,
    });
    expect(bodyVersion.provenance.records[1]).toEqual({
      namespace: 'body-forge',
      name: policy.policyId,
      version: policy.version,
      digest: policy.digest,
    });
  });

  it('same manifest + policy + recipe ⇒ byte-identical BodyVersion (same digest inputs)', async () => {
    const { manifest, policy } = await fixtures();
    const first = await forgeBodyVersion(manifest, policy, RECIPE);
    const second = await forgeBodyVersion(manifest, policy, RECIPE);
    expect(second.digest).toBe(first.digest);
    // A different recipe timestamp yields a DIFFERENT version (content differs).
    const third = await forgeBodyVersion(manifest, policy, { ...RECIPE, forgedAt: '2026-05-01T10:00:09.000Z' });
    expect(third.digest).not.toBe(first.digest);
  });

  it('carries lineage through (append-only supersession projection)', async () => {
    const policy = await createForgePolicy(defaultForgePolicyInput());
    const manifest = await createBodyManifest(
      makeManifestInput({
        targetVersion: '1.1.0',
        parents: [parentRefV1()],
        supersedes: parentRefV1(),
      }),
    );
    const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
    expect(bodyVersion.version).toBe('1.1.0');
    expect(bodyVersion.lineage.parents[0]?.digest).toBe(DIGEST_G);
    expect(bodyVersion.lineage.supersedes?.version).toBe('1.0.0');
  });

  it('the emitted proposal is accepted by the REAL A003 registry (registerBodyVersion)', async () => {
    const { manifest, policy } = await fixtures();
    const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
    const body = createAgentBody({
      identity: { tenant: 'tenant-a', name: 'ledger-reconciler' },
      createdAt: '2026-05-01T09:00:00.000Z',
      creator: { type: 'user', tenant: 'tenant-a', principalId: 'author-01' },
      rights: manifest.rights,
    });
    const updated = await registerBodyVersion(body, bodyVersion);
    expect(updated.versions).toHaveLength(1);
    // Idempotent re-registration of identical content.
    const again = await registerBodyVersion(updated, bodyVersion);
    expect(again.versions).toHaveLength(1);
  });

  it('forge() composes the record alongside the proposal (full lineage on the record)', async () => {
    const { manifest, policy } = await fixtures();
    const result = await forge(manifest, policy, RECIPE, { forgeKey: FORGE_KEY });
    expect(result.record.forgeKey).toBe(FORGE_KEY);
    expect(result.record.correlationId).toBe(CORR_ID);
    expect(result.record.manifestDigest).toBe(manifest.digest);
    expect(result.record.policyDigest).toBe(policy.digest);
    expect(result.record.bodyVersionDigest).toBe(result.bodyVersion.digest);
    expect(result.record.bodyVersionRef).toEqual({
      tenant: 'tenant-a',
      name: 'ledger-reconciler',
      version: '1.0.0',
      digest: result.bodyVersion.digest,
    });
    expect(result.record.provenance.forgedBy).toBe('arena-body-forge-fabric');
    expect(result.record.provenance.recordedAt).toBe(T1);
    expect(result.record.provenance.notes).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(FORGE_IMPLEMENTATION_VERSION).toBe('1.0.0');
  });
});

describe('policy enforcement over a verified manifest (negative)', () => {
  it('REQUIREMENT_VIOLATION: skills below the policy minimum', async () => {
    const manifest = await createBodyManifest(makeManifestInput({ skills: [] }));
    const policy = await createForgePolicy({
      policyId: 'policy-needs-skills',
      version: '1.0.0',
      requirements: { minSkills: 1 },
    });
    await expect(forgeBodyVersion(manifest, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.REQUIREMENT_VIOLATION,
    });
    expectSyncCode(
      () => applyForgePolicy(manifest, policy),
      BODY_FORGE_ERROR_CODES.REQUIREMENT_VIOLATION,
    );
  });

  it('LEARNING_PROVENANCE_REJECTED: experiment-record citations not admitted', async () => {
    const manifest = await createBodyManifest(
      makeManifestInput({ citations: [{ kind: 'experiment-record', digest: DIGEST_B }] }),
    );
    const policy = await createForgePolicy({
      policyId: 'policy-no-experiments',
      version: '1.0.0',
      learningAdmission: { allowExperimentRecordCitations: false },
    });
    await expect(forgeBodyVersion(manifest, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED,
    });
  });

  it('LEARNING_PROVENANCE_REJECTED: silently embedded un-provenanced skills (strict policy)', async () => {
    const manifest = await createBodyManifest(makeManifestInput());
    const policy = await createForgePolicy({
      policyId: 'policy-strict-provenance',
      version: '1.0.0',
      learningAdmission: { uncitedSkillsAllowed: false },
    });
    await expect(forgeBodyVersion(manifest, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED,
    });
  });

  it('a fully cited skill passes the strict policy (the explicit-citation path works)', async () => {
    const manifest = await createBodyManifest(
      makeManifestInput({
        citations: [
          { kind: 'experiment-record', digest: DIGEST_B },
          {
            kind: 'skill-draft',
            digest: DIGEST_G,
            skills: [
              {
                namespace: 'arena-skills',
                name: 'ledger-reconciliation-checklist',
                version: '1.0.0',
                digest: '1111111111111111111111111111111111111111111111111111111111111111',
              },
            ],
          },
        ],
      }),
    );
    const policy = await createForgePolicy({
      policyId: 'policy-strict-provenance',
      version: '1.0.0',
      learningAdmission: { uncitedSkillsAllowed: false, requireExperimentForSkillDraft: true },
    });
    const bodyVersion = await forgeBodyVersion(manifest, policy, RECIPE);
    expect(isBodyVersion(bodyVersion)).toBe(true);
  });

  it('LEARNING_PROVENANCE_REJECTED: drafts without a motivating experiment when required', async () => {
    const manifest = await createBodyManifest(
      makeManifestInput({
        citations: [
          {
            kind: 'skill-draft',
            digest: DIGEST_G,
            skills: [
              {
                namespace: 'arena-skills',
                name: 'ledger-reconciliation-checklist',
                version: '1.0.0',
                digest: '1111111111111111111111111111111111111111111111111111111111111111',
              },
            ],
          },
        ],
      }),
    );
    const policy = await createForgePolicy({
      policyId: 'policy-needs-experiment',
      version: '1.0.0',
      learningAdmission: { requireExperimentForSkillDraft: true },
    });
    await expect(forgeBodyVersion(manifest, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED,
    });
  });

  it('LINEAGE_VIOLATION: parents required by policy but absent', async () => {
    const manifest = await createBodyManifest(makeManifestInput());
    const policy = await createForgePolicy({
      policyId: 'policy-requires-parents',
      version: '1.0.0',
      lineage: { requireParents: true },
    });
    await expect(forgeBodyVersion(manifest, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION,
    });
  });

  it('LINEAGE_VIOLATION: supersession not permitted by policy', async () => {
    const manifest = await createBodyManifest(
      makeManifestInput({
        targetVersion: '1.1.0',
        parents: [parentRefV1()],
        supersedes: parentRefV1(),
      }),
    );
    const policy = await createForgePolicy({
      policyId: 'policy-no-supersession',
      version: '1.0.0',
      lineage: { allowSupersession: false },
    });
    await expect(forgeBodyVersion(manifest, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION,
    });
  });
});

describe('input contracts (negative)', () => {
  it('rejects a structurally invalid manifest / policy / recipe', async () => {
    const { manifest, policy } = await fixtures();
    await expect(forgeBodyVersion({ nope: true } as never, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_MANIFEST,
    });
    await expect(forgeBodyVersion(manifest, { nope: true } as never, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_POLICY,
    });
    await expect(
      forgeBodyVersion(manifest, policy, { ...RECIPE, correlationId: 'not valid!' }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECIPE });
    await expect(
      forgeBodyVersion(manifest, policy, {
        forgePrincipal: { type: 'service', tenant: 'tenant-a', principalId: 'bad id!' },
        forgedAt: T1,
        correlationId: CORR_ID,
      }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_RECIPE });
    await expect(
      forgeBodyVersion(manifest, policy, { ...RECIPE, forgedAt: 'now' }),
    ).rejects.toMatchObject({ code: BODY_FORGE_ERROR_CODES.INVALID_TIMESTAMP });
  });

  it('rejects a tampered manifest / policy before composing (fail closed)', async () => {
    const { manifest, policy } = await fixtures();
    const tamperedManifest = { ...manifest, mission: 'A tampered mission.' } as typeof manifest;
    await expect(forgeBodyVersion(tamperedManifest, policy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.TAMPERED,
    });
    const tamperedPolicy = {
      ...policy,
      requirements: { ...policy.requirements, minSkills: 5 },
    } as typeof policy;
    await expect(forgeBodyVersion(manifest, tamperedPolicy, RECIPE)).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.TAMPERED,
    });
  });

  it('forge() requires a valid idempotency key (lock rule 17)', async () => {
    const { manifest, policy } = await fixtures();
    await expect(forge(manifest, policy, RECIPE, { forgeKey: '' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_RECORD,
    });
    await expect(forge(manifest, policy, RECIPE, { forgeKey: 'not valid!' })).rejects.toMatchObject({
      code: BODY_FORGE_ERROR_CODES.INVALID_RECORD,
    });
  });
});
