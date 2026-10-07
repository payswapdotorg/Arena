/**
 * The C019 generic-client E2E battery — POSITIVE full-loop run: assert
 * a typed artifact at every stage of the §15/§16 loop (FINAL-HANDOFF
 * §15: an unrelated third-party AI application performing the complete
 * flow through Arena's public contracts ONLY).
 */

import { describe, expect, it } from 'vitest';
import { runBoqEscalationLoop, SCENARIO } from './loop.js';
import { asLiveMutation } from '@arena/expert-session';

describe('C019 generic AI application client: the full §15/§16 loop', () => {
  it('walks register → escalate → session → intervention → validation → result → payment → fee → learning → resume', async () => {
    const receipt = await runBoqEscalationLoop();

    // (1) Register/authorize (C017): the developer key authorized.
    expect(receipt.authorization.outcome).toBe('authorized');
    expect(receipt.authorization.keyId).toMatch(/^devkey_/);

    // (2) The durable request id came back from POST /v1/escalations.
    expect(receipt.requestId).toMatch(/^esc_[0-9a-f]{32}$/);
    expect(receipt.duplicate).toBe(false);

    // (3) Capability demand → a QUALIFIED expert was matched.
    expect(receipt.matchedExpertRef).toBe('expert-kwame');

    // (4) The client followed the lifecycle by polling AND webhooks.
    expect(receipt.polledStates[0]).toBe('offered');
    expect(receipt.terminalState).toBe('closed');
    expect(receipt.acceptedEventTypes).toContain('escalation.created');
    expect(receipt.acceptedEventTypes).toContain('escalation.completed');
    expect(receipt.acceptedEventTypes).toContain('escalation.payment.updated');
    // At-least-once delivery, deduped: no duplicate event ids reached the client.
    const eventIds = receipt.client.observedEvents().map((event) => event.eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);

    // (5) The bounded expert session (C006): replica capsule + completed session.
    expect(receipt.arenaSide.sessionRef).toBe('session-boq-block-c');
    expect(receipt.arenaSide.capsuleDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.arenaSide.session.state).toBe('completed');

    // (6) The intervention (C007): the requested mode was authorized and
    // every permitted expert action was recorded as allowed.
    expect(receipt.arenaSide.modeAuthorization.allowed).toBe(true);
    expect(receipt.arenaSide.modeAuthorization.mode).toBe('solve');
    expect(receipt.arenaSide.expertActions).toHaveLength(4);
    expect(receipt.arenaSide.expertActions.every((entry) => entry.allowed)).toBe(true);

    // (7) The typed structured result (ES1.0 taxonomy) + validation.
    expect(receipt.result.kind).toBe('unblock');
    expect(receipt.validationStatus).toBe('passed');

    // (8) Payment + Arena fee (C010): the deterministic fee split.
    expect(receipt.costFields.amountMinorUnits).toBe(SCENARIO.budgetMinorUnits);
    expect(receipt.costFields.currency).toBe('USD');
    expect(receipt.costFields.arenaFeeMinorUnits).toBeGreaterThan(0);
    expect(receipt.costFields.arenaFeeMinorUnits).toBeLessThan(SCENARIO.budgetMinorUnits);
    expect(receipt.costFields.expertPayoutStatus).toBe('paid');

    // (9) Optional learning artifacts (consent-gated).
    expect(receipt.arenaSide.learningCaptured).toBe(true);

    // (10) The application RESUMED its own authoritative workflow —
    // Arena never wrote the application's state.
    expect(receipt.workflowResumed).toBe(true);
    expect(receipt.applied.appliedBy).toBe('client-own-authority');
    expect(receipt.applied.resultKind).toBe('unblock');

    // (11) Bounded-session replay — observational, visibly labelled.
    expect(receipt.replay.kind).toBe('bounded-expert-session-replay');
    expect(receipt.replay.liveMutation).toBe(false);
    expect(receipt.replay.frames.length).toBeGreaterThan(0);
    // A replay is NEVER a live mutation path (the EES1.0 fail-closed guard).
    expect(() => asLiveMutation(receipt.replay)).toThrowError();
  });

  it('is deterministic: two runs produce identical typed artifacts', async () => {
    const first = await runBoqEscalationLoop();
    const second = await runBoqEscalationLoop();
    expect(second.requestId).toBe(first.requestId);
    expect(second.arenaSide.capsuleDigest).toBe(first.arenaSide.capsuleDigest);
    expect(second.result).toEqual(first.result);
    expect(second.acceptedEventTypes).toEqual(first.acceptedEventTypes);
  });
});
