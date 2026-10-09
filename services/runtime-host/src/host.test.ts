/**
 * Composition-root unit tests (Work Order P002; issue #154) — the
 * runtime-host core wiring proofs over the in-memory reference transport
 * and the REFERENCE engines (FT2.0 "Local parity": no database, no
 * service imports — boundary law B2 keeps the real engine classes at the
 * composition site).
 *
 * These prove the HOST CORE: lifecycle/migrations, tenant-gated +
 * lens-stamped escalation surface, the registered job kinds with host
 * claiming semantics, restart recovery and deterministic replay. The
 * REAL-ENGINE parity (services/escalation-api's EscalationApiService +
 * services/job-orchestrator's JobOrchestrator over these same durable
 * ports) and the REAL-DATABASE acceptance (embedded real Postgres + live
 * Neon) live in tests/runtime-host — different evidence classes
 * (disclosed in src/test-support.ts and src/memory-transport.ts).
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@arena/persistence';
import type { CapacitySnapshot } from '@arena/persistence';
import type { CreateEscalationRequestInput } from '@arena/escalation';
import { isJobRecord } from '@arena/job-protocol';
import { createRuntimeHost } from './host.js';
import type { RuntimeHostService } from './host.js';
import { createDurableRuntimeComponents } from './durable.js';
import {
  ReferenceEscalationsEngine,
  ReferenceJobRunnerEngine,
  referenceCreateInput,
} from './test-support.js';
import { MemoryRuntimeTransport } from './memory-transport.js';

const T0 = Date.parse('2026-10-07T10:00:00.000Z');

function createInput(overrides: Record<string, unknown> = {}): CreateEscalationRequestInput {
  return referenceCreateInput(overrides) as unknown as CreateEscalationRequestInput;
}

async function buildHost(
  transport: MemoryRuntimeTransport,
  clock: ManualClock,
): Promise<RuntimeHostService> {
  const durable = createDurableRuntimeComponents({ transport, clock });
  const engines = {
    escalations: new ReferenceEscalationsEngine({
      clock,
      store: durable.escalationStore,
      outbox: durable.webhookOutbox,
    }),
    runner: new ReferenceJobRunnerEngine({
      clock,
      store: durable.jobStore,
      sink: durable.eventSink,
    }),
  };
  return createRuntimeHost({ transport, clock, engines, durable });
}

/** The composition-root unit-test wiring: durable components over the
 * reference transport + the reference engines (the battery composes the
 * REAL engine classes instead — the parity under test there). */
async function startedHost(
  transport: MemoryRuntimeTransport,
  clock: ManualClock,
): Promise<RuntimeHostService> {
  const host = await buildHost(transport, clock);
  await host.start();
  return host;
}

