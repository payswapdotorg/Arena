/**
 * Health-signal + alert-projection tests (Work Order C021; issue #127).
 */

import { describe, expect, it } from 'vitest';

import { createEscalationWebhookEvent } from '@arena/escalation';

import {
  computeAvailabilityCoverage,
  computeMatchingLatency,
  computeQueueDepth,
  computeReplacementRate,
  computeValidationBacklog,
} from './health.js';
import { projectBacklogAlertRule, projectSlaAlertRules, projectSloAlertRules } from './alerts.js';
import { EscalationObservabilityError } from './errors.js';

const TENANT = 'acme';
const R1 = 'esc_11111111111111111111111111111111';
const R2 = 'esc_22222222222222222222222222222222';

function ev(
  requestId: string,
  eventType: Parameters<typeof createEscalationWebhookEvent>[0]['eventType'],
  sequence: number,
  at: string,
  state: Parameters<typeof createEscalationWebhookEvent>[0]['state'],
) {
  return createEscalationWebhookEvent({
    eventType,
    request: {
      requestId,
      tenantId: TENANT,
      correlationId: `corr-${requestId}`,
    } as unknown as Parameters<typeof createEscalationWebhookEvent>[0]['request'],
    sequence,
    now: at,
    ...(state !== null && state !== undefined ? { state } : {}),
  });
}

const AT = '2026-10-01T12:00:00.000Z';

function stream() {
  return [
    ev(R1, 'escalation.created', 1, '2026-10-01T09:00:00.000Z', 'created'),
    ev(R1, 'escalation.matched', 2, '2026-10-01T09:10:00.000Z', 'offered'),
    ev(R1, 'escalation.progressed', 3, '2026-10-01T09:20:00.000Z', 'expert_replaced'),
    ev(R1, 'escalation.matched', 4, '2026-10-01T09:30:00.000Z', 'offered'),
    ev(R1, 'escalation.submitted', 5, '2026-10-01T10:00:00.000Z', 'submitted'),
    ev(R2, 'escalation.created', 1, '2026-10-01T09:05:00.000Z', 'created'),
    ev(R2, 'escalation.progressed', 2, '2026-10-01T09:25:00.000Z', 'triaged'),
  ];
}

describe('health signals', () => {
  it('computes matching latency (created → matched) with median + p95', () => {
    const signal = computeMatchingLatency(stream(), { tenant: TENANT, at: AT });
    expect(signal.matchedCount).toBe(2);
    expect(signal.latenciesMs).toEqual([10 * 60_000, 30 * 60_000]);
    expect(signal.medianMs).toBe(20 * 60_000);
    expect(signal.p95Ms).toBe(30 * 60_000);
    expect(signal.unit).toBe('milliseconds');
  });

  it('computes queue depth from latest states at the projection time', () => {
    const signal = computeQueueDepth(stream(), { tenant: TENANT, at: AT });
    expect(signal.queuedCount).toBe(1); // R2 sits in triaged; R1 is submitted
    expect(signal.byState).toEqual({ triaged: 1 });
  });

  it('computes validation backlog with the oldest age', () => {
    const signal = computeValidationBacklog(stream(), { tenant: TENANT, at: AT });
    expect(signal.backlogCount).toBe(1);
    expect(signal.oldestSinceMs).toBe(2 * 3600_000);
  });

  it('computes replacement rate over distinct escalations', () => {
    const signal = computeReplacementRate(stream(), { tenant: TENANT, at: AT });
    expect(signal.replacementCount).toBe(1);
    expect(signal.escalationCount).toBe(2);
    expect(signal.replacementRate).toBeCloseTo(0.5, 12);
  });

  it('ADVERSARIAL: cross-tenant events fail closed on every signal', () => {
    const foreign = createEscalationWebhookEvent({
      eventType: 'escalation.created',
      request: {
        requestId: R1,
        tenantId: 'other-co',
        correlationId: 'corr-x',
      } as unknown as Parameters<typeof createEscalationWebhookEvent>[0]['request'],
      sequence: 1,
      now: AT,
      state: 'created',
    });
    for (const compute of [computeMatchingLatency, computeQueueDepth, computeValidationBacklog, computeReplacementRate]) {
      try {
        compute([foreign], { tenant: TENANT, at: AT });
        expect.unreachable('cross-tenant event must fail closed');
      } catch (error) {
        expect((error as EscalationObservabilityError).code).toBe(
          'ESCALATION_OBSERVABILITY_CROSS_TENANT_ACCESS',
        );
      }
    }
  });

  it('is deterministic and honest on the empty stream', () => {
    const a = computeMatchingLatency([], { tenant: TENANT, at: AT });
    const b = computeMatchingLatency([], { tenant: TENANT, at: AT });
    expect(a).toEqual(b);
    expect(a.matchedCount).toBe(0);
    expect(a.medianMs).toBeNull();
  });

  it('computes availability coverage over C011-declared windows', () => {
    const signal = computeAvailabilityCoverage(
      [
        { declaredCapacity: 10, remainingCapacity: 6 },
        { declaredCapacity: 5, remainingCapacity: 5 },
      ],
      { tenant: TENANT, at: AT },
    );
    expect(signal.coverageRatio).toBeCloseTo(11 / 15, 12);
    expect(signal.windowCount).toBe(2);
    const empty = computeAvailabilityCoverage([], { tenant: TENANT, at: AT });
    expect(empty.coverageRatio).toBe(0);
  });

  it('rejects overcommitted availability windows (C011 invariant)', () => {
    expect(() =>
      computeAvailabilityCoverage(
        [{ declaredCapacity: 3, remainingCapacity: 4 }],
        { tenant: TENANT, at: AT },
      ),
    ).toThrowError(/remainingCapacity <= declaredCapacity/);
  });
});

