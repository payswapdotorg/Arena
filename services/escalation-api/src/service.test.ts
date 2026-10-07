/**
 * Escalation API service tests (Work Order C001) — POST/REST surfaces,
 * durable lifecycle wiring onto the A015 idempotency/correlation
 * fabric, webhook outbox emission, routing seam and timeout sweep.
 */

import { describe, expect, it } from 'vitest';
import { ESCALATION_ERROR_CODES } from '@arena/escalation';
import { createEscalationResult } from '@arena/escalation';
import { FixedClock } from './fabric.js';
import { EscalationApiService } from './service.js';
import { referenceService, validCreateInput } from './test-support.js';

const NOW = Date.parse('2026-10-07T10:00:00.000Z');

describe('EscalationApiService — POST /v1/escalations', () => {
  it('creates a durable escalation and drives the reference flow to OFFERED', async () => {
    const { service } = referenceService(NOW);
    const outcome = await service.createEscalation(validCreateInput() as never);
    expect(outcome.outcome).toBe('created');
    expect(outcome.duplicate).toBe(false);
    expect(outcome.requestId).toMatch(/^esc_[0-9a-f]{32}$/);
    expect(outcome.record.state).toBe('offered');
    expect(outcome.record.expertRef).toBe('expert-kwame');
    // Creation → triaged → matching → offered: four webhook events, in order.
    expect(outcome.emittedEvents.map((event) => event.eventType)).toEqual([
      'escalation.created',
      'escalation.progressed',
      'escalation.progressed',
      'escalation.matched',
    ]);
    expect(outcome.response.payload).toMatchObject({
      kind: 'escalation-created',
      duplicate: false,
      correlationId: 'corr-0001',
    });
  });

  it('duplicate submission REPLAYS the original request (same key + body)', async () => {
    const { service } = referenceService(NOW);
    const first = await service.createEscalation(validCreateInput() as never);
    const second = await service.createEscalation(validCreateInput() as never);
    expect(second.outcome).toBe('replay');
    expect(second.duplicate).toBe(true);
    expect(second.requestId).toBe(first.requestId);
    expect(second.response.payload).toMatchObject({ kind: 'escalation-replayed', duplicate: true });
    // No new events on replay.
    expect(second.emittedEvents).toHaveLength(0);
    const pending = await service.outbox.listPending();
    expect(pending).toHaveLength(4);
  });

  it('stays in MATCHING (no silent best-effort) when no expert qualifies', async () => {
    const service = new EscalationApiService({
      clock: new FixedClock(NOW),
      directory: { listQualifiedExperts: async () => [] },
    });
    const outcome = await service.createEscalation(validCreateInput() as never);
    expect(outcome.record.state).toBe('matching');
    expect(outcome.record.expertRef).toBeUndefined();
    expect(outcome.emittedEvents.map((event) => event.eventType)).toEqual([
      'escalation.created',
      'escalation.progressed',
      'escalation.progressed',
    ]);
  });

  it('round-robin stub rotates across qualified experts deterministically', async () => {
    const { service } = referenceService(NOW);
    const a = await service.createEscalation(validCreateInput({ idempotencyKey: 'idem-a', correlationId: 'corr-a' }) as never);
    const b = await service.createEscalation(
      validCreateInput({
        idempotencyKey: 'idem-b',
        correlationId: 'corr-b',
        expertRequirements: { requiredCapabilities: ['boq-estimation.quantity-takeoff'] },
      }) as never,
    );
    expect(a.record.expertRef).toBe('expert-kwame');
    expect(b.record.expertRef).toBe('expert-ama');
  });
});

