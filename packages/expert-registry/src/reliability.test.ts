/**
 * Reliability tests (Work Order A006 gate 7; §8 reliability; R32; lock
 * rule 6) — the event-sourced counter discipline: counters are RECOMPUTED
 * from the append-only ledger, never directly mutable or declarable.
 */

import { describe, expect, it } from 'vitest';
import {
  RELIABILITY_ENTRY_VERSION,
  RELIABILITY_EVENT_KINDS,
  RELIABILITY_METRICS_VERSION,
  appendReliabilityEntry,
  assertMetricsMatchLedger,
  assertReliabilityAppendOnly,
  isReliabilityEventKind,
  isReliabilityLedgerEntry,
  isReliabilityMetrics,
  recomputeReliabilityMetrics,
  toReliabilityLedgerEntry,
} from './reliability.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  AT,
  AT_EVEN_LATER,
  AT_LATER,
  DIGEST_A,
  expectThrowsCode,
  RECORDER,
} from './test-support.js';

const entry = (kind: string, occurredAt: string) => ({
  kind,
  occurredAt,
  recordedBy: RECORDER,
});

describe('reliability ledger entries (positive + negative)', () => {
  it('accepts typed outcome entries and freezes them', () => {
    const e = toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1 });
    expect(isReliabilityLedgerEntry(e)).toBe(true);
    expect(e.entryVersion).toBe(RELIABILITY_ENTRY_VERSION);
    expect(Object.isFrozen(e)).toBe(true);
    expect(Object.isFrozen(e.recordedBy)).toBe(true);
  });

  it('the closed vocabulary is exactly the three §8 counter families', () => {
    expect(RELIABILITY_EVENT_KINDS).toEqual(['task-completed', 'task-failed', 'no-response']);
    expect(isReliabilityEventKind('task-completed')).toBe(true);
    expect(isReliabilityEventKind('task-cancelled')).toBe(false);
  });

  it('rejects bad sequences, kinds, timestamps and principals', () => {
    expect(() => toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 0 })).toThrow(
      /positive integer/,
    );
    expect(() => toReliabilityLedgerEntry({ ...entry('task-cancelled', AT), sequence: 1 })).toThrow(
      /unknown reliability event kind/,
    );
    expect(() => toReliabilityLedgerEntry({ ...entry('task-completed', 'when?'), sequence: 1 })).toThrow(
      ExpertRegistryError,
    );
    expect(() =>
      toReliabilityLedgerEntry({
        kind: 'task-completed',
        occurredAt: AT,
        recordedBy: { type: 'user', tenant: 'BAD', principalId: 'x' },
        sequence: 1,
      }),
    ).toThrow(ExpertRegistryError);
    expect(() =>
      toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1, note: '' }),
    ).toThrow(/non-empty/);
  });
});

describe('appendReliabilityEntry — the only way a ledger grows (gate 7)', () => {
  it('assigns sequences itself and returns a NEW frozen ledger (pure append)', () => {
    const empty: readonly ReturnType<typeof toReliabilityLedgerEntry>[] = [];
    const one = appendReliabilityEntry(empty, entry('task-completed', AT));
    expect(one).toHaveLength(1);
    expect(one[0]!.sequence).toBe(1);
    const two = appendReliabilityEntry(one, entry('no-response', AT_LATER));
    expect(two).toHaveLength(2);
    expect(two[1]!.sequence).toBe(2);
    expect(one).toHaveLength(1); // purity: the input ledger is untouched
    expect(Object.isFrozen(two)).toBe(true);
  });

  it('rejects caller-chosen sequences (the ledger order is protocol-controlled)', () => {
    expectThrowsCode(
      () => appendReliabilityEntry([], { ...entry('task-completed', AT), sequence: 1 } as never),
      EXPERT_ERROR_CODES.RELIABILITY_MUTATION,
    );
  });

  it('validates the appended entry kind', () => {
    expect(() => appendReliabilityEntry([], entry('task-cancelled', AT))).toThrow(
      /unknown reliability event kind/,
    );
  });
});

