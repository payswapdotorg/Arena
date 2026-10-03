/**
 * Deterministic demo-corpus tests (Work Order B011; packages/replay-ui).
 *
 * The corpus is built EXCLUSIVELY through the sibling protocol packages'
 * PUBLIC factories, so this suite asserts the protocol-level truths the
 * demo replay surface depends on: determinism (two builds are
 * byte-identical), chain integrity (verifyTrajectoryRecord passes for
 * every run), the completed/in-flight/failed posture split, the A010
 * run-result rule (completed only), and the A012/A013 linkage binding
 * (evaluation/verification records address the trajectory digest).
 */

import { describe, expect, it } from 'vitest';
import { verifyTrajectoryRecord } from '@arena/trajectory';
import { isEnvironmentEventLog } from '@arena/environment-runtime';
import { isRunResult } from '@arena/environment-runtime';
import { isEvaluationRecord } from '@arena/evaluation';
import { isVerificationRecord } from '@arena/verification';
import { buildReplayDemoCorpus, REPLAY_DEMO_IDS } from './fixtures.js';
import { toReplayRunDetail } from './inspection.js';
import { scrollReplayRuns } from './run-list.js';
import { toReplayTimeline } from './timeline.js';

describe('buildReplayDemoCorpus — determinism (the B006 demo posture)', () => {
  it('two builds produce the identical corpus hash and identical digests', async () => {
    const first = await buildReplayDemoCorpus();
    const second = await buildReplayDemoCorpus();
    expect(second.corpusHash).toBe(first.corpusHash);
    expect(second.runs.map((run) => run.runRecord.digest)).toEqual(
      first.runs.map((run) => run.runRecord.digest),
    );
    expect(second.runs.map((run) => run.trajectory.chainHead)).toEqual(
      first.runs.map((run) => run.trajectory.chainHead),
    );
    expect(first.corpusHash.length).toBeGreaterThan(0);
  });

  it('carries exactly the three narrative runs in canonical order', async () => {
    const corpus = await buildReplayDemoCorpus();
    expect(corpus.runs.map((run) => run.runId)).toEqual([
      REPLAY_DEMO_IDS.runA,
      REPLAY_DEMO_IDS.runB,
      REPLAY_DEMO_IDS.runC,
    ]);
  });
});

describe('buildReplayDemoCorpus — protocol-level integrity', () => {
  it('produces trajectories that pass FULL chain verification', async () => {
    const corpus = await buildReplayDemoCorpus();
    for (const run of corpus.runs) {
      const chainHead = await verifyTrajectoryRecord(run.trajectory);
      expect(chainHead).toBe(run.trajectory.chainHead);
    }
  });

  it('produces valid per-run environment event logs (enveloped, append-only)', async () => {
    const corpus = await buildReplayDemoCorpus();
    for (const run of corpus.runs) {
      expect(isEnvironmentEventLog(run.eventLog)).toBe(true);
      expect(run.eventLog.entries.length).toBeGreaterThan(0);
      // Every stream opens with run-submitted (the A010 invariant).
      expect(run.eventLog.entries[0]?.payload.kind).toBe('run-submitted');
    }
  });

  it('produces a valid RunResult ONLY for the completed run (A010 rule)', async () => {
    const corpus = await buildReplayDemoCorpus();
    const [runA, runB, runC] = corpus.runs;
    expect(runA?.runResult).not.toBeNull();
    expect(isRunResult(runA?.runResult)).toBe(true);
    expect(runB?.runResult).toBeNull();
    expect(runC?.runResult).toBeNull();
  });

  it('binds the run result, evaluation and verification to the trajectory by content addressing', async () => {
    const corpus = await buildReplayDemoCorpus();
    const runA = corpus.runs[0];
    if (runA === undefined) throw new Error('run A missing');
    expect(runA.runResult?.runAddress.trajectoryDigest).toBe(runA.trajectory.chainHead);
    const completionEntry = runA.trajectory.entries[runA.trajectory.entries.length - 1];
    expect(completionEntry?.kind).toBe('completion');
    // The payload union is not discriminated on entry.kind in the
    // protocol's types — read the field through a structural lens.
    const completionPayload =
      completionEntry !== undefined
        ? (completionEntry.payload as { evidenceDigests?: readonly string[] })
        : undefined;
    expect(runA.runResult?.runAddress.evidenceDigests).toEqual(
      completionPayload?.evidenceDigests ?? [],
    );
    expect(runA.evaluationRecords).toHaveLength(1);
    expect(isEvaluationRecord(runA.evaluationRecords[0])).toBe(true);
    expect(runA.evaluationRecords[0]?.trajectoryRef).toBe(runA.trajectory.chainHead);
    expect(runA.verificationRecords).toHaveLength(1);
    expect(isVerificationRecord(runA.verificationRecords[0])).toBe(true);
    expect(runA.verificationRecords[0]?.outcome).toBe('pass');
  });
});

