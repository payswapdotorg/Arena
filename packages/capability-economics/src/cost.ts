/**
 * THE COST BASIS — the no-money-truth core of capability economics
 * (Work Order C016; issue #122; handoff §8 commercial model).
 *
 * LAW (spec/service-boundaries.md — one logical authority per data
 * object): C010 owns the escrow/hold ledger; capability-economics owns
 * the economic VIEW. A `CommercialBasis` — the set of cost figures a
 * unit-economics record carries — is therefore FOLDED out of a real C010
 * `PaymentLedger` and out of NOTHING ELSE:
 *
 *   - there is NO exported constructor that accepts free-standing
 *     amounts: `commercialBasisOfLedger(ledger, integrity)` is the only
 *     production path, and it requires a passed C010 integrity
 *     verification (`verifyLedgerIntegrity` — the sha256 digest chain);
 *   - every figure keeps its provenance (ledger head digest + the entry
 *     sequences it was folded from, the C010 fee-schedule identity on
 *     released ledgers) — every figure is traceable to its owning
 *     record;
 *   - the truth label (demo | customer) is INHERITED from the ledger,
 *     never declared independently — demo money is not customer money;
 *   - arithmetic is BigInt-only over C010 canonical minor-unit strings;
 *     floating point never touches a figure;
 *   - multi-currency is representation only — a basis records the
 *     ledger's declared currency exactly as declared.
 *
 * Fold semantics (over the append-only entry stream):
 *   grossCaptured      = Σ capture amounts
 *   platformFee        = release split platform-fee leg      (0 when unsettled)
 *   expertPayout       = release split expert-payout leg     (0 when unsettled)
 *   refunded           = Σ refund amounts
 *   heldRemaining      = ledger escrow balance (still-held funds)
 *   settlementState    = 'released' | 'refunded' | 'in-flight'
 */

import {
  ledgerBalances,
  verifyLedgerIntegrity,
} from '@arena/payments';
import type { LedgerIntegrityVerdict, PaymentLedger } from '@arena/payments';
import type { MinorUnits } from '@arena/payments';
import { minorUnitsToBigInt, toMinorUnits } from '@arena/payments';
import { CAPABILITY_ECONOMICS_ERROR_CODES, CapabilityEconomicsError } from './errors.js';
import type { EconomicsTruth } from './shared.js';
import { rejectCollapsedScoreFields, rejectUnknownFields } from './shared.js';

/** Wire version of the commercial-basis shape. */
export const COMMERCIAL_BASIS_VERSION = 1 as const;

/** The settlement posture of the underlying C010 ledger. */
export const ECONOMICS_SETTLEMENT_STATES = Object.freeze([
  'released',
  'refunded',
  'in-flight',
] as const);
export type EconomicsSettlementState = (typeof ECONOMICS_SETTLEMENT_STATES)[number];

export function isEconomicsSettlementState(
  value: unknown,
): value is EconomicsSettlementState {
  return (
    typeof value === 'string' &&
    (ECONOMICS_SETTLEMENT_STATES as readonly string[]).includes(value)
  );
}

/**
 * The C010-backed cost figures of ONE intervention. Constructed ONLY by
 * `commercialBasisOfLedger` (and read back via `isCommercialBasis`) —
 * free-standing amounts are unrepresentable.
 */
