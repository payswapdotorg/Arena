/**
 * Escrow/hold ledger tests (Work Order C010): the commercial state
 * machine, double-entry balances, lifecycle binding, refund paths,
 * terminal finality, append-only discipline and tamper evidence.
 */

import { describe, expect, it } from 'vitest';
import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  applyAcceptanceOperation,
  applyCaptureOperation,
  applyHoldOperation,
  applyOfferOperation,
  applyRefundOperation,
  applyReleaseOperation,
  availableForRefund,
  committedFunds,
  computeFeeSplit,
  heldFunds,
  isPaymentLedger,
  isTerminalLedgerState,
  ledgerBalances,
  LEDGER_STATES,
  LEDGER_TERMINAL_STATES,
  LEDGER_TRANSITIONS,
  openPaymentLedger,
  toMoney,
  verifyLedgerIntegrity,
  checkLedgerOperation,
  OPERATION_LIFECYCLE_ALLOWLISTS,
} from './index.js';
import type { PaymentLedger } from './index.js';
import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';
import { toMinorUnits } from './money.js';
import { digestCanonical } from '@arena/protocol-core';
import { FIXED_NOW, validMoney } from './test-support.js';

const TENANT = 'tenant-alpha';
const REQUEST = 'esc_00000000000000000000000000000001';
const CORR = 'corr-0001';
const BUDGET = validMoney(); // 25_000 USD

function openLedger(): PaymentLedger {
  return openPaymentLedger({
    requestId: REQUEST,
    tenantId: TENANT,
    correlationId: CORR,
    currency: 'USD',
    truth: 'demo',
    now: FIXED_NOW,
  });
}

async function expectCode(action: () => unknown, code: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentError);
    expect((error as PaymentError).code).toBe(code);
    return;
  }
  throw new Error(`expected a PaymentError with code ${code}`);
}

async function driveToHeld(): Promise<PaymentLedger> {
  const ledger = openLedger();
  const result = await applyHoldOperation(ledger, {
    amount: BUDGET,
    operationKey: 'op-hold',
    lifecycleState: 'created',
    now: FIXED_NOW,
  });
  return result.ledger;
}

async function driveToAccepted(): Promise<PaymentLedger> {
  let ledger = await driveToHeld();
  ledger = (
    await applyOfferOperation(ledger, {
      amount: BUDGET,
      operationKey: 'op-offer',
      lifecycleState: 'offered',
      now: FIXED_NOW,
    })
  ).ledger;
  ledger = (
    await applyAcceptanceOperation(ledger, {
      operationKey: 'op-accept',
      lifecycleState: 'accepted',
      now: FIXED_NOW,
    })
  ).ledger;
  return ledger;
}

async function driveToCaptured(): Promise<PaymentLedger> {
  const ledger = await driveToAccepted();
  return (
    await applyCaptureOperation(ledger, {
      amount: BUDGET,
      operationKey: 'op-capture',
      lifecycleState: 'accepted',
      now: FIXED_NOW,
    })
  ).ledger;
}

describe('ledger — construction', () => {
  it('opens an empty demo ledger in state opened', () => {
    const ledger = openLedger();
    expect(ledger.state).toBe('opened');
    expect(ledger.entries).toHaveLength(0);
    expect(ledger.truth).toBe('demo');
    expect(ledger.currency).toBe('USD');
    expect(isPaymentLedger(ledger)).toBe(true);
    expect(ledgerBalances(ledger)).toEqual({
      'customer-source': '0',
      escrow: '0',
      payable: '0',
      'platform-fee': '0',
      'expert-payout': '0',
      refunds: '0',
    });
  });

  it('rejects malformed ledger openings (ids, truth, currency)', async () => {
    await expectCode(
      () => openPaymentLedger({ ...openLedgerInput(), requestId: 'bad request!' }),
      PAYMENTS_ERROR_CODES.INVALID_REQUEST,
    );
    expect(() => openPaymentLedger({ ...openLedgerInput(), tenantId: 'Bad_Tenant' })).toThrowError(
      /invalid tenant id/,
    );
    await expectCode(
      () => openPaymentLedger({ ...openLedgerInput(), truth: 'fake' as never }),
      PAYMENTS_ERROR_CODES.INVALID_REQUEST,
    );
    await expectCode(
      () => openPaymentLedger({ ...openLedgerInput(), currency: 'usd' }),
      PAYMENTS_ERROR_CODES.INVALID_MONEY,
    );
  });
});