describe('runtime-host composition root — lifecycle', () => {
  it('applies the durable migrations from zero on start (5 versions) and is idempotent', async () => {
    const transport = new MemoryRuntimeTransport({ migratedFromZero: true });
    const clock = new ManualClock(T0);
    const durable = createDurableRuntimeComponents({ transport, clock });
    const engines = {
      escalations: new ReferenceEscalationsEngine({
        clock,
        store: durable.escalationStore,
        outbox: durable.webhookOutbox,
      }),
      runner: new ReferenceJobRunnerEngine({
        clock,
        store: durable.jobStore,
        sink: durable.eventSink,
      }),
    };
    const host = await createRuntimeHost({ transport, clock, engines, durable });
    expect(host.state).toBe('constructed');

    const result = await host.start();
    expect(host.state).toBe('started');
    expect(result.migrationsApplied.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.migrationsApplied.map((entry) => entry.name)).toContain(
      'create-runtime-job-records',
    );
    // P002-F1: the durable payment ledger/outbox migration is part of the
    // from-zero set (F-09 remediation).
    expect(result.migrationsApplied.map((entry) => entry.name)).toContain(
      'create-payment-ledger-and-outbox',
    );
    expect(result.recovery).toEqual({
      nonTerminalJobs: 0,
      reclaimedLeases: 0,
      terminalJobsUntouched: 0,
    });

    // Idempotent start returns the previous result data.
    const again = await host.start();
    expect(again.migrationsApplied).toEqual(result.migrationsApplied);
    expect(transport.createdTables()).toContain('arena_escalation_record');
    expect(transport.createdTables()).toContain('arena_job_dead_letter');

    await host.stop();
    expect(host.state).toBe('stopped');
    await host.stop(); // idempotent
  });

  it('fails closed (state failed) without any persistence transport; health is DISABLED', async () => {
    const clock = new ManualClock(T0);
    const durable = createDurableRuntimeComponents({ env: {}, clock });
    const engines = {
      escalations: new ReferenceEscalationsEngine({
        clock,
        store: durable.escalationStore,
        outbox: durable.webhookOutbox,
      }),
      runner: new ReferenceJobRunnerEngine({
        clock,
        store: durable.jobStore,
        sink: durable.eventSink,
      }),
    };
    const host = await createRuntimeHost({ env: {}, clock, engines, durable });
    let failure: unknown;
    try {
      await host.start();
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as { code?: string }).code).toBe('RUNTIME_PERSISTENCE_DISABLED');
    expect(host.state).toBe('failed');

    const health = await host.health();
    expect(health.ready).toBe(false);
    expect(health.capacity.status).toBe('DISABLED');
    expect(health.components.map((component) => component.component)).toEqual([
      'persistence',
      'job-runner',
      'escalation-lifecycle',
    ]);
    expect(health.state).toBe('failed');
    // The snapshot is pure data and serializable (never throws, never leaks values).
    expect(JSON.stringify(health.capacity)).not.toContain('postgres://');
  });

  it('reports ready=true with a healthy transport after start (fail-closed aggregate)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await startedHost(transport, clock);
    const health = await host.health();
    expect(health.ready).toBe(true);
    expect((health.capacity as CapacitySnapshot).status).toBe('AVAILABLE');
    expect(health.components.every((component) => component.state === 'ready')).toBe(true);
    expect(health.checkedAt).toBe(T0);
  });
});

describe('runtime-host composition root — tenant-gated escalation surface', () => {
  it('persists an accepted escalation durably and reads it back lens-stamped', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await startedHost(transport, clock);

    const outcome = await host.escalations.create('tenant-alpha', createInput());
    expect(outcome.outcome).toBe('created');
    expect(outcome.duplicate).toBe(false);
    const requestId = outcome.requestId;
    expect(requestId).toMatch(/^esc_/);

    const status = await host.escalations.status('tenant-alpha', requestId);
    expect(status.record.request.requestId).toBe(requestId);
    expect(status.lens).toBe('customer');
    expect(JSON.parse(status.serializedResponse)).toEqual({ state: status.record.state });
    expect(status.response.payload).toHaveProperty('kind', 'escalation-status');

    // The lens is stamped at WRITE time from the tenant (ADR-P001-02).
    expect(await host.lensOf(requestId)).toBe('customer');
  });

  it('stamps the reserved demo tenant with the demo lens', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await startedHost(transport, clock);
    const outcome = await host.escalations.create(
      'demo',
      createInput({
        tenantId: 'demo',
        idempotencyKey: 'idem-demo-1',
        correlationId: 'corr-demo-1',
      }),
    );
    expect(await host.lensOf(outcome.requestId)).toBe('demo');
    const status = await host.escalations.status('demo', outcome.requestId);
    expect(status.lens).toBe('demo');
  });

  it('replays a duplicate submission deterministically (same request id, recorded outcome)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await startedHost(transport, clock);

    const first = await host.escalations.create('tenant-alpha', createInput());
    clock.advance(1_000);
    const second = await host.escalations.create('tenant-alpha', createInput());
    expect(second.outcome).toBe('replay');
    expect(second.duplicate).toBe(true);
    expect(second.requestId).toBe(first.requestId);

    // The recorded outcome replays VERBATIM (P002 acceptance criterion d).
    const recorded = await host.recordedOutcome({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-0001' as never,
      correlationId: 'corr-0001' as never,
    });
    expect(recorded).toBeDefined();
    expect(recorded?.outcome).toMatchObject({ kind: 'created', requestId: first.requestId });
    const recordedJson = JSON.stringify(recorded?.outcome);
    clock.advance(1_000);
    const third = await host.escalations.create('tenant-alpha', createInput());
    expect(third.requestId).toBe(first.requestId);
    const recordedAgain = await host.recordedOutcome({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-0001' as never,
      correlationId: 'corr-0001' as never,
    });
    expect(JSON.stringify(recordedAgain?.outcome)).toBe(recordedJson);
  });

  it('fails closed on cross-tenant create, cross-tenant reads and cross-tenant lifecycle act', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await startedHost(transport, clock);

    // Create carries the tenant: a mismatched submission is rejected.
    await expect(
      host.escalations.create(
        'tenant-beta',
        createInput({ tenantId: 'tenant-alpha', correlationId: 'corr-x' }),
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME_CROSS_TENANT_ACCESS' });

    const outcome = await host.escalations.create('tenant-alpha', createInput());
    // Cross-tenant read: not found (never a cross-tenant leak).
    await expect(host.escalations.status('tenant-beta', outcome.requestId)).rejects.toMatchObject({
      code: 'RUNTIME_ESCALATION_NOT_FOUND',
    });
    // Cross-tenant act: the DOMAIN layer fails closed with the typed error.
    await expect(
      host.escalations.advance('tenant-beta', outcome.requestId, 'cancelled'),
    ).rejects.toMatchObject({ code: 'ESCALATION_CROSS_TENANT_ACCESS' });
    // Tenant-scoped listing stays scoped.
    expect(await host.escalations.listByCorrelationId('tenant-beta', 'corr-0001')).toEqual([]);
    expect(await host.escalations.listByCorrelationId('tenant-alpha', 'corr-0001')).toHaveLength(1);
  });
});

