/**
 * Timeline view-model tests (Work Order B011; packages/replay-ui).
 *
 * Positive: a REAL trajectory (built through @arena/trajectory's public
 * factories) projects at full fidelity — kinds, summaries, wall-clock
 * deltas, same-timestamp logical ordering, pending posture, evidence
 * addresses. Negative: malformed, truncated and gapped payloads render
 * truthful degradation (visible notes, `unknown` marks) and NEVER crash
 * or fabricate.
 */

import { describe, expect, it } from 'vitest';
import {
  appendTrajectoryEntry,
  createTrajectoryHeader,
  createTrajectoryRecord,
} from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import {
  REPLAY_OBSERVATIONAL_NOTE,
  REPLAY_STEP_TRUTH_CLASS,
  replayTruthMark,
  classifyReplayTruthCarrier,
  REPLAY_NOT_RESULT_NOTE,
} from './truth.js';
import {
  replayTimelineStatusLabel,
  toReplayTimeline,
  verifyReplayTrajectoryChain,
} from './timeline.js';

const T0 = '2026-10-01T08:00:00.000Z';
const T1 = '2026-10-01T08:01:00.000Z';
const T2 = '2026-10-01T08:02:00.000Z';
const T3 = '2026-10-01T08:03:00.000Z';
const DIGEST_A = '1111111111111111111111111111111111111111111111111111111111111111';
const DIGEST_B = '2222222222222222222222222222222222222222222222222222222222222222';
const EVIDENCE = '3333333333333333333333333333333333333333333333333333333333333333';

async function buildTrajectory(withCompletion: boolean): Promise<TrajectoryRecord> {
  const header = await createTrajectoryHeader({
    trajectoryId: 'timeline-test',
    run: {
      taskVersion: { taskId: 'payments-reliability', version: '1.0.0' },
      environmentVersion: {
        namespace: 'arena-demo',
        name: 'sandboxed-workspace',
        version: '1.0.0',
        digest: DIGEST_A,
      },
      runId: 'arena-demo/timeline-test',
      initialSnapshotDigest: DIGEST_B,
      runRecordDigest: null,
    },
    agentBodyRef: DIGEST_A,
    substrateRef: DIGEST_B,
    startedAt: T0,
    seed: 'seed-timeline-test',
  });
  let record = createTrajectoryRecord(header);
  record = await appendTrajectoryEntry(record, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'read-tests', input: { path: 'src/retry.test.ts' } },
    occurredAt: T1,
  });
  // SAME wall-clock timestamp as the previous step — logical order must rule.
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'observation',
    payload: {
      observationId: 'obs-failures',
      channel: 'stdout',
      content: '3 failing tests in retry policy',
    },
    occurredAt: T1,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'checkpoint',
    payload: { checkpointId: 'ckpt-1', snapshotDigest: DIGEST_B },
    occurredAt: T2,
  });
  if (withCompletion) {
    record = await appendTrajectoryEntry(record, {
      sequence: 4,
      kind: 'completion',
      payload: { outcome: 'completed', evidenceDigests: [EVIDENCE] },
      occurredAt: T3,
    });
  }
  return record;
}

describe('replay truth classes (B003 taxonomy projection)', () => {
  it('pins the replayed-step truth class to simulation-replay — never "result" (positive)', () => {
    expect(REPLAY_STEP_TRUTH_CLASS).toBe('simulation-replay');
    expect(REPLAY_STEP_TRUTH_CLASS).not.toBe('verified-fact');
    expect(REPLAY_STEP_TRUTH_CLASS).not.toBe('evaluation-result');
  });

  it('carries the observational and not-a-result notes verbatim (positive)', () => {
    expect(REPLAY_OBSERVATIONAL_NOTE).toContain('no live-world mutation');
    expect(REPLAY_NOT_RESULT_NOTE).toContain('SIMULATION-REPLAY');
    expect(REPLAY_NOT_RESULT_NOTE).toContain('never a generic "AI result"');
  });

  it('resolves canonical labels/meanings for every class and classifies unknown as unknown (positive)', () => {
    const mark = replayTruthMark('simulation-replay');
    expect(mark.label.length).toBeGreaterThan(0);
    expect(mark.meaning.length).toBeGreaterThan(0);
    expect(classifyReplayTruthCarrier({ stateKind: 'demo-state' }).truthClass).toBe('demo-state');
    expect(classifyReplayTruthCarrier({ nonsense: true }).truthClass).toBe('unknown');
  });
});

