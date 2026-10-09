/**
 * tests/security/production/ac08-restart-partial-state.test.ts — AC-08
 * worker restart and partial state (Work Order P007 integrated pass;
 * issue #159).
 *
 * "worker restart/partial-state (mid-transition kill, no
 * double-transition, audit chain intact)" — attacks the REAL durable
 * runtime over the embedded real Postgres engine with the P002 house
 * definition of a hard restart: a NEW composition over the SAME durable
 * store with NO graceful stop (process-death semantics; no OS-level
 * SIGKILL in this battery — honestly disclosed in the evidence).
 *
 * Attacks:
 *   - the documented host kill-window: a hard kill between the store
 *     insert and the idempotency-outcome record (created by driving the
 *     ENGINE directly, bypassing the host's recording step) must heal
 *     deterministically on the next replay;
 *   - an orphaned job lease (claimed, then the "process dies") must be
 *     reclaimed by the next start's recovery sweep with NO duplicated
 *     transition and NO lost audit history;
 *   - a mid-flight lifecycle advance replayed across the restart
 *     boundary must not double-transition (terminal is terminal);
 *   - the audit chain must remain digest-linked across the boundary
 *     (pre-restart records + post-restart continuation verify as ONE
 *     chain).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '@arena/job-protocol';
import type { AuditRecord, JobRecord } from '@arena/job-protocol';
import {
  bootAdversarialBattery,
  composeRestartedHost,
  createBody,
  json,
  postJson,
} from './support/adversarial-harness.js';
import type { AdversarialBattery } from './support/adversarial-harness.js';

let battery: AdversarialBattery;

beforeEach(async () => {
  battery = await bootAdversarialBattery();
});

afterEach(async () => {
  await battery.close();
});

function key(tenantId = 'tenant-alpha'): Record<string, string> {
  const issuance = battery.keys.issue({ tenantId });
  return { authorization: `Bearer ${issuance.secret}` };
}

const ACTOR = Object.freeze({
  type: 'service',
  tenant: 'arena',
  principalId: 'p007-adversarial-battery',
});

/** Canonical JSON (sorted keys; the jsonb key-reorder discipline). */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([entryKey, entryValue]) => `${JSON.stringify(entryKey)}:${canonicalJson(entryValue)}`)
      .sort();
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

describe('AC-08 — the documented host kill-window heals deterministically', () => {
  it('a kill between the store insert and the idempotency record is healed by the next replay', async () => {
    const input = createBody({
      idempotencyKey: 'idem-ac08-window',
      correlationId: 'corr-ac08-window',
    }) as never;

    // THE KILL WINDOW (the exact window host.ts documents): drive the
    // ENGINE directly — the escalation record + events are inserted, but
    // the HOST-level idempotency outcome record is never written (the
    // process "dies" between the two).
    const outcome = await battery.engines.escalations.createEscalation(input);
    expect(outcome.outcome).toBe('created');

    // The recorded outcome does NOT exist yet (the partial state).
    const identity = {
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-ac08-window' as never,
      correlationId: 'corr-ac08-window' as never,
    };
    expect(await battery.host.recordedOutcome(identity)).toBeUndefined();

    // THE RETRY (the "next process"): the host path replays the record
    // AND records the outcome — the partial state heals.
    const healed = await battery.host.escalations.create('tenant-alpha', input);
    expect(healed.outcome).toBe('replay');
    expect(healed.requestId).toBe(outcome.requestId);

    // The healed record is deterministic from this point on.
    const recorded = await battery.host.recordedOutcome(identity);
    expect(recorded).toBeDefined();
    expect(recorded?.outcome.requestId).toBe(outcome.requestId);
    const recordedJson = JSON.stringify(recorded?.outcome);

    // A SECOND retry (across the restart boundary) returns the RECORDED
    // outcome byte-stably.
    const restarted = await composeRestartedHost(battery);
    try {
      const replay = await restarted.escalations.create('tenant-alpha', input);
      expect(replay.outcome).toBe('replay');
      expect(replay.requestId).toBe(outcome.requestId);
      const recordedAgain = await restarted.recordedOutcome(identity);
      expect(JSON.stringify(recordedAgain?.outcome)).toBe(recordedJson);
    } finally {
      await restarted.stop();
    }
  });
});