describe('recomputeReliabilityMetrics — counters are derived, not stored (gate 7)', () => {
  it('folds the ledger into the three §8 counters (R32 measurement data)', () => {
    const ledger = [
      toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1 }),
      toReliabilityLedgerEntry({ ...entry('task-completed', AT_LATER), sequence: 2 }),
      toReliabilityLedgerEntry({ ...entry('task-failed', AT_LATER), sequence: 3 }),
      toReliabilityLedgerEntry({ ...entry('no-response', AT_EVEN_LATER), sequence: 4 }),
    ];
    const metrics = recomputeReliabilityMetrics(ledger);
    expect(metrics.metricsVersion).toBe(RELIABILITY_METRICS_VERSION);
    expect(metrics.tasksCompleted).toBe(2);
    expect(metrics.tasksFailed).toBe(1);
    expect(metrics.noResponse).toBe(1);
    expect(metrics.totalEvents).toBe(4);
    expect(metrics.lastEventAt).toBe(AT_EVEN_LATER);
    expect(isReliabilityMetrics(metrics)).toBe(true);
    expect(Object.isFrozen(metrics)).toBe(true);
  });

  it('an empty ledger folds to zero counters (a new expert starts honest)', () => {
    const metrics = recomputeReliabilityMetrics([]);
    expect(metrics.tasksCompleted).toBe(0);
    expect(metrics.tasksFailed).toBe(0);
    expect(metrics.noResponse).toBe(0);
    expect(metrics.totalEvents).toBe(0);
    expect(metrics.lastEventAt).toBeUndefined();
  });

  it('derived metrics are IMMUTABLE — direct mutation throws (negative)', () => {
    const metrics = recomputeReliabilityMetrics([
      toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1 }),
    ]);
    expect(() => {
      (metrics as { tasksCompleted: number }).tasksCompleted = 99;
    }).toThrow(TypeError);
    expect(metrics.tasksCompleted).toBe(1);
  });

  it('assertMetricsMatchLedger rejects hand-crafted counters (negative)', () => {
    const ledger = [
      toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1 }),
    ];
    const honest = recomputeReliabilityMetrics(ledger);
    expect(() => assertMetricsMatchLedger(honest, ledger)).not.toThrow();
    const forged = {
      metricsVersion: RELIABILITY_METRICS_VERSION,
      tasksCompleted: 41,
      tasksFailed: 0,
      noResponse: 0,
      totalEvents: 41,
    } as ReturnType<typeof recomputeReliabilityMetrics>;
    expectThrowsCode(
      () => assertMetricsMatchLedger(forged, ledger),
      EXPERT_ERROR_CODES.RELIABILITY_MUTATION,
    );
  });
});

describe('reliability append-only discipline (lock rule 6)', () => {
  it('accepts strict prefix extensions with unbroken sequences', () => {
    const previous = [
      toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1 }),
    ];
    const next = [
      ...previous,
      toReliabilityLedgerEntry({ ...entry('task-failed', AT_LATER), sequence: 2 }),
    ];
    expect(() => assertReliabilityAppendOnly(previous, next)).not.toThrow();
  });

  it('rejects shrinks, rewrites and broken sequences', () => {
    const previous = [
      toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1 }),
      toReliabilityLedgerEntry({ ...entry('task-failed', AT_LATER), sequence: 2 }),
    ];
    expect(() => assertReliabilityAppendOnly(previous, previous.slice(0, 1))).toThrow(
      /ledger shrink detected/,
    );
    const rewritten = [
      toReliabilityLedgerEntry({ ...entry('no-response', AT), sequence: 1 }),
      toReliabilityLedgerEntry({ ...entry('task-failed', AT_LATER), sequence: 2 }),
    ];
    expect(() => assertReliabilityAppendOnly(previous, rewritten)).toThrow(
      /ledger rewrite detected/,
    );
    const broken = [
      toReliabilityLedgerEntry({ ...entry('task-completed', AT), sequence: 1 }),
      toReliabilityLedgerEntry({ ...entry('task-failed', AT_LATER), sequence: 7 }),
    ];
    expect(() => assertReliabilityAppendOnly([], broken)).toThrow(
      /sequence broken/,
    );
  });

  it('entries with evidence refs are validated (evidence optional but typed)', () => {
    const e = toReliabilityLedgerEntry({
      ...entry('task-completed', AT),
      sequence: 1,
      evidence: [{ digest: DIGEST_A, description: 'Trajectory export digest.' }],
    });
    expect(e.evidence).toHaveLength(1);
    expect(() =>
      toReliabilityLedgerEntry({
        ...entry('task-completed', AT),
        sequence: 1,
        evidence: [],
      }),
    ).toThrow(/non-empty list of refs/);
  });
});