export interface CommercialBasis {
  readonly commercialVersion: typeof COMMERCIAL_BASIS_VERSION;
  /** The ledger's terminal/in-flight commercial posture. */
  readonly settlementState: EconomicsSettlementState;
  /** The declared currency, exactly as the ledger declared it. */
  readonly currency: string;
  /** Σ capture entry amounts. */
  readonly grossCapturedMinorUnits: MinorUnits;
  /** Release split platform-fee leg ('0' while unsettled). */
  readonly platformFeeMinorUnits: MinorUnits;
  /** Release split expert-payout leg ('0' while unsettled). */
  readonly expertPayoutMinorUnits: MinorUnits;
  /** Σ refund entry amounts. */
  readonly refundedMinorUnits: MinorUnits;
  /** Still-held funds (escrow balance of the ledger). */
  readonly heldRemainingMinorUnits: MinorUnits;
  /**
   * Provenance: the digest of the LAST ledger entry (the chain head).
   * Null only for an empty (just-opened) ledger.
   */
  readonly ledgerHeadDigest: string | null;
  /** The capture entry sequences the gross was folded from. */
  readonly captureSequences: readonly number[];
  /** The release entry sequence (null while unsettled). */
  readonly releaseSequence: number | null;
  /** The refund entry sequences the refunded figure was folded from. */
  readonly refundSequences: readonly number[];
  /** The C010 fee-schedule identity recorded on release (null while unsettled). */
  readonly feeScheduleId: string | null;
  readonly feeScheduleVersion: number | null;
}

export const COMMERCIAL_BASIS_FIELDS = Object.freeze([
  'commercialVersion',
  'settlementState',
  'currency',
  'grossCapturedMinorUnits',
  'platformFeeMinorUnits',
  'expertPayoutMinorUnits',
  'refundedMinorUnits',
  'heldRemainingMinorUnits',
  'ledgerHeadDigest',
  'captureSequences',
  'releaseSequence',
  'refundSequences',
  'feeScheduleId',
  'feeScheduleVersion',
] as const);

function isMinorUnitsFigure(value: unknown): value is MinorUnits {
  return (
    typeof value === 'string' &&
    /^(0|[1-9][0-9]{0,15})$/.test(value) &&
    BigInt(value) <= 9007199254740991n
  );
}

/** Structural guard for wire values claiming to be commercial bases. */
export function isCommercialBasis(value: unknown): value is CommercialBasis {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['commercialVersion'] !== COMMERCIAL_BASIS_VERSION) return false;
  if (!isEconomicsSettlementState(candidate['settlementState'])) return false;
  if (typeof candidate['currency'] !== 'string' || !/^[A-Z]{3}$/.test(candidate['currency'])) {
    return false;
  }
  if (
    !isMinorUnitsFigure(candidate['grossCapturedMinorUnits']) ||
    !isMinorUnitsFigure(candidate['platformFeeMinorUnits']) ||
    !isMinorUnitsFigure(candidate['expertPayoutMinorUnits']) ||
    !isMinorUnitsFigure(candidate['refundedMinorUnits']) ||
    !isMinorUnitsFigure(candidate['heldRemainingMinorUnits'])
  ) {
    return false;
  }
  if (
    candidate['ledgerHeadDigest'] !== null &&
    (typeof candidate['ledgerHeadDigest'] !== 'string' ||
      !/^[0-9a-f]{64}$/.test(candidate['ledgerHeadDigest']))
  ) {
    return false;
  }
  if (!Array.isArray(candidate['captureSequences']) || !Array.isArray(candidate['refundSequences'])) {
    return false;
  }
  if (
    candidate['releaseSequence'] !== null &&
    (typeof candidate['releaseSequence'] !== 'number' || !Number.isInteger(candidate['releaseSequence']))
  ) {
    return false;
  }
  if (
    candidate['feeScheduleId'] !== null &&
    typeof candidate['feeScheduleId'] !== 'string'
  ) {
    return false;
  }
  if (
    candidate['feeScheduleVersion'] !== null &&
    (typeof candidate['feeScheduleVersion'] !== 'number' ||
      !Number.isInteger(candidate['feeScheduleVersion']))
  ) {
    return false;
  }
  // Exact-field discipline: no smuggled extra figure fields, no collapsed score.
  rejectUnknownFields(candidate, COMMERCIAL_BASIS_FIELDS, 'CommercialBasis');
  rejectCollapsedScoreFields(candidate, 'CommercialBasis');
  return true;
}

