/**
 * DemoPaymentProvider — the deterministic DEMO reference adapter for the
 * @arena/payments PaymentProviderPort (Work Order C010; issue #77;
 * architecture-lock rule 33: payment providers stay behind the
 * provider-neutral port; boundary rule B4: adapters never import
 * services).
 *
 * WHAT THIS IS:
 *   - a fake provider that executes clearly-labelled DEMO transfers;
 *   - deterministic: the same instruction (body) always produces the
 *     byte-identical transfer record — same providerTransferId, same
 *     fields — across instances and runs (no wall clock, no randomness);
 *   - idempotent on the instruction key: a duplicate instruction replays
 *     the recorded record verbatim; a same-key instruction with a
 *     DIFFERENT body is a typed idempotency conflict (never a silent
 *     rebind) — the duplicate-payout guard at the provider seam;
 *   - THE TRUTH-LABEL LAW is enforced HERE as defense in depth: demo
 *     money is never customer money, so an instruction asserting
 *     `truth: 'customer'` is a typed refusal;
 *   - the transfer log is an append-only, in-memory reference fabric
 *     (real provider-side persistence/settlement is a production
 *     provider concern behind this port).
 *
 * WHAT THIS IS NOT (provider posture — explicit OPEN production
 * questions, recorded not guessed; see PROVIDER_POSTURE_OPEN_QUESTIONS
 * and the package README):
 *   - a merchant-of-record;
 *   - a settlement rail with real payout timing;
 *   - a tax/invoicing authority;
 *   - a jurisdiction-aware cross-border mover of money.
 *
 * Hosts wire a REAL provider by implementing PaymentProviderPort the
 * same way; the service layer never learns provider specifics.
 */

import { createHash } from 'node:crypto';
import {
  PAYMENTS_ERROR_CODES,
  PROVIDER_POSTURE_OPEN_QUESTIONS,
  PROVIDER_TRANSFER_VERSION,
  TRANSFER_DESTINATIONS,
  PaymentError,
  isMoney,
} from '@arena/payments';
import type {
  Money,
  PaymentProviderPort,
  ProviderTransferInstruction,
  ProviderTransferRecord,
  TransferDestination,
} from '@arena/payments';

/** Injected time source (epoch milliseconds; never a wall clock). */
export interface Clock {
  now(): number;
}

/** The declared posture of the demo adapter (demo money only). */
export const DEMO_PROVIDER_ID = 'arena-demo-payments-provider';
export const DEMO_PROVIDER_TRUTH = 'demo' as const;

/**
 * The demo adapter's declared posture, machine-readable: it executes
 * demo state ONLY; customer-money settlement requires the production
 * provider decision recorded in PROVIDER_POSTURE_OPEN_QUESTIONS.
 */
export const DEMO_PROVIDER_POSTURE = Object.freeze({
  providerId: DEMO_PROVIDER_ID,
  truth: DEMO_PROVIDER_TRUTH,
  executesCustomerMoney: false,
  openProductionQuestions: PROVIDER_POSTURE_OPEN_QUESTIONS,
} as const);

export interface DemoPaymentProviderConfig {
  /** Injected clock (defaults to the fixed epoch 0 — deterministic). */
  readonly clock?: Clock;
  /**
   * Instruction keys that deterministically FAIL (test/demonstration
   * seam for the service's typed PROVIDER_FAILURE path). A failed
   * instruction is recorded once and its failure is replayed verbatim
   * by duplicates.
   */
  readonly failingInstructionKeys?: readonly string[];
  readonly providerId?: string;
}

/** One executed (or failed) demo transfer, in execution order. */
export interface DemoTransferLogEntry {
  readonly instructionKey: string;
  readonly record: ProviderTransferRecord;
}

function canonicalInstructionView(
  providerId: string,
  instruction: ProviderTransferInstruction,
): string {
  // Flat, field-ordered canonical view — stable across runs and
  // instances (the digest source for the deterministic transfer id).
  return [
    providerId,
    instruction.instructionKey,
    instruction.requestId,
    instruction.tenantId,
    instruction.amount.minorUnits,
    instruction.amount.currency,
    instruction.destination,
    instruction.truth,
    instruction.correlationId,
  ].join('|');
}

function deterministicTransferId(providerId: string, instruction: ProviderTransferInstruction): string {
  const digest = createHash('sha256')
    .update(canonicalInstructionView(providerId, instruction), 'utf8')
    .digest('hex');
  return `dtx_${digest.slice(0, 32)}`;
}

/** Byte-level instruction-body equality (the idempotency conflict guard). */
function sameInstructionBody(a: ProviderTransferInstruction, b: ProviderTransferInstruction): boolean {
  return (
    a.instructionKey === b.instructionKey &&
    a.requestId === b.requestId &&
    a.tenantId === b.tenantId &&
    a.amount.minorUnits === b.amount.minorUnits &&
    a.amount.currency === b.amount.currency &&
    a.destination === b.destination &&
    a.truth === b.truth &&
    a.correlationId === b.correlationId
  );
}

