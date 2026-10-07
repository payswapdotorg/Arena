/**
 * PaymentService integration tests (Work Order C010): the ledger bound
 * to the REAL C001 escalation lifecycle through the injected lifecycle
 * port — the full commercial loop hold → offer → acceptance → capture →
 * release, with escalation.payment.updated events and the ES1.0 cost
 * fields, the refund paths, the dispute surface, and the §18-style
 * adversarial minimums at the SERVICE seam (the domain-level battery
 * lives in packages/payments/src/ledger.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { applyEscalationTransition } from '@arena/escalation';
import type { EscalationRecord } from '@arena/escalation';
import { PAYMENTS_ERROR_CODES, PaymentError, computeFeeSplit, toMinorUnits, toMoney } from '@arena/payments';
import type { ProviderTransferInstruction, ProviderTransferRecord } from '@arena/payments';
import { PaymentService } from './service.js';
import { FixedClock } from './fabric.js';
import {
  FIXED_NOW,
  driveToAccepted,
  driveToResultAccepted,
  escalationDirectory,
  offeredEscalationRecord,
} from './test-support.js';

/** A deterministic fake provider (test double; the DEMO adapter is the reference). */
function fakeProvider(options: { truth?: 'demo' | 'customer'; failKeys?: readonly string[] } = {}) {
  const executed: ProviderTransferInstruction[] = [];
  const byInstructionKey = new Map<string, ProviderTransferRecord>();
  const provider = {
    providerId: 'test-fake-provider',
    truth: options.truth ?? 'demo',
    async transfer(instruction: ProviderTransferInstruction): Promise<ProviderTransferRecord> {
      // Idempotent on instructionKey (the port contract — duplicate
      // instructions replay the recorded transfer record).
      const recorded = byInstructionKey.get(instruction.instructionKey);
      if (recorded !== undefined) return recorded;
      executed.push(instruction);
      if ((options.failKeys ?? []).includes(instruction.instructionKey)) {
        const failed: ProviderTransferRecord = {
          recordVersion: 1,
          providerId: provider.providerId,
          providerTransferId: `ftx_${instruction.instructionKey}`,
          instructionKey: instruction.instructionKey,
          status: 'failed',
          truth: provider.truth,
          occurredAt: new Date(FIXED_NOW).toISOString(),
          failureReason: 'injected failure',
        };
        byInstructionKey.set(instruction.instructionKey, failed);
        return failed;
      }
      const succeeded: ProviderTransferRecord = {
        recordVersion: 1,
        providerId: provider.providerId,
        providerTransferId: `ftx_${instruction.instructionKey}`,
        instructionKey: instruction.instructionKey,
        status: 'succeeded',
        truth: provider.truth,
        occurredAt: new Date(FIXED_NOW).toISOString(),
      };
      byInstructionKey.set(instruction.instructionKey, succeeded);
      return succeeded;
    },
    executed,
  };
  return provider;
}

/** The commercial loop driven over ONE escalation record (the directory is advanced in place). */
async function capturedLedgerService() {
  let record = await offeredEscalationRecord();
  const directory = escalationDirectory(record);
  const provider = fakeProvider();
  const service = new PaymentService({
    clock: new FixedClock(FIXED_NOW),
    lifecycle: directory,
    provider,
  });
  const requestId = record.request.requestId;
  const tenantId = 'tenant-alpha';

  await service.holdBudget({ requestId, tenantId, operationKey: 'hold-1' });
  await service.recordOffer({ requestId, tenantId, operationKey: 'offer-1' });
  record = driveToAccepted(record);
  directory.put(record);
  await service.recordAcceptance({ requestId, tenantId, operationKey: 'accept-1' });
  await service.captureBudget({ requestId, tenantId, operationKey: 'capture-1' });
  return { service, directory, provider, getRecord: () => record, setRecord(next: EscalationRecord) { record = next; } };
}

