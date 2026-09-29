/**
 * ExperimentDescriptor tests - positive (creation, content addressing,
 * deep freeze) and negative/adversarial (undeclared/ambiguous
 * intervention surfaces, duplicate artifacts, empty populations,
 * malformed refs, unknown fields).
 */

import { describe, expect, it } from 'vitest';
import { createExperimentDescriptor, experimentIdentityKey, experimentDescriptorView, isExperimentDescriptor, recomputeExperimentDescriptorDigest } from './descriptor.js';
import { INTERVENTION_SURFACES } from './intervention-surface.js';
import { LEARNING_ERROR_CODES } from './errors.js';
import { makeExperimentInput, TestLcg, DIGEST_A, DIGEST_F } from './test-support.js';
import type { CreateExperimentDescriptorInput } from './descriptor.js';

describe('experiment descriptor - positive', () => {
  it('creates a content-addressed, deep-frozen descriptor', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    expect(descriptor.recordVersion).toBe(1);
    expect(descriptor.experimentId).toBe('experiment-reconciliation-0001');
    expect(descriptor.interventions).toHaveLength(1);
    expect(descriptor.interventions[0]?.changedSurface).toBe('skills');
    expect(descriptor.targetCapability.digest).toBe(DIGEST_F);
    expect(descriptor.outcomeMetrics[0]?.direction).toBe('higher-is-better');
    expect(descriptor.protectedCapabilities).toHaveLength(1);
    expect(descriptor.uncertainty.method).toBe('analytic-variance');
    expect(descriptor.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.interventions)).toBe(true);
    expect(Object.isFrozen(descriptor.interventions[0])).toBe(true);
    expect(isExperimentDescriptor(descriptor)).toBe(true);
  });

  it('is deterministic: same input ⇒ same digest', async () => {
    const a = await createExperimentDescriptor(makeExperimentInput());
    const b = await createExperimentDescriptor(makeExperimentInput());
    expect(a.digest).toBe(b.digest);
  });

  it('any content change ⇒ a different digest (new version required)', async () => {
    const a = await createExperimentDescriptor(makeExperimentInput());
    const b = await createExperimentDescriptor(
      makeExperimentInput({ version: '1.0.1' }),
    );
    expect(a.digest).not.toBe(b.digest);
    expect(experimentIdentityKey(a)).toBe('experiment-reconciliation-0001@1.0.0');
    expect(experimentIdentityKey(b)).toBe('experiment-reconciliation-0001@1.0.1');
  });

  it('digest recomputation matches (tamper tripwire)', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    await expect(recomputeExperimentDescriptorDigest(descriptor)).resolves.toBe(descriptor.digest);
    await expect(
      recomputeExperimentDescriptorDigest(descriptor, DIGEST_A),
    ).rejects.toThrow(/digest mismatch/);
  });

  it('the digest-free view omits the digest', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const view = experimentDescriptorView(descriptor);
    expect('digest' in view).toBe(false);
    expect(view.experimentId).toBe(descriptor.experimentId);
  });

  it('accepts every one of the nine LE1.0 surfaces', async () => {
    for (const surface of INTERVENTION_SURFACES) {
      const descriptor = await createExperimentDescriptor(
        makeExperimentInput({ changedSurface: surface }),
      );
      expect(descriptor.interventions[0]?.changedSurface).toBe(surface);
    }
  });

  it('property: random valid descriptors are deterministic and structurally valid', async () => {
    const lcg = new TestLcg(0xC0FFEE);
    for (let index = 0; index < 16; index += 1) {
      const input = makeExperimentInput({
        experimentId: `experiment-prop-${String(index).padStart(3, '0')}`,
        changedSurface: INTERVENTION_SURFACES[lcg.int(INTERVENTION_SURFACES.length)],
      });
      const first = await createExperimentDescriptor(input);
      const second = await createExperimentDescriptor(input);
      expect(first.digest).toBe(second.digest);
      expect(isExperimentDescriptor(first)).toBe(true);
    }
  });
});

