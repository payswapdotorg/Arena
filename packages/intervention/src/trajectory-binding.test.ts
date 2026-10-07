/**
 * Trajectory-binding suite (Work Order C007) — every intervention emits
 * an A011 trajectory-backed record of observable work: entry mapping
 * (human actions/tool invocations → action entries; tool results/
 * artifact changes/annotations/tool-gap signals → observations;
 * checkpoints → checkpoint entries), chain verification via A011's own
 * verifyTrajectoryRecord, and the two fail-closed screens (private
 * chain-of-thought leak — including a nested TEACH payload — and
 * live-world mutation attempts).
 */

import { describe, expect, it } from 'vitest';
import { verifyTrajectoryRecord } from '@arena/trajectory';
import { InterventionError, INTERVENTION_ERROR_CODES } from './errors.js';
import {
  assertNoLiveWorldMutation,
  assertNoPrivateReasoning,
  buildInterventionTrajectory,
  interventionTrajectoryRef,
} from './trajectory-binding.js';
import { DIGEST_A, makeObservableSteps, makeTrajectoryBinding, T3, T4 } from './test-support.js';

const T4_LATER = T4;

describe('observable-work trajectory binding', () => {
  it('builds a verifiable A011 record from the observable steps + completion', async () => {
    const record = await buildInterventionTrajectory({
      binding: makeTrajectoryBinding(),
      steps: makeObservableSteps(),
      completedAt: T4_LATER,
      evidenceDigests: [DIGEST_A],
    });
    // 5 steps + 1 terminal completion entry.
    expect(record.entries.length).toBe(6);
    expect(record.entries[0]?.kind).toBe('action');
    expect(record.entries[2]?.kind).toBe('observation');
    expect(record.entries[4]?.kind).toBe('checkpoint');
    expect(record.entries[5]?.kind).toBe('completion');
    // The whole chain verifies under A011's own verifier.
    await expect(verifyTrajectoryRecord(record)).resolves.toBe(record.chainHead);
    const ref = interventionTrajectoryRef(record);
    expect(ref.trajectoryId).toBe('ivn-traj-teach-1');
    expect(ref.chainHead).toBe(record.chainHead);
  });

  it('serializes observable payloads into neutral observation content', async () => {
    const record = await buildInterventionTrajectory({
      binding: makeTrajectoryBinding(),
      steps: [
        {
          kind: 'annotation',
          stepId: 'step-annotate-1',
          payload: { note: 'wastage factor applied', subjectRef: 'artifact/boq-draft-7' },
          occurredAt: T3,
        },
      ],
      completedAt: T4_LATER,
    });
    const observation = record.entries[0];
    expect(observation?.kind).toBe('observation');
  });

  it('fails closed on a checkpoint step without a snapshot digest', async () => {
    await expect(
      buildInterventionTrajectory({
        binding: makeTrajectoryBinding(),
        steps: [
          { kind: 'checkpoint', stepId: 'step-checkpoint-bad', payload: { note: 'no digest' }, occurredAt: T3 },
        ],
        completedAt: T4_LATER,
      }),
    ).rejects.toThrowError(InterventionError);
  });

  it('fails closed on an out-of-vocabulary step kind', async () => {
    await expect(
      buildInterventionTrajectory({
        binding: makeTrajectoryBinding(),
        steps: [
          {
            kind: 'private-thought' as unknown as 'annotation',
            stepId: 'step-bad-kind',
            payload: { note: 'x' },
            occurredAt: T3,
          },
        ],
        completedAt: T4_LATER,
      }),
    ).rejects.toThrowError(InterventionError);
  });
});

describe('TEACH trajectory leaking hidden reasoning — the private-reasoning screen', () => {
  it('rejects a demonstration payload carrying chain-of-thought at the TOP level', async () => {
    await expect(
      buildInterventionTrajectory({
        binding: makeTrajectoryBinding(),
        steps: [
          {
            kind: 'human-action',
            stepId: 'step-teach-1',
            payload: { chainOfThought: 'first I would reason about…', action: 'measured the plan' },
            occurredAt: T3,
          },
        ],
        completedAt: T4_LATER,
      }),
    ).rejects.toThrowError(InterventionError);
  });

  it('rejects a NESTED private-reasoning key (case-insensitive, deep)', async () => {
    await expect(
      buildInterventionTrajectory({
        binding: makeTrajectoryBinding(),
        steps: [
          {
            kind: 'annotation',
            stepId: 'step-teach-2',
            payload: {
              note: 'observable annotation',
              meta: { Private_Reasoning: { scratchpad: 'hidden' } },
            },
            occurredAt: T3,
          },
        ],
        completedAt: T4_LATER,
      }),
    ).rejects.toThrowError(InterventionError);
    await expect(() => assertNoPrivateReasoning({ nested: { scratchPad: 'x' } })).toThrowError(
      InterventionError,
    );
    try {
      assertNoPrivateReasoning({ hiddenReasoning: 'x' });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.PRIVATE_REASONING);
      expect((error as InterventionError).category).toBe('privacy');
    }
  });

  it('passes clean observable payloads', () => {
    expect(() =>
      assertNoPrivateReasoning({ action: 'measured', result: { total: 12 }, refs: ['a', 'b'] }),
    ).not.toThrow();
  });
});

describe('live-world mutation attempts — the replica is never a live write path', () => {
  it('rejects live-world reference prefixes anywhere in the payload', () => {
    expect(() => assertNoLiveWorldMutation({ target: 'live:prod-db/invoices' })).toThrowError(
      InterventionError,
    );
    expect(() => assertNoLiveWorldMutation({ deep: [{ ref: 'prod:api/boq' }] })).toThrowError(
      InterventionError,
    );
    expect(() =>
      assertNoLiveWorldMutation({ endpoint: 'ws://live.acme.com/socket' }),
    ).toThrowError(InterventionError);
    try {
      assertNoLiveWorldMutation({ target: 'live:prod-db' });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.LIVE_WORLD_MUTATION);
    }
  });

  it('rejects a live-world step at the trajectory boundary', async () => {
    await expect(
      buildInterventionTrajectory({
        binding: makeTrajectoryBinding(),
        steps: [
          {
            kind: 'artifact-change',
            stepId: 'step-live-write',
            payload: { artifactRef: 'live:prod-boq/current', change: 'mutate' },
            occurredAt: T3,
          },
        ],
        completedAt: T4_LATER,
      }),
    ).rejects.toThrowError(InterventionError);
  });

  it('passes capsule-scoped references', () => {
    expect(() => assertNoLiveWorldMutation({ artifactRef: 'artifact/boq-draft-7' })).not.toThrow();
  });
});
