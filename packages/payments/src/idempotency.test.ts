/**
 * Idempotency tests (Work Order C010): every money operation is
 * correlation-addressable and idempotent — duplicate instruction → the
 * SAME recorded outcome (no new entry, no new audit event); same key
 * with a different body → typed PAYMENTS_IDENTITY_CONFLICT.
 */

import { describe, expect, it } from 'vitest';
import {
  ARENA_REFERENCE_FEE_SCHEDULE,
  applyAcceptanceOperation,
  applyCaptureOperation,
  applyOfferOperation,
  applyHoldOperation,
  applyRefundOperation,
  applyReleaseOperation,
  computeFeeSplit,
  openPaymentLedger,
  toMoney,
} from './index.js';
import { PAYMENTS_ERROR_CODES } from './errors.js';
import { FIXED_NOW, validMoney } from './test-support.js';

const BUDGET = validMoney();

function freshLedger() {
  return openPaymentLedger({
    requestId: 'esc_00000000000000000000000000000002',
    tenantId: 'tenant-alpha',
    correlationId: 'corr-0002',
    currency: 'USD',
    truth: 'demo',
    now: FIXED_NOW,
  });
}

describe('idempotent money operations', () => {
  it('a duplicate HOLD replays the recorded outcome verbatim (no new entry)', async () => {
    const ledger = freshLedger();
    const first = await applyHoldOperation(ledger, {
      amount: BUDGET,
      operationKey: 'hold-key-1',
      lifecycleState: 'created',
      now: FIXED_NOW,
    });
    const second = await applyHoldOperation(first.ledger, {
      amount: BUDGET,
      operationKey: 'hold-key-1',
      lifecycleState: 'created',
      now: '2026-10-07T11:00:00.000Z', // later timestamp — still a replay
    });
    expect(second.outcome).toBe('duplicate');
    expect(second.duplicate).toBe(true);
    expect(second.entry).toBe(first.entry);
    expect(second.auditEvent).toBe(first.auditEvent);
    expect(second.ledger).toBe(first.ledger);
    expect(second.ledger.entries).toHaveLength(1);
    expect(second.ledger.auditEvents).toHaveLength(1);
    expect(second.ledger.state).toBe('held');
  });

  it('the same key with a DIFFERENT body is a typed conflict (never a silent rebind)', async () => {
    const ledger = freshLedger();
    const first = await applyHoldOperation(ledger, {
      amount: BUDGET,
      operationKey: 'hold-key-2',
      lifecycleState: 'created',
      now: FIXED_NOW,
    });
    await expect(
      applyHoldOperation(first.ledger, {
        amount: toMoney({ amount: '999', currency: 'USD' }),
        operationKey: 'hold-key-2',
        lifecycleState: 'created',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.IDENTITY_CONFLICT }),
    );
    // The original record is untouched by the failed attempt.
    expect(first.ledger.entries).toHaveLength(1);
  });

  it('capture, release and refund are each idempotent on their operation keys', async () => {
    let ledger = freshLedger();
    ledger = (
      await applyHoldOperation(ledger, {
        amount: BUDGET,
        operationKey: 'k-hold',
        lifecycleState: 'created',
        now: FIXED_NOW,
      })
    ).ledger;
    ledger = (
      await applyOfferOperation(ledger, {
        amount: BUDGET,
        operationKey: 'k-offer',
        lifecycleState: 'offered',
        now: FIXED_NOW,
      })
    ).ledger;
    ledger = (
      await applyAcceptanceOperation(ledger, {
        operationKey: 'k-accept',
        lifecycleState: 'accepted',
        now: FIXED_NOW,
      })
    ).ledger;
    ledger = (
      await applyCaptureOperation(ledger, {
        amount: BUDGET,
        operationKey: 'k-capture',
        lifecycleState: 'accepted',
        now: FIXED_NOW,
      })
    ).ledger;
    const capturedEntries = ledger.entries.length;
    const replayCapture = await applyCaptureOperation(ledger, {
      amount: BUDGET,
      operationKey: 'k-capture',
      lifecycleState: 'accepted',
      now: FIXED_NOW,
    });
    expect(replayCapture.outcome).toBe('duplicate');
    expect(replayCapture.ledger.entries).toHaveLength(capturedEntries);

    const split = computeFeeSplit(ARENA_REFERENCE_FEE_SCHEDULE, BUDGET);
    const released = await applyReleaseOperation(ledger, {
      schedule: ARENA_REFERENCE_FEE_SCHEDULE,
      split,
      operationKey: 'k-release',
      lifecycleState: 'result_accepted',
      now: FIXED_NOW,
    });
    const replayRelease = await applyReleaseOperation(released.ledger, {
      schedule: ARENA_REFERENCE_FEE_SCHEDULE,
      split,
      operationKey: 'k-release',
      lifecycleState: 'result_accepted',
      now: FIXED_NOW,
    });
    expect(replayRelease.outcome).toBe('duplicate');
    expect(replayRelease.ledger).toBe(released.ledger);

    // Refund path: refund then duplicate-refund the same key.
    const refunded = await applyRefundOperation(ledger, {
      amount: BUDGET,
      reason: 'cancelled',
      operationKey: 'k-refund',
      lifecycleState: 'cancelled',
      now: FIXED_NOW,
    });
    const replayRefund = await applyRefundOperation(refunded.ledger, {
      amount: BUDGET,
      reason: 'cancelled',
      operationKey: 'k-refund',
      lifecycleState: 'cancelled',
      now: FIXED_NOW,
    });
    expect(replayRefund.outcome).toBe('duplicate');
    expect(replayRefund.ledger.entries).toHaveLength(refunded.ledger.entries.length);
  });

  it('duplicate detection is scoped per ledger (same key on another ledger is fresh)', async () => {
    const input = {
      amount: BUDGET,
      operationKey: 'shared-key',
      lifecycleState: 'created' as const,
      now: FIXED_NOW,
    };
    const first = await applyHoldOperation(freshLedger(), input);
    const second = await applyHoldOperation(freshLedger(), input);
    expect(first.outcome).toBe('applied');
    expect(second.outcome).toBe('applied');
    expect(first.entry.operationId).not.toBe(second.entry.operationId);
  });

  it('malformed operation keys are rejected up front', async () => {
    await expect(
      applyHoldOperation(freshLedger(), {
        amount: BUDGET,
        operationKey: 'bad key!',
        lifecycleState: 'created',
        now: FIXED_NOW,
      }),
    ).rejects.toThrowError(/operationKey is invalid/);
  });
});
