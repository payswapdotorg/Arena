/**
 * Timeline projection tests (Work Order C021; issue #127): projection
 * correctness from event streams, dedupe, ordering, tenant isolation,
 * dwell arithmetic and rollups.
 */

import { describe, expect, it } from 'vitest';

import { createEscalationWebhookEvent } from '@arena/escalation';
import type { EscalationWebhookEvent } from '@arena/escalation';

import {
  foldEscalationSummary,
  projectEscalationRollup,
  projectEscalationTimeline,
} from './timeline.js';
import { EscalationObservabilityError } from './errors.js';

const TENANT = 'acme';
const REQUEST = 'esc_11111111111111111111111111111111';
const REQUEST_B = 'esc_22222222222222222222222222222222';

function request(tenant = TENANT, requestId = REQUEST) {
  return {
    requestId,
    tenantId: tenant,
    correlationId: 'corr-1',
  } as unknown as Parameters<typeof createEscalationWebhookEvent>[0]['request'];
}

function event(
  eventType: Parameters<typeof createEscalationWebhookEvent>[0]['eventType'],
  sequence: number,
  at: string,
  extras: {
    state?: Parameters<typeof createEscalationWebhookEvent>[0]['state'];
    data?: unknown;
    tenant?: string;
    requestId?: string;
    eventId?: string;
  } = {},
): EscalationWebhookEvent {
  return createEscalationWebhookEvent({
    eventType,
    request: request(extras.tenant, extras.requestId),
    sequence,
    now: at,
    ...(extras.state !== undefined ? { state: extras.state } : {}),
    ...(extras.data !== undefined ? { data: extras.data } : {}),
    ...(extras.eventId !== undefined ? { eventId: extras.eventId } : {}),
  });
}

const T0 = '2026-10-01T09:00:00.000Z';
const T1 = '2026-10-01T09:10:00.000Z';
const T2 = '2026-10-01T09:40:00.000Z';
const T3 = '2026-10-01T10:00:00.000Z';
const AT = '2026-10-01T11:00:00.000Z';

function happyPathStream(): EscalationWebhookEvent[] {
  return [
    event('escalation.created', 1, T0, { state: 'created' }),
    event('escalation.matched', 2, T1, { state: 'offered' }),
    event('escalation.accepted', 3, T2, { state: 'accepted' }),
    event('escalation.validation.updated', 4, T3, {
      state: 'validating',
      data: { validationStatus: 'pending' },
    }),
  ];
}

