/**
 * Durable routing-job tests (Work Order C015): A015 submission-identity
 * idempotency (queued vs replay), deterministic drain, bounded attempts.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityRoutingService } from './service.js';
import { FixedClock } from './fabric.js';
import { InMemoryCapabilityRoutingJobStore } from './fabric.js';
import { StaticGraphSource } from './fabric.js';
import {
  capabilityRoutingJobIdentity,
  buildCapabilityRoutingJob,
  CAPABILITY_ROUTING_JOB_IDEMPOTENCY_SCOPE_PREFIX,
} from './jobs.js';
import {
  FIXTURE_CLOCK_START,
  buildFixtureGraph,
  fixtureArtifactCandidateInput,
  fixtureDemandInput,
  fixtureExpertCandidate,
} from './test-support.js';
import { InMemoryArtifactOfferCatalog } from './fabric.js';
import { createArtifactCandidate } from '@arena/capability-routing';

describe('capability routing jobs', () => {
  it('builds tenant-isolated A015 submission identities', () => {
    const identity = capabilityRoutingJobIdentity({
      tenantId: 'tenant-a',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    });
    expect(identity.idempotencyScope).toBe(`${CAPABILITY_ROUTING_JOB_IDEMPOTENCY_SCOPE_PREFIX}-tenant-a`);
    const job = buildCapabilityRoutingJob(
      identity,
      {
        demandId: 'capr-job-0001',
        tenantId: 'tenant-a',
        demand: fixtureDemandInput(),
      },
      FIXTURE_CLOCK_START,
    );
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.jobVersion).toBe(1);
    expect(Object.isFrozen(job)).toBe(true);
  });

  it('submits idempotently (replay on the same submission key) and drains deterministically', async () => {
    const graph = await buildFixtureGraph();
    const expert = await fixtureExpertCandidate(graph);
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      graphSource: new StaticGraphSource(graph),
      expertDirectory: {
        listExpertCandidates: () => Promise.resolve([expert]),
      },
      jobStore: new InMemoryCapabilityRoutingJobStore(),
    });
    const options = {
      demandId: 'capr-job-0002',
      idempotencyKey: 'idem-job-1',
      correlationId: 'corr-job-1',
    };
    const first = await service.submitRoutingJob(fixtureDemandInput(), options);
    const second = await service.submitRoutingJob(fixtureDemandInput(), options);
    expect(first.outcome).toBe('queued');
    expect(second.outcome).toBe('replay');
    const drain = await service.drainRoutingJobs();
    expect(drain).toEqual({ completed: 1, failed: 0 });
    const jobs = await service.jobStore.list();
    expect(jobs[0]?.status).toBe('completed');
    expect(jobs[0]?.attempts).toBe(1);
    if (jobs[0]?.decision === undefined) return;
    expect(jobs[0].decision.outcome).toBe('matched');
    // Re-drain is a no-op (completed jobs stay completed).
    const again = await service.drainRoutingJobs();
    expect(again).toEqual({ completed: 0, failed: 0 });
  });

  it('drains multi-class jobs to composition decisions', async () => {
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      artifactCatalog: new InMemoryArtifactOfferCatalog([
        createArtifactCandidate(fixtureArtifactCandidateInput()),
      ]),
      jobStore: new InMemoryCapabilityRoutingJobStore(),
    });
    const demand = fixtureDemandInput({
      escalationModes: ['TOOL_GAP'],
      artifact: { artifactKinds: ['dataset'] },
    });
    delete (demand as { expert?: unknown }).expert;
    await service.submitRoutingJob(demand, {
      demandId: 'capr-job-0003',
      idempotencyKey: 'idem-job-2',
      correlationId: 'corr-job-2',
    });
    const drain = await service.drainRoutingJobs();
    expect(drain).toEqual({ completed: 1, failed: 0 });
    const jobs = await service.jobStore.list();
    const decision = jobs[0]?.decision;
    expect(decision?.outcome).toBe('matched');
    if (decision?.outcome !== 'matched') return;
    expect(decision.components).toEqual(['artifact:offer-rates-dataset']);
  });
});