describe('the corpus through the view models (demo-posture projections)', () => {
  it('run A renders as a ready completed timeline with full linkage', async () => {
    const corpus = await buildReplayDemoCorpus();
    const runA = corpus.runs[0];
    if (runA === undefined) throw new Error('run A missing');
    const detail = toReplayRunDetail({
      runId: runA.runId,
      trajectoryPayload: runA.trajectory,
      eventStreamPayload: runA.eventLog,
      runRecordPayload: runA.runRecord,
      runResultPayload: runA.runResult,
      evaluationRecords: runA.evaluationRecords,
      verificationRecords: runA.verificationRecords,
      requestedSequence: 4,
    });
    expect(detail.timeline.state).toBe('ready');
    expect(detail.timeline.outcome).toBe('completed');
    expect(detail.timeline.stepCount).toBe(8);
    expect(detail.eventStream.state).toBe('ready');
    expect(detail.linkage.evaluations[0]?.truthClass).toBe('evaluation-result');
    expect(detail.linkage.verifications[0]?.truthClass).toBe('verified-fact');
    expect(detail.linkage.evidence.length).toBeGreaterThanOrEqual(2);
    expect(detail.inspection.state).toBe('selected');
    expect(detail.inspection.step?.sequence).toBe(4);
    expect(detail.runResult.readable).toBe(true);
  });

  it('run A demonstrates the same-wall-clock step (logical order authoritative)', async () => {
    const corpus = await buildReplayDemoCorpus();
    const runA = corpus.runs[0];
    if (runA === undefined) throw new Error('run A missing');
    const timeline = toReplayTimeline(runA.trajectory);
    expect(timeline.sameWallClockSteps).toEqual([3]);
  });

  it('run B renders as PENDING (in flight — never guessed)', async () => {
    const corpus = await buildReplayDemoCorpus();
    const runB = corpus.runs[1];
    if (runB === undefined) throw new Error('run B missing');
    const detail = toReplayRunDetail({
      runId: runB.runId,
      trajectoryPayload: runB.trajectory,
      eventStreamPayload: runB.eventLog,
      runRecordPayload: runB.runRecord,
    });
    expect(detail.timeline.pending).toBe(true);
    expect(detail.timeline.outcome).toBe('pending');
    expect(detail.runResult.readable).toBe(false);
  });

  it('run C renders as failed with the error entry visible and no run result', async () => {
    const corpus = await buildReplayDemoCorpus();
    const runC = corpus.runs[2];
    if (runC === undefined) throw new Error('run C missing');
    const detail = toReplayRunDetail({
      runId: runC.runId,
      trajectoryPayload: runC.trajectory,
      eventStreamPayload: runC.eventLog,
      runRecordPayload: runC.runRecord,
    });
    expect(detail.timeline.outcome).toBe('failed');
    expect(detail.timeline.steps.some((step) => step.kind === 'error')).toBe(true);
    expect(detail.timeline.evidenceDigests).toEqual([]);
    expect(detail.runResult.readable).toBe(false);
    expect(detail.runResult.note).toContain('event streams');
  });

  it('scrolls the corpus run list deterministically with continuation', async () => {
    const corpus = await buildReplayDemoCorpus();
    const summaries = corpus.runs.map((run) => ({
      runId: run.runId,
      submittedAt: run.runRecord.submittedAt,
      outcome:
        run.runResult !== null
          ? 'completed'
          : run.trajectory.entries.some((entry) => entry.kind === 'completion')
            ? 'failed'
            : 'in-flight',
      stepCount: run.trajectory.entries.length,
      trajectoryDigest: run.trajectory.chainHead,
    }));
    const page1 = scrollReplayRuns(summaries, { limit: 2 });
    expect(page1.rows.map((row) => row.runId)).toEqual([REPLAY_DEMO_IDS.runA, REPLAY_DEMO_IDS.runB]);
    const page2 = scrollReplayRuns(summaries, {
      limit: 2,
      ...(page1.nextContinuation !== null ? { continuation: page1.nextContinuation } : {}),
    });
    expect(page2.rows.map((row) => row.runId)).toEqual([REPLAY_DEMO_IDS.runC]);
    expect(page1.rows[1]?.truthClass).toBe('pending');
    expect(page1.rows[2]?.truthClass).toBeUndefined();
  });
});