function openLedgerInput() {
  return {
    requestId: REQUEST,
    tenantId: TENANT,
    correlationId: CORR,
    currency: 'USD',
    truth: 'demo' as const,
    now: FIXED_NOW,
  };
}

describe('ledger — the commercial happy path (hold → offer → accept → capture → release)', () => {
  it('HOLD records the budget: dr customer-source / cr escrow', async () => {
    const result = await applyHoldOperation(openLedger(), {
      amount: BUDGET,
      operationKey: 'op-hold',
      lifecycleState: 'created',
      now: FIXED_NOW,
    });
    expect(result.outcome).toBe('applied');
    expect(result.ledger.state).toBe('held');
    expect(heldFunds(result.ledger)).toBe('25000');
    expect(result.entry.lines).toEqual([
      { account: 'customer-source', side: 'debit', minorUnits: '25000' },
      { account: 'escrow', side: 'credit', minorUnits: '25000' },
    ]);
    expect(result.auditEvent.kind).toBe('payment.hold.recorded');
    expect(result.ledger.auditEvents).toHaveLength(1);
  });

  it('OFFER/ACCEPTANCE are commercial markers (no money movement)', async () => {
    const ledger = await driveToAccepted();
    expect(ledger.state).toBe('accepted');
    expect(ledger.entries.map((entry) => entry.kind)).toEqual(['hold', 'offer', 'acceptance']);
    expect(ledger.entries[1]?.lines).toHaveLength(0);
    expect(ledger.entries[2]?.lines).toHaveLength(0);
    expect(heldFunds(ledger)).toBe('25000');
    expect(ledger.auditEvents.map((event) => event.kind)).toEqual([
      'payment.hold.recorded',
      'payment.offer.recorded',
      'payment.acceptance.recorded',
    ]);
  });

  it('CAPTURE at ACCEPTED commits the full held budget to payable', async () => {
    const ledger = await driveToCaptured();
    expect(ledger.state).toBe('captured');
    expect(heldFunds(ledger)).toBe('0');
    expect(committedFunds(ledger)).toBe('25000');
    expect(ledger.entries[3]?.lines).toEqual([
      { account: 'escrow', side: 'debit', minorUnits: '25000' },
      { account: 'payable', side: 'credit', minorUnits: '25000' },
    ]);
  });

  it('RELEASE splits the committed funds into platform fee + expert payout', async () => {
    const ledger = await driveToCaptured();
    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET);
    const result = await applyReleaseOperation(ledger, {
      schedule: ARENA_REFERENCE_FEE_SCHEDULE,
      split,
      operationKey: 'op-release',
      lifecycleState: 'result_accepted',
      now: FIXED_NOW,
      providerTransferIds: ['dtx-demo-1', 'dtx-demo-2'],
    });
    expect(result.ledger.state).toBe('released');
    expect(isTerminalLedgerState(result.ledger.state)).toBe(true);
    const balances = ledgerBalances(result.ledger);
    expect(balances.payable).toBe('0');
    expect(balances['platform-fee']).toBe('2500');
    expect(balances['expert-payout']).toBe('22500');
    expect(result.entry.lines).toEqual([
      { account: 'payable', side: 'debit', minorUnits: '25000' },
      { account: 'platform-fee', side: 'credit', minorUnits: '2500' },
      { account: 'expert-payout', side: 'credit', minorUnits: '22500' },
    ]);
    expect(result.entry.providerTransferIds).toEqual(['dtx-demo-1', 'dtx-demo-2']);
    expect(result.auditEvent.kind).toBe('payment.release.recorded');
    expect(
      (result.auditEvent.summary as { amounts: Record<string, string> }).amounts.platformFeeMinorUnits,
    ).toBe('2500');
  });
});

