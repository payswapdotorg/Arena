/**
 * Run-list view-model tests (Work Order B011; packages/replay-ui).
 *
 * Positive: run summaries project under their truth classes
 * (simulation-replay / pending / unknown), deterministic (runId)
 * ordering, bounded pages, continuation tokens round-trip. Negative:
 * invalid continuations fail closed with the typed error; malformed
 * summaries render as unknown rows; unbounded limits are typed errors.
 */

import { describe, expect, it } from 'vitest';
import {
  REPLAY_UI_ERROR_CODES,
  decodeReplayRunContinuation,
  encodeReplayRunContinuation,
  scrollReplayRuns,
  toReplayRunSummary,
} from './run-list.js';

const RUN_A = {
  runId: 'arena-demo/payments-reliability-a',
  submittedAt: '2026-10-01T08:00:00.000Z',
  outcome: 'completed',
  stepCount: 8,
  trajectoryDigest: 'a'.repeat(64),
};
const RUN_B = {
  runId: 'arena-demo/payments-reliability-b',
  submittedAt: '2026-10-01T08:10:00.000Z',
  outcome: 'in-flight',
  stepCount: 3,
  trajectoryDigest: 'b'.repeat(64),
};
const RUN_C = {
  runId: 'arena-demo/payments-reliability-c',
  submittedAt: '2026-10-01T08:00:00.000Z',
  outcome: 'failed',
  stepCount: 4,
  trajectoryDigest: 'c'.repeat(64),
};

describe('toReplayRunSummary — truth classes on run rows', () => {
  it('projects a completed run under simulation-replay (never "result")', () => {
    const summary = toReplayRunSummary(RUN_A);
    expect(summary.runId).toBe(RUN_A.runId);
    expect(summary.runKey).toBe('payments-reliability-a');
    expect(summary.outcome).toBe('completed');
    expect(summary.truthClass).toBe('simulation-replay');
    expect(summary.stepCount).toBe(8);
  });

  it('projects an in-flight run under pending (honest gap)', () => {
    const summary = toReplayRunSummary(RUN_B);
    expect(summary.outcome).toBe('in-flight');
    expect(summary.truthClass).toBe('pending');
    expect(summary.note).toContain('pending, never guessed');
  });

  it('degrades malformed summaries to unknown rows (negative)', () => {
    for (const payload of [null, 42, 'x', { runId: 'not-scoped' }, { runId: 7 }]) {
      const summary = toReplayRunSummary(payload);
      expect(summary.outcome).toBe('unknown');
      expect(summary.truthClass).toBe('unknown');
      expect(summary.note).toContain('never guessed');
    }
  });

  it('rejects non-64-hex trajectory digests on the row (negative)', () => {
    const summary = toReplayRunSummary({ ...RUN_A, trajectoryDigest: 'zzz' });
    expect(summary.trajectoryDigest).toBeNull();
    expect(summary.truthClass).toBe('simulation-replay');
  });
});

/** Assert a fail-closed typed error carries the expected code (not just any throw). */
function expectTypedCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  expect((caught as { code?: unknown }).code).toBe(code);
}

describe('scrollReplayRuns — deterministic ordering + continuation', () => {
  it('orders by runId ascending, deterministically, regardless of input order', () => {
    const page1 = scrollReplayRuns([RUN_C, RUN_B, RUN_A], { limit: 2 });
    const page2 = scrollReplayRuns([RUN_A, RUN_C, RUN_B], { limit: 2 });
    expect(page1.rows.map((row) => row.runId)).toEqual([
      'arena-demo/payments-reliability-a',
      'arena-demo/payments-reliability-b',
    ]);
    expect(page2.rows.map((row) => row.runId)).toEqual(page1.rows.map((row) => row.runId));
    expect(page1.totalKnown).toBe(3);
  });

  it('round-trips the continuation token onto the next page', () => {
    const page1 = scrollReplayRuns([RUN_A, RUN_B, RUN_C], { limit: 2 });
    expect(page1.nextContinuation).not.toBeNull();
    const page2 = scrollReplayRuns([RUN_A, RUN_B, RUN_C], {
      limit: 2,
      ...(page1.nextContinuation !== null ? { continuation: page1.nextContinuation } : {}),
    });
    expect(page2.rows.map((row) => row.runId)).toEqual(['arena-demo/payments-reliability-c']);
    expect(page2.nextContinuation).toBeNull();
    expect(page2.offset).toBe(2);
  });

  it('returns a null continuation on the last page (no empty tail page)', () => {
    const page = scrollReplayRuns([RUN_A], { limit: 50 });
    expect(page.rows).toHaveLength(1);
    expect(page.nextContinuation).toBeNull();
  });

  it('treats a past-the-end continuation as an honest empty page, never a reset', () => {
    const token = encodeReplayRunContinuation(99);
    const page = scrollReplayRuns([RUN_A], { continuation: token });
    expect(page.rows).toHaveLength(0);
    expect(page.offset).toBe(1); // clamped to totalKnown
    expect(page.nextContinuation).toBeNull();
  });

  it('fails closed with the typed error on invalid continuations (negative)', () => {
    for (const token of ['', 'garbage', '####', 'e30=']) {
      expectTypedCode(() => decodeReplayRunContinuation(token), REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION);
    }
    // Well-formed base64url JSON but wrong scope / version / offset.
    const wrongScope = Buffer.from(
      JSON.stringify({ v: 1, scope: 'by-kind', offset: 1 }),
      'utf8',
    ).toString('base64url');
    const wrongVersion = Buffer.from(
      JSON.stringify({ v: 2, scope: 'replay-runs', offset: 1 }),
      'utf8',
    ).toString('base64url');
    const negativeOffset = Buffer.from(
      JSON.stringify({ v: 1, scope: 'replay-runs', offset: -1 }),
      'utf8',
    ).toString('base64url');
    for (const token of [wrongScope, wrongVersion, negativeOffset]) {
      expectTypedCode(() => decodeReplayRunContinuation(token), REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION);
    }
    expectTypedCode(
      () => scrollReplayRuns([RUN_A], { continuation: 'garbage' }),
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
    );
  });

  it('fails closed on unbounded limits (negative)', () => {
    expectTypedCode(() => scrollReplayRuns([RUN_A], { limit: 0 }), REPLAY_UI_ERROR_CODES.INVALID_QUERY);
    expectTypedCode(() => scrollReplayRuns([RUN_A], { limit: 101 }), REPLAY_UI_ERROR_CODES.INVALID_QUERY);
    expectTypedCode(() => scrollReplayRuns([RUN_A], { limit: -5 }), REPLAY_UI_ERROR_CODES.INVALID_QUERY);
  });

  it('encodes deterministic tokens (same offset → same token)', () => {
    expect(encodeReplayRunContinuation(3)).toBe(encodeReplayRunContinuation(3));
    expect(encodeReplayRunContinuation(3)).not.toBe(encodeReplayRunContinuation(4));
    expectTypedCode(() => encodeReplayRunContinuation(-1), REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION);
  });
});