describe('PaymentService — the commercial loop bound to the C001 lifecycle', () => {
  it('hold → offer → acceptance → capture → release with events and cost fields', async () => {
    let record = await offeredEscalationRecord();
    const directory = escalationDirectory(record);
    const provider = fakeProvider();
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: directory,
      provider,
    });
    const requestId = record.request.requestId;
    const tenantId = 'tenant-alpha';

    // Budget HOLD at creation (pre-acceptance lifecycle state).
    const hold = await service.holdBudget({ requestId, tenantId, operationKey: 'hold-1' });
    expect(hold.outcome).toBe('applied');
    expect(hold.ledger.state).toBe('held');
    expect(hold.emittedEvents).toHaveLength(1);
    expect(hold.emittedEvents[0]?.eventType).toBe('escalation.payment.updated');
    expect(hold.costFields).toEqual({
      amountMinorUnits: 25_000,
      currency: 'USD',
      arenaFeeMinorUnits: 0,
      expertPayoutStatus: 'pending',
    });

    // The commercial offer marker (no money movement).
    const offer = await service.recordOffer({ requestId, tenantId, operationKey: 'offer-1' });
    expect(offer.ledger.state).toBe('offered');

    // ACCEPTED lifecycle → acceptance marker + CAPTURE (full budget commit).
    record = driveToAccepted(record);
    directory.put(record);
    const acceptance = await service.recordAcceptance({ requestId, tenantId, operationKey: 'accept-1' });
    expect(acceptance.ledger.state).toBe('accepted');
    const capture = await service.captureBudget({ requestId, tenantId, operationKey: 'capture-1' });
    expect(capture.ledger.state).toBe('captured');
    expect(capture.costFields.amountMinorUnits).toBe(25_000);

    // Validation passed → RELEASE on completion: the deterministic 10% split.
    record = driveToResultAccepted(record);
    directory.put(record);
    const release = await service.releasePayout({ requestId, tenantId, operationKey: 'release-1' });
    expect(release.ledger.state).toBe('released');
    expect(release.costFields).toEqual({
      amountMinorUnits: 25_000,
      currency: 'USD',
      arenaFeeMinorUnits: 2_500,
      expertPayoutStatus: 'paid',
    });
    // Both provider legs executed (platform 2500 + expert 22500).
    expect(provider.executed.map((instruction) => instruction.destination).sort()).toEqual([
      'expert',
      'platform',
    ]);
    expect(provider.executed.find((i) => i.destination === 'platform')?.amount.minorUnits).toBe('2500');
    expect(provider.executed.find((i) => i.destination === 'expert')?.amount.minorUnits).toBe('22500');
    // Provider execution evidence rides the ledger entry.
    expect(release.entry.providerTransferIds).toHaveLength(2);

    // The commercial audit surface carries every movement.
    const audit = await service.listAuditEvents(requestId, tenantId);
    expect(audit.map((event) => event.kind)).toEqual([
      'payment.hold.recorded',
      'payment.offer.recorded',
      'payment.acceptance.recorded',
      'payment.capture.recorded',
      'payment.release.recorded',
    ]);
  });

  it('every applied money operation emits exactly one escalation.payment.updated event', async () => {
    const record = await offeredEscalationRecord();
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: escalationDirectory(record),
      provider: fakeProvider(),
    });
    const hold = await service.holdBudget({
      requestId: record.request.requestId,
      tenantId: 'tenant-alpha',
      operationKey: 'hold-evt',
    });
    expect(hold.emittedEvents).toHaveLength(1);
    expect(hold.emittedEvents[0]?.data).toMatchObject({
      ledgerState: 'held',
      truth: 'demo',
    });
  });

  it('duplicate surface calls replay the recorded outcome and emit NOTHING', async () => {
    const record = await offeredEscalationRecord();
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: escalationDirectory(record),
      provider: fakeProvider(),
    });
    const first = await service.holdBudget({
      requestId: record.request.requestId,
      tenantId: 'tenant-alpha',
      operationKey: 'hold-dup',
    });
    const second = await service.holdBudget({
      requestId: record.request.requestId,
      tenantId: 'tenant-alpha',
      operationKey: 'hold-dup',
    });
    expect(second.outcome).toBe('duplicate');
    expect(second.ledger).toBe(first.ledger);
    expect(second.emittedEvents).toHaveLength(0);
  });

  it('refund on cancellation returns the held budget (explicit state)', async () => {
    let record = await offeredEscalationRecord();
    const directory = escalationDirectory(record);
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: directory,
      provider: fakeProvider(),
    });
    await service.holdBudget({
      requestId: record.request.requestId,
      tenantId: 'tenant-alpha',
      operationKey: 'hold-r',
    });
    record = applyEscalationTransition(record, 'cancelled', { now: FIXED_NOW });
    directory.put(record);
    const refund = await service.refund({
      requestId: record.request.requestId,
      tenantId: 'tenant-alpha',
      reason: 'cancelled',
      operationKey: 'refund-r',
    });
    expect(refund.ledger.state).toBe('refunded');
    expect(refund.costFields.expertPayoutStatus).toBe('pending');
    expect(refund.costFields.arenaFeeMinorUnits).toBe(0);
  });
});

