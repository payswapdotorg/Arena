/**
 * Task-history tests (Work Order A006; §8 task history; lock rules 6, 11).
 * Positive and negative for record refs, list discipline, tenant scoping
 * and the append-only prefix tripwire.
 */

import { describe, expect, it } from 'vitest';
import {
  TASK_RECORD_ID_PATTERN_SOURCE,
  TASK_RECORD_REF_VERSION,
  TASK_RECORD_TYPES,
  assertTaskHistoryAppendOnly,
  isTaskRecordRefView,
  isTaskRecordType,
  taskRecordRefKey,
  toTaskHistory,
  toTaskRecordRefView,
} from './task-history.js';
import { ExpertRegistryError } from './errors.js';
import { AT, AT_LATER, DIGEST_A } from './test-support.js';

const valid = () => ({
  kind: 'task-outcome',
  tenant: 'tenant-a',
  taskId: 'task-invoice-close-42',
  version: '1.0.0',
  digest: DIGEST_A,
  occurredAt: AT,
});

describe('task record refs (positive)', () => {
  it('accepts content-addressed record refs and freezes them', () => {
    const ref = toTaskRecordRefView(valid());
    expect(isTaskRecordRefView(ref)).toBe(true);
    expect(ref.refVersion).toBe(TASK_RECORD_REF_VERSION);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(taskRecordRefKey(ref)).toBe(
      `task-outcome:task-invoice-close-42@1.0.0#${DIGEST_A}`,
    );
  });

  it('accepts every record type in the closed vocabulary', () => {
    expect(TASK_RECORD_TYPES).toEqual([
      'task-spec',
      'task-assignment',
      'task-outcome',
      'trajectory',
    ]);
    for (const kind of TASK_RECORD_TYPES) {
      expect(isTaskRecordType(kind)).toBe(true);
      expect(toTaskRecordRefView({ ...valid(), kind }).kind).toBe(kind);
    }
    expect(isTaskRecordType('job')).toBe(false);
    expect(TASK_RECORD_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,127}$');
  });

  it('the history list may be empty and is frozen', () => {
    const history = toTaskHistory([]);
    expect(history).toEqual([]);
    expect(Object.isFrozen(history)).toBe(true);
  });
});

describe('task record refs (negative)', () => {
  it('rejects unknown kinds, malformed ids/versions/digests/timestamps', () => {
    expect(() => toTaskRecordRefView({ ...valid(), kind: 'job' })).toThrow(
      /unknown task record kind/,
    );
    expect(() => toTaskRecordRefView({ ...valid(), taskId: 'Bad Id' })).toThrow(
      /invalid task record id/,
    );
    expect(() => toTaskRecordRefView({ ...valid(), version: '1.0' })).toThrow(
      ExpertRegistryError,
    );
    expect(() => toTaskRecordRefView({ ...valid(), digest: 'x' })).toThrow(
      ExpertRegistryError,
    );
    expect(() => toTaskRecordRefView({ ...valid(), occurredAt: 'yesterday' })).toThrow(
      ExpertRegistryError,
    );
    expect(() => toTaskRecordRefView({ ...valid(), tenant: 'BAD' })).toThrow(
      ExpertRegistryError,
    );
    expect(isTaskRecordRefView(null)).toBe(false);
  });

  it('rejects duplicate record refs in one list', () => {
    expect(() => toTaskHistory([valid(), valid()])).toThrow(
      /duplicate task record ref/,
    );
    expect(() =>
      toTaskHistory('nope' as unknown as Parameters<typeof toTaskHistory>[0]),
    ).toThrow(/must be an array/);
  });
});

describe('task-history append-only discipline (lock rule 6)', () => {
  it('accepts strict prefix extensions', () => {
    const first = toTaskHistory([valid()]);
    const second = toTaskHistory([
      valid(),
      { ...valid(), kind: 'trajectory', taskId: 'trajectory-42', occurredAt: AT_LATER },
    ]);
    expect(() => assertTaskHistoryAppendOnly(first, second)).not.toThrow();
  });

  it('rejects shrinks (removal)', () => {
    const first = toTaskHistory([valid(), { ...valid(), taskId: 'task-2' }]);
    const second = toTaskHistory([valid()]);
    expect(() => assertTaskHistoryAppendOnly(first, second)).toThrow(
      /task history removal detected/,
    );
  });

  it('rejects rewrites', () => {
    const first = toTaskHistory([valid()]);
    const second = toTaskHistory([
      { ...valid(), taskId: 'task-replaced', occurredAt: AT_LATER },
    ]);
    expect(() => assertTaskHistoryAppendOnly(first, second)).toThrow(
      /task history rewrite detected/,
    );
  });
});