describe('ledger — lifecycle binding (expired/revoked commercial state guards)', () => {
  it('each operation is allowed only from its closed lifecycle allowlist', () => {
    expect(OPERATION_LIFECYCLE_ALLOWLISTS.release).toEqual(['result_accepted']);
    expect(OPERATION_LIFECYCLE_ALLOWLISTS.refund).toEqual([
      'revision_required',
      'result_rejected',
      'cancelled',
      'timed_out',
    ]);
    expect(OPERATION_LIFECYCLE_ALLOWLISTS.hold).toContain('created');
  });

  it('HOLD before acceptance states only — payout states deny the hold', async () => {
    const verdict = checkLedgerOperation(openLedger(), 'hold', { kind: 'hold', amountMinorUnits: toMinorUnits('1') }, {
      lifecycleState: 'paid',
      now: FIXED_NOW,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('lifecycle_state_not_allowed');
    await expectCode(
      () =>
        applyHoldOperation(openLedger(), {
          amount: BUDGET,
          operationKey: 'op-hold-late',
          lifecycleState: 'paid',
          now: FIXED_NOW,
        }),
      PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED,
    );
  });

  it('RELEASE on a cancelled escalation (revoked commercial state) is denied', async () => {
    const ledger = await driveToCaptured();
    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET);
    await expect(
      applyReleaseOperation(ledger, {
        schedule: ARENA_REFERENCE_FEE_SCHEDULE,
        split,
        operationKey: 'op-release-cancelled',
        lifecycleState: 'cancelled',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED }));
  });

  it('RELEASE on an expired (timed_out) escalation is denied', async () => {
    const ledger = await driveToCaptured();
    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET);
    await expect(
      applyReleaseOperation(ledger, {
        schedule: ARENA_REFERENCE_FEE_SCHEDULE,
        split,
        operationKey: 'op-release-timedout',
        lifecycleState: 'timed_out',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED }));
  });

  it('RELEASE on an already-PAID escalation is denied (duplicate payout path)', async () => {
    const ledger = await driveToCaptured();
    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET);
    await expect(
      applyReleaseOperation(ledger, {
        schedule: ARENA_REFERENCE_FEE_SCHEDULE,
        split,
        operationKey: 'op-release-paid',
        lifecycleState: 'paid',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED }));
  });

  it('cross-tenant operations are typed denials', async () => {
    const ledger = await driveToHeld();
    await expect(
      applyOfferOperation(ledger, {
        amount: BUDGET,
        operationKey: 'op-offer-x',
        lifecycleState: 'offered',
        now: FIXED_NOW,
        tenantId: 'tenant-beta',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.CROSS_TENANT_ACCESS }));
  });
});

