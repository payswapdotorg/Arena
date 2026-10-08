/**
 * Service integration tests (Work Order C021; issue #127): projections
 * materialized from the injected C001/C011 ports, idempotent durable
 * jobs, supersession corrections, cross-tenant fail-closed reads and
 * small-sample suppression on the aggregate SLO endpoint.
 */

import { describe, expect, it } from 'vitest';

import { EscalationObservabilityError } from '@arena/escalation-observability';

import { EscalationObservabilityService } from './fabric.js';
import { FakeSourcePorts, fakeEvent } from './test-support.js';

const TENANT = 'acme';
const OTHER = 'other-co';
const R1 = 'esc_11111111111111111111111111111111';
const R2 = 'esc_22222222222222222222222222222222';

const AT = '2026-10-01T13:00:00.000Z';
const WINDOW = { windowStart: 1_700_000_000_000, windowEnd: 1_700_003_600_000 };

function ports() {
  return new FakeSourcePorts({
    events: [
      { eventType: 'escalation.created', requestId: R1, tenant: TENANT, sequence: 1, at: '2026-10-01T09:00:00.000Z', state: 'created' },
      { eventType: 'escalation.matched', requestId: R1, tenant: TENANT, sequence: 2, at: '2026-10-01T09:10:00.000Z', state: 'offered' },
      { eventType: 'escalation.accepted', requestId: R1, tenant: TENANT, sequence: 3, at: '2026-10-01T09:20:00.000Z', state: 'accepted' },
      { eventType: 'escalation.session.ready', requestId: R1, tenant: TENANT, sequence: 4, at: '2026-10-01T09:25:00.000Z', state: 'session_ready' },
      { eventType: 'escalation.started', requestId: R1, tenant: TENANT, sequence: 5, at: '2026-10-01T09:30:00.000Z', state: 'in_progress' },
      { eventType: 'escalation.submitted', requestId: R1, tenant: TENANT, sequence: 6, at: '2026-10-01T10:00:00.000Z', state: 'submitted' },
      { eventType: 'escalation.validation.updated', requestId: R1, tenant: TENANT, sequence: 7, at: '2026-10-01T10:20:00.000Z', state: 'validating', data: { validationStatus: 'pending' } },
      { eventType: 'escalation.validation.updated', requestId: R1, tenant: TENANT, sequence: 8, at: '2026-10-01T10:30:00.000Z', state: 'result_accepted', data: { validationStatus: 'passed' } },
      { eventType: 'escalation.payment.updated', requestId: R1, tenant: TENANT, sequence: 9, at: '2026-10-01T11:00:00.000Z', state: 'paid', data: { paymentState: 'settled' } },
      { eventType: 'escalation.completed', requestId: R1, tenant: TENANT, sequence: 10, at: '2026-10-01T12:00:00.000Z', state: 'closed' },
      // A second escalation that fails (bad outcome sample).
      { eventType: 'escalation.created', requestId: R2, tenant: TENANT, sequence: 1, at: '2026-10-01T09:05:00.000Z', state: 'created' },
      { eventType: 'escalation.failed', requestId: R2, tenant: TENANT, sequence: 2, at: '2026-10-01T09:15:00.000Z', state: 'timed_out' },
    ],
    subjects: [
      {
        tenant: TENANT,
        requestId: R1,
        clientAppId: 'app-alpha',
        capabilityNeed: 'sql-analysis',
        urgency: 'urgent',
        requestDeadline: '2026-10-02T09:00:00.000Z',
      },
      {
        tenant: TENANT,
        requestId: R2,
        clientAppId: 'app-beta',
        capabilityNeed: 'sql-analysis',
        urgency: 'routine',
        requestDeadline: '2026-10-02T09:00:00.000Z',
      },
    ],
    engagements: [
      {
        tenant: TENANT,
        requestId: R1,
        engagementId: 'eng-1',
        urgency: 'urgent',
        requestDeadline: '2026-10-02T09:00:00.000Z',
        offerIssuedAt: '2026-10-01T09:10:00.000Z',
        acceptedAt: '2026-10-01T09:20:00.000Z',
        activatedAt: '2026-10-01T09:30:00.000Z',
        submittedAt: '2026-10-01T10:00:00.000Z',
        validationVerdictAt: '2026-10-01T10:30:00.000Z',
      },
    ],
    routing: [
      { tenant: TENANT, requestId: R1, resourceClass: 'expert-human', capability: 'sql-analysis' },
      { tenant: TENANT, requestId: R2, resourceClass: 'expert-human', capability: 'sql-analysis' },
    ],
  });
}

