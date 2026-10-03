/**
 * Run-inspection view-model tests (Work Order B011; packages/replay-ui).
 *
 * Positive: the detail assembly composes timeline + event stream +
 * linkage + run record/result summaries; step selection is explicit and
 * honest (selected / out-of-range / none). Negative: malformed run
 * record / run result payloads degrade to unknown summaries; a
 * non-existent step request is reported verbatim, never clamped.
 */

import { describe, expect, it } from 'vitest';
import {
  appendTrajectoryEntry,
  createTrajectoryHeader,
  createTrajectoryRecord,
} from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import {
  createEnvironmentEventLog,
  makeRunSubmittedEvent,
  makeRuntimeEventEnvelope,
  appendRuntimeEventEnvelope,
} from '@arena/environment-runtime';
import {
  selectReplayStep,
  toReplayRunDetail,
  toReplayRunRecordSummary,
  toReplayRunResultSummary,
} from './inspection.js';
import { toReplayTimeline } from './timeline.js';

const T0 = '2026-10-01T08:00:00.000Z';
const T1 = '2026-10-01T08:01:00.000Z';
const T2 = '2026-10-01T08:02:00.000Z';
const DIGEST_A = '1111111111111111111111111111111111111111111111111111111111111111';
const DIGEST_B = '2222222222222222222222222222222222222222222222222222222222222222';

async function buildTrajectory(): Promise<TrajectoryRecord> {
  const header = await createTrajectoryHeader({
    trajectoryId: 'inspection-test',
    run: {
      taskVersion: { taskId: 'payments-reliability', version: '1.0.0' },
      environmentVersion: {
        namespace: 'arena-demo',
        name: 'sandboxed-workspace',
        version: '1.0.0',
        digest: DIGEST_A,
      },
      runId: 'arena-demo/inspection-test',
      initialSnapshotDigest: DIGEST_B,
      runRecordDigest: null,
    },
    agentBodyRef: DIGEST_A,
    substrateRef: DIGEST_B,
    startedAt: T0,
    seed: null,
  });
  let record = createTrajectoryRecord(header);
  record = await appendTrajectoryEntry(record, {
    sequence: 1,
    kind: 'action',
    payload: { actionId: 'read-tests', input: { path: 'src/retry.test.ts' } },
    occurredAt: T1,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 2,
    kind: 'observation',
    payload: { observationId: 'obs-1', channel: 'stdout', content: 'ok' },
    occurredAt: T2,
  });
  record = await appendTrajectoryEntry(record, {
    sequence: 3,
    kind: 'checkpoint',
    payload: { checkpointId: 'ckpt-1', snapshotDigest: DIGEST_B },
    occurredAt: T2,
  });
  return record;
}

describe('selectReplayStep — explicit, honest step selection', () => {
  it('selects an existing step and carries prev/next navigation truth', async () => {
    const timeline = toReplayTimeline(await buildTrajectory());
    const selection = selectReplayStep(timeline, 2);
    expect(selection.state).toBe('selected');
    expect(selection.step?.sequence).toBe(2);
    expect(selection.step?.kind).toBe('observation');
    expect(selection.previousSequence).toBe(1);
    expect(selection.nextSequence).toBe(3);
  });

  it('reports an out-of-range request verbatim — never clamped to a neighbour', async () => {
    const timeline = toReplayTimeline(await buildTrajectory());
    const selection = selectReplayStep(timeline, 99);
    expect(selection.state).toBe('out-of-range');
    expect(selection.requestedSequence).toBe(99);
    expect(selection.step).toBeNull();
    expect(selection.note).toContain('never clamped');
  });

  it('renders the none state without a request or without steps', async () => {
    const timeline = toReplayTimeline(await buildTrajectory());
    expect(selectReplayStep(timeline, null).state).toBe('none');
    const empty = toReplayTimeline(null);
    expect(selectReplayStep(empty, 1).state).toBe('none');
  });

  it('inspects gap markers and unreadable rows too (the no-data truth is inspectable)', async () => {
    const trajectory = await buildTrajectory();
    // Keep entries 1 and 3 (drop entry 2): the gap at sequence 2 shows.
    const gapped = {
      header: trajectory.header,
      entries: [trajectory.entries[0], trajectory.entries[2]],
      chainHead: trajectory.chainHead,
    };
    const timeline = toReplayTimeline(gapped);
    const selection = selectReplayStep(timeline, 2);
    expect(selection.state).toBe('selected');
    expect(selection.step?.kind).toBe('no-data');
  });
});

describe('toReplayRunRecordSummary / toReplayRunResultSummary — A010 projections', () => {
  it('degrades malformed run records to the honest unknown summary (negative)', () => {
    for (const payload of [null, 42, { runId: 'x' }, { nonsense: true }]) {
      const summary = toReplayRunRecordSummary(payload);
      expect(summary.readable).toBe(false);
      expect(summary.runId).toBeNull();
      expect(summary.note).toContain('never guessed');
    }
  });

  it('degrades malformed run results to the honest unknown summary (negative)', () => {
    for (const payload of [null, 'garbage', { finalState: 'completed' }]) {
      const summary = toReplayRunResultSummary(payload);
      expect(summary.readable).toBe(false);
      expect(summary.finalState).toBeNull();
    }
  });
});

describe('toReplayRunDetail — the full assembly', () => {
  it('composes every sub-model and carries the observational note', async () => {
    const trajectory = await buildTrajectory();
    const event = makeRunSubmittedEvent({
      sequence: 1,
      occurredAt: T0,
      runId: 'arena-demo/inspection-test',
      tenantId: 'arena-demo',
      recordDigest: DIGEST_A,
      jobRef: 'job-inspection-test',
      seed: null,
    });
    const log = appendRuntimeEventEnvelope(
      createEnvironmentEventLog(),
      makeRuntimeEventEnvelope(event, {
        correlationId: 'corr-inspection' as never,
        idempotencyKey: 'idem-inspection' as never,
      }),
    );
    const detail = toReplayRunDetail({
      runId: 'arena-demo/inspection-test',
      trajectoryPayload: trajectory,
      eventStreamPayload: log,
      requestedSequence: 1,
    });
    expect(detail.runKey).toBe('inspection-test');
    expect(detail.timeline.state).toBe('ready');
    expect(detail.eventStream.state).toBe('ready');
    expect(detail.inspection.state).toBe('selected');
    expect(detail.chainVerification.status).toBe('not-attempted');
    expect(detail.observationalNote).toContain('no live-world mutation');
    expect(detail.runRecord.readable).toBe(false); // none supplied
  });

  it('degrades honestly when EVERYTHING is malformed (never crashes)', () => {
    const detail = toReplayRunDetail({
      runId: 'arena-demo/hostile',
      trajectoryPayload: 'garbage',
      eventStreamPayload: 42,
      runRecordPayload: null,
      runResultPayload: null,
      requestedSequence: 3,
    });
    expect(detail.timeline.state).toBe('no-data');
    expect(detail.eventStream.state).toBe('no-data');
    expect(detail.inspection.state).toBe('none');
    expect(detail.runRecord.readable).toBe(false);
    expect(detail.runResult.readable).toBe(false);
  });
});
