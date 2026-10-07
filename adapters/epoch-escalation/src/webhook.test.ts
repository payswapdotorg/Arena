/**
 * Signed webhook consumption tests (Work Order C019): the at-least-once
 * consumer discipline — signature forgery, stale timestamps, tenant
 * mismatch, duplicate event ids, and the positive verified path.
 */

import { describe, expect, it } from 'vitest';
import {
  createEscalationWebhookEvent,
  makeEscalationWebhookEventEnvelope,
} from '@arena/escalation';
import type { EscalationRequest } from '@arena/escalation';
import { serializeEnvelope } from '@arena/protocol-core';
import {
  consumeEpochWebhook,
  consumeEpochWebhookOrThrow,
  hmacEpochWebhookSigner,
  EPOCH_WEBHOOK_HEADER_NAMES,
  verifyEpochWebhookSignature,
} from './webhook.js';
import { buildEscalationRequest } from './adapter.js';
import { parseEpochIntegrationPosture } from './posture.js';
import { parseEpochEscalationTrigger } from './trigger.js';
import { EPOCH_ESCALATION_ERROR_CODES, EpochEscalationError } from './errors.js';
import { REFERENCE_POSTURE, validTrigger } from './test-support.js';

const POSTURE = parseEpochIntegrationPosture(REFERENCE_POSTURE);
const SIGNER = hmacEpochWebhookSigner({ signingKeyId: 'arena-escalation-key-1', hmacInput: 'epoch-webhook-hmac-input' });
const NOW = Date.parse('2026-10-07T10:05:00.000Z');

async function signedDelivery(): Promise<{
  request: EscalationRequest;
  headers: Record<string, string>;
  body: string;
}> {
  const request = await buildEscalationRequest(parseEpochEscalationTrigger(validTrigger()), POSTURE);
  const event = createEscalationWebhookEvent({
    eventType: 'escalation.created',
    request,
    sequence: 1,
    now: NOW,
    state: 'created',
    data: { state: 'created' },
  });
  const envelope = makeEscalationWebhookEventEnvelope(event, request.correlationId);
  const body = serializeEnvelope(envelope);
  const timestamp = NOW;
  const signature = SIGNER.sign(timestamp, body);
  return {
    request,
    body,
    headers: {
      'content-type': 'application/json',
      [EPOCH_WEBHOOK_HEADER_NAMES.eventId]: event.eventId,
      [EPOCH_WEBHOOK_HEADER_NAMES.timestamp]: String(timestamp),
      [EPOCH_WEBHOOK_HEADER_NAMES.signature]: `v1=${signature}`,
      [EPOCH_WEBHOOK_HEADER_NAMES.signingKeyId]: SIGNER.signingKeyId,
      [EPOCH_WEBHOOK_HEADER_NAMES.tenantId]: request.tenantId,
      [EPOCH_WEBHOOK_HEADER_NAMES.requestId]: request.requestId,
      [EPOCH_WEBHOOK_HEADER_NAMES.sequence]: '1',
      [EPOCH_WEBHOOK_HEADER_NAMES.attempt]: '1',
    },
  };
}