describe('ledger — money guards', () => {
  it('offer above the held budget is denied', async () => {
    const ledger = await driveToHeld();
    await expect(
      applyOfferOperation(ledger, {
        amount: toMoney({ amount: '25001', currency: 'USD' }),
        operationKey: 'op-offer-over',
        lifecycleState: 'offered',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.INSUFFICIENT_FUNDS }));
  });

  it('capture must be exactly the full held budget', async () => {
    const ledger = await driveToAccepted();
    await expect(
      applyCaptureOperation(ledger, {
        amount: toMoney({ amount: '10000', currency: 'USD' }),
        operationKey: 'op-capture-partial',
        lifecycleState: 'accepted',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.INSUFFICIENT_FUNDS }));
  });

  it('a currency-mismatched operation is denied (never converted)', async () => {
    await expectCode(
      () =>
        applyHoldOperation(openLedger(), {
          amount: toMoney({ amount: '25000', currency: 'EUR' }),
          operationKey: 'op-hold-eur',
          lifecycleState: 'created',
          now: FIXED_NOW,
        }),
      PAYMENTS_ERROR_CODES.CURRENCY_MISMATCH,
    );
  });

  it('zero/negative amounts are denied', async () => {
    await expect(
      applyHoldOperation(openLedger(), {
        amount: toMoney({ amount: '0', currency: 'USD' }),
        operationKey: 'op-hold-zero',
        lifecycleState: 'created',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(/INVALID_TRANSITION|amount_not_positive/);
  });

  it('release gross must equal the committed funds', async () => {
    const ledger = await driveToCaptured();
    const wrongGross = {
      ...computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET),
      grossMinorUnits: toMinorUnits('999'),
    };
    await expect(
      applyReleaseOperation(ledger, {
        schedule: ARENA_REFERENCE_FEE_SCHEDULE,
        split: wrongGross,
        operationKey: 'op-release-wrong-gross',
        lifecycleState: 'result_accepted',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError();
  });

  it('a tampered caller-supplied split is refused at the ledger', async () => {
    const ledger = await driveToCaptured();
    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET);
    const tampered = {
      ...split,
      platformFeeMinorUnits: toMinorUnits('20000'),
      expertPayoutMinorUnits: toMinorUnits('5000'),
    };
    await expect(
      applyReleaseOperation(ledger, {
        schedule: ARENA_REFERENCE_FEE_SCHEDULE,
        split: tampered,
        operationKey: 'op-release-tamper',
        lifecycleState: 'result_accepted',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.SPLIT_MISMATCH }));
  });
});

describe('ledger — refund paths (explicit states, never silent reversals)', () => {
  it('full refund from held (cancellation) → refunded terminal, funds returned', async () => {
    const ledger = await driveToHeld();
    const result = await applyRefundOperation(ledger, {
      amount: BUDGET,
      reason: 'cancelled',
      operationKey: 'op-refund-1',
      lifecycleState: 'cancelled',
      now: FIXED_NOW,
    });
    expect(result.ledger.state).toBe('refunded');
    expect(isTerminalLedgerState(result.ledger.state)).toBe(true);
    const balances = ledgerBalances(result.ledger);
    expect(balances.escrow).toBe('0');
    expect(balances.refunds).toBe('25000');
    expect(result.auditEvent.kind).toBe('payment.refund.recorded');
  });

  it('full refund from captured (revision required) → refunded terminal', async () => {
    const ledger = await driveToCaptured();
    const result = await applyRefundOperation(ledger, {
      amount: BUDGET,
      reason: 'revision_required',
      operationKey: 'op-refund-2',
      lifecycleState: 'revision_required',
      now: FIXED_NOW,
    });
    expect(result.ledger.state).toBe('refunded');
    expect(ledgerBalances(result.ledger).payable).toBe('0');
    expect(ledgerBalances(result.ledger).refunds).toBe('25000');
  });

  it('partial refund keeps the commercial state; only a full sweep is terminal', async () => {
    const ledger = await driveToCaptured();
    const partial = await applyRefundOperation(ledger, {
      amount: toMoney({ amount: '10000', currency: 'USD' }),
      reason: 'result_rejected',
      operationKey: 'op-refund-3',
      lifecycleState: 'result_rejected',
      now: FIXED_NOW,
    });
    expect(partial.ledger.state).toBe('captured');
    expect(availableForRefund(partial.ledger)).toBe('15000');
    const rest = await applyRefundOperation(partial.ledger, {
      amount: toMoney({ amount: '15000', currency: 'USD' }),
      reason: 'result_rejected',
      operationKey: 'op-refund-4',
      lifecycleState: 'result_rejected',
      now: FIXED_NOW,
    });
    expect(rest.ledger.state).toBe('refunded');
  });

  it('refund above the available funds is denied', async () => {
    const ledger = await driveToHeld();
    await expect(
      applyRefundOperation(ledger, {
        amount: toMoney({ amount: '25001', currency: 'USD' }),
        reason: 'timed_out',
        operationKey: 'op-refund-over',
        lifecycleState: 'timed_out',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.INSUFFICIENT_FUNDS }));
  });

  it('refund on a healthy in-flight lifecycle state is denied', async () => {
    const ledger = await driveToHeld();
    await expect(
      applyRefundOperation(ledger, {
        amount: BUDGET,
        reason: 'cancelled',
        operationKey: 'op-refund-bad',
        lifecycleState: 'in_progress',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED }));
  });
});

describe('ledger — terminal finality + append-only discipline', () => {
  it('terminal commercial states are final: every later money operation fails closed', async () => {
    const ledger = await driveToCaptured();
    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET);
    const released = await applyReleaseOperation(ledger, {
      schedule: ARENA_REFERENCE_FEE_SCHEDULE,
      split,
      operationKey: 'op-release',
      lifecycleState: 'result_accepted',
      now: FIXED_NOW,
    });
    // Duplicate payout attempt (new key): terminal denial.
    await expect(
      applyReleaseOperation(released.ledger, {
        schedule: ARENA_REFERENCE_FEE_SCHEDULE,
        split,
        operationKey: 'op-release-again',
        lifecycleState: 'result_accepted',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.TERMINAL_STATE }));
    // Refund after release (double-spend path): terminal denial.
    await expect(
      applyRefundOperation(released.ledger, {
        amount: BUDGET,
        reason: 'dispute_resolved',
        operationKey: 'op-refund-after-release',
        lifecycleState: 'revision_required',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: PAYMENTS_ERROR_CODES.TERMINAL_STATE }));
  });

  it('the closed state machine is coherent (adjacency + terminal lists)', () => {
    expect(LEDGER_STATES).toEqual(['opened', 'held', 'offered', 'accepted', 'captured', 'released', 'refunded']);
    expect(LEDGER_TERMINAL_STATES).toEqual(['released', 'refunded']);
    for (const terminal of LEDGER_TERMINAL_STATES) {
      expect(LEDGER_TRANSITIONS[terminal]).toHaveLength(0);
    }
    expect(LEDGER_TRANSITIONS.captured).toContain('released');
    expect(LEDGER_TRANSITIONS.opened).toEqual(['held']);
  });

  it('history is append-only and immutable in place', async () => {
    const ledger = await driveToCaptured();
    expect(ledger.entries.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(ledger)).toBe(true);
    expect(Object.isFrozen(ledger.entries)).toBe(true);
    for (const entry of ledger.entries) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.lines)).toBe(true);
    }
    expect(() => {
      (ledger as { state: string }).state = 'released';
    }).toThrowError();
  });

  it('timestamps must be monotonically non-decreasing', async () => {
    const ledger = await driveToHeld();
    await expect(
      applyOfferOperation(ledger, {
        amount: BUDGET,
        operationKey: 'op-offer-back',
        lifecycleState: 'offered',
        now: '2026-10-06T00:00:00.000Z',
      }),
    ).rejects.toThrowError(/monotonically/);
  });
});

