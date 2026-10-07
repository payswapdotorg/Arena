/**
 * Webhook event taxonomy tests (Work Order C001) — the closed 13-event
 * ES1.0 vocabulary, lifecycle projection, idempotent consumer keys and
 * terminal-final webhook streams.
 */

import { describe, expect, it } from 'vitest';
import { createEscalationRequest } from './request.js';
import {
  ESCALATION_WEBHOOK_EVENT_TYPES,
  STATE_TO_WEBHOOK_EVENT,
  createEscalationWebhookEvent,
  isEscalationWebhookEvent,
  isTerminalWebhookEvent,
  lifecycleEventForState,
  resultEventData,
  webhookConsumerKey,
} from './events.js';
import { ESCALATION_STATES } from './lifecycle.js';
import { validEscalationRequestInput } from './test-support.js';

const NOW = '2026-10-07T10:15:00.000Z';

describe('escalation webhook events', () => {
  it('has exactly the 13 ES1.0 minimum events', () => {
    expect([...ESCALATION_WEBHOOK_EVENT_TYPES]).toEqual([
      'escalation.created',
      'escalation.matched',
      'escalation.accepted',
      'escalation.session.ready',
      'escalation.started',
      'escalation.progressed',
      'escalation.submitted',
      'escalation.validation.updated',
      'escalation.completed',
      'escalation.failed',
      'escalation.cancelled',
      'escalation.payment.updated',
      'escalation.learning.updated',
    ]);
  });

  it('every lifecycle state projects to an event type (or null)', () => {
    for (const state of ESCALATION_STATES) {
      const event = lifecycleEventForState(state);
      expect(event === null || ESCALATION_WEBHOOK_EVENT_TYPES.includes(event)).toBe(true);
    }
    expect(STATE_TO_WEBHOOK_EVENT['created']).toBe('escalation.created');
    expect(STATE_TO_WEBHOOK_EVENT['closed']).toBe('escalation.completed');
    expect(STATE_TO_WEBHOOK_EVENT['timed_out']).toBe('escalation.failed');
  });

  it('creates events with idempotent consumer keys', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const event = createEscalationWebhookEvent({
      eventType: 'escalation.created',
      request,
      sequence: 1,
      now: NOW,
      state: 'created',
      data: { capabilityNeed: request.capabilityNeed },
    });
    expect(isEscalationWebhookEvent(event)).toBe(true);
    expect(webhookConsumerKey(event)).toBe(event.eventId);
    expect(event.tenantId).toBe('tenant-alpha');
    expect(event.correlationId).toBe('corr-0001');
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('duplicate delivery is detectable by consumer key equality', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const event = createEscalationWebhookEvent({
      eventType: 'escalation.progressed',
      request,
      sequence: 2,
      now: NOW,
      state: 'triaged',
      eventId: 'evt_' + 'a'.repeat(32),
    });
    const redelivered = createEscalationWebhookEvent({
      eventType: 'escalation.progressed',
      request,
      sequence: 2,
      now: NOW,
      state: 'triaged',
      eventId: 'evt_' + 'a'.repeat(32),
    });
    expect(webhookConsumerKey(event)).toBe(webhookConsumerKey(redelivered));
  });

  it('terminal webhook events are final for a stream', () => {
    expect(isTerminalWebhookEvent({ eventType: 'escalation.completed' } as never)).toBe(true);
    expect(isTerminalWebhookEvent({ eventType: 'escalation.failed' } as never)).toBe(true);
    expect(isTerminalWebhookEvent({ eventType: 'escalation.cancelled' } as never)).toBe(true);
    expect(isTerminalWebhookEvent({ eventType: 'escalation.progressed' } as never)).toBe(false);
  });

  it('rejects unknown event types, bad sequences and non-plain data', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    expect(() =>
      createEscalationWebhookEvent({ eventType: 'escalation.vibes', request, sequence: 1, now: NOW }),
    ).toThrowError();
    expect(() =>
      createEscalationWebhookEvent({ eventType: 'escalation.created', request, sequence: 0, now: NOW }),
    ).toThrowError();
    expect(() =>
      createEscalationWebhookEvent({
        eventType: 'escalation.created',
        request,
        sequence: 1,
        now: NOW,
        data: (() => 'nope') as unknown,
      }),
    ).toThrowError();
  });

  it('result event data carries the typed summary', () => {
    const data = resultEventData({
      kind: 'solution',
      summary: 'done',
      producedAt: NOW,
    } as never);
    expect(data).toEqual({ resultKind: 'solution', summary: 'done', producedAt: NOW });
  });
});