describe('toReplayTimeline — positive projection of a REAL trajectory', () => {
  it('renders every entry at full fidelity under the simulation-replay truth class', async () => {
    const trajectory = await buildTrajectory(true);
    const timeline = toReplayTimeline(trajectory);
    expect(timeline.state).toBe('ready');
    expect(timeline.integrity).toBe('chain-consistent');
    expect(timeline.stepCount).toBe(4);
    expect(timeline.steps).toHaveLength(4);
    for (const step of timeline.steps) {
      expect(step.truthClass).toBe('simulation-replay');
    }
    expect(timeline.steps.map((step) => step.kind)).toEqual([
      'action',
      'observation',
      'checkpoint',
      'completion',
    ]);
    expect(timeline.chainHead).toBe(trajectory.chainHead);
    expect(timeline.outcome).toBe('completed');
    expect(timeline.evidenceDigests).toEqual([EVIDENCE]);
  });

  it('carries the run binding (the four evidence-address parts) from the header', async () => {
    const trajectory = await buildTrajectory(true);
    const timeline = toReplayTimeline(trajectory);
    expect(timeline.trajectoryId).toBe('timeline-test');
    expect(timeline.runRef.taskId).toBe('payments-reliability');
    expect(timeline.runRef.environmentId).toBe('arena-demo/sandboxed-workspace');
    expect(timeline.runRef.runId).toBe('arena-demo/timeline-test');
    expect(timeline.runRef.initialSnapshotDigest).toBe(DIGEST_B);
    expect(timeline.seed).toBe('seed-timeline-test');
  });

  it('computes wall-clock deltas and flags same-timestamp steps (logical order authoritative)', async () => {
    const trajectory = await buildTrajectory(true);
    const timeline = toReplayTimeline(trajectory);
    expect(timeline.steps[0]?.wallClockDeltaMs).toBeNull(); // first readable step
    expect(timeline.steps[1]?.wallClockDeltaMs).toBe(0); // same timestamp as step 1
    expect(timeline.steps[1]?.sameWallClockAsPrevious).toBe(true);
    expect(timeline.steps[2]?.wallClockDeltaMs).toBe(60000);
    expect(timeline.sameWallClockSteps).toEqual([2]);
    expect(timeline.notes.join(' ')).toContain('LOGICAL (chain sequence) order is authoritative');
    expect(timeline.span.elapsedMs).toBe(Date.parse(T3) - Date.parse(T1));
  });

  it('renders per-step I/O summaries for every entry kind (positive)', async () => {
    const trajectory = await buildTrajectory(true);
    const timeline = toReplayTimeline(trajectory);
    expect(timeline.steps[0]?.summary).toContain('action read-tests');
    expect(timeline.steps[0]?.summary).toContain('input {path}');
    expect(timeline.steps[1]?.summary).toContain('observation obs-failures on stdout');
    expect(timeline.steps[2]?.summary).toContain('checkpoint ckpt-1');
    expect(timeline.steps[3]?.summary).toContain('completion — completed (1 evidence digest');
  });

  it('carries the chained digests per step (tamper-evident chain visible)', async () => {
    const trajectory = await buildTrajectory(true);
    const timeline = toReplayTimeline(trajectory);
    expect(timeline.steps[0]?.prevDigest).toBe(trajectory.header.digest);
    expect(timeline.steps[3]?.stepDigest).toBe(trajectory.chainHead);
  });

  it('marks a structurally consistent trajectory WITHOUT completion as pending (honest gap)', async () => {
    const trajectory = await buildTrajectory(false);
    const timeline = toReplayTimeline(trajectory);
    expect(timeline.state).toBe('ready');
    expect(timeline.pending).toBe(true);
    expect(timeline.outcome).toBe('pending');
    expect(timeline.notes.join(' ')).toContain('PENDING, never guessed');
    expect(replayTimelineStatusLabel(timeline)).toBe('pending (in flight)');
  });
});