describe('EscalationApiService — GET /v1/escalations/{request_id}', () => {
  it('returns idempotent, tenant-scoped status with ES1.0 response fields', async () => {
    const { service, clock } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    const { record } = await service.getEscalationStatus({
      requestId: created.requestId,
      tenantId: 'tenant-alpha',
    });
    expect(record.state).toBe('offered');
    // Drive the lifecycle: accept → session_ready → in_progress → submit.
    let current = record;
    current = await service.advanceLifecycle(current.request.requestId, 'tenant-alpha', 'accepted');
    current = await service.advanceLifecycle(current.request.requestId, 'tenant-alpha', 'session_ready', {
      sessionRef: 'session-0001',
    });
    current = await service.advanceLifecycle(current.request.requestId, 'tenant-alpha', 'in_progress');
    const result = createEscalationResult({
      kind: 'solution',
      producedAt: clock.now(),
      summary: 'BOQ takeoff with corrected rates.',
      payload: { total: 42_500 },
      steps: ['normalized', 'applied rates'],
    });
    current = await service.advanceLifecycle(current.request.requestId, 'tenant-alpha', 'submitted', { result });
    current = await service.advanceLifecycle(current.request.requestId, 'tenant-alpha', 'validating', {
      validationStatus: 'pending',
    });
    current = await service.advanceLifecycle(current.request.requestId, 'tenant-alpha', 'result_accepted', {
      validationStatus: 'passed',
    });
    current = await service.advanceLifecycle(current.request.requestId, 'tenant-alpha', 'paid', {
      cost: { amountMinorUnits: 25_000, currency: 'USD', arenaFeeMinorUnits: 3_750, expertPayoutStatus: 'paid' },
    });
    const final = await service.getEscalationStatus({
      requestId: created.requestId,
      tenantId: 'tenant-alpha',
    });
    expect(final.record.state).toBe('paid');
    expect(final.record.result?.kind).toBe('solution');
    expect(final.record.validationStatus).toBe('passed');
    expect(final.record.cost?.arenaFeeMinorUnits).toBe(3_750);
    expect(final.record.sessionRef).toBe('session-0001');
    // Every transition appended exactly one webhook event (4 + 7).
    const all = await service.outbox.listAll();
    expect(all).toHaveLength(11);
    const types = all.map((entry) => JSON.parse(entry.payload).payload.eventType as string);
    expect(types).toContain('escalation.session.ready');
    expect(types).toContain('escalation.submitted');
    expect(types).toContain('escalation.validation.updated');
    expect(types).toContain('escalation.payment.updated');
    // Per-request webhook sequences are contiguous and ordered.
    const sequences = all.map((entry) => entry.sequence);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(current.state).toBe('paid');
  });

  it('unknown request id fails closed (typed)', async () => {
    const { service } = referenceService(NOW);
    await expect(
      service.getEscalationStatus({ requestId: 'esc_' + 'f'.repeat(32), tenantId: 'tenant-alpha' }),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.INVALID_REQUEST });
  });
});

describe('EscalationApiService — durability', () => {
  it('sweepTimeouts moves overdue escalations to the EXPLICIT timed_out state', async () => {
    const { service, clock } = referenceService(NOW);
    const created = await service.createEscalation(
      validCreateInput({ deadlineInMs: 60_000 }) as never,
    );
    clock.advanceTo(NOW + 61_000);
    const timedOut = await service.sweepTimeouts();
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]?.state).toBe('timed_out');
    const { record } = await service.getEscalationStatus({
      requestId: created.requestId,
      tenantId: 'tenant-alpha',
    });
    expect(record.state).toBe('timed_out');
    const all = await service.outbox.listAll();
    expect(all.map((entry) => JSON.parse(entry.payload).payload.eventType)).toContain('escalation.failed');
    // The sweep is idempotent: re-running changes nothing.
    const again = await service.sweepTimeouts();
    expect(again).toHaveLength(0);
  });

  it('correlation-addressable lookup finds escalations by correlation id', async () => {
    const { service } = referenceService(NOW);
    await service.createEscalation(validCreateInput() as never);
    const found = await service.listByCorrelationId('tenant-alpha', 'corr-0001');
    expect(found).toHaveLength(1);
    const otherTenant = await service.listByCorrelationId('tenant-beta', 'corr-0001');
    expect(otherTenant).toHaveLength(0);
  });

  it('webhook outbox delivery marking is idempotent (at-least-once drain)', async () => {
    const { service } = referenceService(NOW);
    await service.createEscalation(validCreateInput() as never);
    const pending = await service.outbox.listPending();
    expect(pending).toHaveLength(4);
    await service.outbox.markDelivered(pending[0]!.eventId, NOW + 1);
    await service.outbox.markDelivered(pending[0]!.eventId, NOW + 2);
    expect(await service.outbox.listPending()).toHaveLength(3);
    // Duplicate append of the same eventId is rejected (dedupe).
    const all = await service.outbox.listAll();
    const first = all[0]!;
    await expect(
      service.outbox.append(
        { eventId: first.eventId } as never,
        { payload: JSON.parse(first.payload) } as never,
      ),
    ).rejects.toThrowError(/duplicate/);
  });

  it('injectable clock is respected (FixedClock determinism)', () => {
    const clock = new FixedClock(42);
    expect(clock.now()).toBe(42);
    clock.advanceBy(8);
    expect(clock.now()).toBe(50);
    clock.advanceTo(1);
    expect(clock.now()).toBe(1);
  });
});