describe('runtime-host composition root — shared durable job runner', () => {
  const ACTOR = { type: 'service', tenant: 'arena', principalId: 'runtime-host-test' };

  it('registers the closed job-kind vocabulary and rejects unregistered kinds', async () => {
    const transport = new MemoryRuntimeTransport();
    const host = await startedHost(transport, new ManualClock(T0));
    expect(host.jobs.registeredKinds.map((kind) => kind.definition.kind.name).sort()).toEqual([
      'escalation-projection',
      'escalation-recompute',
      'learning-candidate-projection',
      'retention-sweep',
    ]);
    await expect(
      host.jobs.submitByKind({
        kindName: 'not-a-registered-kind',
        input: {},
        correlationId: 'corr-1' as never,
        idempotencyKey: 'idem-1' as never,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: 'RUNTIME_UNKNOWN_JOB_KIND' });
  });

  it('executes a submitted job through claim-with-lease and records the result verbatim', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await startedHost(transport, clock);

    const submitted = await host.jobs.submitByKind({
      kindName: 'retention-sweep',
      input: { horizon: 30 },
      correlationId: 'corr-job-1' as never,
      idempotencyKey: 'idem-job-1' as never,
      actor: ACTOR,
    });
    expect(submitted.status).toBe('queued');

    // Idempotent submission: same identity + same definition digest ⇒ the SAME record.
    const resubmitted = await host.jobs.submitByKind({
      kindName: 'retention-sweep',
      input: { horizon: 999 },
      correlationId: 'corr-job-1' as never,
      idempotencyKey: 'idem-job-1' as never,
      actor: ACTOR,
    });
    expect(resubmitted.jobId).toBe(submitted.jobId);

    const claimed = await host.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
    expect(claimed.status).toBe('running');

    const completed = await host.executeClaimed({ jobId: submitted.jobId, actor: ACTOR });
    // The protocol's terminal status for a completed attempt is 'succeeded'
    // (the terminal event kind is 'job-completed').
    expect(completed.status).toBe('succeeded');
    expect(completed.result).toMatchObject({ kind: 'retention-sweep' });

    // The audit chain recorded every consequential mutation.
    const audit = await host.auditRecords();
    expect(audit.length).toBeGreaterThanOrEqual(3);
  });

  it('exposes the dead-letter lot as an operator surface (empty until a poison job parks)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const host = await startedHost(transport, clock);
    // The lot starts empty; parking rides the executeClaimed failure path
    // (a throwing registered executor fails terminally and parks — the
    // durable-store-level parking semantics are proven in durable.test.ts).
    expect(await host.deadLetters()).toEqual([]);
  });
});