describe('toReplayTimeline — negative (malformed/truncated payloads never crash)', () => {
  it('renders the honest no-data posture for absent/garbage payloads', () => {
    for (const payload of [null, undefined, 42, 'garbage', [], [{ entry: true }]]) {
      const timeline = toReplayTimeline(payload);
      expect(timeline.state).toBe('no-data');
      expect(timeline.steps).toHaveLength(0);
      expect(timeline.outcome).toBe('unknown');
      expect(timeline.degradation.length).toBeGreaterThan(0);
    }
  });

  it('degrades (never crashes) on a truncated payload: cut entries + stale chain head', async () => {
    const trajectory = await buildTrajectory(true);
    const truncated = {
      header: trajectory.header,
      // Cut after entry 2 — the declared chain head no longer matches.
      entries: trajectory.entries.slice(0, 2),
      chainHead: trajectory.chainHead,
    };
    const timeline = toReplayTimeline(truncated);
    expect(timeline.state).toBe('degraded');
    expect(timeline.integrity).toBe('invalid-shape');
    expect(timeline.stepCount).toBe(2);
    expect(timeline.outcome).toBe('unknown');
    expect(timeline.degradation.join(' ')).toContain('failed structural validation');
    expect(timeline.degradation.join(' ')).toContain('no readable completion entry');
  });

  it('renders sequence gaps as no-data markers — never fabricated steps', async () => {
    const trajectory = await buildTrajectory(true);
    // Keep entry 1 (action) and entry 3 (checkpoint): per-entry validity
    // holds, the record-level guard fails, and the gap at sequence 2 shows.
    const gapped = {
      header: trajectory.header,
      entries: [trajectory.entries[0], trajectory.entries[2]],
      chainHead: trajectory.chainHead,
    };
    const timeline = toReplayTimeline(gapped);
    expect(timeline.state).toBe('degraded');
    expect(timeline.steps.map((step) => step.kind)).toEqual(['action', 'no-data', 'checkpoint']);
    expect(timeline.steps.map((step) => step.sequence)).toEqual([1, 2, 3]);
    const gap = timeline.steps[1];
    expect(gap?.kind).toBe('no-data');
    expect(gap?.truthClass).toBe('unknown');
    expect(gap?.summary).toContain('sequence 2 is missing');
  });

  it('renders unreadable entries as unknown rows at their declared position', async () => {
    const trajectory = await buildTrajectory(true);
    const corrupt = {
      header: trajectory.header,
      entries: [trajectory.entries[0], { sequence: 2, kind: 'nonsense' }, trajectory.entries[2], trajectory.entries[3]],
      chainHead: trajectory.chainHead,
    };
    const timeline = toReplayTimeline(corrupt);
    expect(timeline.state).toBe('degraded');
    expect(timeline.steps[1]?.kind).toBe('unreadable');
    expect(timeline.steps[1]?.truthClass).toBe('unknown');
    expect(timeline.steps[1]?.sequence).toBe(2);
    expect(timeline.degradation.join(' ')).toContain('unreadable');
  });

  it('never throws on deeply hostile payloads (total projection)', () => {
    expect(() => toReplayTimeline({ header: null, entries: [null, 42, 'x'], chainHead: 7 })).not.toThrow();
    expect(() => toReplayTimeline({ entries: [{ sequence: -1 }] })).not.toThrow();
    expect(() => toReplayTimeline({ header: {}, entries: 'not-an-array' })).not.toThrow();
  });
});

describe('verifyReplayTrajectoryChain — typed, non-throwing full-chain verification', () => {
  it('verifies a real trajectory and returns the recomputed chain head', async () => {
    const trajectory = await buildTrajectory(true);
    const verification = await verifyReplayTrajectoryChain(trajectory);
    expect(verification.status).toBe('verified');
    expect(verification.chainHead).toBe(trajectory.chainHead);
  });

  it('fails closed with the trajectory package tamper code on a mutated entry', async () => {
    const trajectory = await buildTrajectory(true);
    const tampered = {
      ...trajectory,
      entries: trajectory.entries.map((entry, index) =>
        index === 1
          ? { ...entry, payload: { ...entry.payload, content: 'tampered content' } }
          : entry,
      ),
    };
    const verification = await verifyReplayTrajectoryChain(tampered);
    expect(verification.status).toBe('failed');
    expect(verification.errorCode).not.toBeNull();
    expect(verification.detail).not.toBeNull();
  });

  it('fails closed (not crash) on malformed shapes', async () => {
    const verification = await verifyReplayTrajectoryChain({ nonsense: true });
    expect(verification.status).toBe('failed');
    expect(verification.errorCode).not.toBeNull();
  });
});
