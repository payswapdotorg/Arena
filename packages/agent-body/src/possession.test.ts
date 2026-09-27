/**
 * Possession tests: digest-bearing binding, versioned model-specific
 * artifacts forcing new possession versions (gate 6), fail-closed
 * verification, content addressing across every component, freeze.
 */

import { describe, expect, it } from 'vitest';
import { AgentBodyError } from './errors.js';
import { AGENT_BODY_ERROR_CODES } from './errors.js';
import {
  createPossession,
  isPossession,
  modelSpecificArtifactKey,
  possessionRef,
  possessionView,
  upgradeModelSpecificArtifact,
  verifyPossession,
} from './possession.js';
import type { CreatePossessionInput } from './possession.js';
import {
  DIGEST_A,
  DIGEST_B,
  makeBodyVersion,
  makePossession,
  makeSubstrate,
} from './test-support.js';

const BEHAVIORAL = {
  artifactId: 'artifact-review-style',
  artifactVersion: '1.0.0',
  digest: DIGEST_A,
  materiality: 'behavioral',
} as const;

describe('Possession creation (positive)', () => {
  it('binds BodyVersion + CognitiveSubstrate + RuntimeProfile + EnvironmentProfile + PolicyBundle + optional artifacts (spec AB1.0)', async () => {
    const possession = await makePossession();
    expect(possession.recordVersion).toBe(1);
    expect(possession.bodyVersion.version).toBe('1.2.0');
    expect(possession.substrate.adapterId).toBe('adapter-reasoning-1');
    expect(possession.runtime.runtimeId).toBe('runtime-agent-1');
    expect(possession.environment.environmentId).toBe('env-standard');
    expect(possession.policies.bundleId).toBe('bundle-tenant-a');
    expect(possession.modelSpecificArtifacts).toHaveLength(1);
    expect(possession.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isPossession(possession)).toBe(true);
  });

  it('embeds the FULL body version and substrate (the digest commits to both)', async () => {
    const possession = await makePossession();
    expect(possession.bodyVersion.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(possession.substrate.integrity.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('exposes a content-addressed possession ref', async () => {
    const possession = await makePossession();
    const ref = await possessionRef(possession);
    expect(ref.bodyVersion.digest).toBe(possession.bodyVersion.digest);
    expect(ref.substrateDigest).toBe(possession.substrate.integrity.contentDigest);
    expect(ref.possessionDigest).toBe(possession.digest);
  });

  it('is deeply frozen', async () => {
    const possession = await makePossession();
    expect(Object.isFrozen(possession)).toBe(true);
    expect(Object.isFrozen(possession.runtime)).toBe(true);
    expect(Object.isFrozen(possession.runtime.configuration)).toBe(true);
    expect(Object.isFrozen(possession.policies.policies)).toBe(true);
    expect(Object.isFrozen(possession.modelSpecificArtifacts)).toBe(true);
    expect(() => {
      (possession as unknown as Record<string, unknown>)['digest'] = '0'.repeat(64);
    }).toThrow(TypeError);
  });
});

describe('Possession content addressing — every component change forces a new possession version', () => {
  it('a substrate upgrade produces a DIFFERENT possession (R45: new binding, recertify)', async () => {
    const original = await makePossession();
    const upgraded = await makePossession({
      substrate: await makeSubstrate({ modelRevision: 'r8' }),
    });
    expect(upgraded.digest).not.toBe(original.digest);
    expect(upgraded.substrate.integrity.contentDigest).not.toBe(
      original.substrate.integrity.contentDigest,
    );
  });

  it('a body version change produces a different possession', async () => {
    const original = await makePossession();
    const evolved = await makePossession({
      bodyVersion: await makeBodyVersion({ version: '1.3.0' }),
    });
    expect(evolved.digest).not.toBe(original.digest);
  });

  it('identical binding content is idempotent (same digest)', async () => {
    const a = await makePossession();
    const b = await makePossession();
    expect(a.digest).toBe(b.digest);
  });

  it('the digest covers the digest-free view exactly', async () => {
    const possession = await makePossession();
    await expect(verifyPossession(possession)).resolves.toBe(possession.digest);
    const view = possessionView(possession);
    expect('digest' in view).toBe(false);
  });
});

describe('Possession fail-closed construction (negative)', () => {
  const base = {
    runtime: {
      runtimeId: 'runtime-agent-1',
      runtimeVersion: '1.0.0',
      configuration: {},
    },
    environment: {
      environmentId: 'env-standard',
      environmentVersion: '3.2.0',
      constraints: ['network-egress-denied'],
    },
    policies: {
      bundleId: 'bundle-tenant-a',
      bundleVersion: '1.0.0',
      policies: [{ policyId: 'p', statements: ['s'] }],
    },
  };

  async function makePossessionWith(overrides: Record<string, unknown>): Promise<unknown> {
    const bodyVersion = await makeBodyVersion();
    const substrate = await makeSubstrate();
    const input = {
      bodyVersion,
      substrate,
      ...(base as Record<string, unknown>),
      ...(overrides as Record<string, unknown>),
    } as unknown as CreatePossessionInput;
    return createPossession(input);
  }

  it('rejects a tampered body version', async () => {
    const bodyVersion = await makeBodyVersion();
    const tampered = { ...bodyVersion, mission: 'rewritten' };
    const substrate = await makeSubstrate();
    await expect(
      createPossession({
        bodyVersion: tampered as never,
        substrate,
        runtime: {
          runtimeId: 'runtime-agent-1',
          runtimeVersion: '1.0.0',
          configuration: {},
        },
        environment: {
          environmentId: 'env-standard',
          environmentVersion: '3.2.0',
          constraints: ['network-egress-denied'],
        },
        policies: {
          bundleId: 'bundle-tenant-a',
          bundleVersion: '1.0.0',
          policies: [{ policyId: 'p', statements: ['s'] }],
        },
      }),
    ).rejects.toThrow(/digest mismatch/);
  });

  it('rejects a tampered substrate', async () => {
    const substrate = await makeSubstrate();
    const tampered = {
      ...substrate,
      contextLimits: { maxContextUnits: 1, maxOutputUnits: 1 },
    };
    await expect(
      makePossession({ substrate: tampered as never }),
    ).rejects.toThrow(/integrity mismatch/);
  });

  it('rejects malformed runtime/environment/policy views', async () => {
    await expect(
      makePossessionWith({
        runtime: { runtimeId: 'BAD', runtimeVersion: '1.0.0', configuration: {} },
      }),
    ).rejects.toThrow(/runtime profile/);
    await expect(
      makePossessionWith({
        environment: {
          environmentId: 'env-standard',
          environmentVersion: '1.0.0',
          constraints: [],
        },
      }),
    ).rejects.toThrow(/environment profile/);
    await expect(
      makePossessionWith({
        policies: {
          bundleId: 'bundle-tenant-a',
          bundleVersion: '1.0.0',
          policies: [],
        },
      }),
    ).rejects.toThrow(/at least one policy/);
    await expect(
      makePossessionWith({
        runtime: {
          runtimeId: 'runtime-agent-1',
          runtimeVersion: '1.0.0',
          configuration: { nested: { deep: true } },
        },
      }),
    ).rejects.toThrow(/runtime profile/); // configuration must be scalar values
  });

  it('rejects duplicate artifact ids and (id, version) digest conflicts at construction', async () => {
    const bodyVersion = await makeBodyVersion();
    const substrate = await makeSubstrate();
    const common = {
      bodyVersion,
      substrate,
      runtime: {
        runtimeId: 'runtime-agent-1',
        runtimeVersion: '1.0.0',
        configuration: {},
      },
      environment: {
        environmentId: 'env-standard',
        environmentVersion: '3.2.0',
        constraints: ['network-egress-denied'],
      },
      policies: {
        bundleId: 'bundle-tenant-a',
        bundleVersion: '1.0.0',
        policies: [{ policyId: 'p', statements: ['s'] }],
      },
    };
    await expect(
      createPossession({
        ...common,
        modelSpecificArtifacts: [BEHAVIORAL, { ...BEHAVIORAL, digest: DIGEST_B }],
      } as never),
    ).rejects.toThrow(/different digests/);
    await expect(
      createPossession({
        ...common,
        modelSpecificArtifacts: [
          BEHAVIORAL,
          { ...BEHAVIORAL, artifactVersion: '2.0.0' },
        ],
      } as never),
    ).rejects.toThrow(/duplicate model-specific artifact id/);
  });

  it('rejects credential-shaped fields in the input (spec AB1.0)', async () => {
    const bodyVersion = await makeBodyVersion();
    const substrate = await makeSubstrate();
    await expect(
      createPossession({
        bodyVersion,
        substrate,
        runtime: {
          runtimeId: 'runtime-agent-1',
          runtimeVersion: '1.0.0',
          configuration: { apiKey: 'x' },
        },
        environment: {
          environmentId: 'env-standard',
          environmentVersion: '3.2.0',
          constraints: ['network-egress-denied'],
        },
        policies: {
          bundleId: 'bundle-tenant-a',
          bundleVersion: '1.0.0',
          policies: [{ policyId: 'p', statements: ['s'] }],
        },
      } as never),
    ).rejects.toThrow(/credential-shaped field/);
  });
});

describe('verifyPossession (fail closed)', () => {
  it('a tampered possession digest fails', async () => {
    const possession = await makePossession();
    const tampered = { ...possession, digest: '0'.repeat(64) };
    await expect(verifyPossession(tampered as never)).rejects.toThrow(/digest mismatch/);
    try {
      await verifyPossession(tampered as never);
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.POSSESSION_TAMPERED);
    }
  });

  it('a possession whose embedded body version was mutated fails', async () => {
    const possession = await makePossession();
    const tampered = {
      ...possession,
      bodyVersion: { ...possession.bodyVersion, role: 'hijacked' },
      digest: possession.digest,
    };
    await expect(verifyPossession(tampered as never)).rejects.toThrow();
  });
});

describe('model-specific artifacts force new possession versions (gate 6, lock rule 22)', () => {
  it('a behavioral artifact upgrade yields a NEW possession with a DIFFERENT digest; the original is untouched', async () => {
    const original = await makePossession();
    const upgraded = await upgradeModelSpecificArtifact(original, {
      artifact: { ...BEHAVIORAL, artifactVersion: '1.1.0', digest: DIGEST_B },
    });
    expect(upgraded).not.toBe(original);
    expect(upgraded.digest).not.toBe(original.digest); // forced new possession version
    expect(original.digest).toBe(original.digest); // no mutation of the original object
    expect(original.modelSpecificArtifacts[0]?.artifactVersion).toBe('1.0.0');
    expect(upgraded.modelSpecificArtifacts[0]?.artifactVersion).toBe('1.1.0');
    await expect(verifyPossession(upgraded)).resolves.toBe(upgraded.digest);
    await expect(verifyPossession(original)).resolves.toBe(original.digest);
  });

  it('the materiality flag is part of the content (a behavioral flip re-digests)', async () => {
    const original = await makePossession();
    const relabeled = await upgradeModelSpecificArtifact(original, {
      artifact: { ...BEHAVIORAL, materiality: 'non-behavioral' },
    });
    expect(relabeled.digest).not.toBe(original.digest);
  });

  it('an identical artifact upgrade is idempotent', async () => {
    const possession = await makePossession();
    const again = await upgradeModelSpecificArtifact(possession, { artifact: BEHAVIORAL });
    expect(again).toBe(possession);
  });

  it('the same artifact version with a DIFFERENT digest is a silent-mutation conflict', async () => {
    const possession = await makePossession();
    await expect(
      upgradeModelSpecificArtifact(possession, {
        artifact: { ...BEHAVIORAL, digest: DIGEST_B },
      }),
    ).rejects.toThrow(/cannot silently mutate|silent mutation/);
    try {
      await upgradeModelSpecificArtifact(possession, {
        artifact: { ...BEHAVIORAL, digest: DIGEST_B },
      });
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(
        AGENT_BODY_ERROR_CODES.ARTIFACT_VERSION_CONFLICT,
      );
    }
  });

  it('unknown artifact ids are rejected', async () => {
    const possession = await makePossession();
    await expect(
      upgradeModelSpecificArtifact(possession, {
        artifact: { ...BEHAVIORAL, artifactId: 'artifact-unknown' },
      }),
    ).rejects.toThrow(/unknown model-specific artifact/);
  });

  it('artifact keys are stable and carry the digest', async () => {
    const possession = await makePossession();
    const artifact = possession.modelSpecificArtifacts[0];
    expect(artifact).toBeDefined();
    if (artifact !== undefined) {
      expect(modelSpecificArtifactKey(artifact)).toBe(
        `artifact-review-style@1.0.0#${DIGEST_A}`,
      );
    }
  });
});
