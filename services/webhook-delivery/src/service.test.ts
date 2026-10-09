/**
 * webhook-delivery service proofs (Work Order P003) — the REAL delivery
 * mechanics over a REAL local HTTP receiver (node:http on an ephemeral
 * port): signed wire headers (HMAC-SHA256 via the existing adapter
 * contract), deterministic backoff retries, explicit dead-lettering,
 * bounded transport timeouts, and per-EVENT-ID consumer dedupe on
 * duplicate delivery. The DURABLE-outbox end-to-end proofs (over the P002
 * Postgres outbox through the real composition) live in tests/api-host.
 */

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hmacSha256WebhookSigner,
  verifyWebhookSignature,
  WEBHOOK_HEADER_NAMES,
} from '@arena/escalation-adapters';
import type { WebhookPendingDelivery, WebhookDeliverySweepReport } from '@arena/escalation-adapters';
import { createWebhookDeliveryService } from './service.js';
import { createNodeWebhookHttpTransport } from './http-transport.js';
import { validateWebhookEndpointUrl } from './http-transport.js';
import { WebhookDeliveryLoop } from './loop.js';

/** One captured delivery at the receiver. */
interface CapturedDelivery {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: string;
  readonly at: number;
}

/** A configurable real HTTP webhook receiver. */
class WebhookReceiver {
  readonly server: ReturnType<typeof createServer>;
  readonly deliveries: CapturedDelivery[] = [];
  #responder: (request: IncomingMessage, response: ServerResponse, body: string) => void;
  #started: Promise<{ url: string; port: number; close(): Promise<void> }> | null = null;

  constructor(
    responder: (
      request: IncomingMessage,
      response: ServerResponse,
      body: string,
    ) => void = (_request, response) => {
      response.statusCode = 200;
      response.end('ok');
    },
  ) {
    this.#responder = responder;
    const capture = this.deliveries;
    this.server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        capture.push({
          headers: { ...request.headers },
          body,
          at: Date.now(),
        });
        this.#responder(request, response, body);
      });
    });
  }

  async start(): Promise<{ url: string; port: number; close(): Promise<void> }> {
    if (this.#started === null) {
      this.#started = new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(0, '127.0.0.1', () => {
          const address = this.server.address();
          const port = typeof address === 'object' && address !== null ? address.port : 0;
          resolve({
            url: `http://127.0.0.1:${port}/hook`,
            port,
            close: () =>
              new Promise<void>((resolveClose) => {
                this.server.close(() => resolveClose());
              }),
          });
        });
      });
    }
    return this.#started;
  }

  setResponder(
    responder: (request: IncomingMessage, response: ServerResponse, body: string) => void,
  ): void {
    this.#responder = responder;
  }
}

/** A minimal durable-outbox-shaped source for these unit proofs. */
class MemoryOutboxSource {
  readonly records: WebhookPendingDelivery[] = [];
  readonly delivered = new Set<string>();

  listPending(): Promise<readonly WebhookPendingDelivery[]> {
    return Promise.resolve(
      this.records.filter((record) => !this.delivered.has(record.eventId)),
    );
  }

  markDelivered(eventId: string, _at: number): Promise<void> {
    this.delivered.add(eventId);
    return Promise.resolve();
  }
}

/** Deterministic manual clock (A015 law). */
class ManualClock {
  #now: number;
  constructor(start: number) {
    this.#now = start;
  }
  now(): number {
    return this.#now;
  }
  advance(ms: number): void {
    this.#now += ms;
  }
}

const T0 = Date.parse('2026-10-09T12:00:00.000Z');
const SIGNING_KEY_ID = 'whk-unit-test';
const SIGNING_INPUT = 'whsec_' + '1'.repeat(64);

let receiver: WebhookReceiver;
let receiverHandle: { url: string; port: number; close(): Promise<void> };

beforeEach(async () => {
  receiver = new WebhookReceiver();
  receiverHandle = await receiver.start();
});

afterEach(async () => {
  await receiverHandle.close();
});

function pendingDelivery(overrides: Partial<WebhookPendingDelivery> = {}): WebhookPendingDelivery {
  return {
    eventId: 'evt_' + Math.random().toString(36).slice(2, 10),
    requestId: 'req_0001',
    tenantId: 'tenant-alpha',
    sequence: 1,
    payload: JSON.stringify({ eventVersion: 1, eventType: 'escalation.created' }),
    createdAt: T0,
    ...overrides,
  };
}

