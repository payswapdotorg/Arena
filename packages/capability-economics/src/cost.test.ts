/**
 * Cost-basis tests (Work Order C016): the no-money-truth invariant —
 * every cost figure folded ONLY out of a real, integrity-verified C010
 * ledger; determinism; truth inheritance; fail-closed paths.
 */

import { describe, expect, it } from 'vitest';
import { applyRefundOperation, toMoney } from '@arena/payments';
import type { LedgerIntegrityVerdict, PaymentLedger } from '@arena/payments';
import { CapabilityEconomicsError } from './errors.js';
import { commercialBasisOfLedger, foldCommercialBasis } from './cost.js';
import {
  FIXED_GROSS_MINOR_UNITS,
  settledLedgerFixture,
  settledFixtureSplit,
} from './test-support.js';

const INTEGRITY_OK: LedgerIntegrityVerdict = { ok: true, reason: 'integrity_ok' };

describe('commercialBasisOfLedger (the no-money-truth fold)', () => {
  it('folds the settled fixture: gross, fee legs, settlement state, provenance', async () => {
    const ledger = await settledLedgerFixture();
    const basis = await commercialBasisOfLedger(ledger, INTEGRITY_OK);
    const split = settledFixtureSplit();
    expect(basis.settlementState).toBe('released');
    expect(basis.currency).toBe('USD');
    expect(basis.grossCapturedMinorUnits).toBe(String(FIXED_GROSS_MINOR_UNITS));
    expect(basis.platformFeeMinorUnits).toBe(split.platformFeeMinorUnits);
    expect(basis.expertPayoutMinorUnits).toBe(split.expertPayoutMinorUnits);
    expect(basis.refundedMinorUnits).toBe('0');
    expect(basis.heldRemainingMinorUnits).toBe('0');
    expect(basis.captureSequences).toEqual([4]);
    expect(basis.releaseSequence).toBe(5);
    expect(basis.refundSequences).toEqual([]);
    expect(basis.feeScheduleId).toBe('arena-reference');
    expect(basis.feeScheduleVersion).toBe(1);
    // Provenance: the chain head digest is addressable.
    expect(basis.ledgerHeadDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: identical ledger → identical basis (byte-for-byte)', async () => {
    const ledger = await settledLedgerFixture();
    const a = await commercialBasisOfLedger(ledger, INTEGRITY_OK);
    const b = await commercialBasisOfLedger(ledger, INTEGRITY_OK);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('fails closed on a failed C010 integrity verification', async () => {
    const ledger = await settledLedgerFixture();
    await expect(
      commercialBasisOfLedger(ledger, { ok: false, reason: 'integrity_digest_chain', sequence: 2 }),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LEDGER_INTEGRITY',
    });
  });

  it('folds refunds (a refunded ledger reports refunded figures + sequences)', async () => {
    // Build a partially refunded journey: hold → offer → refund of held funds.
    const { openPaymentLedger, applyHoldOperation, applyOfferOperation } = await import(
      '@arena/payments'
    );
    let ledger: PaymentLedger = openPaymentLedger({
      requestId: 'req-refund-0002',
      tenantId: 'tenant-econ',
      correlationId: 'corr-econ-0002',
      currency: 'USD',
      truth: 'customer',
      now: '2026-10-08T11:00:00.000Z',
    });
    ledger = (
      await applyHoldOperation(ledger, {
        amount: toMoney({ amount: 10_000, currency: 'USD' }),
        operationKey: 'op-hold-0001',
        lifecycleState: 'created',
        now: '2026-10-08T11:01:00.000Z',
      })
    ).ledger;
    ledger = (
      await applyOfferOperation(ledger, {
        amount: toMoney({ amount: 10_000, currency: 'USD' }),
        operationKey: 'op-offer-0002',
        lifecycleState: 'offered',
        now: '2026-10-08T11:02:00.000Z',
      })
    ).ledger;
    ledger = (
      await applyRefundOperation(ledger, {
        amount: toMoney({ amount: 4_000, currency: 'USD' }),
        reason: 'cancelled',
        operationKey: 'op-refund-0003',
        lifecycleState: 'cancelled',
        now: '2026-10-08T11:03:00.000Z',
      })
    ).ledger;
    const basis = await foldCommercialBasis(ledger);
    expect(basis.settlementState).toBe('in-flight'); // partial refund keeps the ledger non-terminal until full
    expect(basis.refundedMinorUnits).toBe('4000');
    expect(basis.refundSequences).toEqual([3]);
    expect(basis.grossCapturedMinorUnits).toBe('0');
    expect(basis.platformFeeMinorUnits).toBe('0');
    expect(basis.expertPayoutMinorUnits).toBe('0');
  });

  it('inherits the truth label from the ledger (demo stays demo)', async () => {
    const ledger = await settledLedgerFixture({ truth: 'demo' });
    const basis = await foldCommercialBasis(ledger);
    // The basis itself is truth-neutral; the truth inheritance is asserted at
    // the record level — but the demo ledger is foldable and clearly demo.
    expect(basis.currency).toBe('USD');
    const record = await (
      await import('./record.js')
    ).compileUnitEconomics({
      ledger,
      correlationId: 'corr-econ-0001',
      policy: (await import('./policy.js')).ARENA_REFERENCE_ECONOMICS_POLICY,
      recordedAt: '2026-10-08T12:00:00.000Z',
    });
    expect(record.truth).toBe('demo');
  });

  it('rejects a structurally smuggled basis (unknown field / collapsed score)', async () => {
    const { isCommercialBasis } = await import('./cost.js');
    const ledger = await settledLedgerFixture();
    const basis = await foldCommercialBasis(ledger);
    expect(isCommercialBasis(basis)).toBe(true);
    const smuggledScore = { ...basis, roiScore: '0.42' } as unknown;
    expect(() => isCommercialBasis(smuggledScore)).toThrowError(CapabilityEconomicsError);
    const smuggledField = { ...basis, extraFigure: '1' } as unknown;
    expect(() => isCommercialBasis(smuggledField)).toThrowError(CapabilityEconomicsError);
  });
});