describe('runtime-host composition root — restart recovery', () => {
  const ACTOR = { type: 'service', tenant: 'arena', principalId: 'runtime-host-test' };

  it('resumes after a hard restart: no lost records, no duplicated transitions, leases reclaimed', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);

    // --- host A: persist an escalation + claim a job (mid-flight), then DIE.
    const hostA = await startedHost(transport, clock);
    const outcome = await hostA.escalations.create('tenant-alpha', createInput());
    const submitted = await hostA.jobs.submitByKind({
      kindName: 'escalation-recompute',
      input: {},
      correlationId: 'corr-restart-1' as never,
      idempotencyKey: 'idem-restart-1' as never,
      actor: ACTOR,
    });
    const claimed = await hostA.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
    expect(claimed.status).toBe('running');
    const eventsBeforeRestart = claimed.events.length;
    const auditBeforeRestart = (await hostA.auditRecords()).length;
    // (no stop — a hard kill)

    // --- time passes beyond the lease and the attempt timeout.
    clock.advance(120_000);

    // --- host B: a NEW composition over the SAME durable state.
    const hostB = await buildHost(transport, clock);
    const startResult = await hostB.start();
    expect(hostB.state).toBe('started');
    expect(startResult.migrationsApplied).toEqual([]); // already applied
    expect(startResult.recovery.nonTerminalJobs).toBe(1);
    expect(startResult.recovery.reclaimedLeases).toBe(1);
    expect(startResult.recovery.terminalJobsUntouched).toBe(0);

    // The orphaned running job was advanced by the timeout policy — NOT
    // re-executed from scratch: its event history is strictly preserved.
    const after = await hostB.jobs.get(submitted.jobId);
    expect(after).toBeDefined();
    expect(isJobRecord(after)).toBe(true);
    expect(after!.events.length).toBeGreaterThan(eventsBeforeRestart);
    expect(after!.events.slice(0, eventsBeforeRestart)).toEqual(claimed.events);

    // The escalation survived the restart unchanged (no duplicated transitions).
    const status = await hostB.escalations.status('tenant-alpha', outcome.requestId);
    expect(status.record.history.length).toBe(outcome.record.history.length);
    expect(status.record.state).toBe(outcome.record.state);

    // The audit chain CONTINUED across the restart (hydrate proven).
    const auditAfterRestart = (await hostB.auditRecords()).length;
    expect(auditAfterRestart).toBeGreaterThanOrEqual(auditBeforeRestart);

    // The replay of the original submission still returns the same record.
    const replay = await hostB.escalations.create('tenant-alpha', createInput());
    expect(replay.outcome).toBe('replay');
    expect(replay.requestId).toBe(outcome.requestId);

    // The recorded outcome is stable across the restart boundary.
    const recorded = await hostB.recordedOutcome({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-0001' as never,
      correlationId: 'corr-0001' as never,
    });
    expect(recorded?.outcome).toMatchObject({ requestId: outcome.requestId });
  });

  it('counts terminal jobs as untouched at restart (never re-executed)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const hostA = await startedHost(transport, clock);
    const submitted = await hostA.jobs.submitByKind({
      kindName: 'retention-sweep',
      input: {},
      correlationId: 'corr-restart-2' as never,
      idempotencyKey: 'idem-restart-2' as never,
      actor: ACTOR,
    });
    await hostA.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
    const completed = await hostA.executeClaimed({ jobId: submitted.jobId, actor: ACTOR });
    expect(completed.status).toBe('succeeded');
    clock.advance(120_000);

    const hostB = await buildHost(transport, clock);
    const startResult = await hostB.start();
    expect(startResult.recovery.terminalJobsUntouched).toBe(1);
    expect(startResult.recovery.nonTerminalJobs).toBe(0);
    const still = await hostB.jobs.get(submitted.jobId);
    expect(still?.events.length).toBe(completed.events.length); // untouched
    expect(still?.status).toBe('succeeded');
  });
});