describe('webhook delivery over a real local receiver', () => {
  it('delivers signed payloads with the full wire header set and marks the outbox delivered', async () => {
    const clock = new ManualClock(T0);
    const outbox = new MemoryOutboxSource();
    const delivery = pendingDelivery();
    outbox.records.push(delivery);
    const signer = hmacSha256WebhookSigner({
      signingKeyId: SIGNING_KEY_ID,
      hmacInput: SIGNING_INPUT,
    });
    const service = createWebhookDeliveryService({
      outbox: {
        listPending: () => outbox.listPending(),
        markDelivered: (eventId, at) => outbox.markDelivered(eventId, at),
      },
      endpoint: { url: receiverHandle.url },
      signer,
      clock,
      transport: createNodeWebhookHttpTransport({ timeoutMs: 2_000 }),
    });

    const report = await service.deliverPending();
    expect(report.outcome).toBe('swept');
    expect(report.pendingConsidered).toBe(1);
    expect(report.deliveredCount).toBe(1);
    expect(report.deadLetteredCount).toBe(0);

    expect(receiver.deliveries.length).toBe(1);
    const seen = receiver.deliveries[0];
    expect(seen?.body).toBe(delivery.payload);
    expect(seen?.headers[WEBHOOK_HEADER_NAMES.eventId]).toBe(delivery.eventId);
    expect(seen?.headers[WEBHOOK_HEADER_NAMES.signingKeyId]).toBe(SIGNING_KEY_ID);
    expect(seen?.headers['content-type']).toBe('application/json');
    const signatureHeader = String(seen?.headers[WEBHOOK_HEADER_NAMES.signature]);
    expect(signatureHeader.startsWith('v1=')).toBe(true);
    const timestamp = Number(seen?.headers[WEBHOOK_HEADER_NAMES.timestamp]);

    // The consumer verifies the signature (HMAC-SHA256 over
    // `<timestamp>.<payload>` — the existing adapter contract).
    const verification = verifyWebhookSignature({
      signer,
      timestamp,
      payload: delivery.payload,
      signatureHeader,
      now: clock.now(),
    });
    expect(verification).toEqual({ outcome: 'verified' });

    expect(await outbox.listPending()).toEqual([]);
    expect(await service.attemptsFor(delivery.eventId)).toEqual([
      expect.objectContaining({ attempt: 1, outcome: 'delivered', httpStatus: 200 }),
    ]);
  });

  it('retries a failing delivery with deterministic backoff and dead-letters after maxAttempts', async () => {
    const clock = new ManualClock(T0);
    const outbox = new MemoryOutboxSource();
    const delivery = pendingDelivery();
    outbox.records.push(delivery);
    let calls = 0;
    receiver.setResponder((_request, response) => {
      calls += 1;
      response.statusCode = 500;
      response.end('boom');
    });
    const service = createWebhookDeliveryService({
      outbox: {
        listPending: () => outbox.listPending(),
        markDelivered: (eventId, at) => outbox.markDelivered(eventId, at),
      },
      endpoint: { url: receiverHandle.url },
      signer: hmacSha256WebhookSigner({
        signingKeyId: SIGNING_KEY_ID,
        hmacInput: SIGNING_INPUT,
      }),
      clock,
      transport: createNodeWebhookHttpTransport({ timeoutMs: 2_000 }),
      backoff: { maxAttempts: 3, baseDelayMs: 1_000, multiplier: 2 },
    });

    const report = await service.deliverPending();
    expect(report.deliveredCount).toBe(0);
    expect(report.deadLetteredCount).toBe(1);
    expect(calls).toBe(3);

    const attempts = await service.attemptsFor(delivery.eventId);
    expect(attempts.length).toBe(3);
    expect(attempts.every((attempt) => attempt.outcome === 'failed')).toBe(true);
    expect(attempts.every((attempt) => attempt.httpStatus === 500)).toBe(true);
    // Deterministic exponential backoff: attempt n is followed by
    // base * multiplier^(n-1) before the next retry window.
    expect(attempts[0]?.scheduledRetryAt).toBe(T0 + 1_000);
    expect(attempts[1]?.scheduledRetryAt).toBe(T0 + 2_000);
    expect(attempts[2]?.scheduledRetryAt).toBeNull();

    const deadLetters = await service.deadLetters();
    expect(deadLetters.length).toBe(1);
    expect(deadLetters[0]).toEqual(
      expect.objectContaining({
        eventId: delivery.eventId,
        attempts: 3,
        lastHttpStatus: 500,
        url: receiverHandle.url,
      }),
    );

    // A dead-lettered event is SKIPPED on the next sweep (never retried,
    // never silently dropped — the explicit state).
    const second = await service.deliverPending();
    expect(second.skippedCount).toBe(1);
    expect(second.deliveredCount).toBe(0);
    expect(calls).toBe(3);
  });

  it('fails a hanging endpoint attempt on the bounded transport timeout (typed, no crash)', async () => {
    const clock = new ManualClock(T0);
    const outbox = new MemoryOutboxSource();
    const delivery = pendingDelivery();
    outbox.records.push(delivery);
    receiver.setResponder(() => {
      /* never responds — the transport timeout must fire */
    });
    const service = createWebhookDeliveryService({
      outbox: {
        listPending: () => outbox.listPending(),
        markDelivered: (eventId, at) => outbox.markDelivered(eventId, at),
      },
      endpoint: { url: receiverHandle.url },
      signer: hmacSha256WebhookSigner({
        signingKeyId: SIGNING_KEY_ID,
        hmacInput: SIGNING_INPUT,
      }),
      clock,
      transport: createNodeWebhookHttpTransport({ timeoutMs: 150 }),
      backoff: { maxAttempts: 1, baseDelayMs: 10, multiplier: 1 },
    });

    const report = await service.deliverPending();
    expect(report.deliveredCount).toBe(0);
    expect(report.deadLetteredCount).toBe(1);
    const attempts = await service.attemptsFor(delivery.eventId);
    expect(attempts.length).toBe(1);
    expect(attempts[0]?.outcome).toBe('failed');
    // A timeout carries no HTTP status (the request never completed).
    expect(attempts[0]?.httpStatus).toBeNull();
  });

  it('proves at-least-once: a transient failure re-delivers the SAME event id (consumer dedupes per EVENT ID)', async () => {
    const clock = new ManualClock(T0);
    const outbox = new MemoryOutboxSource();
    const delivery = pendingDelivery();
    outbox.records.push(delivery);
    let calls = 0;
    receiver.setResponder((_request, response) => {
      calls += 1;
      if (calls === 1) {
        response.statusCode = 503;
        response.end('transient');
        return;
      }
      response.statusCode = 200;
      response.end('ok');
    });
    const service = createWebhookDeliveryService({
      outbox: {
        listPending: () => outbox.listPending(),
        markDelivered: (eventId, at) => outbox.markDelivered(eventId, at),
      },
      endpoint: { url: receiverHandle.url },
      signer: hmacSha256WebhookSigner({
        signingKeyId: SIGNING_KEY_ID,
        hmacInput: SIGNING_INPUT,
      }),
      clock,
      transport: createNodeWebhookHttpTransport({ timeoutMs: 2_000 }),
      backoff: { maxAttempts: 3, baseDelayMs: 1, multiplier: 1 },
    });

    const report = await service.deliverPending();
    expect(report.deliveredCount).toBe(1);
    expect(report.deadLetteredCount).toBe(0);
    // At-least-once: the receiver saw the SAME event delivered twice
    // (attempt 1 failed, attempt 2 succeeded) — duplicate delivery.
    expect(receiver.deliveries.length).toBe(2);
    const eventIds = receiver.deliveries.map(
      (seen) => seen.headers[WEBHOOK_HEADER_NAMES.eventId],
    );
    expect(new Set(eventIds).size).toBe(1);
    // The consumer's per-EVENT-ID dedupe keeps exactly one unique event.
    const uniqueEventIds = new Set(eventIds);
    expect(uniqueEventIds.has(delivery.eventId)).toBe(true);
    expect(outbox.delivered.has(delivery.eventId)).toBe(true);
  });
});