describe('projectEscalationTimeline', () => {
  it('projects steps with dwell times and current state', () => {
    const timeline = projectEscalationTimeline(happyPathStream(), {
      tenant: TENANT,
      requestId: REQUEST,
      at: AT,
      clientAppId: 'app-alpha',
      capabilityNeed: 'sql-analysis',
      urgency: 'urgent',
    });
    expect(timeline.currentState).toBe('validating');
    expect(timeline.terminal).toBe(false);
    expect(timeline.steps).toHaveLength(4);
    expect(timeline.steps[0]?.dwellMs).toBe(10 * 60_000);
    expect(timeline.steps[1]?.dwellMs).toBe(30 * 60_000);
    expect(timeline.steps[2]?.dwellMs).toBe(20 * 60_000);
    expect(timeline.steps[3]?.dwellMs).toBeNull();
    expect(timeline.validationVerdicts).toEqual([
      { sequence: 4, occurredAt: T3, validationStatus: 'pending' },
    ]);
    expect(timeline.clientAppId).toBe('app-alpha');
  });

  it('is deterministic: identical events yield the identical projection', () => {
    const a = projectEscalationTimeline(happyPathStream(), {
      tenant: TENANT,
      requestId: REQUEST,
      at: AT,
    });
    const b = projectEscalationTimeline(happyPathStream(), {
      tenant: TENANT,
      requestId: REQUEST,
      at: AT,
    });
    expect(a).toEqual(b);
  });

  it('dedupes by eventId (at-least-once delivery is safe)', () => {
    const stream = happyPathStream();
    const duplicated = [...stream, { ...stream[1]! }];
    const timeline = projectEscalationTimeline(duplicated, {
      tenant: TENANT,
      requestId: REQUEST,
      at: AT,
    });
    expect(timeline.steps).toHaveLength(4);
  });

  it('records payment-state refs, replacements and terminal events', () => {
    const stream = [
      event('escalation.created', 1, T0, { state: 'created' }),
      event('escalation.progressed', 2, T1, { state: 'expert_replaced' }),
      event('escalation.matched', 3, T2, { state: 'offered' }),
      event('escalation.payment.updated', 4, T3, {
        state: 'paid',
        data: { paymentState: 'settled', payoutStatus: 'paid' },
      }),
      event('escalation.completed', 5, AT, { state: 'closed' }),
    ];
    const timeline = projectEscalationTimeline(stream, {
      tenant: TENANT,
      requestId: REQUEST,
      at: AT,
    });
    expect(timeline.replacements).toHaveLength(1);
    expect(timeline.paymentStates).toEqual([
      { sequence: 4, occurredAt: T3, paymentState: 'settled' },
    ]);
    expect(timeline.terminal).toBe(true);
    expect(timeline.currentState).toBe('closed');
  });

  it('fails closed on cross-tenant events (CROSS_TENANT_ACCESS)', () => {
    const stream = [
      ...happyPathStream(),
      event('escalation.progressed', 5, AT, { tenant: 'other-co', state: 'matching' }),
    ];
    expect(() =>
      projectEscalationTimeline(stream, { tenant: TENANT, requestId: REQUEST, at: AT }),
    ).toThrowError(EscalationObservabilityError);
    try {
      projectEscalationTimeline(stream, { tenant: TENANT, requestId: REQUEST, at: AT });
    } catch (error) {
      expect((error as EscalationObservabilityError).code).toBe(
        'ESCALATION_OBSERVABILITY_CROSS_TENANT_ACCESS',
      );
    }
  });

  it('fails closed on events of another escalation', () => {
    const stream = [
      ...happyPathStream(),
      event('escalation.progressed', 5, AT, { requestId: REQUEST_B, state: 'matching' }),
    ];
    expect(() =>
      projectEscalationTimeline(stream, { tenant: TENANT, requestId: REQUEST, at: AT }),
    ).toThrowError(/belongs to escalation/);
  });

  it('fails closed on conflicting events claiming the same sequence', () => {
    const stream = [
      event('escalation.created', 1, T0, { state: 'created' }),
      event('escalation.matched', 1, T1, { state: 'offered' }),
    ];
    expect(() =>
      projectEscalationTimeline(stream, { tenant: TENANT, requestId: REQUEST, at: AT }),
    ).toThrowError(/conflicting stream/);
  });

  it('fails closed on non-monotonic occurredAt timestamps', () => {
    const stream = [
      event('escalation.created', 1, T1, { state: 'created' }),
      event('escalation.matched', 2, T0, { state: 'offered' }),
    ];
    expect(() =>
      projectEscalationTimeline(stream, { tenant: TENANT, requestId: REQUEST, at: AT }),
    ).toThrowError(/non-decreasing/);
  });

  it('fails closed on structurally invalid events', () => {
    expect(() =>
      projectEscalationTimeline([{ bogus: true }], {
        tenant: TENANT,
        requestId: REQUEST,
        at: AT,
      }),
    ).toThrowError(EscalationObservabilityError);
  });

  it('projects the empty stream honestly (no fabricated steps)', () => {
    const timeline = projectEscalationTimeline([], {
      tenant: TENANT,
      requestId: REQUEST,
      at: AT,
    });
    expect(timeline.steps).toHaveLength(0);
    expect(timeline.currentState).toBeNull();
    expect(timeline.terminal).toBe(false);
  });

  it('freezes the projection (no mutation path)', () => {
    const timeline = projectEscalationTimeline(happyPathStream(), {
      tenant: TENANT,
      requestId: REQUEST,
      at: AT,
    });
    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline.steps)).toBe(true);
    expect(() => {
      (timeline as { currentState: string }).currentState = 'closed';
    }).toThrow();
  });
});

describe('foldEscalationSummary + projectEscalationRollup', () => {
  function timelineFor(
    requestId: string,
    opts: { clientAppId?: string; capability?: string; urgency?: string },
  ) {
    const stream = happyPathStream().map((event) => ({ ...event, requestId }));
    return projectEscalationTimeline(stream, {
      tenant: TENANT,
      requestId,
      at: AT,
      clientAppId: opts.clientAppId ?? null,
      capabilityNeed: opts.capability ?? null,
      urgency: opts.urgency ?? null,
    });
  }

  it('folds the summary deterministically', () => {
    const summary = foldEscalationSummary(timelineFor(REQUEST, { urgency: 'urgent' }));
    expect(summary.stepCount).toBe(4);
    expect(summary.observedDwellMs).toBe(60 * 60_000);
    expect(summary.longestDwellMs).toBe(30 * 60_000);
    expect(summary.validationVerdictCount).toBe(1);
    expect(summary.urgency).toBe('urgent');
  });

  it('rolls up by client-app with replacement rates (deterministic order)', () => {
    const timelines = [
      timelineFor(REQUEST, { clientAppId: 'app-beta' }),
      timelineFor(REQUEST_B, { clientAppId: 'app-alpha' }),
    ];
    const cells = projectEscalationRollup(timelines, 'client-app');
    expect(cells.map((cell) => cell.key)).toEqual(['app-alpha', 'app-beta']);
    expect(cells[0]).toMatchObject({
      dimension: 'client-app',
      escalationCount: 1,
      terminalCount: 0,
      replacementCount: 0,
      replacementRate: 0,
    });
  });

  it('fails closed when the rollup dimension field is missing', () => {
    const timelines = [timelineFor(REQUEST, {})];
    expect(() => projectEscalationRollup(timelines, 'client-app')).toThrowError(
      /clientAppId subject field/,
    );
    expect(() => projectEscalationRollup(timelines, 'capability')).toThrowError(
      /capabilityNeed subject field/,
    );
    expect(() => projectEscalationRollup(timelines, 'urgency')).toThrowError(
      /urgency subject field/,
    );
  });

  it('rejects an unknown rollup dimension', () => {
    expect(() =>
      projectEscalationRollup([], 'region' as unknown as 'client-app'),
    ).toThrowError(/unknown rollup dimension/);
  });
});