describe('experiment descriptor - negative/adversarial', () => {
  it('REJECTS an intervention with a MISSING (undeclared) changed surface', async () => {
    const input = makeExperimentInput() as unknown as Record<string, unknown>;
    const interventions = input['interventions'] as unknown as Record<string, unknown>[];
    delete interventions[0]?.['changedSurface'];
    await expect(createExperimentDescriptor(input as never)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.INVALID_INTERVENTION,
    });
  });

  it('REJECTS an intervention with an AMBIGUOUS (unknown) changed surface', async () => {
    await expect(
      createExperimentDescriptor(makeExperimentInput({ changedSurface: 'model' })),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_INTERVENTION });
    await expect(
      createExperimentDescriptor(makeExperimentInput({ changedSurface: '' })),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_INTERVENTION });
    await expect(
      createExperimentDescriptor(makeExperimentInput({ changedSurface: 'skills-procedures' })),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_INTERVENTION });
  });

  it('REJECTS zero interventions (an experiment compares baseline against intervention)', async () => {
    const input = makeExperimentInput() as unknown as Record<string, unknown>;
    input['interventions'] = [];
    await expect(createExperimentDescriptor(input as never)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.INVALID_INTERVENTION,
    });
  });

  it('REJECTS duplicate intervention artifact digests (ambiguous declaration)', async () => {
    const input = makeExperimentInput();
    (input as unknown as { interventions: unknown[] }).interventions = [
      ...input.interventions,
      { ...input.interventions[0], changedSurface: 'procedures' },
    ];
    await expect(createExperimentDescriptor(input)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.INVALID_INTERVENTION,
    });
  });

  it('REJECTS an empty pinned task population', async () => {
    await expect(
      createExperimentDescriptor(makeExperimentInput({ taskPopulation: [] })),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_POPULATION });
  });

  it('REJECTS duplicate pinned task versions', async () => {
    await expect(
      createExperimentDescriptor(
        makeExperimentInput({
          taskPopulation: [
            { taskId: 'task-reconciliation', version: '1.0.0' },
            { taskId: 'task-reconciliation', version: '1.0.0' },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_POPULATION });
  });

  it('REJECTS empty evaluation/verification suites and environment versions', async () => {
    const base = makeExperimentInput();
    await expect(
      createExperimentDescriptor({ ...base, evaluationSuiteRefs: [] }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
    await expect(
      createExperimentDescriptor({ ...base, verificationSuiteRefs: [] }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
    await expect(
      createExperimentDescriptor({ ...base, environmentVersions: [] }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
  });

  it('REJECTS duplicate and empty outcome metrics', async () => {
    const base = makeExperimentInput();
    const duplicate = [...base.outcomeMetrics, { ...base.outcomeMetrics[0] }];
    await expect(
      createExperimentDescriptor({
        ...base,
        outcomeMetrics: duplicate,
      } as unknown as CreateExperimentDescriptorInput),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_METRIC });
    await expect(
      createExperimentDescriptor({ ...base, outcomeMetrics: [] }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_METRIC });
    await expect(
      createExperimentDescriptor({
        ...base,
        outcomeMetrics: [{ metricId: 'm', description: 'd', direction: 'sideways' }],
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_METRIC });
  });

  it('REJECTS malformed target capability refs (REAL A004 guard)', async () => {
    const base = makeExperimentInput();
    await expect(
      createExperimentDescriptor({
        ...base,
        targetCapability: { kind: 'capability', id: 'X', version: '1.0.0', digest: DIGEST_F },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
    await expect(
      createExperimentDescriptor({
        ...base,
        targetCapability: { kind: 'capability', id: 'ok', version: '1.0.0', digest: 'not-a-digest' },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
  });

  it('REJECTS unknown uncertainty methods', async () => {
    await expect(
      createExperimentDescriptor(makeExperimentInput({ uncertaintyMethod: 'vibes' })),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
  });

  it('REJECTS unknown fields (strict shape)', async () => {
    const input = { ...makeExperimentInput(), surprise: true } as never;
    await expect(createExperimentDescriptor(input)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR,
    });
  });

  it('REJECTS malformed baseline pins and provenance', async () => {
    const base = makeExperimentInput();
    await expect(
      createExperimentDescriptor({ ...base, baseline: { bodyRef: 'nope', substrateRef: null, runtimeRef: null } }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DIGEST });
    await expect(
      createExperimentDescriptor({
        ...base,
        provenance: { authoredBy: 'ok', submittedAt: 'yesterday', notes: null },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_TIMESTAMP });
    await expect(
      createExperimentDescriptor({ ...base, version: '1.0.0+build' }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
  });

  it('REJECTS invalid ids and versions', async () => {
    await expect(
      createExperimentDescriptor(makeExperimentInput({ experimentId: 'Bad_Id' })),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_IDENTITY });
    await expect(
      createExperimentDescriptor(makeExperimentInput({ version: 'v1' })),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DESCRIPTOR });
  });
});