describe('PaymentService — adversarial minimums (handoff §18 at the service seam)', () => {
  it('duplicate payout attempt: same key replays, different key is a typed terminal denial', async () => {
    const { service, provider, getRecord, setRecord, directory } = await capturedLedgerService();
    const requestId = getRecord().request.requestId;
    const tenantId = 'tenant-alpha';
    setRecord(driveToResultAccepted(getRecord()));
    directory.put(getRecord());

    const first = await service.releasePayout({ requestId, tenantId, operationKey: 'release-dup' });
    expect(first.outcome).toBe('applied');
    expect(provider.executed).toHaveLength(2);

    // Duplicate instruction (same operation key): the provider legs are
    // idempotent on their instruction keys and NOTHING new is recorded.
    const replay = await service.releasePayout({ requestId, tenantId, operationKey: 'release-dup' });
    expect(replay.outcome).toBe('duplicate');
    expect(replay.emittedEvents).toHaveLength(0);
    expect(provider.executed).toHaveLength(2);

    // A SECOND payout attempt under a fresh key is the typed denial.
    await expect(service.releasePayout({ requestId, tenantId, operationKey: 'release-dup-2' })).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.TERMINAL_STATE }),
    );
  });

  it('payout on a revoked escalation state (cancelled) is denied — refund is the only path', async () => {
    const { service, getRecord, setRecord, directory } = await capturedLedgerService();
    const requestId = getRecord().request.requestId;
    const tenantId = 'tenant-alpha';

    // The escalation is revoked after capture: payout must fail closed.
    setRecord(applyEscalationTransition(getRecord(), 'cancelled', { now: FIXED_NOW }));
    directory.put(getRecord());
    await expect(
      service.releasePayout({ requestId, tenantId, operationKey: 'release-revoked' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED }),
    );

    // …and the refund path is the explicit way out.
    const refund = await service.refund({
      requestId,
      tenantId,
      reason: 'cancelled',
      operationKey: 'refund-revoked',
    });
    expect(refund.ledger.state).toBe('refunded');
  });

  it('payout on an expired escalation state (timed_out) is denied', async () => {
    const { service, getRecord, setRecord, directory } = await capturedLedgerService();
    const requestId = getRecord().request.requestId;
    const tenantId = 'tenant-alpha';

    setRecord(applyEscalationTransition(getRecord(), 'timed_out', { now: FIXED_NOW }));
    directory.put(getRecord());
    await expect(
      service.releasePayout({ requestId, tenantId, operationKey: 'release-expired' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED }),
    );
  });

  it('cross-tenant ledger access is a typed denial on every money surface', async () => {
    const record = await offeredEscalationRecord();
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: escalationDirectory(record),
      provider: fakeProvider(),
    });
    const requestId = record.request.requestId;
    await service.holdBudget({ requestId, tenantId: 'tenant-alpha', operationKey: 'hold-x' });

    // Write path (the unscoped probe surfaces the typed cross-tenant failure).
    await expect(
      service.holdBudget({ requestId, tenantId: 'tenant-beta', operationKey: 'hold-x-beta' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.CROSS_TENANT_ACCESS }),
    );
    // Read paths (getLedger / listAuditEvents) fail closed for tenants
    // with no lifecycle visibility: the escalation is invisible.
    await expect(service.getLedger(requestId, 'tenant-beta')).rejects.toThrowError(PaymentError);
    await expect(service.listAuditEvents(requestId, 'tenant-beta')).rejects.toThrowError(PaymentError);
  });

  it('fee-split tampering: a caller-declared inflated split is refused (typed)', async () => {
    const { service, getRecord, setRecord, directory } = await capturedLedgerService();
    const requestId = getRecord().request.requestId;
    const tenantId = 'tenant-alpha';

    setRecord(driveToResultAccepted(getRecord()));
    directory.put(getRecord());
    const honest = computeFeeSplit(service.feeSchedule, toMoney({ amount: 25_000, currency: 'USD' }));
    const tampered = {
      ...honest,
      platformFeeMinorUnits: toMinorUnits('12500'), // inflated 10% → 50%
      expertPayoutMinorUnits: toMinorUnits('12500'),
    };
    await expect(
      service.releasePayout({
        requestId,
        tenantId,
        operationKey: 'release-tamper',
        declaredSplit: tampered,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.SPLIT_MISMATCH }),
    );
    // The ledger was never touched: still captured.
    expect((await service.getLedger(requestId, tenantId)).state).toBe('captured');
  });

  it('refund double-spend: a second refund under a fresh key is a typed terminal denial', async () => {
    let record = await offeredEscalationRecord();
    const directory = escalationDirectory(record);
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: directory,
      provider: fakeProvider(),
    });
    const requestId = record.request.requestId;
    const tenantId = 'tenant-alpha';
    await service.holdBudget({ requestId, tenantId, operationKey: 'hold-ds' });
    record = applyEscalationTransition(record, 'cancelled', { now: FIXED_NOW });
    directory.put(record);

    const first = await service.refund({
      requestId,
      tenantId,
      reason: 'cancelled',
      operationKey: 'refund-ds-1',
    });
    expect(first.ledger.state).toBe('refunded');
    // Double-spend attempt (fresh key): typed denial.
    await expect(
      service.refund({ requestId, tenantId, reason: 'cancelled', operationKey: 'refund-ds-2' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.TERMINAL_STATE }),
    );
    // Same key: duplicate replay (no double refund).
    const replay = await service.refund({
      requestId,
      tenantId,
      reason: 'cancelled',
      operationKey: 'refund-ds-1',
    });
    expect(replay.outcome).toBe('duplicate');
    expect(replay.emittedEvents).toHaveLength(0);
  });
});

