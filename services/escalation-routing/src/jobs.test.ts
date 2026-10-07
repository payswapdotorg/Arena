/**
 * Durable routing job tests (Work Order C002) — A015 submission-identity
 * idempotency, deterministic drain, bounded attempts and fail-closed
 * parking.
 */

import { describe, expect, it } from 'vitest';
import { EscalationRoutingService } from './service.js';
import { FixedClock, StaticGraphSource, StaticRoutingCandidateDirectory } from './fabric.js';
import { ROUTING_JOB_MAX_ATTEMPTS } from './jobs.js';
import {
  FIXTURE_NOW,
  buildFixtureGraph,
  fixtureCandidate,
  fixtureEscalationRecord,
} from './test-support.js';

describe('durable routing jobs (A015 fabric semantics)', () => {
  it('submits a queued job; the same submission identity replays', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const record = await fixtureEscalationRecord();
    const first = await service.submitRoutingJob(record);
    expect(first.outcome).toBe('queued');
    const second = await service.submitRoutingJob(record);
    expect(second.outcome).toBe('replay');
    const jobs = await service.jobStore.list();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('queued');
    expect(jobs[0]?.tenantId).toBe('tenant-a');
  });

  it('drain completes queued jobs and records the decision + history', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const record = await fixtureEscalationRecord();
    await service.submitRoutingJob(record);
    const result = await service.drainRoutingJobs();
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(0);
    const job = (await service.jobStore.list())[0];
    expect(job?.status).toBe('completed');
    expect(job?.decision).toEqual({ outcome: 'matched', expertRef: 'expert-001' });
    expect(job?.attempts).toBe(1);
    const history = await service.decisionHistory(record.request.requestId, 'tenant-a');
    expect(history).toHaveLength(1);
    // Draining again is a no-op (completed jobs are not re-processed).
    const again = await service.drainRoutingJobs();
    expect(again.completed).toBe(0);
  });

  it('a no-match decision completes the job with the typed reason recorded', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([]),
    });
    await service.submitRoutingJob(await fixtureEscalationRecord());
    const result = await service.drainRoutingJobs();
    expect(result.completed).toBe(1);
    const job = (await service.jobStore.list())[0];
    expect(job?.decision).toEqual({ outcome: 'no-match', reason: 'no-qualified-expert' });
    expect(job?.lastError).toBe('no-qualified-expert');
  });

  it('a persistently failing route parks the job as failed after bounded attempts', async () => {
    const graph = await buildFixtureGraph();
    // A clock returning NaN makes evaluatedAt unparseable — route throws
    // internally, which the drain contains and parks deterministically.
    const brokenClock = { now: () => Number.NaN };
    const service = new EscalationRoutingService({
      clock: brokenClock,
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    await service.submitRoutingJob(await fixtureEscalationRecord());
    for (let round = 0; round < ROUTING_JOB_MAX_ATTEMPTS - 1; round += 1) {
      const result = await service.drainRoutingJobs();
      expect(result.failed).toBe(0);
      expect(result.completed).toBe(0);
    }
    const final = await service.drainRoutingJobs();
    expect(final.failed).toBe(1);
    const job = (await service.jobStore.list())[0];
    expect(job?.status).toBe('failed');
    expect(job?.attempts).toBe(ROUTING_JOB_MAX_ATTEMPTS);
    expect(typeof job?.lastError).toBe('string');
  });

  it('tenant-isolated key spaces: different tenants never collide on one submission key', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const tenantA = await fixtureEscalationRecord({ tenantId: 'tenant-a', idempotencyKey: 'same-key' });
    const tenantB = await fixtureEscalationRecord({ tenantId: 'tenant-b', idempotencyKey: 'same-key' });
    const first = await service.submitRoutingJob(tenantA);
    const second = await service.submitRoutingJob(tenantB);
    expect(first.outcome).toBe('queued');
    expect(second.outcome).toBe('queued');
    const jobs = await service.jobStore.list();
    expect(jobs).toHaveLength(2);
  });
});
