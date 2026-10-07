/**
 * Service↔adapter WIRING tests (Work Order C001) — the integration layer
 * proving the escalation-api reference service composes with the
 * adapters/escalation wire transports through the structural ports:
 *
 *   - EscalationApiService.outbox  →  WebhookDeliveryAdapter.source
 *   - McpToolServer                →  McpStdioTransport.handler
 *
 * Direction service → adapter is the approved downward edge (boundary
 * rule B4); this is a TEST-ONLY devDependency — production hosts wire
 * the same composition at their root (see adapters/escalation/README).
 */

import { describe, expect, it } from 'vitest';
import {
  McpStdioTransport,
  WebhookDeliveryAdapter,
  hmacSha256WebhookSigner,
  verifyWebhookSignature,
} from '@arena/escalation-adapters';
import type { WebhookSignatureVerification } from '@arena/escalation-adapters';
import { McpToolServer } from './mcp.js';
import { referenceService, validCreateInput } from './test-support.js';

const START = Date.parse('2026-10-07T10:00:00.000Z');
const SIGNING = { signingKeyId: 'wh-2026-10', hmacInput: 'host-injected-material' };

describe('wiring — service outbox drains through the signed webhook delivery adapter', () => {
  it('delivers every lifecycle webhook with verifiable signatures and unique consumer keys', async () => {
    const { service } = referenceService(START);
    const created = await service.createEscalation(validCreateInput());
    expect(created.outcome).toBe('created');

    const transport = new RecordingTransport();
    const adapter = new WebhookDeliveryAdapter({
      source: service.outbox,
      endpoint: { url: 'https://client.example/hooks/arena' },
      signer: hmacSha256WebhookSigner(SIGNING),
      transport,
      clock: { now: () => START },
      ledger: new RecordingLedger(),
    });
    const report = await adapter.deliverPending();

    // created → triaged → matching → offered: 4 durable events
    expect(report.deliveredCount).toBe(4);
    expect(report.deadLetteredCount).toBe(0);
    expect(transport.posts).toHaveLength(4);

    const eventTypes = transport.posts.map((post) => {
      const envelope = JSON.parse(post.body) as { payload: { eventType: string } };
      return envelope.payload.eventType;
    });
    expect(eventTypes).toEqual([
      'escalation.created',
      'escalation.progressed',
      'escalation.progressed',
      'escalation.matched',
    ]);
    const eventIds = transport.posts.map((p) => p.headers['x-arena-event-id']!);
    expect(new Set(eventIds).size).toBe(4);
    for (const post of transport.posts) {
      const verdict: WebhookSignatureVerification = verifyWebhookSignature({
        signer: hmacSha256WebhookSigner(SIGNING),
        timestamp: Number(post.headers['x-arena-webhook-timestamp']!),
        payload: post.body,
        signatureHeader: post.headers['x-arena-signature']!,
        now: START,
      });
      expect(verdict).toEqual({ outcome: 'verified' });
    }
    expect(await service.outbox.listPending()).toHaveLength(0);
  });

  it('a tampered payload fails consumer verification (fail-closed integration)', async () => {
    const { service } = referenceService(START);
    await service.createEscalation(validCreateInput());
    const transport = new RecordingTransport();
    const adapter = new WebhookDeliveryAdapter({
      source: service.outbox,
      endpoint: { url: 'https://client.example/hooks/arena' },
      signer: hmacSha256WebhookSigner(SIGNING),
      transport,
      clock: { now: () => START },
      ledger: new RecordingLedger(),
    });
    await adapter.deliverPending();
    const post = transport.posts[0]!;
    const verdict = verifyWebhookSignature({
      signer: hmacSha256WebhookSigner(SIGNING),
      timestamp: Number(post.headers['x-arena-webhook-timestamp']!),
      payload: post.body.replace('escalation.created', 'escalation.completed'),
      signatureHeader: post.headers['x-arena-signature']!,
      now: START,
    });
    expect(verdict).toEqual({ outcome: 'rejected', reason: 'signature-mismatch' });
  });

  it('timeout sweep failures are delivered as escalation.failed through the adapter', async () => {
    const { service, clock } = referenceService(START);
    await service.createEscalation(validCreateInput());
    clock.advanceTo(START + 3_600_000 + 1); // past deadlineInMs
    const timedOut = await service.sweepTimeouts();
    expect(timedOut).toHaveLength(1);

    const transport = new RecordingTransport();
    const adapter = new WebhookDeliveryAdapter({
      source: service.outbox,
      endpoint: { url: 'https://client.example/hooks/arena' },
      signer: hmacSha256WebhookSigner(SIGNING),
      transport,
      clock,
      ledger: new RecordingLedger(),
    });
    const report = await adapter.deliverPending();
    expect(report.deliveredCount).toBe(5); // 4 lifecycle + escalation.failed
    const last = transport.posts.at(-1)!;
    const envelope = JSON.parse(last.body) as { payload: { eventType: string } };
    expect(envelope.payload.eventType).toBe('escalation.failed');
  });

  it('an endpoint outage retries with backoff then dead-letters — nothing is dropped silently', async () => {
    const { service } = referenceService(START);
    await service.createEscalation(validCreateInput());
    const transport = new RecordingTransport();
    transport.failuresRemaining = Number.POSITIVE_INFINITY;
    const ledger = new RecordingLedger();
    const adapter = new WebhookDeliveryAdapter({
      source: service.outbox,
      endpoint: { url: 'https://client.example/hooks/arena' },
      signer: hmacSha256WebhookSigner(SIGNING),
      transport,
      clock: { now: () => START },
      ledger,
      backoff: { maxAttempts: 3, baseDelayMs: 1000, multiplier: 2 },
    });
    const report = await adapter.deliverPending();
    expect(report.deliveredCount).toBe(0);
    expect(report.deadLetteredCount).toBe(4);
    expect(transport.posts).toHaveLength(12); // 4 events × 3 attempts
    const deadLetters = await ledger.listDeadLetters();
    expect(deadLetters).toHaveLength(4);
    // pending remains (at-least-once until acked) but is skipped forever
    expect(await service.outbox.listPending()).toHaveLength(4);
    const second = await adapter.deliverPending();
    expect(second.skippedCount).toBe(4);
    expect(transport.posts).toHaveLength(12);
  });
});

