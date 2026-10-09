/**
 * tests/security/production/ac04-webhook-forgery.test.ts — AC-04 webhook
 * forgery and replay (Work Order P007 integrated pass; issue #159).
 *
 * "webhook forgery (bad signature, replayed signature, missing headers)
 * + cross-event replay" — attacks the REAL signed delivery path: the
 * REAL webhook-delivery service draining the REAL durable outbox over
 * the REAL embedded Postgres engine into a REAL HTTP receiver, plus the
 * consumer-side verification contract (verifyWebhookSignature).
 *
 * Attacks (beyond the P003 acceptance negatives — these are the
 * adversarial variants the threat model's AC-04 vectors name):
 *   - bad signature: flipped digest bits, wrong-length digest, garbage;
 *   - REPLAYED signature: a valid signature for event A replayed against
 *     event B's payload (cross-event signature swap) and against a
 *     tampered variant of its own payload;
 *   - missing headers: absent signature / timestamp / event-id headers;
 *   - stale-but-valid signature replay (outside tolerance);
 *   - cross-event replay at the OUTBOX level: duplicate event-id append
 *     must be rejected by the durable outbox (per-EVENT dedupe, never
 *     per type — the R-032 law);
 *   - redelivery-after-restart: a new composition over the same durable
 *     store re-drains WITHOUT re-delivering already-delivered events.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyWebhookSignature, WEBHOOK_HEADER_NAMES } from '@arena/escalation-adapters';
import {
  bootAdversarialBattery,
  createBody,
  json,
  postJson,
  WebhookReceiver,
  webhookDelivery,
} from './support/adversarial-harness.js';
import type { AdversarialBattery } from './support/adversarial-harness.js';

let battery: AdversarialBattery;

beforeEach(async () => {
  battery = await bootAdversarialBattery();
});

afterEach(async () => {
  await battery.close();
});

function key(tenantId = 'tenant-alpha'): Record<string, string> {
  const issuance = battery.keys.issue({ tenantId });
  return { authorization: `Bearer ${issuance.secret}` };
}

/** Deliver the current outbox into the receiver and return the receiver. */
async function deliverAll(receiver: WebhookReceiver, url: string) {
  const delivery = webhookDelivery(battery, url, {
    backoff: { maxAttempts: 2, baseDelayMs: 1, multiplier: 1 },
  });
  const report = await delivery.deliverPending();
  return report;
}