describe('PaymentService — dispute/refund request surface (explicit states)', () => {
  it('openDispute → resolveDispute(refund) rides the guarded refund path', async () => {
    let record = await offeredEscalationRecord();
    const directory = escalationDirectory(record);
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: directory,
      provider: fakeProvider(),
    });
    const requestId = record.request.requestId;
    const tenantId = 'tenant-alpha';
    await service.holdBudget({ requestId, tenantId, operationKey: 'hold-dis' });

    const dispute = await service.openDispute({ requestId, tenantId, reason: 'quality' });
    expect(dispute.state).toBe('open');

    record = applyEscalationTransition(record, 'cancelled', { now: FIXED_NOW });
    directory.put(record);
    const { dispute: resolved, refund } = await service.resolveDispute({
      disputeId: dispute.disputeId,
      tenantId,
      resolution: 'refund',
      operationKey: 'dispute-refund-1',
      note: 'outcome materially incomplete',
    });
    expect(resolved.state).toBe('resolved_refund');
    expect(resolved.resolvedAt).toBe(FIXED_NOW);
    expect(refund?.ledger.state).toBe('refunded');
    expect(service.listDisputes(requestId, tenantId)).toHaveLength(1);
  });

  it('a dispute resolution can never silently reverse released money (fail-closed)', async () => {
    const { service, getRecord, setRecord, directory } = await capturedLedgerService();
    const requestId = getRecord().request.requestId;
    const tenantId = 'tenant-alpha';

    setRecord(driveToResultAccepted(getRecord()));
    directory.put(getRecord());
    await service.releasePayout({ requestId, tenantId, operationKey: 'release-dis' });

    const dispute = await service.openDispute({ requestId, tenantId, reason: 'billing' });
    await expect(
      service.resolveDispute({
        disputeId: dispute.disputeId,
        tenantId,
        resolution: 'refund',
        operationKey: 'dispute-refund-impossible',
      }),
    ).rejects.toThrowError(PaymentError);
    // The dispute stays open — a failed resolution is not a reversal.
    expect(service.listDisputes(requestId, tenantId)[0]?.state).toBe('open');
  });

  it('disputes resolve once; unknown disputes and foreign tenants are typed denials', async () => {
    const record = await offeredEscalationRecord();
    const service = new PaymentService({
      clock: new FixedClock(FIXED_NOW),
      lifecycle: escalationDirectory(record),
      provider: fakeProvider(),
    });
    const requestId = record.request.requestId;
    const tenantId = 'tenant-alpha';
    await service.holdBudget({ requestId, tenantId, operationKey: 'hold-dis2' });

    const dispute = await service.openDispute({ requestId, tenantId, reason: 'timeliness' });
    const resolved = await service.resolveDispute({
      disputeId: dispute.disputeId,
      tenantId,
      resolution: 'no_refund',
      operationKey: 'dispute-no-refund',
      note: 'expert met the deadline',
    });
    expect(resolved.dispute.state).toBe('resolved_no_refund');
    await expect(
      service.resolveDispute({ disputeId: dispute.disputeId, tenantId, resolution: 'withdraw', operationKey: 'x' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.TERMINAL_STATE }),
    );
    // Foreign tenant / unknown dispute.
    await expect(
      service.resolveDispute({ disputeId: dispute.disputeId, tenantId: 'tenant-beta', resolution: 'withdraw', operationKey: 'y' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.INVALID_REQUEST }),
    );
    await expect(
      service.openDispute({ requestId, tenantId: 'tenant-beta', reason: 'billing' }),
    ).rejects.toThrowError(PaymentError);
  });
});
