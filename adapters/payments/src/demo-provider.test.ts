/**
 * DemoPaymentProvider tests (Work Order C010): the deterministic DEMO
 * reference adapter for the provider-neutral PaymentProviderPort —
 * determinism, idempotent duplicate replay, same-key body conflicts,
 * the truth-label law, typed shape failures, failure injection and the
 * recorded provider posture (the open production questions).
 */

import { describe, expect, it } from 'vitest';
import { PAYMENTS_ERROR_CODES, PaymentError, toMoney } from '@arena/payments';
import type { Money, ProviderTransferInstruction } from '@arena/payments';
import {
  DEMO_PROVIDER_ID,
  DEMO_PROVIDER_POSTURE,
  DemoPaymentProvider,
  demoTransferInstruction,
} from './demo-provider.js';

const FIXED_NOW = Date.parse('2026-10-07T10:00:00.000Z');
const clock = { now: () => FIXED_NOW };

const AMOUNT: Money = toMoney({ amount: 25_000, currency: 'USD' });

function instruction(overrides: Partial<ProviderTransferInstruction> = {}): ProviderTransferInstruction {
  return demoTransferInstruction({
    instructionKey: 'release-1:platform',
    requestId: 'esc_demo_1',
    tenantId: 'tenant-alpha',
    amount: AMOUNT,
    destination: 'platform',
    correlationId: 'corr-0001',
    ...overrides,
  });
}

describe('DemoPaymentProvider — deterministic demo transfers', () => {
  it('executes a clearly-labelled demo transfer with a deterministic id', async () => {
    const provider = new DemoPaymentProvider({ clock });
    const record = await provider.transfer(instruction());
    expect(record.status).toBe('succeeded');
    expect(record.providerId).toBe(DEMO_PROVIDER_ID);
    expect(record.truth).toBe('demo');
    expect(record.providerTransferId).toMatch(/^dtx_[0-9a-f]{32}$/);
    expect(record.instructionKey).toBe('release-1:platform');
    expect(record.occurredAt).toBe(new Date(FIXED_NOW).toISOString());
    expect(record.details).toMatchObject({
      destination: 'platform',
      requestId: 'esc_demo_1',
      tenantId: 'tenant-alpha',
      amountMinorUnits: '25000',
      currency: 'USD',
    });
  });

  it('is byte-deterministic: two fresh instances produce identical records', async () => {
    const a = await new DemoPaymentProvider({ clock }).transfer(instruction());
    const b = await new DemoPaymentProvider({ clock }).transfer(instruction());
    expect(a).toEqual(b);
    // Different provider ids digests differ (the id is provider-scoped).
    const other = new DemoPaymentProvider({ clock, providerId: 'other-demo' });
    const c = await other.transfer(instruction());
    expect(c.providerTransferId).not.toBe(a.providerTransferId);
  });

  it('duplicate instructions (same key, same body) replay the recorded record — no double execution', async () => {
    const provider = new DemoPaymentProvider({ clock });
    const first = await provider.transfer(instruction());
    const second = await provider.transfer(instruction());
    expect(second).toBe(first);
    expect(provider.listTransfers()).toHaveLength(1);
    expect(provider.findTransfer('release-1:platform')).toBe(first);
  });

  it('the same key with a DIFFERENT body is a typed idempotency conflict', async () => {
    const provider = new DemoPaymentProvider({ clock });
    await provider.transfer(instruction());
    const tampered = instruction({ amount: toMoney({ amount: 30_000, currency: 'USD' }) });
    await expect(provider.transfer(tampered)).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.IDENTITY_CONFLICT }),
    );
    // The log still carries exactly one execution.
    expect(provider.listTransfers()).toHaveLength(1);
  });

  it('TRUTH-LABEL LAW: a customer-truth instruction is refused at the demo seam', async () => {
    const provider = new DemoPaymentProvider({ clock });
    const customerInstruction = {
      ...instruction(),
      truth: 'customer',
    } as ProviderTransferInstruction;
    await expect(provider.transfer(customerInstruction)).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.TRUTH_LABEL_VIOLATION }),
    );
    expect(provider.listTransfers()).toHaveLength(0);
  });

  it('malformed instructions fail closed with typed errors', async () => {
    const provider = new DemoPaymentProvider({ clock });
    // Float-shaped minor units are not money.
    const floaty = instruction({
      amount: { minorUnits: '12.5', currency: 'USD' } as unknown as Money,
    });
    await expect(provider.transfer(floaty)).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.INVALID_MONEY }),
    );
    // Destination outside the closed vocabulary.
    const badDestination = instruction({ destination: 'merchant' as never });
    await expect(provider.transfer(badDestination)).rejects.toThrowError(
      expect.objectContaining({ code: PAYMENTS_ERROR_CODES.INVALID_REQUEST }),
    );
    // Missing idempotency key.
    const keyless = { ...instruction(), instructionKey: '' };
    await expect(provider.transfer(keyless)).rejects.toThrowError(PaymentError);
  });

  it('configured failures are recorded once and replayed verbatim by duplicates', async () => {
    const provider = new DemoPaymentProvider({
      clock,
      failingInstructionKeys: ['release-9:expert'],
    });
    const failed = await provider.transfer(
      instruction({ instructionKey: 'release-9:expert', destination: 'expert' }),
    );
    expect(failed.status).toBe('failed');
    expect(failed.failureReason).toContain('release-9:expert');
    const replay = await provider.transfer(
      instruction({ instructionKey: 'release-9:expert', destination: 'expert' }),
    );
    expect(replay).toBe(failed);
    expect(provider.listTransfers()).toHaveLength(1);
  });

  it('the transfer log is an append-only audit surface in execution order', async () => {
    const provider = new DemoPaymentProvider({ clock });
    await provider.transfer(instruction({ instructionKey: 'release-1:platform' }));
    await provider.transfer(
      instruction({ instructionKey: 'release-1:expert', destination: 'expert' }),
    );
    const log = provider.listTransfers();
    expect(log.map((entry) => entry.instructionKey)).toEqual(['release-1:platform', 'release-1:expert']);
    // Frozen records: appended history is immutable in place.
    expect(() => {
      (log[0] as { instructionKey: string }).instructionKey = 'mutated';
    }).toThrow();
  });

  it('records the declared posture and the open production questions (never guessed)', () => {
    expect(DEMO_PROVIDER_POSTURE.executesCustomerMoney).toBe(false);
    expect(DEMO_PROVIDER_POSTURE.truth).toBe('demo');
    expect(DEMO_PROVIDER_POSTURE.openProductionQuestions).toContain('merchant-of-record responsibilities');
    expect(DEMO_PROVIDER_POSTURE.openProductionQuestions).toContain('tax handling and invoicing');
    expect(DEMO_PROVIDER_POSTURE.openProductionQuestions).toContain(
      'jurisdiction and cross-border constraints',
    );
    expect(DEMO_PROVIDER_POSTURE.openProductionQuestions).toContain(
      'payout and settlement rails and timing',
    );
  });
});
