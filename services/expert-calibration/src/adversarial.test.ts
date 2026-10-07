/**
 * Adversarial minimum for the C004 reference service (Work Order):
 *
 *   1. calibration-masquerading-as-authorization — a calibration verdict
 *      consumed as authorization must FAIL CLOSED;
 *   2. backdated/tampered outcome injection — an outcome observed before
 *      its prediction, or a mutated store entry, fails closed;
 *   3. cross-tenant calibration record access — TENANT_MISMATCH;
 *   4. requalification bypass attempt after expiry — the read surface
 *      reports not-in-force and a completed job cannot be re-run.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { isTerminalJobRecord } from '@arena/job-protocol';
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

const CORR = toCorrelationId('corr-adv');

function opts(n: number, at: string) {
  return {
    correlationId: CORR,
    idempotencyKey: toIdempotencyKey(`adv-key-${n}`),
    at,
  };
}

async function makeSeeded() {
  const intake = new FakeIntakeGapSource();
  const qualification = new FakeExpertQualificationPort();
  const workbench = new FakeWorkbenchAssignmentPort();
  const service = new ExpertCalibrationService({ intake, qualification, workbench });
  const { program } = await service.registerProgram({ ...SERVICE_PROGRAM_INPUT }, opts(1, S0));
  return { service, intake, qualification, workbench, program };
}

function outcomeInput(programId: string, programDigest: string, overrides: Record<string, unknown> = {}) {
  return {
    calibrationId: 'cal-record-adv-1',
    tenant: 'tenant-a',
    expertId: 'expert-1',
    programId,
    programDigest,
    probeId: 'probe-prediction-1',
    predicted: { confidence: 0.7, score: null },
    observed: { outcome: 'correct', score: null },
    applicability: {
      capability: { ...SERVICE_CAPABILITY },
      environment: [{ namespace: 'arena', name: 'expert-workbench-env', version: '1.2.0', digest: 'c'.repeat(64) }],
    },
    predictedAt: S0,
    observedAt: S1,
    provenance: { recordedBy: 'verifier-tax-audit', recordedAt: S1, notes: null },
    ...overrides,
  };
}

describe('adversarial: calibration-masquerading-as-authorization', () => {
  it('a calibration verdict consumed as authorization FAILS CLOSED (no happy path)', async () => {
    const { service, program } = await makeSeeded();
    await service.recordCalibrationOutcome(outcomeInput(program.programId, program.digest), opts(2, S3));
    const { verdict } = await service.runProgram(program.programId, 'tenant-a', 'expert-1', {
      ...opts(3, S3),
      verdictId: 'cal-verdict-adv-1',
    });
    expect(() => service.consumeAsAuthorization(verdict, 'routing-permission-check')).toThrow(
      /consumed as an authorization/,
    );
    expect(() =>
      service.consumeAsAuthorization({ verdict: 'calibrated', digest: verdict.digest }, 'api-gate'),
    ).toThrow(/consumed as an authorization/);
  });
});

describe('adversarial: backdated / tampered outcome injection', () => {
  it('rejects an outcome observed strictly before its prediction (BACKDATED_OUTCOME)', async () => {
    const { service, program } = await makeSeeded();
    await expect(
      service.recordCalibrationOutcome(
        outcomeInput(program.programId, program.digest, { predictedAt: S2, observedAt: S1 }),
        opts(2, S3),
      ),
    ).rejects.toThrow(/causally impossible/);
    expect(service.describe().records).toBe(0);
  });

  it('rejects an outcome recorded under a foreign program digest (integrity of the program pin)', async () => {
    const { service, program } = await makeSeeded();
    await expect(
      service.recordCalibrationOutcome(
        outcomeInput(program.programId, 'f'.repeat(64)),
        opts(3, S3),
      ),
    ).rejects.toThrow();
  });
});

describe('adversarial: cross-tenant calibration access', () => {
  it('fails closed on cross-tenant program access, track completion and job execution (TENANT_MISMATCH)', async () => {
    const { service, intake, qualification, program } = await makeSeeded();
    await expect(
      service.recordCalibrationOutcome(
        outcomeInput(program.programId, program.digest, { tenant: 'tenant-b' }),
        opts(2, S3),
      ),
    ).rejects.toThrow(/TENANT_MISMATCH|belongs to tenant/);
    await expect(service.runProgram(program.programId, 'tenant-b', 'expert-1', { ...opts(3, S3), verdictId: 'cal-verdict-x' })).rejects.toThrow(
      /belongs to tenant/,
    );

    intake.seed('intake-session-1', 'tenant-a', [
      { reason: 'capability-unanswered', itemId: 'item-cap-1', routingInput: 'capability' },
    ]);
    await service.derivePreTrainingTrack(
      { trackId: 'pretrain-track-adv', tenant: 'tenant-a', expertId: 'expert-1', intakeSessionId: 'intake-session-1' },
      opts(4, S1),
    );
    await expect(
      service.completePreTrainingAssignment('pretrain-track-adv', 'tenant-b', 'expert-1', 'assign-capability-item-cap-1', {
        ...opts(5, S2),
        capability: { ...SERVICE_CAPABILITY },
        evidence: ['f'.repeat(64)],
      }),
    ).rejects.toThrow(/TENANT_MISMATCH|belongs to tenant/);

    qualification.seedWindow('tenant-a', 'expert-1', SERVICE_CAPABILITY.id, {
      validFrom: S0,
      validUntil: '2026-10-10T00:00:00.000Z',
      recordDigest: 'a'.repeat(64),
    });
    const { job } = await service.scheduleRequalificationCheck(program.programId, 'tenant-a', 'expert-1', opts(6, S3));
    await expect(service.runRequalificationCheck(job.jobId, 'tenant-b', opts(7, S3))).rejects.toThrow(
      /belongs to tenant/,
    );
  });
});

describe('adversarial: requalification bypass attempt after expiry', () => {
  it('the routing read reports NOT-in-force after the window elapses (stale performance cannot be laundered)', async () => {
    const { service, qualification, program } = await makeSeeded();
    await service.recordCalibrationOutcome(outcomeInput(program.programId, program.digest), opts(2, S3));
    await service.recordCalibrationOutcome(
      outcomeInput(program.programId, program.digest, { calibrationId: 'cal-record-adv-2' }),
      opts(3, S3),
    );
    await service.recordCalibrationOutcome(
      outcomeInput(program.programId, program.digest, { calibrationId: 'cal-record-adv-3', observed: { outcome: 'incorrect', score: null } }),
      opts(4, S3),
    );
    await service.runProgram(program.programId, 'tenant-a', 'expert-1', { ...opts(5, S3), verdictId: 'cal-verdict-adv-1' });
    qualification.seedWindow('tenant-a', 'expert-1', SERVICE_CAPABILITY.id, {
      validFrom: S0,
      validUntil: '2026-10-10T00:00:00.000Z',
      recordDigest: 'a'.repeat(64),
    });
    const { performance } = await service.getDemonstratedPerformance(
      'tenant-a',
      'expert-1',
      SERVICE_CAPABILITY.id,
      { correlationId: CORR, at: S_EXPIRED },
    );
    expect(performance.verdict).toBe('calibrated'); // the evidence itself is unchanged...
    expect(performance.inForce).toBe(false); // ...but it is NOT in force for routing.
  });

  it('a COMPLETED requalification job cannot be re-run (terminal state) — the check is append-only', async () => {
    const { service, qualification, program } = await makeSeeded();
    qualification.seedWindow('tenant-a', 'expert-1', SERVICE_CAPABILITY.id, {
      validFrom: S0,
      validUntil: '2026-10-10T00:00:00.000Z',
      recordDigest: 'a'.repeat(64),
    });
    const { job } = await service.scheduleRequalificationCheck(program.programId, 'tenant-a', 'expert-1', opts(2, S3));
    const run = await service.runRequalificationCheck(job.jobId, 'tenant-a', { ...opts(3, S_EXPIRED) });
    expect(run.job.status).toBe('succeeded');
    expect(isTerminalJobRecord(run.job)).toBe(true);
    // Attempting to re-run the SAME job (bypassing a fresh scheduling) fails.
    await expect(service.runRequalificationCheck(job.jobId, 'tenant-a', { ...opts(4, S_EXPIRED) })).rejects.toThrow();
    expect(qualification.requalificationProposals).toHaveLength(1); // exactly one proposal
  });
});
