/**
 * Unit-economics record tests (Work Order C016): the compile path (the
 * ONLY construction path — ledger REQUIRED), determinism, missing-input
 * disclosure, append/supersession/idempotent replay, cross-tenant
 * denials, tampered-ledger fail-closed.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityEconomicsError } from './errors.js';
import {
  appendUnitEconomics,
  compileUnitEconomics,
  isUnitEconomicsRecord,
} from './record.js';
import { ARENA_REFERENCE_ECONOMICS_POLICY } from './policy.js';
import { createCapabilityLiftValueRecord } from './value.js';
import {
  acceptedValidationFixture,
  effortFixture,
  expertRoutingFixture,
  settledLedgerFixture,
} from './test-support.js';

const RECORDED_AT = '2026-10-08T12:00:00.000Z';

async function fullInput() {
  const ledger = await settledLedgerFixture();
  const value = await createCapabilityLiftValueRecord({
    requestId: ledger.requestId,
    tenantId: ledger.tenantId,
    capabilityId: 'cap.nlp.translation',
    pinnedEvaluationPopulationRef: 'evalpop:fixed-2026q4',
    verificationAuditRef: 'audit:0007',
    evaluatorVersionBefore: 'c'.repeat(64),
    evaluatorVersionAfter: 'c'.repeat(64),
    protectedCapabilityRegression: { capabilityId: 'cap.nlp.summarize', measuredDelta: -0.01 },
    uncertainty: { reported: true, variance: '0.021', material: true },
    claimedLiftPoints: 12,
    effortMinutes: 90,
    recordedAt: RECORDED_AT,
  });
  return {
    ledger,
    correlationId: 'corr-econ-0001',
    validation: acceptedValidationFixture(),
    routing: expertRoutingFixture(),
    effort: effortFixture(),
    value,
    context: { capabilityId: 'cap.nlp.translation', domain: 'nlp' },
    policy: ARENA_REFERENCE_ECONOMICS_POLICY,
    recordedAt: RECORDED_AT,
  };
}

describe('compileUnitEconomics', () => {
  it('compiles the full fixture: C010-backed figures, effort, routing, validation, value', async () => {
    const input = await fullInput();
    const record = await compileUnitEconomics(input);
    expect(isUnitEconomicsRecord(record)).toBe(true);
    expect(record.requestId).toBe('req-econ-0001');
    expect(record.tenantId).toBe('tenant-econ');
    expect(record.currency).toBe('USD');
    expect(record.truth).toBe('customer');
    expect(record.commercial.grossCapturedMinorUnits).toBe('25000');
    expect(record.commercial.platformFeeMinorUnits).toBe('2500');
    expect(record.commercial.expertPayoutMinorUnits).toBe('22500');
    expect(record.effort?.sessionDurationMinutes).toBe(90);
    expect(record.routing?.primaryResourceClass).toBe('expert');
    expect(record.validation?.verdict).toBe('accepted');
    expect(record.value?.liftPoints).toBe(12);
    expect(record.missingInputs).toEqual([]);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.economicsId).toMatch(/^econ_[0-9a-f]{32}$/);
  });

  it('is deterministic: identical inputs → identical economicsId AND digest', async () => {
    const a = await compileUnitEconomics(await fullInput());
    const b = await compileUnitEconomics(await fullInput());
    expect(a.economicsId).toBe(b.economicsId);
    expect(a.digest).toBe(b.digest);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('requires the ledger (no C010 backing → unrepresentable, typed)', async () => {
    const input = await fullInput();
    const ledgerless = { ...input, ledger: undefined } as unknown as Parameters<
      typeof compileUnitEconomics
    >[0];
    await expect(compileUnitEconomics(ledgerless)).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LEDGER_BACKING_MISSING',
    });
  });

  it('fails closed on a TAMPERED ledger (digest chain broken → no economics)', async () => {
    const ledger = await settledLedgerFixture();
    const entries = [...ledger.entries];
    const first = entries[0];
    if (first !== undefined && first.kind === 'hold') {
      entries[0] = {
        ...first,
        payload: { kind: 'hold', amountMinorUnits: '99999' },
      } as typeof first;
    }
    const tampered = { ...ledger, entries } as typeof ledger;
    await expect(
      compileUnitEconomics({
        ledger: tampered,
        correlationId: 'corr-econ-0001',
        policy: ARENA_REFERENCE_ECONOMICS_POLICY,
        recordedAt: RECORDED_AT,
      }),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LEDGER_INTEGRITY',
    });
  });

  it('records missing optional inputs with closed reasons (never defaulted)', async () => {
    const ledger = await settledLedgerFixture();
    const record = await compileUnitEconomics({
      ledger,
      correlationId: 'corr-econ-0001',
      policy: ARENA_REFERENCE_ECONOMICS_POLICY,
      recordedAt: RECORDED_AT,
    });
    expect(record.validation).toBeNull();
    expect(record.routing).toBeNull();
    expect(record.effort).toBeNull();
    expect(record.value).toBeNull();
    expect([...record.missingInputs]).toEqual([
      'validation-outcome-unavailable',
      'routing-decision-unavailable',
      'effort-signals-unavailable',
      'value-record-not-linked',
    ]);
  });

  it('refuses a value record from another tenant/request (typed CROSS_TENANT)', async () => {
    const input = await fullInput();
    const foreignValue = await createCapabilityLiftValueRecord({
      requestId: 'req-other-9999',
      tenantId: 'tenant-other',
      capabilityId: 'cap.nlp.translation',
      pinnedEvaluationPopulationRef: 'evalpop:fixed-2026q4',
      verificationAuditRef: 'audit:0007',
      evaluatorVersionBefore: 'c'.repeat(64),
      evaluatorVersionAfter: 'c'.repeat(64),
      protectedCapabilityRegression: { capabilityId: 'cap.nlp.summarize', measuredDelta: 0 },
      uncertainty: { reported: true, variance: '0.021', material: true },
      recordedAt: RECORDED_AT,
    });
    await expect(
      compileUnitEconomics({ ...input, value: foreignValue }),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_CROSS_TENANT_ACCESS',
    });
  });

  it('rejects a smuggled score field on the record view (no-collapse law)', async () => {
    const record = await compileUnitEconomics(await fullInput());
    expect(isUnitEconomicsRecord(record)).toBe(true);
    expect(() =>
      isUnitEconomicsRecord({ ...record, roi: '0.42' } as unknown),
    ).toThrowError(CapabilityEconomicsError);
  });
});

describe('appendUnitEconomics (supersession by append)', () => {
  it('appends a new record, replays an identical recompute verbatim', async () => {
    const input = await fullInput();
    const record = await compileUnitEconomics(input);
    const first = await appendUnitEconomics([], record);
    expect(first.outcome).toBe('appended');
    expect(first.history.length).toBe(1);
    const replay = await appendUnitEconomics(first.history, record);
    expect(replay.outcome).toBe('replay');
    expect(replay.history.length).toBe(1);
  });

  it('supersedes by APPEND when the recomputed state changed (prior retained)', async () => {
    const input = await fullInput();
    const firstRecord = await compileUnitEconomics(input);
    const appended = await appendUnitEconomics([], firstRecord);
    // Recompute with a changed validation outcome at a LATER time.
    const changedRecord = await compileUnitEconomics({
      ...input,
      validation: acceptedValidationFixture({ attemptNumber: 2, verdict: 'revision_required' }),
      recordedAt: '2026-10-08T13:00:00.000Z',
    });
    expect(changedRecord.economicsId).not.toBe(firstRecord.economicsId);
    const superseded = await appendUnitEconomics(appended.history, changedRecord);
    expect(superseded.outcome).toBe('appended');
    expect(superseded.history.length).toBe(2);
    expect(superseded.history[0]).toBe(firstRecord); // prior retained
  });

  it('denies cross-tenant appends at the domain level', async () => {
    const ledgerA = await settledLedgerFixture();
    const ledgerB = await settledLedgerFixture({ tenantId: 'tenant-other' });
    const recordA = await compileUnitEconomics({
      ledger: ledgerA,
      correlationId: 'corr-a',
      policy: ARENA_REFERENCE_ECONOMICS_POLICY,
      recordedAt: RECORDED_AT,
    });
    const recordB = await compileUnitEconomics({
      ledger: ledgerB,
      correlationId: 'corr-b',
      policy: ARENA_REFERENCE_ECONOMICS_POLICY,
      recordedAt: RECORDED_AT,
    });
    await expect(appendUnitEconomics([recordA], recordB)).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_CROSS_TENANT_ACCESS',
    });
  });

  it('denies mixed-request histories (one history per request)', async () => {
    const ledgerA = await settledLedgerFixture();
    const ledgerB = await settledLedgerFixture({ requestId: 'req-econ-0002' });
    const recordA = await compileUnitEconomics({
      ledger: ledgerA,
      correlationId: 'corr-a',
      policy: ARENA_REFERENCE_ECONOMICS_POLICY,
      recordedAt: RECORDED_AT,
    });
    const recordB = await compileUnitEconomics({
      ledger: ledgerB,
      correlationId: 'corr-b',
      policy: ARENA_REFERENCE_ECONOMICS_POLICY,
      recordedAt: RECORDED_AT,
    });
    await expect(appendUnitEconomics([recordA], recordB)).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_INVALID_INPUT',
    });
  });
});