async function materialized() {
  const service = new EscalationObservabilityService(ports());
  const result = await service.materializeTenantProjections(
    { tenant: TENANT },
    { correlationId: 'corr-1', idempotencyKey: 'idem-1', at: AT },
  );
  return { service, result };
}

describe('materializeTenantProjections (durable idempotent job)', () => {
  it('projects timelines + measured SLA records from the injected ports', async () => {
    const { service, result } = await materialized();
    expect(result.replayed).toBe(false);
    expect(result.projectedTimelineCount).toBe(2);
    expect(result.appendedSlaRecordCount).toBe(4);
    const timeline = await service.getEscalationTimeline(
      { tenant: TENANT, requestId: R1 },
      { correlationId: 'q1' },
    );
    expect(timeline.currentState).toBe('closed');
    expect(timeline.terminal).toBe(true);
    expect(timeline.paymentStates).toEqual([
      { sequence: 9, occurredAt: '2026-10-01T11:00:00.000Z', paymentState: 'settled' },
    ]);
    expect(timeline.validationVerdicts).toHaveLength(2);
    const { records } = await service.getSlaOverview({ tenant: TENANT }, { correlationId: 'q2' });
    expect(records).toHaveLength(4);
    expect(records.map((record) => record.state)).toEqual(['met', 'met', 'met', 'met']);
    // Every measured record is evidence-backed by the escalation's events.
    for (const record of records) {
      expect(record.evidenceEventIds.length).toBeGreaterThanOrEqual(10);
      expect(record.engagementId).toBe('eng-1');
    }
  });

  it('is idempotent: replaying the same key reports replayed and appends nothing', async () => {
    const service = new EscalationObservabilityService(ports());
    await service.materializeTenantProjections(
      { tenant: TENANT },
      { correlationId: 'corr-1', idempotencyKey: 'idem-1', at: AT },
    );
    const replay = await service.materializeTenantProjections(
      { tenant: TENANT },
      { correlationId: 'corr-2', idempotencyKey: 'idem-1', at: '2026-10-01T14:00:00.000Z' },
    );
    expect(replay.replayed).toBe(true);
    expect(replay.appendedSlaRecordCount).toBe(0);
    const { records } = await service.getSlaOverview({ tenant: TENANT }, { correlationId: 'q' });
    expect(records).toHaveLength(4);
    // The durable job log carries BOTH entries (append-only evidence).
    const log = service.getJobLog();
    expect(log).toHaveLength(2);
    expect(log[1]?.replayed).toBe(true);
  });

  it('fails closed when the event port leaks a cross-tenant event', async () => {
    const base = new FakeSourcePorts({});
    const foreignEvent = fakeEvent({
      eventType: 'escalation.created',
      requestId: R1,
      tenant: OTHER,
      sequence: 1,
      at: '2026-10-01T09:00:00.000Z',
      state: 'created',
    });
    const leaking = {
      ...base,
      events: {
        listEscalationEvents: async () => [foreignEvent],
      },
    };
    const service = new EscalationObservabilityService(leaking);
    await expect(
      service.materializeTenantProjections(
        { tenant: TENANT },
        { correlationId: 'c', idempotencyKey: 'k', at: AT },
      ),
    ).rejects.toThrowError(/cross-tenant port leak/);
  });

  it('fails closed when the engagement port disagrees with the request subject', async () => {
    const inconsistent = new FakeSourcePorts({
      events: [
        { eventType: 'escalation.created', requestId: R1, tenant: TENANT, sequence: 1, at: '2026-10-01T09:00:00.000Z', state: 'created' },
      ],
      subjects: [
        {
          tenant: TENANT,
          requestId: R1,
          clientAppId: null,
          capabilityNeed: null,
          urgency: 'urgent',
          requestDeadline: '2026-10-02T09:00:00.000Z',
        },
      ],
      engagements: [
        {
          tenant: TENANT,
          requestId: R1,
          engagementId: 'eng-x',
          urgency: 'routine',
          requestDeadline: '2026-10-02T09:00:00.000Z',
          offerIssuedAt: '2026-10-01T09:00:00.000Z',
          acceptedAt: null,
          activatedAt: null,
          submittedAt: null,
          validationVerdictAt: null,
        },
      ],
    });
    const service = new EscalationObservabilityService(inconsistent);
    await expect(
      service.materializeTenantProjections(
        { tenant: TENANT },
        { correlationId: 'c', idempotencyKey: 'k', at: AT },
      ),
    ).rejects.toThrowError(/inconsistent port view/);
  });

  it('projects honestly when no engagement record exists (no fabricated SLA)', async () => {
    const noEngagement = new FakeSourcePorts({
      events: [
        { eventType: 'escalation.created', requestId: R1, tenant: TENANT, sequence: 1, at: '2026-10-01T09:00:00.000Z', state: 'created' },
      ],
    });
    const service = new EscalationObservabilityService(noEngagement);
    const result = await service.materializeTenantProjections(
      { tenant: TENANT },
      { correlationId: 'c', idempotencyKey: 'k', at: AT },
    );
    expect(result.appendedSlaRecordCount).toBe(0);
    const { records } = await service.getSlaOverview({ tenant: TENANT }, { correlationId: 'q' });
    expect(records).toHaveLength(0);
  });
});

