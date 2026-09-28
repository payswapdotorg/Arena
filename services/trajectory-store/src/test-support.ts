/**
 * Shared test fixtures for @arena/trajectory-store (NOT part of the
 * public surface — hygiene.test.ts asserts it is not exported).
 */

import type {
  CreateTrajectoryEntryInput,
  CreateTrajectoryHeaderInput,
} from '@arena/trajectory';

export const DIGEST_A =
  '1111111111111111111111111111111111111111111111111111111111111111';
export const DIGEST_B =
  '2222222222222222222222222222222222222222222222222222222222222222';
export const DIGEST_C =
  '3333333333333333333333333333333333333333333333333333333333333333';
export const DIGEST_D =
  '4444444444444444444444444444444444444444444444444444444444444444';
export const DIGEST_E =
  '5555555555555555555555555555555555555555555555555555555555555555';

export const T0 = '2026-01-15T09:30:00.000Z';
export const T1 = '2026-01-15T09:30:01.000Z';
export const T2 = '2026-01-15T09:30:02.000Z';
export const T3 = '2026-01-15T09:30:03.000Z';
export const T4 = '2026-01-15T09:30:04.000Z';
export const T5 = '2026-01-15T09:30:05.000Z';
export const T6 = '2026-01-15T09:30:06.000Z';
export const T7 = '2026-01-15T09:30:07.000Z';

export const T_OTHER_DAY = '2026-02-20T18:00:00.000Z';

export interface StoreHeaderOverrides {
  readonly trajectoryId?: string;
  readonly runKey?: string;
  readonly agentBodyRef?: string;
  readonly startedAt?: string;
  readonly initialSnapshotDigest?: string;
}

export function makeStoreHeaderInput(
  overrides: StoreHeaderOverrides = {},
): CreateTrajectoryHeaderInput {
  return {
    trajectoryId: overrides.trajectoryId ?? 'trajectory-000042',
    run: {
      taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
      environmentVersion: {
        namespace: 'tenant-a',
        name: 'engineering-sandbox',
        version: '1.2.0',
        digest: DIGEST_A,
      },
      runId: `tenant-a/${overrides.runKey ?? 'run-000042'}`,
      initialSnapshotDigest: overrides.initialSnapshotDigest ?? DIGEST_B,
      runRecordDigest: DIGEST_C,
    },
    agentBodyRef: overrides.agentBodyRef ?? DIGEST_D,
    substrateRef: DIGEST_E,
    startedAt: overrides.startedAt ?? T0,
    seed: 'seed-1234',
  };
}

export function storeActionInput(
  sequence: number,
  occurredAt: string,
  command = 'test',
): CreateTrajectoryEntryInput {
  return {
    sequence,
    kind: 'action',
    payload: { actionId: 'shell-exec', input: { command: 'make', args: [command] } },
    occurredAt,
  };
}

export function storeObservationInput(
  sequence: number,
  occurredAt: string,
): CreateTrajectoryEntryInput {
  return {
    sequence,
    kind: 'observation',
    payload: {
      observationId: 'stdout-tail',
      channel: 'stdout',
      content: `step ${String(sequence)} completed`,
    },
    occurredAt,
  };
}

export function storeCompletionInput(
  sequence: number,
  occurredAt: string,
): CreateTrajectoryEntryInput {
  return {
    sequence,
    kind: 'completion',
    payload: { outcome: 'completed', evidenceDigests: [DIGEST_D] },
    occurredAt,
  };
}

/** A deterministic 32-bit LCG for property tests (A010 constants). */
export class StoreTestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x2f6e2b1;
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }

  int(maxExclusive: number): number {
    return Math.floor((this.nextUint32() / 2 ** 32) * maxExclusive);
  }

  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }
}
