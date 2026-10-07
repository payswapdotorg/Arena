/**
 * Test support (Work Order C001) — in-memory reference doubles for the
 * escalation wire adapters: a recording HTTP transport (programmable
 * failures), a delivery ledger, an outbox double, a fixed clock and an
 * MCP handler double.
 */

import type {
  WebhookDeliveryAttemptRecord,
  WebhookDeadLetterRecord,
  WebhookDeliveryLedger,
  WebhookHttpTransport,
  WebhookOutboxSource,
  WebhookPendingDelivery,
} from './webhook-delivery.js';
import type { McpToolCallWireResponse, McpToolHandler } from './mcp-stdio.js';

/** Deterministic fixed clock (reference fabric). */
export class FixedClock {
  constructor(private current: number) {}
  now(): number {
    return this.current;
  }
  advanceTo(ms: number): void {
    this.current = ms;
  }
  advanceBy(ms: number): void {
    this.current += ms;
  }
}

/** One recorded POST performed by the adapter. */
export interface RecordedPost {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/**
 * In-memory HTTP transport double. `failuresRemaining` makes the next N
 * POSTs fail (status 500); `throwNext` makes the very next POST throw
 * (transport outage simulation). Every POST is recorded in order.
 */
export class InMemoryWebhookTransport implements WebhookHttpTransport {
  readonly posts: RecordedPost[] = [];
  failuresRemaining = 0;
  throwNext = false;

  async post(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: string,
  ): Promise<{ readonly ok: boolean; readonly status: number }> {
    this.posts.push({ url, headers: { ...headers }, body });
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error('simulated transport outage');
    }
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      return { ok: false, status: 500 };
    }
    return { ok: true, status: 200 };
  }
}

/** In-memory delivery ledger (attempt log + dead-letter state). */
export class InMemoryWebhookDeliveryLedger implements WebhookDeliveryLedger {
  private readonly attemptLog: WebhookDeliveryAttemptRecord[] = [];
  private readonly deadLetters = new Map<string, WebhookDeadLetterRecord>();

  async recordAttempt(attempt: WebhookDeliveryAttemptRecord): Promise<void> {
    this.attemptLog.push(attempt);
  }

  async recordDeadLetter(record: WebhookDeadLetterRecord): Promise<void> {
    if (this.deadLetters.has(record.eventId)) return;
    this.deadLetters.set(record.eventId, record);
  }

  async listDeadLetters(): Promise<readonly WebhookDeadLetterRecord[]> {
    return [...this.deadLetters.values()];
  }

  async attemptsFor(eventId: string): Promise<readonly WebhookDeliveryAttemptRecord[]> {
    return this.attemptLog.filter((a) => a.eventId === eventId);
  }

  allAttempts(): readonly WebhookDeliveryAttemptRecord[] {
    return [...this.attemptLog];
  }
}

/** In-memory outbox double (structural mirror of the service outbox). */
export class InMemoryOutboxDouble implements WebhookOutboxSource {
  private readonly deliveries = new Map<string, WebhookPendingDelivery>();
  private readonly delivered = new Set<string>();
  /** When true, markDelivered is IGNORED (at-least-once duplicate simulation). */
  ignoreMarkDelivered = false;

  add(delivery: WebhookPendingDelivery): void {
    this.deliveries.set(delivery.eventId, delivery);
  }

  async listPending(): Promise<readonly WebhookPendingDelivery[]> {
    return [...this.deliveries.values()].filter((d) => !this.delivered.has(d.eventId));
  }

  async markDelivered(eventId: string, _at: number): Promise<void> {
    if (this.ignoreMarkDelivered) return;
    this.delivered.add(eventId);
  }
}

/** Deterministic MCP handler double for transport tests. */
export class EchoMcpHandler implements McpToolHandler {
  readonly seen: unknown[] = [];

  async handleToolCall(request: unknown): Promise<McpToolCallWireResponse> {
    this.seen.push(request);
    return {
      jsonrpc: '2.0',
      id: (request as { id?: string | number | null }).id ?? null,
      result: { content: [{ type: 'text', text: 'echo' }] },
    };
  }
}