describe('wiring — MCP tool server behind the stdio transport binding', () => {
  it('create-escalation and get-escalation-status round-trip over chunked stdio lines', async () => {
    const { service } = referenceService(START);
    const transport = new McpStdioTransport({ handler: new McpToolServer(service) });

    const createCall = JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'create-escalation', arguments: validCreateInput() },
    });
    // split across two chunks to prove line buffering on real traffic
    expect(await transport.handleChunk(createCall.slice(0, 60))).toEqual([]);
    const [framedCreate] = await transport.handleChunk(`${createCall.slice(60)}\n`);
    const createResult = JSON.parse(framedCreate!) as {
      id: string;
      result: { content: { text: string }[] };
    };
    expect(createResult.id).toBe('call-1');
    const created = JSON.parse(createResult.result.content[0]!.text) as {
      outcome: string;
      requestId: string;
      state: string;
    };
    expect(created.outcome).toBe('created');
    expect(created.state).toBe('offered'); // matched by the reference stub

    const statusCall = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get-escalation-status', arguments: { requestId: created.requestId, tenantId: 'tenant-alpha' } },
    });
    const [framedStatus] = await transport.handleChunk(`${statusCall}\n`);
    const status = JSON.parse(JSON.parse(framedStatus!).result.content[0]!.text) as {
      requestId: string;
      state: string;
    };
    expect(status.requestId).toBe(created.requestId);
    expect(status.state).toBe('offered');
  });

  it('the stdio surface fail-closes malformed lines without killing the stream', async () => {
    const { service } = referenceService(START);
    const transport = new McpStdioTransport({ handler: new McpToolServer(service) });
    const [bad] = await transport.handleChunk('{garbage\n');
    expect(JSON.parse(bad!).error.code).toBe(-32700);
    const [good] = await transport.handleChunk(
      `${JSON.stringify({ jsonrpc: '2.0', id: 'ok', method: 'tools/list' })}\n`,
    );
    const listed = JSON.parse(JSON.parse(good!).result.content[0]!.text) as { name: string }[];
    expect(listed.map((t) => t.name)).toEqual(['create-escalation', 'get-escalation-status']);
  });
});

// -- in-memory transport + ledger (adapter-port doubles, wiring-local) ------

class RecordingTransport {
  readonly posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  failuresRemaining = 0;

  async post(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: string,
  ): Promise<{ ok: boolean; status: number }> {
    this.posts.push({ url, headers: { ...headers }, body });
    if (this.failuresRemaining > 0) return { ok: false, status: 500 };
    return { ok: true, status: 200 };
  }
}

class RecordingLedger {
  private readonly attempts: { eventId: string; attempt: number; outcome: string }[] = [];
  private readonly deadLetters: { eventId: string }[] = [];

  async recordAttempt(attempt: { eventId: string; attempt: number; outcome: string }): Promise<void> {
    this.attempts.push(attempt);
  }

  async recordDeadLetter(record: { eventId: string }): Promise<void> {
    this.deadLetters.push(record);
  }

  async listDeadLetters(): Promise<{ eventId: string }[]> {
    return [...this.deadLetters];
  }

  async attemptsFor(eventId: string): Promise<{ eventId: string; attempt: number; outcome: string }[]> {
    return this.attempts.filter((a) => a.eventId === eventId);
  }
}