describe('ledger — tamper evidence (digest chain + integrity)', () => {
  it('a healthy ledger verifies clean', async () => {
    const ledger = await driveToCaptured();
    const verdict = await verifyLedgerIntegrity(ledger);
    expect(verdict).toEqual({ ok: true, reason: 'integrity_ok' });
  });

  it('mutating a committed entry (amount tamper) breaks the chain and is detected', async () => {

    const ledger = await driveToCaptured();
    const tampered = JSON.parse(JSON.stringify(ledger)) as PaymentLedger;
    const holdEntry = tampered.entries[0] as unknown as { lines: { minorUnits: string }[] };
    // Keep the entry BALANCED so ONLY the digest chain trips (an amount
    // tamper that also unbalances is caught even earlier — see below).
    holdEntry.lines[0]!.minorUnits = '99000';
    holdEntry.lines[1]!.minorUnits = '99000';
    const verdict = await verifyLedgerIntegrity(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('integrity_digest_chain');
  });

  it('an unbalanced injected entry is detected (double-entry invariant)', async () => {
    const ledger = await driveToCaptured();
    const tampered = JSON.parse(JSON.stringify(ledger)) as PaymentLedger;
    const captureEntry = tampered.entries[3] as unknown as { lines: { minorUnits: string }[] };
    captureEntry.lines[1]!.minorUnits = '20000'; // debits != credits now
    // Recompute the digest chain with the CANONICAL digest so ONLY the
    // balance invariant trips.
    let prev: string | null = null;
    for (const entry of tampered.entries) {
      const view = { ...entry } as Record<string, unknown>;
      delete view['digest'];
      (entry as { prevDigest: string | null }).prevDigest = prev;
      const digest = await digestCanonical(view as never);
      (entry as { digest: string }).digest = digest;
      prev = digest;
    }
    const verdict = await verifyLedgerIntegrity(tampered);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('integrity_unbalanced_lines');
  });

  it('a broken sequence is detected', async () => {
    const ledger = await driveToCaptured();
    const tampered = JSON.parse(JSON.stringify(ledger)) as PaymentLedger;
    (tampered.entries[1] as unknown as { sequence: number }).sequence = 9;
    const verdict = await verifyLedgerIntegrity(tampered);
    expect(verdict.ok).toBe(false);
    expect(['integrity_bad_sequence', 'integrity_bad_shape']).toContain(verdict.reason);
  });

  it('the structural guard rejects non-ledger values', () => {
    expect(isPaymentLedger(openLedger())).toBe(true);
    expect(isPaymentLedger({ ...openLedger(), state: 'weird' })).toBe(false);
    expect(isPaymentLedger(null)).toBe(false);
    expect(isPaymentLedger('ledger')).toBe(false);
  });
});
