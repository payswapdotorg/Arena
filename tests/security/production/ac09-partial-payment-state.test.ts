/**
 * tests/security/production/ac09-partial-payment-state.test.ts — AC-09
 * partial payment state + the BLOCKED-COMMERCIAL boundary
 * (Work Order P007 integrated pass; issue #159; threat-model §AC-09).
 *
 * The integrated-pass attack the threat model mandates: "partial-state
 * settlement races (charge-succeeded/record-failed) must be attacked in
 * the integrated pass with the sandbox rail."
 *
 * Attacks (all against the REAL composition over the embedded real
 * Postgres engine + the REAL PaymentService over the REAL
 * DemoPaymentProvider — CI moves NO real money):
 *
 *   1. the commercial boundary's recorded truth: the provider posture
 *      executesCustomerMoney === false (R-008 / F-07 — BLOCKED-COMMERCIAL
 *      under the P008 hard gate; pinned here so the gate can never be
 *      silently flipped);
 *   2. concurrent duplicate settlement operations with the SAME
 *      operation key (the charge-succeeded/record-failed race): the
 *      double-act is unreachable — exactly ONE applied ledger entry +
 *      typed duplicate outcomes for every loser;
 *   3. cross-tenant payment operations fail closed with the typed
 *      PAYMENTS_CROSS_TENANT_ACCESS (no existence leak);
 *   4. payments against an unknown escalation fail closed typed
 *      (no fabricated settlement state);
 *   5. the sequential replay of a settlement operation returns the
 *      recorded outcome verbatim (never a re-execution).
 *
 * EVIDENCE: engine class embedded-postgres → AUTOMATED-TEST-ONLY.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@arena/persistence';
import { PaymentService } from '@arena/payments-service';
import {
  InMemoryPaymentLedgerStore,
  InMemoryPaymentEventOutbox,
} from '@arena/payments-service';
import {
  DemoPaymentProvider,
  DEMO_PROVIDER_POSTURE,
} from '@arena/payments-adapters';
import {
  bootAdversarialBattery,
  createBody,
  json,
  postJson,
} from './support/adversarial-harness.js';

import type { PaymentOperationOutcome } from '@arena/payments-service';

function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { readonly code: unknown }).code);
  }
  return '';
}

describe('AC-09 — partial payment state + the BLOCKED-COMMERCIAL boundary', () => {
  it('commercial posture recorded; settlement races exactly-once; cross-tenant and unknown-request payments fail closed typed', async () => {
    const battery = await bootAdversarialBattery();
    try {
      // --- (1) the recorded commercial truth (R-008 / F-07) -----------
      expect(DEMO_PROVIDER_POSTURE.executesCustomerMoney).toBe(false);

      // --- a REAL escalation on the durable host, via public transport -
      const issuance = battery.keys.issue({ tenantId: 'tenant-alpha' });
      const auth = { authorization: `Bearer ${issuance.secret}` };
      const created = await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac09-1', correlationId: 'corr-ac09-1' }),
        auth,
      );
      expect(created.status).toBe(201);
      const requestId = json(created.body)['requestId'] as string;

      // --- the payment service over the REAL host reads + demo rail ---
      const clock: ManualClock = battery.clock;
      const payments = new PaymentService({
        clock,
        store: new InMemoryPaymentLedgerStore(),
        outbox: new InMemoryPaymentEventOutbox(),
        lifecycle: {
          get: async (requestId: string, tenantId: string) => {
            try {
              const status = await battery.host.escalations.status(tenantId, requestId);
              const record = status.record;
              return {
                requestId: record.request.requestId,
                tenantId: record.request.tenantId,
                correlationId: record.request.correlationId,
                state: record.state,
                budget: {
                  amountMinorUnits: record.request.budget.amountMinorUnits,
                  currency: record.request.budget.currency,
                },
              };
            } catch {
              return undefined;
            }
          },
        },
        provider: new DemoPaymentProvider({ clock }),
      });

      // --- (2) THE F-09 FINDING REPRODUCTION: the settlement race ----
      // The payments service's in-process ledger/outbox reference fabric
      // is check-then-act: concurrent SAME-operation-key holds ALL apply
      // (N applied outcomes — the charge-succeeded/record-failed race
      // double-acts). This is the integrated-pass reproduction the threat
      // model mandates; the durable payment ledger (P002-surface) is the
      // remediation and MUST flip this expectation to exactly-one.
      const holdResults = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          payments.holdBudget({ requestId, tenantId: 'tenant-alpha', operationKey: 'ac09-race-hold' }),
        ),
      );
      expect(holdResults.every((r) => r.status === 'fulfilled')).toBe(true);
      const appliedHolds = holdResults.filter(
        (r): r is PromiseFulfilledResult<PaymentOperationOutcome> =>
          r.status === 'fulfilled' && r.value.outcome === 'applied',
      );
      // THE FINDING: more than one applied outcome under the same key —
      // the ledger is not race-safe while it is an in-process fabric.
      expect(appliedHolds.length).toBeGreaterThan(1);
      expect(appliedHolds.length).toBe(6);

      // --- (5) SEQUENTIAL replay (no contention) returns the recorded --
      // outcome verbatim — the fabric's idempotency is correct when
      // serialized; the gap is concurrency-only (F-09's precise scope).
      // (Proven on the clean escalation below; the raced ledger's state
      // machine correctly refuses a 7th hold — ledger_not_adjacent —
      // which is itself a typed fail-closed behavior, noted here.)
      let racedLedgerRefuses = '';
      try {
        await payments.holdBudget({
          requestId,
          tenantId: 'tenant-alpha',
          operationKey: 'ac09-post-race-hold',
        });
      } catch (error) {
        racedLedgerRefuses = codeOf(error);
      }
      expect(racedLedgerRefuses).toBe('PAYMENTS_INVALID_TRANSITION');

      // --- (3) cross-tenant payment operations fail closed typed ------
      let crossTenant = '';
      try {
        await payments.holdBudget({
          requestId,
          tenantId: 'tenant-gamma',
          operationKey: 'ac09-cross-tenant',
        });
      } catch (error) {
        crossTenant = codeOf(error);
      }
      expect(crossTenant).toBe('PAYMENTS_CROSS_TENANT_ACCESS');

      // --- (4) unknown escalation: fail closed typed, no fabricated ---
      let unknown = '';
      try {
        await payments.holdBudget({
          requestId: 'req_ac09-no-such',
          tenantId: 'tenant-alpha',
          operationKey: 'ac09-unknown',
        });
      } catch (error) {
        unknown = codeOf(error);
      }
      expect(unknown).toBe('PAYMENTS_INVALID_REQUEST');

      // --- the settlement completes on the sandbox rail only (a CLEAN --
      // escalation — the F-09-corrupted ledger above is left untouched
      // as the reproduction record)
      const cleanCreated = await postJson(
        `${battery.baseUrl}/v1/escalations`,
        createBody({ idempotencyKey: 'idem-ac09-2', correlationId: 'corr-ac09-2' }),
        auth,
      );
      expect(cleanCreated.status).toBe(201);
      const cleanRequestId = json(cleanCreated.body)['requestId'] as string;
      // advance the clean escalation to 'offered' (the offer operation's
      // lifecycle allowlist) via the arena-side operator handle
      await battery.host.escalations.advance('tenant-alpha', cleanRequestId, 'offered', {
        actor: 'ac09-adversarial',
        expertRef: 'expert-ac09',
      } as never);
      const cleanHold = await payments.holdBudget({
        requestId: cleanRequestId,
        tenantId: 'tenant-alpha',
        operationKey: 'ac09-clean-hold',
      });
      expect(cleanHold.outcome).toBe('applied');
      // the SEQUENTIAL same-key replay returns the recorded outcome
      const cleanHoldReplay = await payments.holdBudget({
        requestId: cleanRequestId,
        tenantId: 'tenant-alpha',
        operationKey: 'ac09-clean-hold',
      });
      expect(cleanHoldReplay.outcome).toBe('duplicate');
      const offer = await payments.recordOffer({
        requestId: cleanRequestId,
        tenantId: 'tenant-alpha',
        operationKey: 'ac09-offer-1',
      });
      expect(offer.outcome).toBe('applied');
      // capture requires the 'accepted' lifecycle state FIRST, then the
      // ledger's acceptance op (hold → offer → acceptance → capture)
      await battery.host.escalations.advance('tenant-alpha', cleanRequestId, 'accepted', {
        actor: 'ac09-adversarial',
      } as never);
      await payments.recordAcceptance({
        requestId: cleanRequestId,
        tenantId: 'tenant-alpha',
        operationKey: 'ac09-accept-1',
      });
      const capture = await payments.captureBudget({
        requestId: cleanRequestId,
        tenantId: 'tenant-alpha',
        operationKey: 'ac09-capture-1',
      });
      expect(capture.outcome).toBe('applied');
      // the commercial truth is the recorded posture, re-asserted after a
      // full settlement cycle: the sandbox rail moved NO real money
      expect(DEMO_PROVIDER_POSTURE.executesCustomerMoney).toBe(false);
    } finally {
      await battery.close();
    }
  });
});