describe('AC-04 — signature forgery against the consumer verification contract', () => {
  it('the REAL delivery is verifiable, then every forged variant is rejected typed', async () => {
    const receiver = new WebhookReceiver();
    const handle = await receiver.start();
    try {
      const auth = key();
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac04-1', correlationId: 'corr-ac04-1' }),
        auth,
      );
      const report = await deliverAll(receiver, handle.url);
      expect(report.deliveredCount).toBeGreaterThanOrEqual(3);
      expect(receiver.deliveries.length).toBeGreaterThanOrEqual(3);

      // Every REAL delivery verifies through the consumer contract.
      for (const seen of receiver.deliveries) {
        const verification = verifyWebhookSignature({
          signer: battery.signer,
          timestamp: Number(seen.headers[WEBHOOK_HEADER_NAMES.timestamp]),
          payload: seen.body,
          signatureHeader: String(seen.headers[WEBHOOK_HEADER_NAMES.signature]),
          now: battery.clock.now(),
        });
        expect(verification).toEqual({ outcome: 'verified' });
      }

      const victim = receiver.deliveries[0];
      expect(victim).toBeDefined();
      const payload = victim?.body ?? '';
      const timestamp = Number(victim?.headers[WEBHOOK_HEADER_NAMES.timestamp]);
      const signature = String(victim?.headers[WEBHOOK_HEADER_NAMES.signature]);

      // (1) BAD signature — flipped digest bits.
      const flipped = signature.replace(/(?<=v1=)(.)/, (ch) => (ch === 'a' ? 'b' : 'a'));
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload,
          signatureHeader: flipped,
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });

      // (2) BAD signature — wrong length (truncated digest).
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload,
          signatureHeader: 'v1=deadbeef',
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });

      // (3) MISSING headers — absent signature header (string-cast of
      // undefined is the transport reality of a stripped delivery).
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload,
          signatureHeader: String(undefined),
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'malformed-signature-header' });
      // Empty-string header (a header present but valueless).
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload,
          signatureHeader: '',
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'malformed-signature-header' });

      // (4) REPLAYED signature against a TAMPERED payload variant of the
      // same event (the classic capture-and-modify replay).
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp,
          payload: `${payload.slice(0, -3)}xx}`,
          signatureHeader: signature,
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });

      // (5) STALE-but-valid replay: correctly signed for an old timestamp,
      // replayed outside the 300 000 ms tolerance.
      const staleTimestamp = timestamp - 301_000;
      const staleSignature = `v1=${battery.signer.sign(staleTimestamp, payload)}`;
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp: staleTimestamp,
          payload,
          signatureHeader: staleSignature,
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'timestamp-mismatch' });
    } finally {
      await handle.close();
    }
  });

  it('CROSS-EVENT replay: event A\'s valid signature never verifies event B\'s payload', async () => {
    const receiver = new WebhookReceiver();
    const handle = await receiver.start();
    try {
      const auth = key();
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac04-x', correlationId: 'corr-ac04-x' }),
        auth,
      );
      await deliverAll(receiver, handle.url);
      expect(receiver.deliveries.length).toBeGreaterThanOrEqual(3);

      const first = receiver.deliveries[0];
      const second = receiver.deliveries[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();

      // Cross-event signature swap: A's signature + timestamp over B's
      // payload fails the HMAC compare (the signature binds payload bytes).
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp: Number(first?.headers[WEBHOOK_HEADER_NAMES.timestamp]),
          payload: second?.body ?? '',
          signatureHeader: String(first?.headers[WEBHOOK_HEADER_NAMES.signature]),
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });

      // The REVERSE swap also fails.
      expect(
        verifyWebhookSignature({
          signer: battery.signer,
          timestamp: Number(second?.headers[WEBHOOK_HEADER_NAMES.timestamp]),
          payload: first?.body ?? '',
          signatureHeader: String(second?.headers[WEBHOOK_HEADER_NAMES.signature]),
          now: battery.clock.now(),
        }),
      ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });

      // The consumer's dedupe discipline keys on x-arena-event-id: every
      // REAL delivery carries a DISTINCT event id (per-EVENT dedupe never
      // suppresses a legitimately distinct event — R-032).
      const eventIds = receiver.deliveries.map((seen) =>
        String(seen.headers[WEBHOOK_HEADER_NAMES.eventId]),
      );
      expect(new Set(eventIds).size).toBe(eventIds.length);
      // The full header set is present on every delivery (no stripped
      // delivery sneaks through with missing headers).
      for (const seen of receiver.deliveries) {
        expect(seen.headers[WEBHOOK_HEADER_NAMES.eventId]).toBeDefined();
        expect(seen.headers[WEBHOOK_HEADER_NAMES.timestamp]).toBeDefined();
        expect(seen.headers[WEBHOOK_HEADER_NAMES.signature]).toBeDefined();
        expect(seen.headers[WEBHOOK_HEADER_NAMES.signingKeyId]).toBe('p007-adversarial-signer');
        expect(String(seen.headers[WEBHOOK_HEADER_NAMES.signature]).startsWith('v1=')).toBe(true);
      }
    } finally {
      await handle.close();
    }
  });
});