describe('ops query surface', () => {
  it('serves per-tenant summaries + SLA overview with breach alert rules', async () => {
    const { service } = await materialized();
    const summaries = await service.listEscalationSummaries(
      { tenant: TENANT },
      { correlationId: 'q' },
    );
    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.requestId)).toEqual([R1, R2]);
    const { alertRules } = await service.getSlaOverview({ tenant: TENANT }, { correlationId: 'q' });
    // All four clocks are met — the honest quiet (no fabricated alerts).
    expect(alertRules).toHaveLength(0);
  });

  it('serves dimensional SLO rollups with disclosed formulas', async () => {
    const { service } = await materialized();
    const cells = await service.getSloRollups(
      { tenant: TENANT, dimension: 'capability', window: WINDOW, targetRatio: 0.5 },
      { correlationId: 'q' },
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]?.key).toBe('sql-analysis');
    expect(cells[0]?.evaluation.sampleCount).toBe(2);
    expect(cells[0]?.evaluation.goodCount).toBe(1);
    expect(cells[0]?.formula.statement).toContain('good / total');
  });

  it('serves network health signals from the event stream', async () => {
    const { service } = await materialized();
    const health = await service.getNetworkHealth(
      {
        tenant: TENANT,
        availabilityWindows: [{ declaredCapacity: 4, remainingCapacity: 2 }],
        backlogThreshold: 0,
      },
      { correlationId: 'q', at: AT },
    );
    expect(health.matchingLatency.matchedCount).toBe(1);
    expect(health.queueDepth.queuedCount).toBe(0);
    expect(health.validationBacklog.backlogCount).toBe(0);
    expect(health.replacementRate.replacementCount).toBe(0);
    expect(health.availabilityCoverage?.coverageRatio).toBeCloseTo(0.5, 12);
    expect(health.alertRules).toHaveLength(0);
  });

  it('ADVERSARIAL: cross-tenant timeline reads fail closed', async () => {
    const { service } = await materialized();
    await expect(
      service.getEscalationTimeline(
        { tenant: OTHER, requestId: R1 },
        { correlationId: 'q' },
      ),
    ).rejects.toThrowError(EscalationObservabilityError);
    // And the other tenant's summaries never include acme projections.
    const summaries = await service.listEscalationSummaries(
      { tenant: OTHER },
      { correlationId: 'q' },
    );
    expect(summaries).toHaveLength(0);
  });

  it('ADVERSARIAL: tenant detail never leaks through the aggregate SLO endpoint', async () => {
    const mixed = new FakeSourcePorts({
      events: [
        { eventType: 'escalation.created', requestId: R1, tenant: TENANT, sequence: 1, at: '2026-10-01T09:00:00.000Z', state: 'created' },
        { eventType: 'escalation.completed', requestId: R1, tenant: TENANT, sequence: 2, at: '2026-10-01T10:00:00.000Z', state: 'closed' },
        { eventType: 'escalation.created', requestId: R2, tenant: OTHER, sequence: 1, at: '2026-10-01T09:00:00.000Z', state: 'created' },
        { eventType: 'escalation.completed', requestId: R2, tenant: OTHER, sequence: 2, at: '2026-10-01T10:00:00.000Z', state: 'closed' },
      ],
      subjects: [
        { tenant: TENANT, requestId: R1, clientAppId: 'app-a', capabilityNeed: 'cap-x', urgency: 'routine', requestDeadline: '2026-10-02T09:00:00.000Z' },
        { tenant: OTHER, requestId: R2, clientAppId: 'app-b', capabilityNeed: 'cap-x', urgency: 'routine', requestDeadline: '2026-10-02T09:00:00.000Z' },
      ],
    });
    const service = new EscalationObservabilityService(mixed);
    await service.materializeTenantProjections(
      { tenant: TENANT },
      { correlationId: 'c1', idempotencyKey: 'k1', at: AT },
    );
    await service.materializeTenantProjections(
      { tenant: OTHER },
      { correlationId: 'c2', idempotencyKey: 'k2', at: AT },
    );
    const aggregate = await service.getAggregateSloView(
      { dimension: 'capability', window: WINDOW, targetRatio: 0.5, minSampleCount: 5 },
      { correlationId: 'q' },
    );
    // Each tenant contributed 1 sample (< 5) → both suppressed, counted
    // anonymously — neither tenant id appears on the view.
    expect(aggregate.suppressedCellCount).toBe(2);
    expect(aggregate.contributingCellCount).toBe(0);
    const serialized = JSON.stringify(aggregate);
    expect(serialized).not.toContain(TENANT);
    expect(serialized).not.toContain(OTHER);
    expect(aggregate.evaluation.verdict).toBe('no-data');
  });
});

