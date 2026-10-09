/**
 * tests/runtime-host/composition-parity.test.ts — the REAL-class parity
 * pinning the frozen interface package names
 * (packages/runtime-host/src/surfaces.ts): "the REAL classes satisfy
 * these interfaces structurally at the composition site (deploy/runtime
 * wiring); the parity is pinned by tests/runtime-host against the real
 * classes."
 *
 * The REAL service engines (services/escalation-api's EscalationApiService
 * with the REAL routing service, services/job-orchestrator's
 * JobOrchestrator) composed through deploy/runtime/src/composition.ts —
 * the production composition — over the in-memory reference transport:
 * the full host surface (lifecycle, lens stamping, tenant gates,
 * registered kinds, claiming, restart recovery) through REAL engine
 * instances. This is the M3 "real ports + shared durable job runner
 * wiring" parity proof; the REAL-database proofs live in
 * pglite-acceptance.test.ts / live-neon-acceptance.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@arena/persistence';
import { isJobRecord } from '@arena/job-protocol';
import type { RuntimeHostService } from '@arena/runtime-host-service';
import { composeRuntimeHost } from '@arena/runtime-host-composition';
import { MemoryRuntimeTransport } from '@arena/runtime-host-service/memory-transport';
import { referenceCreateInput } from '@arena/runtime-host-service/test-support';

const T0 = Date.parse('2026-10-07T10:00:00.000Z');
const ACTOR = Object.freeze({
  type: 'service',
  tenant: 'arena',
  principalId: 'runtime-host-battery',
});

function createInput(overrides: Record<string, unknown> = {}) {
  return referenceCreateInput(overrides) as unknown as Parameters<
    RuntimeHostService['escalations']['create']
  >[1];
}

async function composeStarted(
  transport: MemoryRuntimeTransport,
  clock: ManualClock,
): Promise<RuntimeHostService> {
  const host = await composeRuntimeHost({ transport, clock });
  await host.start();
  return host;
}

describe('runtime-host composition parity — the REAL engines through the production composition', () => {
  it('composes the REAL EscalationApiService + REAL routing + REAL JobOrchestrator (structural parity)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await composeStarted(transport, clock);

    // The REAL C001 service drives the escalation surface: created →
    // triaged → matching (the REAL routing service's no-match posture
    // with no qualified experts).
    const outcome = await host.escalations.create('tenant-alpha', createInput());
    expect(outcome.outcome).toBe('created');
    expect(['matching', 'offered']).toContain(outcome.record.state);
    expect(outcome.emittedEvents.length).toBeGreaterThanOrEqual(3);
    expect(outcome.response.payload).toHaveProperty('kind', 'escalation-created');

    // The REAL A015 orchestrator drives the job runner surface.
    const submitted = await host.jobs.submitByKind({
      kindName: 'retention-sweep',
      input: { horizon: 30 },
      correlationId: 'corr-parity-1' as never,
      idempotencyKey: 'idem-parity-1' as never,
      actor: ACTOR,
    });
    expect(submitted.status).toBe('queued');
    const claimed = await host.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
    expect(claimed.status).toBe('running');
    const completed = await host.executeClaimed({ jobId: submitted.jobId, actor: ACTOR });
    expect(completed.status).toBe('succeeded');
    expect(completed.result).toMatchObject({ kind: 'retention-sweep' });

    // The REAL orchestrator's audit chain flowed through the durable
    // event sink (submit + claim + complete ⇒ at least 3 records).
    expect((await host.auditRecords()).length).toBeGreaterThanOrEqual(3);
  });

  it('runs the full restart-recovery arc through the REAL engines (lease reclaim, no duplicated transitions)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const hostA = await composeStarted(transport, clock);

    const outcome = await hostA.escalations.create('tenant-alpha', createInput());
    const submitted = await hostA.jobs.submitByKind({
      kindName: 'escalation-recompute',
      input: {},
      correlationId: 'corr-parity-2' as never,
      idempotencyKey: 'idem-parity-2' as never,
      actor: ACTOR,
    });
    const claimed = await hostA.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
    const eventsBefore = claimed.events.length;
    const historyBefore = (await hostA.escalations.status('tenant-alpha', outcome.requestId))
      .record.history.length;
    // (hard kill — no stop)

    clock.advance(120_000);
    const hostB = await composeRuntimeHost({ transport, clock });
    const startB = await hostB.start();
    expect(startB.migrationsApplied).toEqual([]);
    expect(startB.recovery).toEqual({
      nonTerminalJobs: 1,
      reclaimedLeases: 1,
      terminalJobsUntouched: 0,
    });

    const after = await hostB.jobs.get(submitted.jobId);
    expect(isJobRecord(after)).toBe(true);
    expect(after!.events.length).toBeGreaterThan(eventsBefore);
    expect(after!.events.slice(0, eventsBefore)).toEqual(claimed.events);

    const status = await hostB.escalations.status('tenant-alpha', outcome.requestId);
    expect(status.record.history.length).toBe(historyBefore);
    expect(status.record.state).toBe('matching');

    // Deterministic replay through the REAL service's idempotency index.
    const replay = await hostB.escalations.create('tenant-alpha', createInput());
    expect(replay.outcome).toBe('replay');
    expect(replay.requestId).toBe(outcome.requestId);
    const recorded = await hostB.recordedOutcome({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-0001' as never,
      correlationId: 'corr-0001' as never,
    });
    expect(recorded?.outcome).toMatchObject({ requestId: outcome.requestId });
  });

  it('composes the labelled stub routing on demand (the explicit fallback)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await composeRuntimeHost({ transport, clock, routing: 'reference-stub' });
    await host.start();
    const outcome = await host.escalations.create('tenant-alpha', createInput());
    expect(outcome.record.state).toBe('matching');
  });

  it('fails closed without any transport (zero-credential posture, state failed)', async () => {
    const clock = new ManualClock(T0);
    const host = await composeRuntimeHost({ env: {}, clock });
    await expect(host.start()).rejects.toMatchObject({ code: 'RUNTIME_PERSISTENCE_DISABLED' });
    expect(host.state).toBe('failed');
    const health = await host.health();
    expect(health.ready).toBe(false);
    expect(health.capacity.status).toBe('DISABLED');
  });
});
