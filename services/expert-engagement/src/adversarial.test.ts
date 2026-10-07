/**
 * ExpertEngagementService ADVERSARIAL tests (Work Order C011): the
 * fail-closed negative space — offer acceptance after expiry, duplicate
 * offer acceptance, capacity overcommit attempts, cross-tenant
 * engagement access and SLA breach-record tampering.
 */

import { describe, expect, it } from 'vitest';
import { createExpertEngagementService } from './fabric.js';
import {
  InMemoryAvailabilityDeclarationStore,
  InMemoryCommercialOffers,
  InMemoryEngagementStore,
  InMemoryEscalationLifecycle,
  InMemoryRoutingShortlist,
  InMemorySlaBreachStore,
  InMemorySlaEvaluationJobs,
  fakeDigest,
} from './test-support.js';
import {
  EXPERT_ENGAGEMENT_ERROR_CODES,
  ExpertEngagementError,
} from '@arena/expert-engagement';
import type { SlaBreachRecord } from '@arena/expert-engagement';

const T0 = '2026-10-07T09:00:00.000Z'; // Wednesday (ISO day 3)
const T1 = '2026-10-07T09:20:00.000Z';
const EXPIRY = '2026-10-07T12:00:00.000Z';
const AFTER_EXPIRY = '2026-10-07T12:00:00.001Z';
const DEADLINE = '2026-10-08T09:00:00.000Z';

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(ExpertEngagementError);
  expect((error as ExpertEngagementError).code).toBe(code);
}

function setup() {
  const escalation = new InMemoryEscalationLifecycle();
  const routing = new InMemoryRoutingShortlist();
  const commercial = new InMemoryCommercialOffers();
  const engagements = new InMemoryEngagementStore();
  const availability = new InMemoryAvailabilityDeclarationStore();
  const breaches = new InMemorySlaBreachStore();
  const slaJobs = new InMemorySlaEvaluationJobs();
  const ports = { escalation, routing, commercial, engagements, availability, breaches, slaJobs };
  escalation.add({
    requestId: 'req-1001',
    tenantId: 'tenant-a',
    correlationId: 'corr-escalation',
    state: 'offered',
    urgency: 'urgent',
    deadline: DEADLINE,
  });
  routing.add({
    digest: fakeDigest('verdict'),
    requestId: 'req-1001',
    tenantId: 'tenant-a',
    outcome: 'matched',
    shortlistExpertIds: ['expert-one', 'expert-two'],
  });
  commercial.add({
    requestId: 'req-1001',
    tenantId: 'tenant-a',
    commercialOfferRef: fakeDigest('commercial-offer'),
    budgetHoldRef: fakeDigest('budget-hold'),
  });
  const service = createExpertEngagementService(ports);
  return { escalation, routing, commercial, breaches, ports, service };
}

async function declareWindow(
  service: ReturnType<typeof createExpertEngagementService>,
  capacitySlots = 2,
) {
  return service.declareAvailability(
    {
      declarationId: 'avail-expert-one-1',
      tenant: 'tenant-a',
      expertId: 'expert-one',
      version: 1,
      windows: [
        {
          window: { recurrence: 'weekly', dayOfWeek: 3, startUtc: '09:00', endUtc: '17:00' },
          capacitySlots,
        },
      ],
    },
    { correlationId: 'corr-avail', idempotencyKey: 'avail-key-1', at: T0 },
  );
}

async function issue(
  service: ReturnType<typeof createExpertEngagementService>,
  engagementId: string,
  key: string,
) {
  return service.issueOffer(
    {
      engagementId,
      tenant: 'tenant-a',
      escalationRef: 'req-1001',
      expertId: 'expert-one',
      offerExpiresAt: EXPIRY,
    },
    { correlationId: `corr-${engagementId}`, idempotencyKey: key, at: T0 },
  );
}

describe('ADVERSARIAL: offer acceptance after expiry (must fail closed)', () => {
  it('acceptance at/after offerExpiresAt fails closed with OFFER_EXPIRED', async () => {
    const { escalation, breaches, ports, service } = setup();
    await declareWindow(service);
    await issue(service, 'eng-alpha-1', 'offer-key-1');
    // The escalation DID advance — only the expiry guard may deny.
    escalation.setState('tenant-a', 'req-1001', 'accepted');
    await expect(
      service.accept(
        { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
        { correlationId: 'corr-2', idempotencyKey: 'accept-key-1', at: AFTER_EXPIRY },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.OFFER_EXPIRED);
      return true;
    });
    // The record stays OFFERED (never a best-effort acceptance).
    const record = await service.getEngagement(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-read' },
    );
    expect(record.status).toBe('offered');

    // The expiry transition IS legal at/after the expiry.
    const expired = await service.expire(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-3', idempotencyKey: 'expire-key-1', at: AFTER_EXPIRY },
    );
    expect(expired.record.status).toBe('expired');
  });
});