describe('correctMeasuredSlaRecord (supersession)', () => {
  it('corrects through supersession — the prior record stays intact', async () => {
    const { service } = await materialized();
    const { records } = await service.getSlaOverview({ tenant: TENANT }, { correlationId: 'q' });
    const prior = records.find((record) => record.clock === 'submit');
    expect(prior).toBeDefined();
    const { record: correction } = await service.correctMeasuredSlaRecord(
      {
        tenant: TENANT,
        requestId: R1,
        clock: 'submit',
        state: 'breached',
        reasons: ['clock-breached-deadline-passed'],
        milestoneAt: '2026-10-01T15:00:00.000Z',
        correctionId: 'obs_' + '9'.repeat(32),
        observedAt: '2026-10-01T15:30:00.000Z',
      },
      { correlationId: 'c3', idempotencyKey: 'k3', at: '2026-10-01T15:30:00.000Z' },
    );
    expect(correction.supersedes).toBe(prior?.slaRecordId);
    expect(correction.reasons).toContain('correction-supersedes-prior-record');
    const after = await service.getSlaOverview({ tenant: TENANT }, { correlationId: 'q2' });
    const effectiveSubmit = after.records.find((record) => record.clock === 'submit');
    expect(effectiveSubmit?.slaRecordId).toBe(correction.slaRecordId);
    // The breached correction now projects a breach alert rule.
    expect(after.alertRules.map((rule) => rule.escalationCondition)).toContain(
      'sla-clock-breached',
    );
  });

  it('fails closed when no measured record exists to correct', async () => {
    const noData = new EscalationObservabilityService(new FakeSourcePorts());
    await expect(
      noData.correctMeasuredSlaRecord(
        {
          tenant: TENANT,
          requestId: R1,
          clock: 'accept',
          state: 'met',
          reasons: ['clock-met-before-due'],
          milestoneAt: '2026-10-01T09:30:00.000Z',
          correctionId: 'obs_' + '8'.repeat(32),
          observedAt: '2026-10-01T10:00:00.000Z',
        },
        { correlationId: 'c', idempotencyKey: 'k', at: '2026-10-01T10:00:00.000Z' },
      ),
    ).rejects.toThrowError(/no measured SLA record to correct/);
  });
});
