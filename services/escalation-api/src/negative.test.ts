/**
 * Adversarial / negative tests (Work Order C001) — the required
 * adversarial minimum:
 *   - cross-tenant escalation attempt (read + lifecycle + replay);
 *   - idempotency-key conflict (same key, different body);
 *   - duplicate webhook delivery (consumer-key dedupe);
 *   - unpermitted action / role escalation via the API;
 *   - malformed submissions and envelope discipline.
 */

import { describe, expect, it } from 'vitest';
import { ESCALATION_ERROR_CODES } from '@arena/escalation';
import { makeGetEscalationStatusQuery, parseEscalationWebhookEventEnvelope } from '@arena/escalation';
import { serializeEnvelope, toCorrelationId } from '@arena/protocol-core';
import { EscalationApiService } from './service.js';
import { FixedClock } from './fabric.js';
import { referenceService, validCreateInput } from './test-support.js';

const NOW = Date.parse('2026-10-07T10:00:00.000Z');

describe('adversarial — cross-tenant isolation', () => {
  it('tenant B cannot READ tenant A escalation status via the API', async () => {
    const { service } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    await expect(
      service.getEscalationStatus({ requestId: created.requestId, tenantId: 'tenant-beta' }),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.INVALID_REQUEST });
  });

  it('tenant B cannot DRIVE tenant A lifecycle transitions', async () => {
    const { service } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    await expect(
      service.advanceLifecycle(created.requestId, 'tenant-beta', 'accepted'),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.CROSS_TENANT_ACCESS });
    // The original record is untouched.
    const { record } = await service.getEscalationStatus({
      requestId: created.requestId,
      tenantId: 'tenant-alpha',
    });
    expect(record.state).toBe('offered');
  });

  it('tenant B cannot ACT as expert on tenant A escalation actions', async () => {
    const { service } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    await expect(
      service.recordExpertAction(created.requestId, 'tenant-beta', 'read-context'),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.CROSS_TENANT_ACCESS });
    // Nothing was recorded on the action log.
    expect(service.actionLog(created.requestId)).toHaveLength(0);
  });

  it('tenant isolation extends through the status query envelope path', async () => {
    const { service } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    const query = makeGetEscalationStatusQuery(
      { queryVersion: 1, requestId: created.requestId, tenantId: 'tenant-beta' },
      toCorrelationId('corr-attack'),
    );
    const payload = query.payload;
    await expect(service.getEscalationStatus(payload)).rejects.toMatchObject({
      code: ESCALATION_ERROR_CODES.INVALID_REQUEST,
    });
  });
});

describe('adversarial — idempotency-key conflict', () => {
  it('same key + DIFFERENT body is a typed rejection (never silently rebound)', async () => {
    const { service } = referenceService(NOW);
    await service.createEscalation(validCreateInput() as never);
    await expect(
      service.createEscalation(validCreateInput({ urgency: 'urgent' }) as never),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.IDENTITY_CONFLICT });
  });

  it('tenant-scoped key spaces: same key in another tenant is NOT a conflict', async () => {
    const { service } = referenceService(NOW);
    const a = await service.createEscalation(validCreateInput() as never);
    const b = await service.createEscalation(
      validCreateInput({ tenantId: 'tenant-beta' }) as never,
    );
    expect(a.outcome).toBe('created');
    expect(b.outcome).toBe('created');
    expect(a.requestId).not.toBe(b.requestId);
  });
});

describe('adversarial — duplicate webhook delivery', () => {
  it('consumer dedupes redeliveries on the eventId consumer key', async () => {
    const { service } = referenceService(NOW);
    await service.createEscalation(validCreateInput() as never);
    const deliveries = await service.outbox.listPending();
    expect(deliveries.length).toBeGreaterThan(0);
    // Redelivery of the FIRST event: parse the wire payload back into an
    // envelope — the consumer side keys on payload.eventId.
    const first = deliveries[0]!;
    const envelope = parseEscalationWebhookEventEnvelope(first.payload);
    const seen = new Set<string>();
    seen.add(envelope.payload.eventId);
    // Simulated redelivery of the same wire message.
    const redelivered = parseEscalationWebhookEventEnvelope(serializeEnvelope(envelope));
    expect(seen.has(redelivered.payload.eventId)).toBe(true);
    expect(seen.size).toBe(1);
    // Outbox-side: appending the same eventId twice is rejected.
    await expect(
      service.outbox.append(redelivered.payload, envelope),
    ).rejects.toThrowError(/duplicate/);
  });
});

describe('adversarial — unpermitted action / role escalation via the API', () => {
  it('rejects actions outside the request permitted vocabulary (typed)', async () => {
    const { service } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    await expect(
      service.recordExpertAction(created.requestId, 'tenant-alpha', 'run-approved-tools'),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.UNPERMITTED_ACTION });
    // The ATTEMPT is on the audit log.
    const log = service.actionLog(created.requestId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'run-approved-tools', allowed: false });
  });

  it('rejects role-escalation shaped actions and unknown actions', async () => {
    const { service } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    for (const action of ['assume-admin-role', 'grant-permission', 'format-c-drive', '']) {
      await expect(
        service.recordExpertAction(created.requestId, 'tenant-alpha', action),
      ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.UNPERMITTED_ACTION });
    }
    expect(service.actionLog(created.requestId)).toHaveLength(4);
  });

  it('permits and records actions inside the closed vocabulary', async () => {
    const { service } = referenceService(NOW);
    const created = await service.createEscalation(validCreateInput() as never);
    const verdict = await service.recordExpertAction(created.requestId, 'tenant-alpha', 'read-context');
    expect(verdict.allowed).toBe(true);
    expect(service.actionLog(created.requestId)).toHaveLength(1);
  });
});

describe('adversarial — malformed submissions', () => {
  it('rejects unapproved modes / bad shapes through the API surface', async () => {
    const { service } = referenceService(NOW);
    await expect(
      service.createEscalation(validCreateInput({ escalationModes: ['vibes'] }) as never),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.INVALID_MODE });
    await expect(
      service.createEscalation(validCreateInput({ budget: { amountMinorUnits: -5, currency: 'USD' } }) as never),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.INVALID_REQUEST });
    await expect(
      service.createEscalation(validCreateInput({ permittedActions: ['assume-admin-role'] }) as never),
    ).rejects.toMatchObject({ code: ESCALATION_ERROR_CODES.INVALID_REQUEST });
  });

  it('non-object input fails closed', async () => {
    const service = new EscalationApiService({ clock: new FixedClock(NOW) });
    await expect(service.createEscalation(null as never)).rejects.toMatchObject({
      code: ESCALATION_ERROR_CODES.INVALID_REQUEST,
    });
  });
});