describe('consumeEpochWebhook — the at-least-once consumer discipline', () => {
  it('consumes a correctly signed delivery and returns the typed event', async () => {
    const { headers, body } = await signedDelivery();
    const verdict = consumeEpochWebhook({
      received: { headers, body },
      signer: SIGNER,
      expectedTenantId: 'tenant-alpha',
      now: NOW,
      seenEventIds: new Set<string>(),
    });
    expect(verdict.outcome).toBe('consumed');
    if (verdict.outcome === 'consumed') {
      expect(verdict.event.eventType).toBe('escalation.created');
      expect(verdict.event.tenantId).toBe('tenant-alpha');
    }
  });

  it('rejects a FORGED signature (signature-mismatch)', async () => {
    const { headers, body } = await signedDelivery();
    const forged = { ...headers, [EPOCH_WEBHOOK_HEADER_NAMES.signature]: 'v1=' + 'f'.repeat(64) };
    const verdict = consumeEpochWebhook({
      received: { headers: forged, body },
      signer: SIGNER,
      expectedTenantId: 'tenant-alpha',
      now: NOW,
      seenEventIds: new Set<string>(),
    });
    expect(verdict).toMatchObject({ outcome: 'rejected', reason: 'signature-mismatch' });
  });

  it('rejects a signature signed with DIFFERENT material (forgery via second key)', async () => {
    const { headers, body } = await signedDelivery();
    const attackerSigner = hmacEpochWebhookSigner({
      signingKeyId: 'arena-escalation-key-1',
      hmacInput: 'attacker-knows-the-scheme-not-the-key',
    });
    const verdict = consumeEpochWebhook({
      received: { headers, body },
      signer: attackerSigner,
      expectedTenantId: 'tenant-alpha',
      now: NOW,
      seenEventIds: new Set<string>(),
    });
    expect(verdict).toMatchObject({ outcome: 'rejected', reason: 'signature-mismatch' });
  });

  it('rejects a stale timestamp outside the tolerance window', async () => {
    const { headers, body } = await signedDelivery();
    const verdict = consumeEpochWebhook({
      received: { headers, body },
      signer: SIGNER,
      expectedTenantId: 'tenant-alpha',
      now: NOW + 600_000,
      seenEventIds: new Set<string>(),
    });
    expect(verdict).toMatchObject({ outcome: 'rejected', reason: 'timestamp-mismatch' });
  });

  it('rejects a missing / malformed signature header', async () => {
    const { headers, body } = await signedDelivery();
    const noSignature = { ...headers };
    delete noSignature[EPOCH_WEBHOOK_HEADER_NAMES.signature];
    expect(
      consumeEpochWebhook({
        received: { headers: noSignature, body },
        signer: SIGNER,
        expectedTenantId: 'tenant-alpha',
        now: NOW,
        seenEventIds: new Set<string>(),
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'missing-signature-header' });

    const malformed = { ...headers, [EPOCH_WEBHOOK_HEADER_NAMES.signature]: 'raw-hex-without-prefix' };
    expect(
      consumeEpochWebhook({
        received: { headers: malformed, body },
        signer: SIGNER,
        expectedTenantId: 'tenant-alpha',
        now: NOW,
        seenEventIds: new Set<string>(),
      }),
    ).toMatchObject({ outcome: 'rejected', reason: 'malformed-signature-header' });
  });

  it('rejects a tampered payload (signature covers the body)', async () => {
    const { headers, body } = await signedDelivery();
    const tampered = body.replace('"created"', '"closed"');
    const verdict = consumeEpochWebhook({
      received: { headers, body: tampered },
      signer: SIGNER,
      expectedTenantId: 'tenant-alpha',
      now: NOW,
      seenEventIds: new Set<string>(),
    });
    expect(verdict.outcome).toBe('rejected');
  });

  it('rejects a cross-tenant event (tenant mismatch)', async () => {
    const { headers, body } = await signedDelivery();
    const verdict = consumeEpochWebhook({
      received: { headers, body },
      signer: SIGNER,
      expectedTenantId: 'tenant-beta',
      now: NOW,
      seenEventIds: new Set<string>(),
    });
    expect(verdict).toMatchObject({ outcome: 'rejected', reason: 'tenant-mismatch' });
  });

  it('dedupes on the event id (at-least-once delivery ⇒ idempotent consumption)', async () => {
    const { headers, body } = await signedDelivery();
    const seen = new Set<string>();
    const first = consumeEpochWebhook({
      received: { headers, body },
      signer: SIGNER,
      expectedTenantId: 'tenant-alpha',
      now: NOW,
      seenEventIds: seen,
    });
    expect(first.outcome).toBe('consumed');
    if (first.outcome === 'consumed') seen.add(first.eventId);
    const second = consumeEpochWebhook({
      received: { headers, body },
      signer: SIGNER,
      expectedTenantId: 'tenant-alpha',
      now: NOW,
      seenEventIds: seen,
    });
    expect(second).toMatchObject({ outcome: 'rejected', reason: 'duplicate-event' });
  });

  it('rejects an invalid event envelope body', async () => {
    const timestamp = NOW;
    const body = JSON.stringify({ not: 'an-escalation-event' });
    const signature = SIGNER.sign(timestamp, body);
    const verdict = consumeEpochWebhook({
      received: {
        headers: {
          [EPOCH_WEBHOOK_HEADER_NAMES.eventId]: 'evt_11111111111111111111111111111111',
          [EPOCH_WEBHOOK_HEADER_NAMES.timestamp]: String(timestamp),
          [EPOCH_WEBHOOK_HEADER_NAMES.signature]: `v1=${signature}`,
        },
        body,
      },
      signer: SIGNER,
      expectedTenantId: 'tenant-alpha',
      now: NOW,
      seenEventIds: new Set<string>(),
    });
    expect(verdict).toMatchObject({ outcome: 'rejected', reason: 'invalid-event-envelope' });
  });

  it('the throwing variant surfaces typed errors', async () => {
    const { headers, body } = await signedDelivery();
    expect(() =>
      consumeEpochWebhookOrThrow({
        received: { headers: { ...headers, [EPOCH_WEBHOOK_HEADER_NAMES.signature]: `v1=${'0'.repeat(64)}` }, body },
        signer: SIGNER,
        expectedTenantId: 'tenant-alpha',
        now: NOW,
        seenEventIds: new Set<string>(),
      }),
    ).toThrowError(EpochEscalationError);
    try {
      consumeEpochWebhookOrThrow({
        received: { headers: { ...headers, [EPOCH_WEBHOOK_HEADER_NAMES.signature]: `v1=${'0'.repeat(64)}` }, body },
        signer: SIGNER,
        expectedTenantId: 'tenant-alpha',
        now: NOW,
        seenEventIds: new Set<string>(),
      });
    } catch (error) {
      expect((error as EpochEscalationError).code).toBe(EPOCH_ESCALATION_ERROR_CODES.WEBHOOK_SIGNATURE_REJECTED);
    }
  });

  it('verifyEpochWebhookSignature is reusable standalone (machine-readable verdict)', async () => {
    const { headers, body } = await signedDelivery();
    const timestamp = Number(headers[EPOCH_WEBHOOK_HEADER_NAMES.timestamp] ?? '');
    expect(
      verifyEpochWebhookSignature({
        signer: SIGNER,
        timestamp,
        payload: body,
        signatureHeader: headers[EPOCH_WEBHOOK_HEADER_NAMES.signature] ?? '',
        now: NOW,
      }),
    ).toBeNull();
    expect(
      verifyEpochWebhookSignature({
        signer: SIGNER,
        timestamp,
        payload: body,
        signatureHeader: 'v1=deadbeef',
        now: NOW,
      }),
    ).toBe('signature-mismatch');
  });
});
