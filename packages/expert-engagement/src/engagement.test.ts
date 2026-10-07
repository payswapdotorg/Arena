/**
 * Engagement lifecycle unit + adversarial tests (Work Order C011).
 */

import { describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_TRANSITION_TABLE,
  applyEngagementTransition,
  bindsToEscalationState,
  checkEngagementTransition,
  createEngagementOffer,
  engagementIdentityKey,
  isEngagement,
  verifyEngagementDigest,
} from './engagement.js';
import {
  appendEngagementHistoryEntry,
  startEngagementHistory,
} from './engagement.js';
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';
import { toEngagementTimestamp } from './shared.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);

const T0 = '2026-10-07T09:00:00.000Z';
const T1 = '2026-10-07T09:30:00.000Z';
const T2 = '2026-10-07T10:00:00.000Z';
const DEADLINE = '2026-10-08T09:00:00.000Z';
const EXPIRY = '2026-10-07T12:00:00.000Z';
const AFTER_EXPIRY = '2026-10-07T12:00:00.001Z';

async function newOffer(overrides: Record<string, string> = {}) {
  return createEngagementOffer({
    engagementId: 'eng-alpha-1',
    tenant: 'tenant-a',
    escalationRef: 'req-1001',
    expertId: 'expert-one',
    commercialOfferRef: DIGEST_A,
    budgetHoldRef: DIGEST_B,
    routingVerdictRef: DIGEST_C,
    availabilityRef: DIGEST_D,
    urgency: 'urgent',
    requestDeadline: DEADLINE,
    offerExpiresAt: EXPIRY,
    offeredAt: T0,
    idempotencyKey: 'offer-key-1',
    correlationId: 'corr-1',
    ...overrides,
  });
}

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(ExpertEngagementError);
  expect((error as ExpertEngagementError).code).toBe(code);
}

describe('createEngagementOffer', () => {
  it('constructs a frozen, content-addressed OFFERED record', async () => {
    const record = await newOffer();
    expect(record.status).toBe('offered');
    expect(record.urgency).toBe('urgent');
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(isEngagement(record)).toBe(true);
    expect(engagementIdentityKey(record)).toBe('tenant-a/eng-alpha-1');
  });

  it('rejects an offer born expired (expiry must follow the offer time)', async () => {
    await expect(
      newOffer({ offerExpiresAt: T0, offeredAt: T0 }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD);
      return true;
    });
  });

  it('rejects an offer expiring after the request deadline (deadline-aware)', async () => {
    await expect(
      newOffer({ offerExpiresAt: '2026-10-09T09:00:00.000Z' }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD);
      return true;
    });
  });

  it('rejects an unknown urgency class (closed vocabulary mirrors C001)', async () => {
    await expect(newOffer({ urgency: 'extreme' })).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_POLICY);
        return true;
      },
    );
  });

  it('rejects malformed ids/tenants/digests (fail-closed validation)', async () => {
    await expect(newOffer({ engagementId: 'BAD_ID' })).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY);
        return true;
      },
    );
    await expect(newOffer({ tenant: 'Tenant-A' })).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY);
        return true;
      },
    );
    await expect(newOffer({ commercialOfferRef: 'not-a-digest' })).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_REF);
        return true;
      },
    );
  });
});