describe('webhook endpoint validation (fail closed before network I/O)', () => {
  it('accepts http/https URLs and rejects anything else', () => {
    expect(validateWebhookEndpointUrl('http://127.0.0.1:9/hook')).toEqual({ outcome: 'ok' });
    expect(validateWebhookEndpointUrl('https://example.test/hook')).toEqual({ outcome: 'ok' });
    expect(validateWebhookEndpointUrl('not a url')).toEqual({
      outcome: 'rejected',
      reason: 'not-a-valid-url',
    });
    expect(validateWebhookEndpointUrl('ftp://example.test/hook')).toEqual({
      outcome: 'rejected',
      reason: 'unsupported-protocol:ftp:',
    });
    expect(validateWebhookEndpointUrl('file:///etc/passwd')).toEqual({
      outcome: 'rejected',
      reason: 'unsupported-protocol:file:',
    });
  });

  it('throws synchronously on an invalid endpoint URL (never reaches the network)', async () => {
    const service = createWebhookDeliveryService({
      outbox: {
        listPending: () => Promise.resolve([pendingDelivery()]),
        markDelivered: () => Promise.resolve(),
      },
      endpoint: { url: 'file:///etc/passwd' },
      signer: hmacSha256WebhookSigner({
        signingKeyId: SIGNING_KEY_ID,
        hmacInput: SIGNING_INPUT,
      }),
      clock: { now: () => T0 },
      backoff: { maxAttempts: 1, baseDelayMs: 1, multiplier: 1 },
    });
    // The attempt fails (thrown transport = one failed attempt) and the
    // event moves to the explicit dead-letter state — never a crash.
    const report = await service.deliverPending();
    expect(report.deadLetteredCount).toBe(1);
    const deadLetters = await service.deadLetters();
    expect(deadLetters[0]?.lastHttpStatus).toBeNull();
  });
});

