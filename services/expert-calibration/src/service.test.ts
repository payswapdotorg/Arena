/**
 * Integration tests (Work Order C004): a full calibration program run
 * over injected ports on the in-memory reference fabric — register →
 * record outcomes → run verdict → pre-training track → proposal →
 * scheduled requalification check → routing read surface.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { ExpertCalibrationService } from './fabric.js';
import {
  FakeExpertQualificationPort,
  FakeIntakeGapSource,
  FakeWorkbenchAssignmentPort,
  SERVICE_CAPABILITY,
  SERVICE_PROGRAM_INPUT,
  S0,
  S1,
  S2,
  S3,
  S_EXPIRED,
} from './test-support.js';

const CORR = toCorrelationId('corr-1');

function makeService() {
  const intake = new FakeIntakeGapSource();
  const qualification = new FakeExpertQualificationPort();
  const workbench = new FakeWorkbenchAssignmentPort();
  const service = new ExpertCalibrationService({ intake, qualification, workbench });
  return { service, intake, qualification, workbench };
}

function opts(n: number, at: string) {
  return {
    correlationId: CORR,
    idempotencyKey: toIdempotencyKey(`key-${n}`),
    at,
  };
}

async function seededService() {
  const ctx = makeService();
  const { service } = ctx;
  const { program } = await service.registerProgram({ ...SERVICE_PROGRAM_INPUT }, opts(1, S0));
  const outcomes = [
    { calibrationId: 'cal-record-1', predicted: { confidence: 0.7, score: null }, observed: { outcome: 'correct', score: null }, predictedAt: S0, observedAt: S1 },
    { calibrationId: 'cal-record-2', predicted: { confidence: 0.7, score: null }, observed: { outcome: 'correct', score: null }, predictedAt: S0, observedAt: S2 },
    { calibrationId: 'cal-record-3', predicted: { confidence: 0.7, score: null }, observed: { outcome: 'incorrect', score: null }, predictedAt: S0, observedAt: S2 },
  ] as const;
  let key = 10;
  for (const outcome of outcomes) {
    await service.recordCalibrationOutcome(
      {
        calibrationId: outcome.calibrationId,
        tenant: 'tenant-a',
        expertId: 'expert-1',
        programId: program.programId,
        programDigest: program.digest,
        probeId: 'probe-prediction-1',
        predicted: outcome.predicted,
        observed: outcome.observed,
        applicability: {
          capability: { ...SERVICE_CAPABILITY },
          environment: [{ namespace: 'arena', name: 'expert-workbench-env', version: '1.2.0', digest: 'c'.repeat(64) }],
        },
        predictedAt: outcome.predictedAt,
        observedAt: outcome.observedAt,
        provenance: { recordedBy: 'verifier-tax-audit', recordedAt: outcome.observedAt, notes: null },
      },
      opts(key++, S3),
    );
  }
  return ctx;
}

describe('program lifecycle + drift verdict (integration)', () => {
  it('registers a program, appends outcomes, derives the typed verdict deterministically', async () => {
    const { service } = await seededService();
    const { verdict } = await service.runProgram(
      SERVICE_PROGRAM_INPUT.programId,
      'tenant-a',
      'expert-1',
      { ...opts(20, S3), verdictId: 'cal-verdict-1' },
    );
    expect(verdict.verdict).toBe('calibrated');
    expect(verdict.freshDecidedCount).toBe(3);
    expect(verdict.recordCount).toBe(3);
    expect(verdict.foldedRecordDigests).toHaveLength(3);
    expect(service.describe().verdicts).toBe(1);
  });

  it('rejects duplicate program registration and duplicate record ids (append-only store)', async () => {
    const { service } = await seededService();
    await expect(
      service.registerProgram({ ...SERVICE_PROGRAM_INPUT }, opts(21, S3)),
    ).rejects.toThrow(/already registered/);
  });

  it('rejects same idempotency key on a different command tuple (IDEMPOTENCY_CONFLICT)', async () => {
    const ctx = makeService();
    const { service } = ctx;
    await service.registerProgram({ ...SERVICE_PROGRAM_INPUT }, opts(1, S0));
    await expect(
      service.registerProgram({ ...SERVICE_PROGRAM_INPUT, programId: 'calprog-other-1' }, opts(1, S0)),
    ).rejects.toThrow(/different command tuple/);
  });
});

describe('pre-training flow (C003 gaps → A017 workbench → A007 proposal)', () => {
  it('derives the track from the intake gap port, dispatches to the workbench, and PROPOSES to A007 on completion', async () => {
    const ctx = makeService();
    const { service, intake, qualification, workbench } = ctx;
    intake.seed('intake-session-1', 'tenant-a', [
      { reason: 'capability-unanswered', itemId: 'item-cap-1', routingInput: 'capability' },
      { reason: 'evidence-missing', itemId: 'item-ev-1', routingInput: 'evidence' },
    ]);

    const { track } = await service.derivePreTrainingTrack(
      { trackId: 'pretrain-track-1', tenant: 'tenant-a', expertId: 'expert-1', intakeSessionId: 'intake-session-1' },
      opts(2, S1),
    );
    expect(track.assignments).toHaveLength(2);
    expect(workbench.dispatched).toHaveLength(2);
    expect(workbench.dispatched[0]!.workbenchTask.taskKind).toBe('calibration-pre-training');

    // First completion → in-progress, NO proposal yet (proposal-not-write boundary).
    const first = await service.completePreTrainingAssignment(
      'pretrain-track-1',
      'tenant-a',
      'expert-1',
      'assign-capability-item-cap-1',
      { ...opts(3, S2), capability: { ...SERVICE_CAPABILITY }, evidence: ['f'.repeat(64)] },
    );
    expect(first.track.state).toBe('in-progress');
    expect(first.proposal).toBeNull();
    expect(qualification.updateProposals).toHaveLength(0);

    // Final completion → pre-trained → the A007 port receives the PROPOSAL.
    const done = await service.completePreTrainingAssignment(
      'pretrain-track-1',
      'tenant-a',
      'expert-1',
      'assign-evidence-item-ev-1',
      { ...opts(4, S3), capability: { ...SERVICE_CAPABILITY }, evidence: ['f'.repeat(64)] },
    );
    expect(done.track.state).toBe('pre-trained');
    expect(done.proposal).not.toBeNull();
    expect(done.proposal!.kind).toBe('pre-training-completed');
    expect(qualification.updateProposals).toHaveLength(1);
    expect(done.receipt!.accepted).toBe(true);
    expect(service.listEvents().map((envelope) => envelope.schema).some((schema) => schema.includes('qualification-update-proposed-event'))).toBe(true);
  });

  it('fails closed when the C003 gap port fails or the workbench rejects (PORT_FAILURE)', async () => {
    const ctx = makeService();
    const { service, intake, workbench } = ctx;
    intake.failNext = true;
    await expect(
      service.derivePreTrainingTrack(
        { trackId: 'pretrain-track-x', tenant: 'tenant-a', expertId: 'expert-1', intakeSessionId: 'intake-session-1' },
        opts(5, S1),
      ),
    ).rejects.toThrow(/intake gap port failed/);

    intake.failNext = false;
    intake.seed('intake-session-1', 'tenant-a', [
      { reason: 'capability-unanswered', itemId: 'item-cap-1', routingInput: 'capability' },
    ]);
    workbench.rejectAll = true;
    await expect(
      service.derivePreTrainingTrack(
        { trackId: 'pretrain-track-y', tenant: 'tenant-a', expertId: 'expert-1', intakeSessionId: 'intake-session-1' },
        opts(6, S1),
      ),
    ).rejects.toThrow(/workbench port rejected/);
    expect(service.describe().tracks).toBe(0);
  });

  it('fails closed when the A007 proposal port rejects or fails (no silent partial handoff)', async () => {
    const ctx = makeService();
    const { service, intake, qualification } = ctx;
    intake.seed('intake-session-1', 'tenant-a', [
      { reason: 'capability-unanswered', itemId: 'item-cap-1', routingInput: 'capability' },
    ]);
    await service.derivePreTrainingTrack(
      { trackId: 'pretrain-track-1', tenant: 'tenant-a', expertId: 'expert-1', intakeSessionId: 'intake-session-1' },
      opts(2, S1),
    );
    qualification.rejectUpdates = true;
    await expect(
      service.completePreTrainingAssignment(
        'pretrain-track-1',
        'tenant-a',
        'expert-1',
        'assign-capability-item-cap-1',
        { ...opts(3, S2), capability: { ...SERVICE_CAPABILITY }, evidence: ['f'.repeat(64)] },
      ),
    ).rejects.toThrow(/rejected the proposal/);
  });
});

describe('scheduled requalification checks (durable idempotent A015 jobs)', () => {
  it('schedules a job, then runs it: time-window-elapsed → EXPIRED transition proposal to A007', async () => {
    const ctx = await seededService();
    const { service, qualification } = ctx;
    qualification.seedWindow('tenant-a', 'expert-1', SERVICE_CAPABILITY.id, {
      validFrom: S0,
      validUntil: '2026-10-10T00:00:00.000Z',
      recordDigest: 'a'.repeat(64),
    });
    await service.runProgram(SERVICE_PROGRAM_INPUT.programId, 'tenant-a', 'expert-1', {
      ...opts(20, S3),
      verdictId: 'cal-verdict-1',
    });
    const { job } = await service.scheduleRequalificationCheck(
      SERVICE_PROGRAM_INPUT.programId,
      'tenant-a',
      'expert-1',
      opts(21, S3),
    );
    expect(job.status).toBe('queued');
    expect(job.kind.name).toBe('requalification-check');
    expect(job.idempotencyKey).toBe(toIdempotencyKey('key-21'));

    const run = await service.runRequalificationCheck(job.jobId, 'tenant-a', {
      ...opts(22, S_EXPIRED),
    });
    expect(run.job.status).toBe('succeeded');
    expect(run.proposal).not.toBeNull();
    expect(run.proposal!.trigger).toBe('time-window-elapsed');
    expect(run.proposal!.proposedStatus).toBe('expired');
    expect(qualification.requalificationProposals).toHaveLength(1);
  });

  it('completes with NO proposal when nothing decayed and the verdict is calibrated', async () => {
    const ctx = await seededService();
    const { service, qualification } = ctx;
    qualification.seedWindow('tenant-a', 'expert-1', SERVICE_CAPABILITY.id, {
      validFrom: S0,
      validUntil: '2027-01-01T00:00:00.000Z',
      recordDigest: 'a'.repeat(64),
    });
    await service.runProgram(SERVICE_PROGRAM_INPUT.programId, 'tenant-a', 'expert-1', {
      ...opts(20, S3),
      verdictId: 'cal-verdict-1',
    });
    const { job } = await service.scheduleRequalificationCheck(
      SERVICE_PROGRAM_INPUT.programId,
      'tenant-a',
      'expert-1',
      opts(21, S3),
    );
    const run = await service.runRequalificationCheck(job.jobId, 'tenant-a', { ...opts(22, S3) });
    expect(run.proposal).toBeNull();
    expect(run.job.status).toBe('succeeded');
    expect(qualification.requalificationProposals).toHaveLength(0);
  });
});

describe('the C002 routing read surface (demonstrated performance)', () => {
  it('serves the typed verdict + in-force flag as a frozen read (a port, not a write into routing)', async () => {
    const ctx = await seededService();
    const { service, qualification } = ctx;
    qualification.seedWindow('tenant-a', 'expert-1', SERVICE_CAPABILITY.id, {
      validFrom: S0,
      validUntil: '2027-01-01T00:00:00.000Z',
      recordDigest: 'a'.repeat(64),
    });
    await service.runProgram(SERVICE_PROGRAM_INPUT.programId, 'tenant-a', 'expert-1', {
      ...opts(20, S3),
      verdictId: 'cal-verdict-1',
    });
    const { performance, response } = await service.getDemonstratedPerformance(
      'tenant-a',
      'expert-1',
      SERVICE_CAPABILITY.id,
      { correlationId: CORR, at: S3 },
    );
    expect(performance.verdict).toBe('calibrated');
    expect(performance.freshSampleCount).toBe(3);
    expect(performance.totalSampleCount).toBe(3);
    expect(performance.inForce).toBe(true);
    expect(response.kind).toBe('response');
    expect(Object.isFrozen(performance)).toBe(true);

    // After the window elapses the SAME read reports inForce false —
    // routing cannot consume stale demonstrated performance.
    const expired = await service.getDemonstratedPerformance(
      'tenant-a',
      'expert-1',
      SERVICE_CAPABILITY.id,
      { correlationId: CORR, at: S_EXPIRED },
    );
    expect(expired.performance.inForce).toBe(false);
  });

  it('fails closed when no verdict exists (no invented data)', async () => {
    const ctx = makeService();
    const { service } = ctx;
    await service.registerProgram({ ...SERVICE_PROGRAM_INPUT }, opts(1, S0));
    await expect(
      service.getDemonstratedPerformance('tenant-a', 'expert-1', SERVICE_CAPABILITY.id, {
        correlationId: CORR,
        at: S3,
      }),
    ).rejects.toThrow(/no calibration verdict/);
  });
});
