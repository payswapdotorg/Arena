/**
 * Durable recompute-job tests (Work Order C016): the A015 fabric
 * semantics — idempotent submission (replay), bounded attempts,
 * deterministic drain, fail-closed parking.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityEconomicsService } from './service.js';
import {
  FixedClock,
  InMemoryCapabilityEconomicsJobStore,
  InMemoryEconomicsRecordStore,
  InMemoryPaymentLedgerSource,
} from './fabric.js';
import { CAPABILITY_ECONOMICS_JOB_MAX_ATTEMPTS } from './jobs.js';
import { settledLedgerFixture, TENANT } from './test-support.js';

describe('CapabilityEconomicsService recompute jobs (A015 fabric semantics)', () => {
  it('submits idempotently (duplicate submission REPLAYS the queued job)', async () => {
    const ledger = await settledLedgerFixture();
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(Date.parse('2026-10-08T12:00:00.000Z')),
      ledgerSource: new InMemoryPaymentLedgerSource([ledger]),
    });
    const first = await service.submitRecomputeJob('req-econ-0001', TENANT, {
      idempotencyKey: 'recompute-0001',
      correlationId: 'corr-0001',
    });
    expect(first.outcome).toBe('queued');
    const second = await service.submitRecomputeJob('req-econ-0001', TENANT, {
      idempotencyKey: 'recompute-0001',
      correlationId: 'corr-0001',
    });
    expect(second.outcome).toBe('replay');
    expect(second.job.submissionKey).toBe(first.job.submissionKey);
  });

  it('drains queued jobs to completed economics records (deterministic)', async () => {
    const ledger = await settledLedgerFixture();
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(Date.parse('2026-10-08T12:00:00.000Z')),
      ledgerSource: new InMemoryPaymentLedgerSource([ledger]),
      recordStore: new InMemoryEconomicsRecordStore(),
      jobStore: new InMemoryCapabilityEconomicsJobStore(),
    });
    await service.submitRecomputeJob('req-econ-0001', TENANT, {
      idempotencyKey: 'recompute-0001',
      correlationId: 'corr-0001',
    });
    const drained = await service.drainRecomputeJobs();
    expect(drained).toEqual({ completed: 1, failed: 0 });
    const jobs = await service.jobStore.list();
    expect(jobs[0]!.status).toBe('completed');
    expect(jobs[0]!.economicsId).toMatch(/^econ_[0-9a-f]{32}$/);
    expect(jobs[0]!.outcome).toBe('appended');
    // A re-drain is a no-op (jobs already completed).
    expect(await service.drainRecomputeJobs()).toEqual({ completed: 0, failed: 0 });
  });

  it('missing ledger backing parks the job as failed after bounded attempts (fail-closed)', async () => {
    const service = new CapabilityEconomicsService({
      clock: new FixedClock(Date.parse('2026-10-08T12:00:00.000Z')),
      ledgerSource: new InMemoryPaymentLedgerSource([]),
      jobStore: new InMemoryCapabilityEconomicsJobStore(),
    });
    await service.submitRecomputeJob('req-econ-0001', TENANT, {
      idempotencyKey: 'recompute-0001',
      correlationId: 'corr-0001',
    });
    let drained = await service.drainRecomputeJobs();
    expect(drained.completed).toBe(0);
    expect(drained.failed).toBe(0); // first attempt: retryable
    drained = await service.drainRecomputeJobs();
    expect(drained.failed).toBe(0); // second attempt: retryable
    drained = await service.drainRecomputeJobs();
    expect(drained.failed).toBe(1); // third attempt: parked as failed
    const jobs = await service.jobStore.list();
    expect(jobs[0]!.status).toBe('failed');
    expect(jobs[0]!.attempts).toBe(CAPABILITY_ECONOMICS_JOB_MAX_ATTEMPTS);
    expect(jobs[0]!.lastError).toContain('LEDGER_BACKING_MISSING');
  });
});