describe('alert-rule projections', () => {
  it('projects a breached-clock rule onto metric-above-threshold (catalog ancestry cited)', () => {
    const rules = projectSlaAlertRules({
      tenant: TENANT,
      measuredStates: [
        { requestId: R1, clock: 'accept', urgency: 'critical', state: 'breached' },
      ],
      at: AT,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.conditionKind).toBe('metric-above-threshold');
    expect(rules[0]?.escalationCondition).toBe('sla-clock-breached');
    expect(rules[0]?.severity).toBe('high');
    expect(rules[0]?.catalogAncestry).toContain('alert-catalog');
    expect(Object.isFrozen(rules[0])).toBe(true);
  });

  it('projects at-risk mass as its own (lower-severity) rule', () => {
    const rules = projectSlaAlertRules({
      tenant: TENANT,
      measuredStates: [
        { requestId: R1, clock: 'accept', urgency: 'routine', state: 'at-risk' },
        { requestId: R2, clock: 'submit', urgency: 'routine', state: 'at-risk' },
      ],
      at: AT,
    });
    expect(rules.map((rule) => rule.escalationCondition)).toEqual(['sla-clocks-at-risk']);
    expect(rules[0]?.severity).toBe('medium');
  });

  it('projects nothing when everything is met/pending (honest quiet)', () => {
    expect(
      projectSlaAlertRules({
        tenant: TENANT,
        measuredStates: [{ requestId: R1, clock: 'accept', urgency: 'routine', state: 'pending' }],
        at: AT,
      }),
    ).toHaveLength(0);
  });

  it('projects slo-no-data rules from no-data verdicts (fail-closed posture)', () => {
    const rules = projectSloAlertRules({
      tenant: TENANT,
      sloVerdicts: [
        { sloId: 'slo-escalation-capability-x', verdict: 'no-data' },
        { sloId: 'slo-escalation-capability-y', verdict: 'met' },
      ],
      at: AT,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]?.conditionKind).toBe('slo-no-data');
    expect(rules[0]?.sloId).toBe('slo-escalation-capability-x');
  });

  it('projects the validation-backlog rule only above the threshold', () => {
    expect(projectBacklogAlertRule({ tenant: TENANT, backlogCount: 3, threshold: 5, at: AT })).toBeNull();
    const rule = projectBacklogAlertRule({ tenant: TENANT, backlogCount: 7, threshold: 5, at: AT });
    expect(rule?.conditionKind).toBe('metric-above-threshold');
    expect(rule?.threshold).toBe(5);
    expect(() =>
      projectBacklogAlertRule({ tenant: TENANT, backlogCount: -1, threshold: 5, at: AT }),
    ).toThrowError(EscalationObservabilityError);
  });
});
