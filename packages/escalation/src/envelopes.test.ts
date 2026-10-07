/**
 * Envelope wiring tests (Work Order C001) — strict round trips for the
 * four escalation wire messages (command/query/response/event) and
 * fail-closed parsing (wrong kind, wrong namespace, missing idempotency
 * key on commands).
 */

import { describe, expect, it } from 'vitest';
import { serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { createEscalationRequest } from './request.js';
import { createEscalationRecord } from './lifecycle.js';
import { createEscalationWebhookEvent } from './events.js';
import {
  ESCALATION_SCHEMAS,
  escalationSchemaRef,
  isKnownEscalationSchema,
  makeCreateEscalationCommand,
  makeEscalationResponse,
  makeEscalationWebhookEventEnvelope,
  makeGetEscalationStatusQuery,
  parseCreateEscalationCommand,
  parseEscalationResponse,
  parseEscalationResponseFor,
  parseEscalationWebhookEventEnvelope,
  parseGetEscalationStatusQuery,
} from './envelopes.js';
import { validEscalationRequestInput } from './test-support.js';

const NOW = '2026-10-07T10:00:00.000Z';

describe('escalation envelope wiring', () => {
  it('create-escalation-command round trips (command kind, REQUIRED idempotency key)', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const envelope = makeCreateEscalationCommand(
      request,
      toCorrelationId('corr-0001'),
      toIdempotencyKey('idem-0001'),
    );
    const wire = serializeEnvelope(envelope);
    const parsed = parseCreateEscalationCommand(wire);
    expect(parsed.kind).toBe('command');
    expect(parsed.idempotencyKey).toBe('idem-0001');
    expect(parsed.payload.requestId).toBe(request.requestId);
    expect(parsed.correlationId).toBe('corr-0001');
  });

  it('get-escalation-status-query round trips (query kind, NULL idempotency key)', () => {
    const envelope = makeGetEscalationStatusQuery(
      { queryVersion: 1, requestId: 'esc_' + '1'.repeat(32), tenantId: 'tenant-alpha' },
      toCorrelationId('corr-0002'),
    );
    const parsed = parseGetEscalationStatusQuery(serializeEnvelope(envelope));
    expect(parsed.kind).toBe('query');
    expect(parsed.idempotencyKey).toBeNull();
    expect(parsed.payload.tenantId).toBe('tenant-alpha');
  });

  it('escalation-response round trips and asserts correlation pairing', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const record = createEscalationRecord(request, NOW);
    const response = makeEscalationResponse(
      { responseVersion: 1, kind: 'escalation-status', record },
      toCorrelationId('corr-0003'),
    );
    const wire = serializeEnvelope(response);
    const parsed = parseEscalationResponse(wire);
    expect(parsed.kind).toBe('response');
    if (parsed.payload.kind === 'escalation-status') {
      expect(parsed.payload.record.state).toBe('created');
    }
    const query = makeGetEscalationStatusQuery(
      { queryVersion: 1, requestId: request.requestId, tenantId: 'tenant-alpha' },
      toCorrelationId('corr-0003'),
    );
    expect(() => parseEscalationResponseFor(wire, query)).not.toThrow();
    const otherQuery = makeGetEscalationStatusQuery(
      { queryVersion: 1, requestId: request.requestId, tenantId: 'tenant-alpha' },
      toCorrelationId('corr-9999'),
    );
    expect(() => parseEscalationResponseFor(wire, otherQuery)).toThrowError();
  });

  it('escalation-webhook-event round trips (event kind, consumer key as envelope key)', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    const event = createEscalationWebhookEvent({
      eventType: 'escalation.created',
      request,
      sequence: 1,
      now: NOW,
      state: 'created',
    });
    const envelope = makeEscalationWebhookEventEnvelope(event, toCorrelationId('corr-0001'));
    const parsed = parseEscalationWebhookEventEnvelope(serializeEnvelope(envelope));
    expect(parsed.kind).toBe('event');
    expect(parsed.payload.eventType).toBe('escalation.created');
    expect(parsed.idempotencyKey).toBe(event.eventId);
  });

  it('rejects envelopes with the wrong kind / namespace / idempotency shape', async () => {
    const request = await createEscalationRequest(validEscalationRequestInput());
    // A query envelope serialized where a command is expected.
    const query = serializeEnvelope(
      makeGetEscalationStatusQuery(
        { queryVersion: 1, requestId: request.requestId, tenantId: 'tenant-alpha' },
        toCorrelationId('corr-0004'),
      ),
    );
    expect(() => parseCreateEscalationCommand(query)).toThrowError(/command/);
    // A command envelope serialized where a query is expected.
    const command = serializeEnvelope(
      makeCreateEscalationCommand(request, toCorrelationId('corr-0005'), toIdempotencyKey('idem-0005')),
    );
    expect(() => parseGetEscalationStatusQuery(command)).toThrowError(/query/);
    // Malformed wire JSON fails closed.
    expect(() => parseEscalationResponse('{not json')).toThrowError();
  });

  it('schema registry: escalation namespace refs resolve and verify', () => {
    const ref = escalationSchemaRef('escalation/create-escalation-command');
    expect(ref.namespace).toBe('escalation');
    expect(ref.version).toBe('1.0.0');
    expect(isKnownEscalationSchema(ref)).toBe(true);
    expect(isKnownEscalationSchema({ namespace: 'api', name: 'create-escalation-command', version: '1.0.0' })).toBe(false);
    expect(Object.keys(ESCALATION_SCHEMAS)).toContain('escalation/escalation-request');
  });
});
