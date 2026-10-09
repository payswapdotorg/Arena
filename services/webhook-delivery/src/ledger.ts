/**
 * services/webhook-delivery/src/ledger.ts — the webhook delivery ledger
 * (Work Order P003; issue #155).
 *
 * HONEST DURABILITY DISCLOSURE (recorded in the PR body and the package
 * description): the attempt ledger and dead-letter lot are PROCESS-LOCAL.
 * The DURABLE at-least-once substrate is the P002 webhook outbox
 * (listPending / markDelivered over Postgres — the frozen
 * @arena/runtime-host `WebhookOutboxPort`): a delivery-service restart
 * re-reads pending events from the durable outbox and re-attempts them —
 * at-least-once semantics hold, events are never silently dropped, and
 * duplicate deliveries are deduped per EVENT ID on the consumer side
 * (x-arena-event-id — never per type, ADR-P001-08 rule 4 / R-032). The
 * LIMITATION: an exhausted (dead-lettered) event becomes pending again
 * after a process restart and is retried before re-dead-lettering —
 * dead-letter PERMANENCE across restarts is not yet durable. Making it
 * durable requires either a delivery-ledger migration in the frozen
 * adapters/hosted surface (P002-owned) or a webhook job kind in the
 * frozen host registry — both are TL follow-ups disclosed in the PR body.
 */

import type {
  WebhookDeliveryAttemptRecord,
  WebhookDeliveryLedger,
  WebhookDeadLetterRecord,
} from '@arena/escalation-adapters';

/**
 * The reference delivery ledger: append-only attempt records per event id
 * plus the explicit dead-letter lot (auditable, never silently dropped).
 */
export class InMemoryWebhookDeliveryLedger implements WebhookDeliveryLedger {
  readonly #attempts = new Map<string, WebhookDeliveryAttemptRecord[]>();
  readonly #deadLetters = new Map<string, WebhookDeadLetterRecord>();

  async recordAttempt(attempt: WebhookDeliveryAttemptRecord): Promise<void> {
    const existing = this.#attempts.get(attempt.eventId) ?? [];
    this.#attempts.set(attempt.eventId, [...existing, attempt]);
  }

  async recordDeadLetter(record: WebhookDeadLetterRecord): Promise<void> {
    // Idempotent: the LAST dead-letter record for an event id wins (the
    // durable-outbox re-arm path can re-exhaust an event after restart).
    this.#deadLetters.set(record.eventId, record);
  }

  async listDeadLetters(): Promise<readonly WebhookDeadLetterRecord[]> {
    return [...this.#deadLetters.values()];
  }

  async attemptsFor(eventId: string): Promise<readonly WebhookDeliveryAttemptRecord[]> {
    return [...(this.#attempts.get(eventId) ?? [])];
  }
}
