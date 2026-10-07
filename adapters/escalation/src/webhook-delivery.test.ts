/**
 * Signed webhook delivery adapter tests (Work Order C001): delivery with
 * valid signatures, deterministic retry/backoff, explicit dead-letter
 * state, at-least-once duplicates, consumer-side verification.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEBHOOK_BACKOFF,
  WEBHOOK_HEADER_NAMES,
  WebhookDeliveryAdapter,
  hmacSha256WebhookSigner,
  verifyWebhookSignature,
} from './webhook-delivery.js';
import type { WebhookPendingDelivery } from './webhook-delivery.js';
import { FixedClock, InMemoryOutboxDouble, InMemoryWebhookDeliveryLedger, InMemoryWebhookTransport } from './test-support.js';

const NOW = Date.parse('2026-10-07T11:00:00.000Z');

function fixtureDelivery(overrides: Partial<WebhookPendingDelivery> = {}): WebhookPendingDelivery {
  return {
    eventId: 'evt-0001',
    requestId: 'req-0001',
    tenantId: 'tenant-alpha',
    sequence: 1,
    payload: '{"v":1,"kind":"event","payload":{"eventId":"evt-0001","eventType":"escalation.created"}}',
    createdAt: NOW,
    ...overrides,
  };
}

function makeAdapter(options: {
  delivery?: WebhookPendingDelivery;
  maxAttempts?: number;
  baseDelayMs?: number;
  multiplier?: number;
} = {}) {
  const source = new InMemoryOutboxDouble();
  source.add(options.delivery ?? fixtureDelivery());
  const transport = new InMemoryWebhookTransport();
  const ledger = new InMemoryWebhookDeliveryLedger();
  const clock = new FixedClock(NOW);
  const signer = hmacSha256WebhookSigner({ signingKeyId: 'wh-2026-10', hmacInput: 'injected-material' });
  const adapter = new WebhookDeliveryAdapter({
    source,
    endpoint: { url: 'https://client.example/hooks/arena' },
    signer,
    transport,
    clock,
    ledger,
    backoff: {
      maxAttempts: options.maxAttempts,
      baseDelayMs: options.baseDelayMs,
      multiplier: options.multiplier,
    },
  });
  return { source, transport, ledger, clock, signer, adapter };
}

describe('WebhookDeliveryAdapter — signed delivery', () => {
  it('delivers a pending event once with signed, consumer-dedupeable headers', async () => {
    const { adapter, transport, ledger, signer } = makeAdapter();
    const report = await adapter.deliverPending();

    expect(report.outcome).toBe('swept');
    expect(report.deliveredCount).toBe(1);
    expect(report.deadLetteredCount).toBe(0);
    expect(transport.posts).toHaveLength(1);
    const post = transport.posts[0]!;
    expect(post.url).toBe('https://client.example/hooks/arena');
    expect(post.headers['content-type']).toBe('application/json');
    expect(post.headers[WEBHOOK_HEADER_NAMES.eventId]).toBe('evt-0001');
    expect(post.headers[WEBHOOK_HEADER_NAMES.signingKeyId]).toBe('wh-2026-10');
    expect(post.headers[WEBHOOK_HEADER_NAMES.attempt]).toBe('1');
    expect(post.body).toBe(fixtureDelivery().payload);
    const timestamp = Number(post.headers[WEBHOOK_HEADER_NAMES.timestamp]!);
    expect(
      verifyWebhookSignature({
        signer,
        timestamp,
        payload: post.body,
        signatureHeader: post.headers[WEBHOOK_HEADER_NAMES.signature]!,
        now: timestamp,
      }),
    ).toEqual({ outcome: 'verified' });
    const attempts = await ledger.attemptsFor('evt-0001');
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.outcome).toBe('delivered');
    expect(attempts[0]!.scheduledRetryAt).toBeNull();
  });

  it('a delivered event leaves the pending set — re-sweep is a no-op', async () => {
    const { adapter, transport } = makeAdapter();
    await adapter.deliverPending();
    const second = await adapter.deliverPending();
    expect(second.pendingConsidered).toBe(0);
    expect(second.deliveredCount).toBe(0);
    expect(transport.posts).toHaveLength(1);
  });

  it('fails closed on construction without an outbox source', () => {
    const { source, ...rest } = makeAdapter();
    void source;
    expect(
      () =>
        new WebhookDeliveryAdapter({
          source: undefined as unknown as never,
          endpoint: rest.adapter.endpoint,
          signer: rest.signer,
          transport: rest.transport,
          clock: rest.clock,
          ledger: rest.ledger,
        }),
    ).toThrow(/requires an outbox source/);
  });
});

describe('WebhookDeliveryAdapter — retry with deterministic backoff', () => {
  it('retries a failing endpoint and delivers on a later attempt', async () => {
    const { adapter, transport, ledger } = makeAdapter();
    transport.failuresRemaining = 2;
    const report = await adapter.deliverPending();

    expect(report.deliveredCount).toBe(1);
    expect(transport.posts).toHaveLength(3);
    const attempts = await ledger.attemptsFor('evt-0001');
    expect(attempts.map((a) => a.outcome)).toEqual(['failed', 'failed', 'delivered']);
    // deterministic backoff: attempt n scheduled at t + base * mult^(n-1)
    expect(attempts[0]!.scheduledRetryAt).toBe(NOW + DEFAULT_WEBHOOK_BACKOFF.baseDelayMs);
    expect(attempts[1]!.scheduledRetryAt).toBe(NOW + DEFAULT_WEBHOOK_BACKOFF.baseDelayMs * 2);
    expect(attempts[2]!.scheduledRetryAt).toBeNull();
    expect(attempts.map((a) => a.httpStatus)).toEqual([500, 500, 200]);
  });

  it('a thrown transport error is one failed attempt — never a crash', async () => {
    const { adapter, transport, ledger } = makeAdapter({ maxAttempts: 2 });
    transport.throwNext = true;
    const report = await adapter.deliverPending();
    expect(report.outcome).toBe('swept');
    const attempts = await ledger.attemptsFor('evt-0001');
    expect(attempts[0]!.httpStatus).toBeNull();
    expect(attempts[0]!.outcome).toBe('failed');
  });

  it('delayForAttempt is the deterministic exponential schedule', () => {
    const { adapter } = makeAdapter({ baseDelayMs: 1000, multiplier: 2 });
    expect([1, 2, 3, 4].map((n) => adapter.delayForAttempt(n))).toEqual([1000, 2000, 4000, 8000]);
  });
});

describe('WebhookDeliveryAdapter — explicit dead-letter state', () => {
  it('exhausted deliveries dead-letter with a full audit record and are skipped afterwards', async () => {
    const { adapter, transport, ledger } = makeAdapter({ maxAttempts: 3 });
    transport.failuresRemaining = Number.POSITIVE_INFINITY;
    const report = await adapter.deliverPending();
    expect(report.deliveredCount).toBe(0);
    expect(report.deadLetteredCount).toBe(1);
    expect(transport.posts).toHaveLength(3);

    const deadLetters = await ledger.listDeadLetters();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0]).toMatchObject({
      eventId: 'evt-0001',
      requestId: 'req-0001',
      tenantId: 'tenant-alpha',
      url: 'https://client.example/hooks/arena',
      attempts: 3,
      lastHttpStatus: 500,
    });

    // second sweep: dead-lettered events are skipped, never re-fired
    const second = await adapter.deliverPending();
    expect(second.skippedCount).toBe(1);
    expect(second.deadLetteredCount).toBe(0);
    expect(transport.posts).toHaveLength(3);
  });
});

describe('WebhookDeliveryAdapter — at-least-once semantics', () => {
  it('an un-acked delivery re-fires with the SAME consumer dedupe key', async () => {
    const { adapter, source, transport } = makeAdapter();
    source.ignoreMarkDelivered = true; // crash between POST and ack
    await adapter.deliverPending();
    await adapter.deliverPending();
    expect(transport.posts).toHaveLength(2);
    const [first, second] = transport.posts;
    // the eventId header is the idempotent consumer key — stable across
    // duplicate deliveries (timestamps/signatures differ, keys do not)
    expect(second!.headers[WEBHOOK_HEADER_NAMES.eventId]).toBe(first!.headers[WEBHOOK_HEADER_NAMES.eventId]);
    expect(second!.body).toBe(first!.body);
  });
});

describe('verifyWebhookSignature — consumer-side verification verdicts', () => {
  const signer = hmacSha256WebhookSigner({ signingKeyId: 'wh-2026-10', hmacInput: 'injected-material' });
  const payload = fixtureDelivery().payload;
  const timestamp = NOW;
  const signatureHeader = `v1=${signer.sign(timestamp, payload)}`;

  it('accepts a genuine delivery', () => {
    expect(
      verifyWebhookSignature({ signer, timestamp, payload, signatureHeader, now: timestamp }),
    ).toEqual({ outcome: 'verified' });
  });

  it('rejects a tampered payload with signature-mismatch', () => {
    expect(
      verifyWebhookSignature({
        signer,
        timestamp,
        payload: payload.replace('escalation.created', 'escalation.completed'),
        signatureHeader,
        now: timestamp,
      }),
    ).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });
  });

  it('rejects a malformed signature header', () => {
    expect(
      verifyWebhookSignature({ signer, timestamp, payload, signatureHeader: 'nope', now: timestamp }),
    ).toEqual({ outcome: 'rejected', reason: 'malformed-signature-header' });
  });

  it('rejects a stale timestamp outside tolerance', () => {
    expect(
      verifyWebhookSignature({
        signer,
        timestamp,
        payload,
        signatureHeader,
        now: timestamp + 300_001,
        toleranceMs: 300_000,
      }),
    ).toEqual({ outcome: 'rejected', reason: 'timestamp-mismatch' });
  });
});
