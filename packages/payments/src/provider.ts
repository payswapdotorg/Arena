/**
 * Provider-neutral payment provider port (Work Order C010; issue #77;
 * architecture-lock rule 33: expert payment, Arena fees, settlement and
 * payout are commercial concerns behind provider-neutral adapters and do
 * NOT become domain-specific payment-provider contracts).
 *
 * The port is deliberately minimal and STRUCTURAL:
 *   - a provider executes transfer instructions and returns transfer
 *     records; it never learns Arena lifecycle semantics;
 *   - the reference implementation is the deterministic DEMO adapter in
 *     adapters/payments (a fake provider — no real provider integration
 *     is in scope for C010);
 *   - THE TRUTH-LABEL LAW is enforced HERE at the seam: demo money is
 *     never customer money. A 'customer' ledger may never ride a 'demo'
 *     provider and vice versa (typed PAYMENTS_TRUTH_LABEL_VIOLATION).
 *
 * PROVIDER POSTURE — explicit OPEN PRODUCTION QUESTIONS (recorded, not
 * guessed; the ledger deliberately makes no claim about them):
 *   - merchant-of-record responsibilities;
 *   - payout/settlement rails and timing;
 *   - tax handling and invoicing;
 *   - jurisdiction and cross-border constraints.
 * These are host/composition-root decisions behind this port.
 */

import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';
import type { Money } from './money.js';
import type { MoneyTruth, PlainJsonValue } from './shared.js';
import { isMoneyTruth } from './shared.js';

/** Wire version of the provider transfer record. */
export const PROVIDER_TRANSFER_VERSION = 1 as const;

/** Closed destination vocabulary for a transfer instruction. */
export const TRANSFER_DESTINATIONS = Object.freeze(['platform', 'expert'] as const);
export type TransferDestination = (typeof TRANSFER_DESTINATIONS)[number];

export function isTransferDestination(value: unknown): value is TransferDestination {
  return typeof value === 'string' && (TRANSFER_DESTINATIONS as readonly string[]).includes(value);
}

/** One provider execution instruction (idempotent on instructionKey). */
export interface ProviderTransferInstruction {
  /** Idempotency key for the provider leg (scoped per provider). */
  readonly instructionKey: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly amount: Money;
  readonly destination: TransferDestination;
  /** The truth label the caller asserts for this instruction. */
  readonly truth: MoneyTruth;
  readonly correlationId: string;
}

/** The provider-neutral record of one executed (or refused) transfer. */
export interface ProviderTransferRecord {
  readonly recordVersion: typeof PROVIDER_TRANSFER_VERSION;
  readonly providerId: string;
  readonly providerTransferId: string;
  readonly instructionKey: string;
  readonly status: 'succeeded' | 'failed';
  readonly truth: MoneyTruth;
  readonly occurredAt: string;
  /** Provider-side failure reason (closed at the adapter, free-form here). */
  readonly failureReason?: string;
  readonly details?: PlainJsonValue;
}

export function isProviderTransferRecord(value: unknown): value is ProviderTransferRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === PROVIDER_TRANSFER_VERSION &&
    typeof candidate['providerId'] === 'string' &&
    typeof candidate['providerTransferId'] === 'string' &&
    typeof candidate['instructionKey'] === 'string' &&
    (candidate['status'] === 'succeeded' || candidate['status'] === 'failed') &&
    isMoneyTruth(candidate['truth']) &&
    typeof candidate['occurredAt'] === 'string'
  );
}

/**
 * THE provider seam. Real providers (marketplace payment providers with
 * platform application fees) implement this behind adapters; the
 * deterministic reference implementation is the DEMO adapter
 * (adapters/payments) which produces clearly-labelled demo state.
 */
export interface PaymentProviderPort {
  /** Stable provider identity (adapter-supplied). */
  readonly providerId: string;
  /** Whether this provider executes demo or customer money. */
  readonly truth: MoneyTruth;
  /** Execute one transfer instruction (idempotent on instructionKey). */
  transfer(instruction: ProviderTransferInstruction): Promise<ProviderTransferRecord>;
}

export const TRUTH_LABEL_VIOLATION_REASONS = Object.freeze([
  'customer_ledger_on_demo_provider',
  'demo_ledger_on_customer_provider',
  'instruction_truth_mismatch',
] as const);
export type TruthLabelViolationReason = (typeof TRUTH_LABEL_VIOLATION_REASONS)[number];

export type TruthLabelVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: TruthLabelViolationReason };

/**
 * The truth-label law as a pure check: demo money is never customer
 * money. The ledger's truth, the instruction's truth and the provider's
 * truth must all agree.
 */
export function checkTruthLabelLaw(
  ledgerTruth: MoneyTruth,
  providerTruth: MoneyTruth,
  instructionTruth?: MoneyTruth,
): TruthLabelVerdict {
  if (ledgerTruth === 'customer' && providerTruth === 'demo') {
    return { ok: false, reason: 'customer_ledger_on_demo_provider' };
  }
  if (ledgerTruth === 'demo' && providerTruth === 'customer') {
    return { ok: false, reason: 'demo_ledger_on_customer_provider' };
  }
  if (instructionTruth !== undefined && instructionTruth !== providerTruth) {
    return { ok: false, reason: 'instruction_truth_mismatch' };
  }
  return { ok: true };
}

/** Throwing form of the truth-label law (typed violation). */
export function assertTruthLabelLaw(
  ledgerTruth: MoneyTruth,
  providerTruth: MoneyTruth,
  instructionTruth?: MoneyTruth,
): void {
  const verdict = checkTruthLabelLaw(ledgerTruth, providerTruth, instructionTruth);
  if (!verdict.ok) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.TRUTH_LABEL_VIOLATION, {
      message: `truth-label law violated (${verdict.reason}): ledger=${ledgerTruth} provider=${providerTruth}${instructionTruth === undefined ? '' : ` instruction=${instructionTruth}`} — demo money is never customer money`,
      details: { reason: verdict.reason, ledgerTruth, providerTruth, instructionTruth: instructionTruth ?? null },
    });
  }
}

/**
 * The declared provider posture for C010: the reference adapter is DEMO
 * state only; customer-money settlement requires a production provider
 * decision (MoR/tax/jurisdiction) that remains an OPEN production
 * question — recorded here so every consumer of the port sees it.
 */
export const PROVIDER_POSTURE_OPEN_QUESTIONS: readonly string[] = Object.freeze([
  'merchant-of-record responsibilities',
  'payout and settlement rails and timing',
  'tax handling and invoicing',
  'jurisdiction and cross-border constraints',
]);