describe('guarded transitions', () => {
  it('accept → activate → complete walks the happy path with fresh digests', async () => {
    const offered = await newOffer();
    const accepted = await applyEngagementTransition(offered, {
      transition: 'accept',
      at: T1,
      tenant: 'tenant-a',
    });
    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedAt).toBe(T1);
    expect(accepted.digest).not.toBe(offered.digest);
    expect(offered.status).toBe('offered'); // source never mutated (append-only)

    const active = await applyEngagementTransition(accepted, {
      transition: 'activate',
      at: T2,
      tenant: 'tenant-a',
    });
    expect(active.status).toBe('active');
    const completed = await applyEngagementTransition(active, {
      transition: 'complete',
      at: '2026-10-07T18:00:00.000Z',
      tenant: 'tenant-a',
    });
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBe('2026-10-07T18:00:00.000Z');

    // Terminal finality: nothing may follow 'completed'.
    await expect(
      applyEngagementTransition(completed, {
        transition: 'withdraw',
        at: '2026-10-07T19:00:00.000Z',
        tenant: 'tenant-a',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.TERMINAL_STATE);
      return true;
    });
  });

  it('ADVERSARIAL: acceptance at/after offer expiry fails closed (OFFER_EXPIRED)', async () => {
    const offered = await newOffer();
    const atExpiry = checkEngagementTransition(offered, 'accept', {
      at: EXPIRY,
      tenant: 'tenant-a',
    });
    expect(atExpiry.allowed).toBe(false);
    expect(atExpiry.reason).toBe('transition_offer_expired');
    await expect(
      applyEngagementTransition(offered, {
        transition: 'accept',
        at: AFTER_EXPIRY,
        tenant: 'tenant-a',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.OFFER_EXPIRED);
      return true;
    });
  });

  it('expire is legal only at/after the expiry (deterministic expiry)', async () => {
    const offered = await newOffer();
    expect(
      checkEngagementTransition(offered, 'expire', { at: T1, tenant: 'tenant-a' }).allowed,
    ).toBe(false);
    const expired = await applyEngagementTransition(offered, {
      transition: 'expire',
      at: AFTER_EXPIRY,
      tenant: 'tenant-a',
    });
    expect(expired.status).toBe('expired');
    // expired is terminal
    await expect(
      applyEngagementTransition(expired, {
        transition: 'accept',
        at: '2026-10-07T13:00:00.000Z',
        tenant: 'tenant-a',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.TERMINAL_STATE);
      return true;
    });
  });

  it('ADVERSARIAL: duplicate acceptance on an already-accepted engagement is denied', async () => {
    const offered = await newOffer();
    const accepted = await applyEngagementTransition(offered, {
      transition: 'accept',
      at: T1,
      tenant: 'tenant-a',
    });
    const again = checkEngagementTransition(accepted, 'accept', {
      at: T2,
      tenant: 'tenant-a',
    });
    expect(again.allowed).toBe(false);
    expect(again.reason).toBe('transition_not_allowed_from_status');
  });

  it('ADVERSARIAL: cross-tenant transition is denied (CROSS_TENANT_ACCESS)', async () => {
    const offered = await newOffer();
    const verdict = checkEngagementTransition(offered, 'accept', {
      at: T1,
      tenant: 'tenant-b',
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('transition_tenant_mismatch');
    await expect(
      applyEngagementTransition(offered, {
        transition: 'accept',
        at: T1,
        tenant: 'tenant-b',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.CROSS_TENANT_ACCESS);
      return true;
    });
  });

  it('replace requires a distinct successor engagement id (supersession)', async () => {
    const offered = await newOffer();
    expect(
      checkEngagementTransition(offered, 'replace', { at: T1, tenant: 'tenant-a' }).reason,
    ).toBe('transition_requires_successor');
    const replaced = await applyEngagementTransition(offered, {
      transition: 'replace',
      at: T1,
      tenant: 'tenant-a',
      successorEngagementId: 'eng-alpha-2',
    });
    expect(replaced.status).toBe('replaced');
    expect(replaced.successorEngagementId).toBe('eng-alpha-2');
  });

  it('completion after the request deadline is denied (DEADLINE_PASSED)', async () => {
    const offered = await newOffer();
    const accepted = await applyEngagementTransition(offered, {
      transition: 'accept',
      at: T1,
      tenant: 'tenant-a',
    });
    const active = await applyEngagementTransition(accepted, {
      transition: 'activate',
      at: T2,
      tenant: 'tenant-a',
    });
    await expect(
      applyEngagementTransition(active, {
        transition: 'complete',
        at: '2026-10-09T09:00:00.001Z',
        tenant: 'tenant-a',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.DEADLINE_PASSED);
      return true;
    });
  });

  it('the closed transition table matches the spec lifecycle', () => {
    expect(ENGAGEMENT_TRANSITION_TABLE.accept?.to).toBe('accepted');
    expect(ENGAGEMENT_TRANSITION_TABLE.decline?.to).toBe('declined');
    expect(ENGAGEMENT_TRANSITION_TABLE.expire?.to).toBe('expired');
    expect(ENGAGEMENT_TRANSITION_TABLE.activate?.to).toBe('active');
    expect(ENGAGEMENT_TRANSITION_TABLE.complete?.to).toBe('completed');
    expect(ENGAGEMENT_TRANSITION_TABLE.withdraw?.to).toBe('withdrawn');
    expect(ENGAGEMENT_TRANSITION_TABLE.replace?.to).toBe('replaced');
  });
});

describe('C001 escalation-state binding', () => {
  it('offered binds only to escalation offered', () => {
    expect(bindsToEscalationState('offered', 'offered')).toBe(true);
    expect(bindsToEscalationState('offered', 'accepted')).toBe(false);
  });

  it('active binds to session_ready / in_progress', () => {
    expect(bindsToEscalationState('active', 'session_ready')).toBe(true);
    expect(bindsToEscalationState('active', 'in_progress')).toBe(true);
    expect(bindsToEscalationState('active', 'matching')).toBe(false);
  });

  it('completed binds to submitted and later C001 states', () => {
    expect(bindsToEscalationState('completed', 'submitted')).toBe(true);
    expect(bindsToEscalationState('completed', 'paid')).toBe(true);
    expect(bindsToEscalationState('completed', 'offered')).toBe(false);
  });
});

describe('integrity + history', () => {
  it('ADVERSARIAL: a tampered record fails digest verification (TAMPERED)', async () => {
    const record = await newOffer();
    await expect(verifyEngagementDigest(record)).resolves.toBe(record.digest);
    const tampered = { ...record, expertId: "expert-two" as typeof record.expertId };
    await expect(verifyEngagementDigest(tampered)).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.TAMPERED);
        return true;
      },
    );
  });

  it('history is append-only, contiguous and monotonic', async () => {
    const offered = await newOffer();
    const accepted = await applyEngagementTransition(offered, {
      transition: 'accept',
      at: T1,
      tenant: 'tenant-a',
    });
    let history = startEngagementHistory(offered);
    history = appendEngagementHistoryEntry(history, {
      engagementId: offered.engagementId,
      tenant: offered.tenant,
      transition: 'accept',
      from: 'offered',
      to: 'accepted',
      at: toEngagementTimestamp(T1, 'at'),
      recordDigest: accepted.digest,
    });
    expect(history.entries.length).toBe(1);
    expect(history.entries[0]?.sequence).toBe(1);
    expect(() =>
      appendEngagementHistoryEntry(history, {
        engagementId: offered.engagementId,
        tenant: offered.tenant,
        transition: 'accept',
        from: 'offered',
        to: 'accepted',
        at: toEngagementTimestamp(T0, 'at'), // backdated
        recordDigest: accepted.digest,
      }),
    ).toThrow(ExpertEngagementError);
  });
});
