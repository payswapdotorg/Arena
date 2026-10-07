/**
 * The C019 Epoch escalation-loop E2E battery (FINAL-HANDOFF §15: "Epoch
 * and one independent generic client must both prove the public
 * contract") — the Epoch client drives the SAME §15 loop through the
 * Epoch escalation reference adapter (adapters/epoch-escalation).
 */

import { describe, expect, it } from 'vitest';
import { runEpochEscalationLoop, EPOCH_SCENARIO } from './epoch-loop.js';
import {
  EPOCH_ESCALATION_AUTHORITY_BOUNDARY,
  attemptEpochAuthoritativeWrite,
} from '@arena/epoch-escalation-adapter';

describe('C019 Epoch escalation loop: the full §15 loop through the adapter', () => {
  it('walks trigger → ES1.0 request → public escalation API → typed delivery → own-authority application', async () => {
    const receipt = await runEpochEscalationLoop();

    // The EPI1.0 async contract survived into the ES1.0 request.
    expect(receipt.triggerIdempotencyKey).toBe(EPOCH_SCENARIO.idempotencyKey);
    expect(receipt.triggerCorrelationId).toBe(EPOCH_SCENARIO.correlationId);

    // The durable request id came back from the SAME public transport.
    expect(receipt.requestId).toMatch(/^esc_[0-9a-f]{32}$/);
    expect(receipt.duplicate).toBe(false);

    // Capability demand → a qualified expert matched; loop closed.
    expect(receipt.matchedExpertRef).toBe('expert-kwame');
    expect(receipt.terminalState).toBe('closed');

    // The adapter consumed SIGNED webhooks (verified + deduped by EVENT ID —
    // one event type may legitimately recur across lifecycle transitions,
    // e.g. `escalation.progressed` for triaged→matching).
    expect(receipt.consumedEventTypes).toContain('escalation.created');
    expect(receipt.consumedEventTypes).toContain('escalation.completed');
    expect(receipt.consumedEventTypes).toContain('escalation.payment.updated');
    const uniqueIds = new Set(receipt.consumedEventIds);
    expect(uniqueIds.size).toBe(receipt.consumedEventIds.length);

    // The read-only delivery projection: typed result, refs, cost, no store handles.
    expect(receipt.delivery.epochJobId).toBe(EPOCH_SCENARIO.epochJobId);
    expect(receipt.delivery.state).toBe('closed');
    expect(receipt.delivery.resultKind).toBe('unblock');
    expect(receipt.delivery.validationStatus).toBe('passed');
    expect(receipt.delivery.cost?.arenaFeeMinorUnits).toBeGreaterThan(0);
    expect(receipt.delivery.cost?.expertPayoutStatus).toBe('paid');
    expect(receipt.delivery.refs.some((ref) => ref.kind === 'escalation-request-ref')).toBe(true);
    // Learning artifact refs stay hidden (the posture did not authorize reuse).
    expect(receipt.delivery.learningArtifactRefs).toHaveLength(0);

    // Epoch applied the result through its OWN authority.
    expect(receipt.appliedByEpoch.applied).toBe(true);
    expect(receipt.appliedByEpoch.authority).toBe('epoch-own-authority');

    // Write-back attempts against Epoch authoritative stores fail CLOSED.
    expect(receipt.writeBackDenied).toBe(true);
    expect(() =>
      attemptEpochAuthoritativeWrite({
        attemptKind: 'epoch-authoritative-write-attempt',
        store: 'delivery-state',
      }),
    ).toThrowError();
    expect(EPOCH_ESCALATION_AUTHORITY_BOUNDARY.effectDirection).toBe(
      'arena-to-epoch-read-only-projection',
    );
  });

  it('is deterministic: the delivery projection is stable across runs', async () => {
    const first = await runEpochEscalationLoop();
    const second = await runEpochEscalationLoop();
    expect(second.requestId).toBe(first.requestId);
    expect(second.delivery.state).toBe(first.delivery.state);
    expect(second.delivery.refs).toEqual(first.delivery.refs);
    expect(second.consumedEventTypes).toEqual(first.consumedEventTypes);
  });
});