describe('AC-04 — cross-event replay at the DURABLE OUTBOX (duplicate event id)', () => {
  it('appending a duplicate event id to the durable outbox fails closed typed', async () => {
    const auth = key();
    const created = await postJson(
      `${battery.baseUrl}/v1/escalations`,
      createBody({ idempotencyKey: 'idem-ac04-dup', correlationId: 'corr-ac04-dup' }),
      auth,
    );
    expect(created.status).toBe(201);
    const pending = await battery.durable.webhookOutbox.listPending();
    expect(pending.length).toBeGreaterThanOrEqual(3);
    const victim = pending[0];

    // THE ATTACK: replay a captured (event, envelope) pair verbatim into
    // the outbox — the durable outbox must reject the duplicate event id
    // (per-EVENT dedupe; never per type). A successful double-append
    // would let a replayed lifecycle event double-act on the consumer.
    const record = victim as unknown as Record<string, unknown>;
    const event = {
      eventVersion: record['eventVersion'],
      eventId: record['eventId'],
      requestId: record['requestId'],
      tenantId: record['tenantId'],
      eventType: record['eventType'],
      sequence: record['sequence'],
      occurredAt: record['occurredAt'],
      data: record['payload'] ?? record['data'],
    };
    const envelope = {
      envelopeVersion: 1,
      id: `envl_replayed_${String(record['eventId'])}`,
      correlationId: 'corr-ac04-dup',
      causationId: null,
      issuedAt: new Date(battery.clock.now()).toISOString(),
      payload: event,
    };
    let duplicateRejected = false;
    let duplicateCode = '';
    try {
      await battery.durable.webhookOutbox.append(
        event as never,
        envelope as never,
      );
    } catch (error) {
      duplicateRejected = true;
      duplicateCode = (error as { code?: string }).code ?? '';
    }
    expect(duplicateRejected).toBe(true);
    expect(duplicateCode.length).toBeGreaterThan(0);
    // The rejection is TYPED (machine-readable) — either the escalation
    // code set's INVALID_EVENT family or the persistence fail-closed set.
    expect(
      duplicateCode.startsWith('ESCALATION_') || duplicateCode.startsWith('PERSISTENCE_'),
    ).toBe(true);

    // The outbox is unchanged by the failed attack (no phantom rows).
    const after = await battery.durable.webhookOutbox.listPending();
    expect(after.length).toBe(pending.length);
    const eventIds = after.map((delivery) => delivery.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);
  });
});

describe('AC-04 — redelivery-after-restart (the outbox is the durable substrate)', () => {
  it('a NEW composition over the same durable store re-drains WITHOUT re-delivering delivered events', async () => {
    const receiver = new WebhookReceiver();
    const handle = await receiver.start();
    try {
      const auth = key();
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac04-restart', correlationId: 'corr-ac04-restart' }),
        auth,
      );
      const pending = await battery.durable.webhookOutbox.listPending();
      expect(pending.length).toBeGreaterThanOrEqual(3);

      // Deliver everything once (the "before the crash" drain).
      const first = await deliverAll(receiver, handle.url);
      expect(first.deliveredCount).toBe(pending.length);
      const deliveredEventIds = new Set(
        receiver.deliveries.map((seen) => String(seen.headers[WEBHOOK_HEADER_NAMES.eventId])),
      );
      expect(deliveredEventIds.size).toBe(pending.length);

      // Emit MORE events after the first drain (a new escalation), then
      // "restart": a NEW webhook-delivery composition over the SAME
      // durable outbox (the process-death approximation — the P002 house
      // definition of a hard restart).
      await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac04-restart-2', correlationId: 'corr-ac04-restart-2' }),
        auth,
      );
      const secondDelivery = webhookDelivery(battery, handle.url, {
        backoff: { maxAttempts: 2, baseDelayMs: 1, multiplier: 1 },
      });
      const restartSweep = await secondDelivery.deliverPending();

      // Only the NEW (undelivered) events are considered — every
      // delivered event stays delivered across the restart boundary
      // (no duplicate delivery of already-consumed lifecycle events).
      expect(restartSweep.pendingConsidered).toBeLessThanOrEqual(
        (await battery.durable.webhookOutbox.listAll()).length - pending.length,
      );
      for (const seen of receiver.deliveries.slice(pending.length)) {
        const eventId = String(seen.headers[WEBHOOK_HEADER_NAMES.eventId]);
        expect(deliveredEventIds.has(eventId)).toBe(false);
      }
      const allEventIds = receiver.deliveries.map((seen) =>
        String(seen.headers[WEBHOOK_HEADER_NAMES.eventId]),
      );
      expect(new Set(allEventIds).size).toBe(allEventIds.length);

      // Every post-restart delivery STILL verifies (fresh signatures for
      // the fresh attempts — a restarted drainer never replays a stale
      // signature).
      for (const seen of receiver.deliveries.slice(pending.length)) {
        const verification = verifyWebhookSignature({
          signer: battery.signer,
          timestamp: Number(seen.headers[WEBHOOK_HEADER_NAMES.timestamp]),
          payload: seen.body,
          signatureHeader: String(seen.headers[WEBHOOK_HEADER_NAMES.signature]),
          now: battery.clock.now(),
        });
        expect(verification).toEqual({ outcome: 'verified' });
      }
    } finally {
      await handle.close();
    }
  });
});
