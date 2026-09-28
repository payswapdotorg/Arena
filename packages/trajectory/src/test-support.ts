/**
 * Shared test fixtures for @arena/trajectory (NOT part of the public
 * surface — hygiene.test.ts asserts it is not exported).
 */

import type { CreateTrajectoryHeaderInput } from './header.js';
import type { CreateTrajectoryEntryInput } from './entry.js';

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
export const DIGEST_F =
  '6666666666666666666666666666666666666666666666666666666666666666';

export const T0 = '2026-01-15T09:30:00.000Z';
export const T1 = '2026-01-15T09:30:01.000Z';
export const T2 = '2026-01-15T09:30:02.000Z';
export const T3 = '2026-01-15T09:30:03.000Z';
export const T4 = '2026-01-15T09:30:04.000Z';
export const T5 = '2026-01-15T09:30:05.000Z';
export const T6 = '2026-01-15T09:30:06.000Z';
export const T7 = '2026-01-15T09:30:07.000Z';

export interface HeaderOverrides {
  readonly trajectoryId?: string;
  readonly taskId?: string;
  readonly taskVersion?: string;
  readonly environmentDigest?: string;
  readonly runKey?: string;
  readonly initialSnapshotDigest?: string;
  readonly runRecordDigest?: string | null;
  readonly agentBodyRef?: string;
  readonly substrateRef?: string;
  readonly startedAt?: string;
  readonly seed?: string | null;
}

export function makeHeaderInput(overrides: HeaderOverrides = {}): CreateTrajectoryHeaderInput {
  return {
    trajectoryId: overrides.trajectoryId ?? 'trajectory-000042',
    run: {
      taskVersion: {
        taskId: overrides.taskId ?? 'task-build-website',
        version: overrides.taskVersion ?? '2.1.0',
      },
      environmentVersion: {
        namespace: 'tenant-a',
        name: 'engineering-sandbox',
        version: '1.2.0',
        digest: overrides.environmentDigest ?? DIGEST_A,
      },
      runId: `tenant-a/${overrides.runKey ?? 'run-000042'}`,
      initialSnapshotDigest: overrides.initialSnapshotDigest ?? DIGEST_B,
      runRecordDigest:
        overrides.runRecordDigest === undefined ? DIGEST_C : overrides.runRecordDigest,
    },
    agentBodyRef: overrides.agentBodyRef ?? DIGEST_D,
    substrateRef: overrides.substrateRef ?? DIGEST_E,
    startedAt: overrides.startedAt ?? T0,
    seed: overrides.seed === undefined ? 'seed-1234' : overrides.seed,
  };
}

export function makeActionInput(sequence: number, occurredAt: string): CreateTrajectoryEntryInput {
  return {
    sequence,
    kind: 'action',
    payload: { actionId: 'shell-exec', input: { command: 'make', args: ['test'] } },
    occurredAt,
  };
}

export function makeObservationInput(
  sequence: number,
  occurredAt: string,
): CreateTrajectoryEntryInput {
  return {
    sequence,
    kind: 'observation',
    payload: {
      observationId: 'stdout-tail',
      channel: 'stdout',
      content: 'all tests passed (12 suites, 96 cases)',
    },
    occurredAt,
  };
}

export function makeCheckpointInput(
  sequence: number,
  occurredAt: string,
): CreateTrajectoryEntryInput {
  return {
    sequence,
    kind: 'checkpoint',
    payload: { checkpointId: 'cp-0001', snapshotDigest: DIGEST_F },
    occurredAt,
  };
}

export function makeErrorInput(sequence: number, occurredAt: string): CreateTrajectoryEntryInput {
  return {
    sequence,
    kind: 'error',
    payload: { code: 'WORKLOAD_STEP_FAILED', message: 'step 3 exited with code 1 (retrying)' },
    occurredAt,
  };
}

export function makeCompletionInput(
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

export function makeMixedSequence(): readonly CreateTrajectoryEntryInput[] {
  return [
    makeActionInput(1, T0),
    makeObservationInput(2, T1),
    makeErrorInput(3, T2),
    makeActionInput(4, T3),
    makeCheckpointInput(5, T4),
    makeObservationInput(6, T5),
    makeCompletionInput(7, T6),
  ];
}

/**
 * Deterministic 32-bit LCG for property tests (Numerical Recipes
 * constants — mirrors @arena/environment-runtime's SeededLcg; kept in
 * test-support because the determinism primitive is A010's owned
 * surface, not this package's).
 */
export class TestLcg {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x2f6e2b1;
  }

  nextUint32(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 2 ** 32;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  bool(): boolean {
    return this.nextUint32() % 2 === 0;
  }
}