describe('ADVERSARIAL: duplicate offer acceptance (idempotent typed duplicate)', () => {
  it('the same accept instruction replays the recorded outcome verbatim', async () => {
    const { escalation, breaches, ports, service } = setup();
    await declareWindow(service);
    await issue(service, 'eng-alpha-1', 'offer-key-1');
    escalation.setState('tenant-a', 'req-1001', 'accepted');
    const input = { engagementId: 'eng-alpha-1', tenant: 'tenant-a' };
    const first = await service.accept(input, {
      correlationId: 'corr-2',
      idempotencyKey: 'accept-key-1',
      at: T1,
    });
    const duplicate = await service.accept(input, {
      correlationId: 'corr-2b',
      idempotencyKey: 'accept-key-1',
      at: T1,
    });
    expect(duplicate.replayed).toBe(true);
    expect(duplicate.record.digest).toBe(first.record.digest);
    expect(duplicate.record.status).toBe('accepted');
    // Capacity was committed ONCE (the duplicate never double-commits).
    const projection = await service.getAvailabilityRoutingInput(
      { tenant: 'tenant-a', expertId: 'expert-one' },
      { correlationId: 'corr-proj', at: T1 },
    );
    expect(projection.availableWindows[0]?.remainingSlots).toBe(1); // capacity 2 - 1
  });

  it('the same key with a DIFFERENT body is a typed conflict (never a silent rebind)', async () => {
    const { escalation, breaches, ports, service } = setup();
    await declareWindow(service);
    await issue(service, 'eng-alpha-1', 'offer-key-1');
    escalation.setState('tenant-a', 'req-1001', 'accepted');
    await service.accept(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-2', idempotencyKey: 'accept-key-1', at: T1 },
    );
    await expect(
      service.decline(
        { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
        { correlationId: 'corr-2b', idempotencyKey: 'accept-key-1', at: T1 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.IDENTITY_CONFLICT);
      return true;
    });
  });
});

describe('ADVERSARIAL: capacity overcommit attempt', () => {
  it('a second accept into a one-slot window fails closed with CAPACITY_EXCEEDED', async () => {
    const { escalation, service } = setup();
    await declareWindow(service, 1); // ONE slot only
    // Offers hold no slot (only accepted/active engagements occupy) — both issue.
    await issue(service, 'eng-alpha-1', 'offer-key-1');
    await issue(service, 'eng-alpha-2', 'offer-key-2');
    escalation.setState('tenant-a', 'req-1001', 'accepted');
    const accepted = await service.accept(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-2', idempotencyKey: 'accept-key-1', at: T1 },
    );
    expect(accepted.record.status).toBe('accepted');
    // The second engagement CANNOT accept: the declared window is fully committed.
    await expect(
      service.accept(
        { engagementId: 'eng-alpha-2', tenant: 'tenant-a' },
        { correlationId: 'corr-3', idempotencyKey: 'accept-key-2', at: T1 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.CAPACITY_EXCEEDED);
      return true;
    });
    // And a fresh offer now fails at issue time once the escalation is
    // offered again (replacement path): the window stays fully committed.
    escalation.setState('tenant-a', 'req-1001', 'offered');
    await expect(issue(service, 'eng-alpha-3', 'offer-key-3')).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.CAPACITY_EXCEEDED);
        return true;
      },
    );
  });
});

describe('ADVERSARIAL: cross-tenant engagement access', () => {
  it('reads and transitions from another tenant fail closed with CROSS_TENANT_ACCESS', async () => {
    const { service } = setup();
    await declareWindow(service);
    await issue(service, 'eng-alpha-1', 'offer-key-1');
    await expect(
      service.getEngagement(
        { engagementId: 'eng-alpha-1', tenant: 'tenant-b' },
        { correlationId: 'corr-read' },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.CROSS_TENANT_ACCESS);
      return true;
    });
    await expect(
      service.accept(
        { engagementId: 'eng-alpha-1', tenant: 'tenant-b' },
        { correlationId: 'corr-2', idempotencyKey: 'accept-key-1', at: T1 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.CROSS_TENANT_ACCESS);
      return true;
    });
    // Unknown ids fail closed with NOT_FOUND (never a leak).
    await expect(
      service.getEngagement(
        { engagementId: 'eng-missing', tenant: 'tenant-a' },
        { correlationId: 'corr-read' },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND);
      return true;
    });
  });
});

describe('ADVERSARIAL: SLA breach-record tampering', () => {
  it('a tampered stored breach record fails closed with TAMPERED on read', async () => {
    const { escalation, breaches, ports, service } = setup();
    await declareWindow(service);
    await issue(service, 'eng-alpha-1', 'offer-key-1');
    // Evaluate past the request deadline → three canonical breach records.
    await service.evaluateSlaClocks(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-sla', idempotencyKey: 'sla-key-1', at: '2026-10-08T09:00:00.001Z' },
    );
    // Tamper the store directly (the reference fabric's private map).
    const store = (breaches as unknown as { store: Map<string, SlaBreachRecord> }).store;
    const victim = [...store.values()][0];
    if (victim === undefined) throw new Error('fixture: no breach record to tamper');
    store.set(victim.breachId, {
      ...victim,
      observedAt: '2026-10-08T09:00:00.000Z' as typeof victim.observedAt, // rewritten observation time
    });
    await expect(
      service.listSlaBreaches(
        { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
        { correlationId: 'corr-sla' },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.TAMPERED);
      return true;
    });
  });
});
