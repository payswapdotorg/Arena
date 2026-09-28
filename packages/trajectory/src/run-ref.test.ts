/**
 * TrajectoryRunRef tests — the four RunAddress-shaped digest refs of the
 * run binding, positive AND negative paths (Work Order A011 gates 2, 11).
 */

import { describe, expect, it } from 'vitest';
import {
  isTrajectoryRunRef,
  toTrajectoryRunRef,
  trajectoryRunRefKey,
} from './run-ref.js';
import type { TrajectoryRunRefInput } from './run-ref.js';
import { TRAJECTORY_ERROR_CODES } from './errors.js';
import { DIGEST_A, DIGEST_B, DIGEST_C, makeHeaderInput } from './test-support.js';

function makeRunRefInput(overrides: Partial<TrajectoryRunRefInput> = {}): TrajectoryRunRefInput {
  const base = makeHeaderInput().run;
  return { ...base, ...overrides };
}

describe('toTrajectoryRunRef (positive paths)', () => {
  it('validates and freezes the four address parts', () => {
    const ref = toTrajectoryRunRef(makeRunRefInput());
    expect(ref.taskVersion).toEqual({ taskId: 'task-build-website', version: '2.1.0' });
    expect(ref.environmentVersion.namespace).toBe('tenant-a');
    expect(ref.environmentVersion.name).toBe('engineering-sandbox');
    expect(ref.environmentVersion.version).toBe('1.2.0');
    expect(ref.environmentVersion.digest).toBe(DIGEST_A);
    expect(ref.runId).toBe('tenant-a/run-000042');
    expect(ref.initialSnapshotDigest).toBe(DIGEST_B);
    expect(ref.runRecordDigest).toBe(DIGEST_C);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(Object.isFrozen(ref.taskVersion)).toBe(true);
    expect(Object.isFrozen(ref.environmentVersion)).toBe(true);
  });

  it('accepts A009-neutral run ids (no tenant scope)', () => {
    const ref = toTrajectoryRunRef(makeRunRefInput({ runId: 'run-000042' }));
    expect(ref.runId).toBe('run-000042');
  });

  it('treats runRecordDigest as optional (null when absent)', () => {
    const input = makeRunRefInput();
    delete (input as { runRecordDigest?: string | null }).runRecordDigest;
    const ref = toTrajectoryRunRef(input);
    expect(ref.runRecordDigest).toBeNull();
  });
});

describe('toTrajectoryRunRef (negative paths)', () => {
  it('rejects missing required fields', () => {
    for (const key of [
      'taskVersion',
      'environmentVersion',
      'runId',
      'initialSnapshotDigest',
    ] as const) {
      const input = makeRunRefInput() as unknown as Record<string, unknown>;
      delete input[key];
      expect(() => toTrajectoryRunRef(input as unknown as TrajectoryRunRefInput)).toThrowError(
        expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_RUN_REF }),
      );
    }
  });

  it('rejects unknown fields (strict shape)', () => {
    expect(() =>
      toTrajectoryRunRef({ ...makeRunRefInput(), extra: 'nope' } as unknown as TrajectoryRunRefInput),
    ).toThrowError(/unknown field 'extra'/);
  });

  it('rejects malformed task versions', () => {
    expect(() =>
      toTrajectoryRunRef(makeRunRefInput({ taskVersion: { taskId: 'UPPER', version: '1.0.0' } })),
    ).toThrowError(/taskId/);
    expect(() =>
      toTrajectoryRunRef(makeRunRefInput({ taskVersion: { taskId: 'task-x', version: 'v 1' } })),
    ).toThrowError(/task version/);
  });

  it('rejects malformed environment version refs', () => {
    expect(() =>
      toTrajectoryRunRef(
        makeRunRefInput({
          environmentVersion: {
            namespace: 'UPPER',
            name: 'engineering-sandbox',
            version: '1.2.0',
            digest: DIGEST_A,
          },
        }),
      ),
    ).toThrowError(/namespace\/name/);
    expect(() =>
      toTrajectoryRunRef(
        makeRunRefInput({
          environmentVersion: {
            namespace: 'tenant-a',
            name: 'engineering-sandbox',
            version: '1.2.0+build', // build metadata rejected
            digest: DIGEST_A,
          },
        }),
      ),
    ).toThrowError(/semver/);
    expect(() =>
      toTrajectoryRunRef(
        makeRunRefInput({
          environmentVersion: {
            namespace: 'tenant-a',
            name: 'engineering-sandbox',
            version: '1.2.0',
            digest: 'not-a-digest',
          },
        }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
  });

  it('rejects malformed run ids', () => {
    expect(() => toTrajectoryRunRef(makeRunRefInput({ runId: 'UPPER/run' }))).toThrowError(
      /invalid run id/,
    );
    expect(() => toTrajectoryRunRef(makeRunRefInput({ runId: 'tenant-a/' }))).toThrowError(
      /invalid run id/,
    );
    expect(() => toTrajectoryRunRef(makeRunRefInput({ runId: 'spaced id' }))).toThrowError(
      /invalid run id/,
    );
  });

  it('rejects malformed digests and a non-digest runRecordDigest', () => {
    expect(() =>
      toTrajectoryRunRef(makeRunRefInput({ initialSnapshotDigest: 'x'.repeat(64) })),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
    expect(() =>
      toTrajectoryRunRef(makeRunRefInput({ runRecordDigest: 'not-a-digest' })),
    ).toThrowError(/runRecordDigest/);
  });
});

describe('isTrajectoryRunRef (structural predicate)', () => {
  it('accepts the validated shape', () => {
    expect(isTrajectoryRunRef(toTrajectoryRunRef(makeRunRefInput()))).toBe(true);
  });

  it('rejects non-objects, missing parts and malformed parts', () => {
    expect(isTrajectoryRunRef(null)).toBe(false);
    expect(isTrajectoryRunRef('ref')).toBe(false);
    expect(isTrajectoryRunRef([])).toBe(false);
    const missing = makeRunRefInput() as unknown as Record<string, unknown>;
    delete missing.initialSnapshotDigest;
    expect(isTrajectoryRunRef(missing)).toBe(false);
    expect(
      isTrajectoryRunRef({
        ...makeRunRefInput(),
        environmentVersion: { namespace: 'tenant-a', name: 'x', version: '1.2.0' },
      }),
    ).toBe(false);
    expect(
      isTrajectoryRunRef({ ...makeRunRefInput(), runRecordDigest: 5 }),
    ).toBe(false);
  });
});

describe('trajectoryRunRefKey', () => {
  it('is a stable, discriminating string key', () => {
    const a = toTrajectoryRunRef(makeRunRefInput());
    const b = toTrajectoryRunRef(makeRunRefInput());
    const c = toTrajectoryRunRef(makeRunRefInput({ runId: 'tenant-a/run-000043' }));
    expect(trajectoryRunRefKey(a)).toBe(trajectoryRunRefKey(b));
    expect(trajectoryRunRefKey(a)).not.toBe(trajectoryRunRefKey(c));
    expect(trajectoryRunRefKey(a)).toContain('task:task-build-website@2.1.0');
    expect(trajectoryRunRefKey(a)).toContain(`snapshot:${DIGEST_B}`);
    expect(trajectoryRunRefKey(a)).toContain(`record:${DIGEST_C}`);
    expect(trajectoryRunRefKey({ ...a, runRecordDigest: null })).toContain('record:-');
  });
});