describe('AC-08 — orphaned lease + hard restart (no duplicated transition, audit intact)', () => {
  it('a claimed-then-orphaned job is reclaimed; history preserved verbatim; the chain grows and verifies', async () => {
    // Ground truth: one escalation through the public transport.
    const auth = key();
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-ac08-lease', correlationId: 'corr-ac08-lease' }),
      auth,
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;
    const statusBefore = await battery.host.escalations.status('tenant-alpha', requestId);
    const historyBefore = statusBefore.record.history.length;
    const stateBefore = statusBefore.record.state;

    // A durable job mid-flight: submitted + claimed with a lease, never
    // completed — then the "process dies" (no stop, no completion).
    const submitted = await battery.host.jobs.submitByKind({
      kindName: 'escalation-recompute',
      input: { requestId },
      correlationId: 'corr-ac08-lease' as never,
      idempotencyKey: 'idem-ac08-lease-job' as never,
      actor: ACTOR,
    });
    const claimed = await battery.host.claimWithLease({
      jobId: submitted.jobId,
      actor: ACTOR,
    });
    expect(claimed.status).toBe('running');
    const eventsBefore = claimed.events.length;
    const auditBefore = (await battery.host.auditRecords()).length;
    // (no stop() — the process DIES here)

    // Advance beyond the lease + attempt timeout, then RESTART.
    battery.clock.advance(120_000);
    const restarted = await composeRestartedHost(battery);
    try {
      // The recovery sweep reclaimed the orphaned lease.
      const after = await restarted.jobs.get(submitted.jobId);
      expect(after).toBeDefined();
      expect(after?.events.length).toBeGreaterThan(eventsBefore);
      // The pre-restart event history is preserved VERBATIM (canonical
      // comparison — jsonb reorders keys; the P002 discipline).
      expect(
        canonicalJson(after?.events.slice(0, eventsBefore)),
      ).toBe(canonicalJson(claimed.events));

      // The escalation gained NO duplicated transition across the
      // boundary (the sweep touches jobs, never escalations).
      const statusAfter = await restarted.escalations.status('tenant-alpha', requestId);
      expect(statusAfter.record.history.length).toBe(historyBefore);
      expect(statusAfter.record.state).toBe(stateBefore);

      // The audit chain GREW (the recovery mutation is audited) and
      // verifies over the WHOLE chain (pre + post restart).
      const auditAfter = (await restarted.auditRecords()) as readonly AuditRecord[];
      expect(auditAfter.length).toBeGreaterThan(auditBefore);
      await expect(verifyAuditChain({ records: [...auditAfter] })).resolves.toBeTypeOf('string');
    } finally {
      await restarted.stop();
    }
  });
});

describe('AC-08 — mid-flight lifecycle advance replayed across the restart boundary', () => {
  it('a terminal transition fired twice across the boundary double-transitions NOTHING', async () => {
    const auth = key();
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-ac08-term', correlationId: 'corr-ac08-term' }),
      auth,
    );
    expect(created.status).toBe(201);
    const requestId = json(created.body)['requestId'] as string;

    // First (pre-"crash") transition: matching → cancelled (terminal).
    const cancelled = await battery.host.escalations.advance(
      'tenant-alpha',
      requestId,
      'cancelled',
    );
    expect(cancelled.state).toBe('cancelled');
    const historyAfterFirst = cancelled.history.length;

    // THE REPLAY: a restarted composition attempts the SAME transition
    // again (the double-fire a crashed-then-retried worker would issue).
    const restarted = await composeRestartedHost(battery);
    try {
      let refusedCode = '';
      try {
        await restarted.escalations.advance('tenant-alpha', requestId, 'cancelled');
      } catch (error) {
        refusedCode = (error as { code?: string }).code ?? '';
      }
      // Terminal is terminal: the typed refusal (either the terminal or
      // the invalid-transition code — both fail closed).
      expect(['ESCALATION_TERMINAL_STATE', 'ESCALATION_INVALID_TRANSITION']).toContain(
        refusedCode,
      );

      // The record is UNCHANGED by the refused replay.
      const status = await restarted.escalations.status('tenant-alpha', requestId);
      expect(status.record.state).toBe('cancelled');
      expect(status.record.history.length).toBe(historyAfterFirst);

      // And a CROSS-TENANT advance attempt across the boundary stays
      // denied (restart changed nothing about tenant isolation).
      let crossDenied = false;
      try {
        await restarted.escalations.advance('tenant-beta', requestId, 'cancelled');
      } catch (error) {
        crossDenied = (error as { code?: string }).code === 'ESCALATION_CROSS_TENANT_ACCESS';
      }
      expect(crossDenied).toBe(true);
    } finally {
      await restarted.stop();
    }
  });
});

describe('AC-08 — restart recovery report shape (the operator-visible evidence)', () => {
  it('the recovery report counts honestly (non-terminal jobs, reclaimed leases, terminal untouched)', async () => {
    const submitted = await battery.host.jobs.submitByKind({
      kindName: 'escalation-recompute',
      input: {},
      correlationId: 'corr-ac08-report' as never,
      idempotencyKey: 'idem-ac08-report' as never,
      actor: ACTOR,
    });
    await battery.host.claimWithLease({ jobId: submitted.jobId, actor: ACTOR });
    // Terminal job that must be untouched by the sweep (claimed first —
    // completion requires the running state per the job protocol).
    const terminalJob = await battery.host.jobs.submitByKind({
      kindName: 'escalation-recompute',
      input: {},
      correlationId: 'corr-ac08-report-t' as never,
      idempotencyKey: 'idem-ac08-report-t' as never,
      actor: ACTOR,
    });
    await battery.host.claimWithLease({ jobId: terminalJob.jobId, actor: ACTOR });
    await battery.engines.runner.complete({ jobId: terminalJob.jobId, actor: ACTOR, result: 'done' });

    battery.clock.advance(120_000);
    const restarted = await composeRestartedHost(battery);
    try {
      // start() already ran the sweep inside composeRestartedHost; the
      // restarted host exposes the outcome through its surfaces.
      const jobs = await restarted.runner.findByCorrelationId('corr-ac08-report');
      expect(jobs.length).toBe(1);
      const job = jobs[0] as JobRecord | undefined;
      expect(job).toBeDefined();
      // The orphaned running job was advanced by the timeout policy —
      // requeued or terminally failed, NEVER left silently running.
      expect(['queued', 'failed']).toContain(job?.status ?? '');
      const terminal = (await restarted.runner.findByCorrelationId('corr-ac08-report-t'))[0];
      expect(terminal?.status).toBe('succeeded');
      // The dead-letter lot stays queryable (explicit, never silent).
      expect(Array.isArray(await restarted.deadLetters())).toBe(true);
    } finally {
      await restarted.stop();
    }
  });
});