function assertInstructionShape(instruction: ProviderTransferInstruction): void {
  if (typeof instruction !== 'object' || instruction === null) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: 'provider transfer instruction must be an object',
      details: { instructionKey: null },
    });
  }
  if (typeof instruction.instructionKey !== 'string' || instruction.instructionKey.length === 0) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: 'provider transfer instruction requires a non-empty instructionKey (the idempotency key)',
      details: { instructionKey: null },
    });
  }
  if (typeof instruction.requestId !== 'string' || typeof instruction.tenantId !== 'string') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `instruction ${JSON.stringify(instruction.instructionKey)} requires requestId and tenantId`,
      details: { instructionKey: instruction.instructionKey },
    });
  }
  if (!isMoney(instruction.amount)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_MONEY, {
      message: `instruction ${JSON.stringify(instruction.instructionKey)} carries a malformed Money amount (string-scaled minor units + currency, never floats)`,
      details: { instructionKey: instruction.instructionKey },
    });
  }
  if (!(TRANSFER_DESTINATIONS as readonly string[]).includes(instruction.destination)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `instruction ${JSON.stringify(instruction.instructionKey)} destination ${JSON.stringify(instruction.destination)} is not in the closed vocabulary ${JSON.stringify(TRANSFER_DESTINATIONS)}`,
      details: { instructionKey: instruction.instructionKey, destination: instruction.destination },
    });
  }
  if (instruction.truth !== 'demo' && instruction.truth !== 'customer') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `instruction ${JSON.stringify(instruction.instructionKey)} truth ${JSON.stringify(instruction.truth)} is not a money truth label`,
      details: { instructionKey: instruction.instructionKey },
    });
  }
}

/**
 * The deterministic DEMO reference adapter. Wire it through
 * PaymentServiceConfig.provider (services/payments); duplicate
 * instructions replay their recorded outcome; nothing about a real
 * provider is emulated beyond the typed port contract.
 */
export class DemoPaymentProvider implements PaymentProviderPort {
  readonly providerId: string;
  readonly truth: 'demo' = DEMO_PROVIDER_TRUTH;
  private readonly clock: Clock;
  private readonly failingInstructionKeys: ReadonlySet<string>;
  private readonly byInstructionKey = new Map<string, ProviderTransferRecord>();
  private readonly originalByInstructionKey = new Map<string, ProviderTransferInstruction>();
  private readonly log: DemoTransferLogEntry[] = [];

  constructor(config: DemoPaymentProviderConfig = {}) {
    this.providerId = config.providerId ?? DEMO_PROVIDER_ID;
    this.clock = config.clock ?? { now: () => 0 };
    this.failingInstructionKeys = new Set(config.failingInstructionKeys ?? []);
  }

  async transfer(instruction: ProviderTransferInstruction): Promise<ProviderTransferRecord> {
    assertInstructionShape(instruction);
    // TRUTH-LABEL LAW (defense in depth — the service checks it too):
    // demo money is never customer money.
    if (instruction.truth !== this.truth) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.TRUTH_LABEL_VIOLATION, {
        message: `truth-label law violated at the demo provider seam: instruction truth ${JSON.stringify(instruction.truth)} on a ${JSON.stringify(this.truth)} provider — demo money is never customer money`,
        details: {
          providerId: this.providerId,
          instructionKey: instruction.instructionKey,
          instructionTruth: instruction.truth,
          providerTruth: this.truth,
        },
      });
    }
    const recorded = this.byInstructionKey.get(instruction.instructionKey);
    if (recorded !== undefined) {
      // Idempotent replay — but ONLY for the byte-same instruction body
      // (a failed leg replays its recorded failure verbatim, too).
      const original = this.originalByInstructionKey.get(instruction.instructionKey);
      if (original === undefined || !sameInstructionBody(original, instruction)) {
        throw new PaymentError(PAYMENTS_ERROR_CODES.IDENTITY_CONFLICT, {
          message: `instruction key ${JSON.stringify(instruction.instructionKey)} was already used for a different transfer at provider ${this.providerId} — idempotency conflict, never a silent rebind`,
          details: {
            providerId: this.providerId,
            instructionKey: instruction.instructionKey,
            recordedTransferId: recorded.providerTransferId,
          },
        });
      }
      return recorded;
    }
    const record: ProviderTransferRecord = Object.freeze({
      recordVersion: PROVIDER_TRANSFER_VERSION,
      providerId: this.providerId,
      providerTransferId: deterministicTransferId(this.providerId, instruction),
      instructionKey: instruction.instructionKey,
      status: this.failingInstructionKeys.has(instruction.instructionKey) ? 'failed' : 'succeeded',
      truth: this.truth,
      occurredAt: new Date(this.clock.now()).toISOString(),
      ...(this.failingInstructionKeys.has(instruction.instructionKey)
        ? { failureReason: `demo provider: instruction key ${JSON.stringify(instruction.instructionKey)} is configured to fail` }
        : {
            details: {
              destination: instruction.destination,
              requestId: instruction.requestId,
              tenantId: instruction.tenantId,
              correlationId: instruction.correlationId,
              amountMinorUnits: instruction.amount.minorUnits,
              currency: instruction.amount.currency,
            } satisfies Record<string, string>,
          }),
    });
    this.byInstructionKey.set(instruction.instructionKey, record);
    this.originalByInstructionKey.set(instruction.instructionKey, instruction);
    this.log.push(Object.freeze({ instructionKey: instruction.instructionKey, record }));
    return record;
  }

  /** The append-only demo transfer log (audit surface; execution order). */
  listTransfers(): readonly DemoTransferLogEntry[] {
    return Object.freeze([...this.log]);
  }

  /** The recorded outcome for one instruction key (if executed). */
  findTransfer(instructionKey: string): ProviderTransferRecord | undefined {
    return this.byInstructionKey.get(instructionKey);
  }
}

/** Structural helper: build a demo instruction for tests/wiring. */
export function demoTransferInstruction(input: {
  readonly instructionKey: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly amount: Money;
  readonly destination: TransferDestination;
  readonly correlationId: string;
}): ProviderTransferInstruction {
  return Object.freeze({ ...input, truth: DEMO_PROVIDER_TRUTH });
}
