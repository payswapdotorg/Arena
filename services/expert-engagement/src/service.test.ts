/**
 * ExpertEngagementService integration tests (Work Order C011): the
 * offer → accept → session handoff → complete flow over the INJECTED
 * C001/C002/C010 ports on the reference fabric.
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
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from '@arena/expert-engagement';

const T0 = '2026-10-07T09:00:00.000Z'; // Wednesday (ISO day 3)
const T1 = '2026-10-07T09:20:00.000Z';
const T2 = '2026-10-07T10:00:00.000Z';
const T3 = '2026-10-07T16:00:00.000Z';
const EXPIRY = '2026-10-07T12:00:00.000Z';
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

describe('issueOffer over the injected C001/C002/C010 ports', () => {
  it('issues an OFFERED engagement bound to the escalation, shortlist and commercial refs', async () => {
    const { service } = setup();
    await declareWindow(service);
    const { record, replayed } = await service.issueOffer(
      {
        engagementId: 'eng-alpha-1',
        tenant: 'tenant-a',
        escalationRef: 'req-1001',
        expertId: 'expert-one',
        offerExpiresAt: EXPIRY,
      },
      { correlationId: 'corr-1', idempotencyKey: 'offer-key-1', at: T0 },
    );
    expect(replayed).toBe(false);
    expect(record.status).toBe('offered');
    expect(record.urgency).toBe('urgent');
    expect(record.requestDeadline).toBe(DEADLINE);
    expect(record.commercialOfferRef).toBe(fakeDigest('commercial-offer'));
    expect(record.budgetHoldRef).toBe(fakeDigest('budget-hold'));
    expect(record.routingVerdictRef).toBe(fakeDigest('verdict'));
    expect(service.listEvents().map((event) => event.kind)).toContain('offer-issued');
  });

  it('replays the recorded offer verbatim under the same idempotency key', async () => {
    const { service } = setup();
    await declareWindow(service);
    const input = {
      engagementId: 'eng-alpha-1',
      tenant: 'tenant-a',
      escalationRef: 'req-1001',
      expertId: 'expert-one',
      offerExpiresAt: EXPIRY,
    };
    const first = await service.issueOffer(input, {
      correlationId: 'corr-1',
      idempotencyKey: 'offer-key-1',
      at: T0,
    });
    const second = await service.issueOffer(input, {
      correlationId: 'corr-2',
      idempotencyKey: 'offer-key-1',
      at: T0,
    });
    expect(second.replayed).toBe(true);
    expect(second.record.digest).toBe(first.record.digest);
  });

  it('fails closed when the expert is not on the matched shortlist', async () => {
    const { service } = setup();
    await declareWindow(service);
    await expect(
      service.issueOffer(
        {
          engagementId: 'eng-alpha-9',
          tenant: 'tenant-a',
          escalationRef: 'req-1001',
          expertId: 'expert-three',
          offerExpiresAt: EXPIRY,
        },
        { correlationId: 'corr-1', idempotencyKey: 'offer-key-9', at: T0 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.NOT_FOUND);
      return true;
    });
  });

  it('fails closed when the escalation state does not bind to OFFERED', async () => {
    const { escalation, service } = setup();
    escalation.setState('tenant-a', 'req-1001', 'matching');
    await declareWindow(service);
    await expect(
      service.issueOffer(
        {
          engagementId: 'eng-alpha-1',
          tenant: 'tenant-a',
          escalationRef: 'req-1001',
          expertId: 'expert-one',
          offerExpiresAt: EXPIRY,
        },
        { correlationId: 'corr-1', idempotencyKey: 'offer-key-1', at: T0 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.ESCALATION_STATE_MISMATCH);
      return true;
    });
  });
});

describe('offer → accept → session handoff → complete (the ERF1.0 path)', () => {
  it('walks accept → activate → complete as the escalation advances', async () => {
    const { escalation, service } = setup();
    await declareWindow(service);
    await service.issueOffer(
      {
        engagementId: 'eng-alpha-1',
        tenant: 'tenant-a',
        escalationRef: 'req-1001',
        expertId: 'expert-one',
        offerExpiresAt: EXPIRY,
      },
      { correlationId: 'corr-1', idempotencyKey: 'offer-key-1', at: T0 },
    );

    // The escalation advances OFFERED → ACCEPTED (C001-owned transition).
    escalation.setState('tenant-a', 'req-1001', 'accepted');
    const accepted = await service.accept(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-2', idempotencyKey: 'accept-key-1', at: T1 },
    );
    expect(accepted.record.status).toBe('accepted');
    expect(accepted.record.acceptedAt).toBe(T1);

    // SESSION handoff: escalation ACCEPTED → SESSION_READY.
    escalation.setState('tenant-a', 'req-1001', 'session_ready');
    const active = await service.activate(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-3', idempotencyKey: 'activate-key-1', at: T2 },
    );
    expect(active.record.status).toBe('active');
    expect(active.record.activatedAt).toBe(T2);

    // Submission: escalation IN_PROGRESS → SUBMITTED.
    escalation.setState('tenant-a', 'req-1001', 'in_progress');
    escalation.setState('tenant-a', 'req-1001', 'submitted');
    const completed = await service.complete(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-4', idempotencyKey: 'complete-key-1', at: T3 },
    );
    expect(completed.record.status).toBe('completed');
    expect(completed.record.completedAt).toBe(T3);
    expect(completed.replayed).toBe(false);
    // Terminal finality.
    await expect(
      service.withdraw(
        { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
        { correlationId: 'corr-5', idempotencyKey: 'withdraw-key-1', at: T3 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.TERMINAL_STATE);
      return true;
    });
  });

  it('rejects accept when the escalation has not advanced to accepted (binding drift)', async () => {
    const { service } = setup();
    await declareWindow(service);
    await service.issueOffer(
      {
        engagementId: 'eng-alpha-2',
        tenant: 'tenant-a',
        escalationRef: 'req-1001',
        expertId: 'expert-one',
        offerExpiresAt: EXPIRY,
      },
      { correlationId: 'corr-1', idempotencyKey: 'offer-key-2', at: T0 },
    );
    await expect(
      service.accept(
        { engagementId: 'eng-alpha-2', tenant: 'tenant-a' },
        { correlationId: 'corr-2', idempotencyKey: 'accept-key-2', at: T1 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.ESCALATION_STATE_MISMATCH);
      return true;
    });
  });
});

describe('availability declarations and the routing-input projection', () => {
  it('declares versioned declarations; new versions must strictly supersede', async () => {
    const { service } = setup();
    const first = await declareWindow(service);
    expect(first.declaration.version).toBe(1);
    await expect(
      service.declareAvailability(
        {
          declarationId: 'avail-expert-one-2',
          tenant: 'tenant-a',
          expertId: 'expert-one',
          version: 1,
          windows: [
            {
              window: { recurrence: 'weekly', dayOfWeek: 4, startUtc: '09:00', endUtc: '17:00' },
              capacitySlots: 1,
            },
          ],
        },
        { correlationId: 'corr-avail', idempotencyKey: 'avail-key-2', at: T0 },
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.VERSION_CONFLICT);
      return true;
    });
    const second = await service.declareAvailability(
      {
        declarationId: 'avail-expert-one-3',
        tenant: 'tenant-a',
        expertId: 'expert-one',
        version: 2,
        windows: [
          {
            window: { recurrence: 'weekly', dayOfWeek: 3, startUtc: '10:00', endUtc: '18:00' },
            capacitySlots: 3,
          },
        ],
      },
      { correlationId: 'corr-avail', idempotencyKey: 'avail-key-3', at: T1 },
    );
    expect(second.declaration.version).toBe(2);

    const projection = await service.getAvailabilityRoutingInput(
      { tenant: 'tenant-a', expertId: 'expert-one' },
      { correlationId: 'corr-proj', at: T1 },
    );
    expect(projection.declarationVersion).toBe(2);
    expect(projection.availableWindows.length).toBe(1);
    expect(projection.availableWindows[0]?.window.startUtc).toBe('10:00');
  });

  it('the projection reflects committed capacity (accepted engagements occupy slots)', async () => {
    const { escalation, service } = setup();
    await declareWindow(service, 1);
    await service.issueOffer(
      {
        engagementId: 'eng-alpha-1',
        tenant: 'tenant-a',
        escalationRef: 'req-1001',
        expertId: 'expert-one',
        offerExpiresAt: EXPIRY,
      },
      { correlationId: 'corr-1', idempotencyKey: 'offer-key-1', at: T0 },
    );
    escalation.setState('tenant-a', 'req-1001', 'accepted');
    await service.accept(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-2', idempotencyKey: 'accept-key-1', at: T1 },
    );
    const projection = await service.getAvailabilityRoutingInput(
      { tenant: 'tenant-a', expertId: 'expert-one' },
      { correlationId: 'corr-proj', at: T2 },
    );
    expect(projection.availableWindows.length).toBe(0);
    expect(projection.fullyCommittedWindows).toBe(1);
  });
});

describe('SLA clock evaluation as a durable idempotent job', () => {
  it('derives clocks, records breaches once and completes the job', async () => {
    const { service } = setup();
    await declareWindow(service);
    await service.issueOffer(
      {
        engagementId: 'eng-alpha-1',
        tenant: 'tenant-a',
        escalationRef: 'req-1001',
        expertId: 'expert-one',
        offerExpiresAt: EXPIRY,
      },
      { correlationId: 'corr-1', idempotencyKey: 'offer-key-1', at: T0 },
    );
    const mid = await service.evaluateSlaClocks(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-sla', idempotencyKey: 'sla-key-1', at: T1 },
    );
    expect(mid.evaluation.acceptClock.state).toBe('on-track');
    expect(mid.recordedBreaches.length).toBe(0);

    // Past the request deadline with no milestones: every clock is breached.
    const late = await service.evaluateSlaClocks(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-sla', idempotencyKey: 'sla-key-2', at: '2026-10-08T09:00:00.001Z' },
    );
    expect(late.evaluation.submitClock.state).toBe('breached');
    expect(late.recordedBreaches.length).toBe(3);

    // The same late evaluation REPLAYS the canonical breach records (append-only, idempotent).
    const repeat = await service.evaluateSlaClocks(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-sla', idempotencyKey: 'sla-key-3', at: '2026-10-08T10:00:00.000Z' },
    );
    expect(repeat.recordedBreaches.length).toBe(3);
    const stored = await service.listSlaBreaches(
      { engagementId: 'eng-alpha-1', tenant: 'tenant-a' },
      { correlationId: 'corr-sla' },
    );
    expect(stored.length).toBe(3);
  });

  it('the job replay is idempotent (same key replays the recorded job)', async () => {
    const { service } = setup();
    await declareWindow(service);
    await service.issueOffer(
      {
        engagementId: 'eng-alpha-3',
        tenant: 'tenant-a',
        escalationRef: 'req-1001',
        expertId: 'expert-one',
        offerExpiresAt: EXPIRY,
      },
      { correlationId: 'corr-1', idempotencyKey: 'offer-key-3', at: T0 },
    );
    const first = await service.evaluateSlaClocks(
      { engagementId: 'eng-alpha-3', tenant: 'tenant-a', jobId: 'sla-job-x' },
      { correlationId: 'corr-sla', idempotencyKey: 'sla-key-x', at: T1 },
    );
    const second = await service.evaluateSlaClocks(
      { engagementId: 'eng-alpha-3', tenant: 'tenant-a', jobId: 'sla-job-x' },
      { correlationId: 'corr-sla', idempotencyKey: 'sla-key-x', at: T1 },
    );
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
  });
});

describe('record reads', () => {
  it('reads a digest-verified engagement record', async () => {
    const { service } = setup();
    await declareWindow(service);
    const { record } = await service.issueOffer(
      {
        engagementId: 'eng-alpha-4',
        tenant: 'tenant-a',
        escalationRef: 'req-1001',
        expertId: 'expert-one',
        offerExpiresAt: EXPIRY,
      },
      { correlationId: 'corr-1', idempotencyKey: 'offer-key-4', at: T0 },
    );
    const read = await service.getEngagement(
      { engagementId: 'eng-alpha-4', tenant: 'tenant-a' },
      { correlationId: 'corr-read' },
    );
    expect(read.digest).toBe(record.digest);
  });
});