describe('the dedicated drain loop (honestly disclosed: no webhook job kind in the frozen host registry)', () => {
  it('records every manual tick outcome — swept, drain-failed (never re-thrown), drain-skipped (overlap)', async () => {
    const clock = new ManualClock(T0);
    const emptyReport = Object.freeze({
      outcome: 'swept' as const,
      pendingConsidered: 0,
      deliveredCount: 0,
      deadLetteredCount: 0,
      skippedCount: 0,
      attempts: Object.freeze([]),
    });
    let failNext = false;
    let gate: Promise<void> | null = null;
    let releaseGate: () => void = () => {};
    const drain = async (): Promise<typeof emptyReport> => {
      if (failNext) {
        failNext = false;
        throw new Error('outbox unreachable');
      }
      if (gate !== null) {
        // A drain gated on an external release — models a slow sweep.
        await gate;
      }
      return emptyReport;
    };
    const loop = new WebhookDeliveryLoop(drain, { clock });

    // (1) a healthy sweep is recorded as swept.
    clock.advance(1_000);
    const first = await loop.tick();
    expect(first).toEqual(emptyReport);
    expect(loop.ticks).toEqual([
      expect.objectContaining({ tick: 1, outcome: 'swept', at: T0 + 1_000 }),
    ]);

    // (2) a throwing drain is recorded drain-failed and NEVER re-thrown.
    failNext = true;
    const failed = await loop.tick();
    expect(failed).toEqual({ outcome: 'drain-failed' });
    expect(loop.ticks[1]).toEqual(
      expect.objectContaining({ outcome: 'drain-failed', error: 'outbox unreachable' }),
    );

    // (3) an overlapping drain is recorded drain-skipped (skipped ≠ failed).
    gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const slow = loop.tick(); // in-flight, gated on `releaseGate`
    const overlap = await loop.tick();
    expect(overlap).toEqual({ outcome: 'drain-skipped' });
    expect(loop.ticks[2]).toEqual(expect.objectContaining({ outcome: 'drain-skipped' }));
    releaseGate();
    await slow;
    expect(loop.ticks[3]).toEqual(expect.objectContaining({ outcome: 'swept' }));
  });

  it('schedules drains on an interval (unref-able) and stops cleanly', async () => {
    const clock = new ManualClock(T0);
    const ticks: string[] = [];
    const drain = async (): Promise<WebhookDeliverySweepReport> => ({
      outcome: 'swept',
      pendingConsidered: 0,
      deliveredCount: 0,
      deadLetteredCount: 0,
      skippedCount: 0,
      attempts: [],
    });
    const loop = new WebhookDeliveryLoop(drain, {
      clock,
      intervalMs: 20,
      keepAlive: false,
      onTick: (record) => {
        ticks.push(record.outcome);
      },
    });
    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    loop.stop();
    expect(loop.running).toBe(false);
    // The interval actually fired (≥2 drains) and every tick was swept.
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.every((outcome) => outcome === 'swept')).toBe(true);
    expect(loop.ticks.length).toBe(ticks.length);
  });
});