/**
 * Verify the ledger's C010 integrity then fold the cost basis. THE ONLY
 * production construction path for cost figures — fail-closed on any
 * integrity failure (a tampered money record can never back economics).
 */
export async function commercialBasisOfLedger(
  ledger: PaymentLedger,
  integrity: LedgerIntegrityVerdict,
): Promise<CommercialBasis> {
  if (integrity.ok !== true) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.LEDGER_INTEGRITY, {
      message: `refusing to fold economics off ledger ${ledger.requestId}: C010 integrity verification failed (${integrity.reason})`,
      details: { requestId: ledger.requestId, reason: integrity.reason },
    });
  }
  let captured = 0n;
  const captureSequences: number[] = [];
  let refunded = 0n;
  const refundSequences: number[] = [];
  let platformFee: MinorUnits | null = null;
  let expertPayout: MinorUnits | null = null;
  let releaseSequence: number | null = null;
  let feeScheduleId: string | null = null;
  let feeScheduleVersion: number | null = null;
  for (const entry of ledger.entries) {
    switch (entry.kind) {
      case 'capture': {
        captured += minorUnitsToBigInt(
          (entry.payload as { amountMinorUnits: MinorUnits }).amountMinorUnits,
        );
        captureSequences.push(entry.sequence);
        break;
      }
      case 'release': {
        const split = (entry.payload as {
          split: {
            platformFeeMinorUnits: MinorUnits;
            expertPayoutMinorUnits: MinorUnits;
            scheduleId: string;
            scheduleVersion: number;
          };
          schedule: { scheduleId: string; version: number };
        }).split;
        platformFee = split.platformFeeMinorUnits;
        expertPayout = split.expertPayoutMinorUnits;
        releaseSequence = entry.sequence;
        feeScheduleId = split.scheduleId;
        feeScheduleVersion = split.scheduleVersion;
        break;
      }
      case 'refund': {
        refunded += minorUnitsToBigInt(
          (entry.payload as { amountMinorUnits: MinorUnits }).amountMinorUnits,
        );
        refundSequences.push(entry.sequence);
        break;
      }
      default:
        break;
    }
  }
  const settlementState: EconomicsSettlementState =
    ledger.state === 'released'
      ? 'released'
      : ledger.state === 'refunded'
        ? 'refunded'
        : 'in-flight';
  const lastEntry = ledger.entries.length > 0 ? ledger.entries[ledger.entries.length - 1] : undefined;
  const basis: CommercialBasis = Object.freeze({
    commercialVersion: COMMERCIAL_BASIS_VERSION,
    settlementState,
    currency: ledger.currency,
    grossCapturedMinorUnits: toMinorUnits(captured.toString(10)),
    platformFeeMinorUnits: platformFee ?? toMinorUnits('0'),
    expertPayoutMinorUnits: expertPayout ?? toMinorUnits('0'),
    refundedMinorUnits: toMinorUnits(refunded.toString(10)),
    heldRemainingMinorUnits: ledgerBalances(ledger).escrow,
    ledgerHeadDigest: lastEntry !== undefined ? lastEntry.digest : null,
    captureSequences: Object.freeze([...captureSequences]),
    releaseSequence,
    refundSequences: Object.freeze([...refundSequences]),
    feeScheduleId,
    feeScheduleVersion,
  });
  if (!isCommercialBasis(basis)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.LEDGER_INTEGRITY, {
      message: `folded commercial basis of ledger ${ledger.requestId} failed its own structural guard`,
    });
  }
  return basis;
}

/** Convenience: verify + fold in one step (the compile path). */
export async function foldCommercialBasis(ledger: PaymentLedger): Promise<CommercialBasis> {
  return commercialBasisOfLedger(ledger, await verifyLedgerIntegrity(ledger));
}

/** The truth label a record inherits from its backing ledger. */
export function truthOfLedger(ledger: PaymentLedger): EconomicsTruth {
  return ledger.truth;
}
