/**
 * UnitEconomicsRecord — the per-intervention economics record (Work
 * Order C016; issue #122). Append-only, provenance-addressed, deep-frozen,
 * content-addressed (sha256 digest over the digest-free view).
 *
 * ONE record per escalation/intervention, compiled from:
 *   - the C010 PaymentLedger (REQUIRED — the cost figures are folded by
 *     cost.ts; there is no path to a cost figure without ledger backing);
 *   - the C009 validation outcome (verdict, adjudication rounds,
 *     replacement count — structurally-mirrored input views);
 *   - the C015 routing decision (resource classes + match digest);
 *   - effort signals (session duration minutes, revision rounds —
 *     C005/expert-session surfaces via the service);
 *   - optionally one Q1.0 capability-lift value record (value.ts).
 *
 * Missing optional inputs are RECORDED AS MISSING (closed reason
 * vocabulary) — never silently defaulted into figures. The truth label
 * and currency are INHERITED from the ledger. Tenant isolation is
 * enforced at the domain level (typed CROSS_TENANT).
 *
 * Supersession is by APPEND (`appendUnitEconomics`): a recomputation
 * with different inputs is a NEW record; the prior record is retained;
 * an identical recompute (same economicsId AND same digest) is an
 * idempotent replay. Nothing is ever silently restated.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { PaymentLedger } from '@arena/payments';
import { CAPABILITY_ECONOMICS_ERROR_CODES, CapabilityEconomicsError } from './errors.js';
import type { CommercialBasis } from './cost.js';
import { foldCommercialBasis } from './cost.js';
import type { CapabilityLiftValueRecord } from './value.js';
import { isCapabilityLiftValueRecord } from './value.js';
import type { EconomicsPolicy } from './policy.js';
import { isEconomicsPolicy } from './policy.js';
import type { EconomicsRecordId, EconomicsTenantId, EconomicsTimestamp } from './shared.js';
import {
  isEconomicsRecordId,
  isEconomicsTenantId,
  requireBoundedString,
  toEconomicsRecordId,
  toEconomicsTimestamp,
} from './shared.js';
import { rejectCollapsedScoreFields, rejectUnknownFields } from './shared.js';

/** Wire version of the unit-economics record shape. */
export const UNIT_ECONOMICS_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Input views (structurally-mirrored closed vocabularies — the SERVICE
// binds the merged C009/C015/C005 records onto them; the economics
// package never forks those domains' objects)
// ---------------------------------------------------------------------------

/** The C009 adjudication verdict vocabulary, mirrored. */
export const ECONOMICS_VALIDATION_VERDICTS = Object.freeze([
  'accepted',
  'revision_required',
  'rejected',
  'needs_more_evidence',
  'pending',
] as const);
export type EconomicsValidationVerdict = (typeof ECONOMICS_VALIDATION_VERDICTS)[number];

export function isEconomicsValidationVerdict(
  value: unknown,
): value is EconomicsValidationVerdict {
  return (
    typeof value === 'string' &&
    (ECONOMICS_VALIDATION_VERDICTS as readonly string[]).includes(value)
  );
}

/** The C015 resource-class vocabulary, mirrored. */
export const ECONOMICS_RESOURCE_CLASSES = Object.freeze([
  'expert',
  'body',
  'tool',
  'knowledge',
  'artifact',
] as const);
export type EconomicsResourceClass = (typeof ECONOMICS_RESOURCE_CLASSES)[number];

export function isEconomicsResourceClass(value: unknown): value is EconomicsResourceClass {
  return (
    typeof value === 'string' &&
    (ECONOMICS_RESOURCE_CLASSES as readonly string[]).includes(value)
  );
}

/** The C009 validation-outcome input view. */
export interface ValidationBasisInput {
  readonly verdict: EconomicsValidationVerdict;
  /** 1-based adjudication round (revision attempts consumed + 1). */
  readonly attemptNumber: number;
  /** Expert replacement count observed on the escalation. */
  readonly replacementCount: number;
  /** Provenance refs (C009 verdict id / record digest), when available. */
  readonly verdictId?: string;
  readonly recordDigest?: string;
}

/** The C015 routing-decision input view. */
export interface RoutingBasisInput {
  /** The routing outcome ('matched' | 'no-match' — the seam vocabulary). */
  readonly outcome: 'matched' | 'no-match';
  /** The matched resource classes, canonical order. */
  readonly resourceClasses: readonly EconomicsResourceClass[];
  /** Provenance: the C015 ResourceMatch digest, when available. */
  readonly matchDigest?: string;
}

/** The effort-signal input view (C005/expert-session surfaces). */
export interface EffortBasisInput {
  /** Expert session duration in minutes (null when unmeasured). */
  readonly sessionDurationMinutes: number | null;
  /** Revision rounds observed (C009 adjudication rounds beyond the first). */
  readonly revisionRounds: number;
  /** Replacement cost signal — replacements observed on the escalation. */
  readonly replacementCount: number;
  /** Provenance refs of the effort sources. */
  readonly sourceRefs: readonly string[];
}

/** The closed missing-input reason vocabulary (recorded, never defaulted). */
export const MISSING_INPUT_REASONS = Object.freeze([
  'validation-outcome-unavailable',
  'routing-decision-unavailable',
  'effort-signals-unavailable',
  'value-record-not-linked',
] as const);
export type MissingInputReason = (typeof MISSING_INPUT_REASONS)[number];

export function isMissingInputReason(value: unknown): value is MissingInputReason {
  return typeof value === 'string' && (MISSING_INPUT_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The bases (frozen record views)
// ---------------------------------------------------------------------------

export interface ValidationBasis {
  readonly validationVersion: 1;
  readonly verdict: EconomicsValidationVerdict;
  readonly attemptNumber: number;
  readonly replacementCount: number;
  readonly verdictId: string | null;
  readonly recordDigest: string | null;
}

export interface RoutingBasis {
  readonly routingVersion: 1;
  readonly outcome: 'matched' | 'no-match';
  readonly resourceClasses: readonly EconomicsResourceClass[];
  readonly primaryResourceClass: EconomicsResourceClass | null;
  readonly matchDigest: string | null;
}

export interface EffortBasis {
  readonly effortVersion: 1;
  readonly sessionDurationMinutes: number | null;
  readonly revisionRounds: number;
  readonly replacementCount: number;
  readonly sourceRefs: readonly string[];
}

/** The linked value side (a ref view — the record itself stays in value.ts). */
export interface ValueBasis {
  readonly valueVersion: 1;
  readonly valueRecordId: string;
  readonly capabilityId: string;
  readonly liftPoints: number | null;
}

export interface UnitEconomicsContext {
  readonly capabilityId: string | null;
  readonly domain: string | null;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

export interface UnitEconomicsRecord {
  readonly recordVersion: typeof UNIT_ECONOMICS_RECORD_VERSION;
  readonly economicsId: EconomicsRecordId;
  readonly requestId: string;
  readonly tenantId: EconomicsTenantId;
  readonly correlationId: string;
  /** INHERITED from the backing C010 ledger — never declared here. */
  readonly currency: string;
  readonly truth: 'demo' | 'customer';
  readonly commercial: CommercialBasis;
  readonly effort: EffortBasis | null;
  readonly routing: RoutingBasis | null;
  readonly validation: ValidationBasis | null;
  readonly value: ValueBasis | null;
  readonly context: UnitEconomicsContext;
  readonly missingInputs: readonly MissingInputReason[];
  readonly policyId: string;
  readonly policyVersion: number;
  readonly recordedAt: EconomicsTimestamp;
  readonly digest: string;
}

export const UNIT_ECONOMICS_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'economicsId',
  'requestId',
  'tenantId',
  'correlationId',
  'currency',
  'truth',
  'commercial',
  'effort',
  'routing',
  'validation',
  'value',
  'context',
  'missingInputs',
  'policyId',
  'policyVersion',
  'recordedAt',
  'digest',
] as const);

/** Structural guard for wire values claiming to be unit-economics records. */
export function isUnitEconomicsRecord(value: unknown): value is UnitEconomicsRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== UNIT_ECONOMICS_RECORD_VERSION) return false;
  if (!isEconomicsRecordId(candidate['economicsId'])) return false;
  if (!isEconomicsTenantId(candidate['tenantId'])) return false;
  if (typeof candidate['requestId'] !== 'string') return false;
  if (typeof candidate['correlationId'] !== 'string') return false;
  if (typeof candidate['currency'] !== 'string' || !/^[A-Z]{3}$/.test(candidate['currency'])) {
    return false;
  }
  if (candidate['truth'] !== 'demo' && candidate['truth'] !== 'customer') return false;
  if (typeof candidate['commercial'] !== 'object' || candidate['commercial'] === null) {
    return false;
  }
  if (
    candidate['missingInputs'] !== undefined &&
    !Array.isArray(candidate['missingInputs'])
  ) {
    return false;
  }
  rejectUnknownFields(candidate, UNIT_ECONOMICS_RECORD_FIELDS, 'UnitEconomicsRecord');
  rejectCollapsedScoreFields(candidate, 'UnitEconomicsRecord');
  return true;
}

// ---------------------------------------------------------------------------
// Compilation — the ONLY construction path
// ---------------------------------------------------------------------------

export interface CompileUnitEconomicsInput {
  /** REQUIRED: the C010 ledger backing every cost figure. */
  readonly ledger: PaymentLedger;
  readonly correlationId: string;
  readonly validation?: ValidationBasisInput;
  readonly routing?: RoutingBasisInput;
  readonly effort?: EffortBasisInput;
  readonly value?: CapabilityLiftValueRecord;
  readonly context?: { readonly capabilityId?: string; readonly domain?: string };
  readonly policy: EconomicsPolicy;
  readonly recordedAt: string | number | Date;
  /** Optional economicsId override (deterministic derivation otherwise). */
  readonly economicsId?: string;
}

function toValidationBasis(input: ValidationBasisInput, requestId: string): ValidationBasis {
  if (!isEconomicsValidationVerdict(input.verdict)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `validation verdict must be in the closed vocabulary: ${JSON.stringify(input.verdict)}`,
    });
  }
  if (
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1 ||
    !Number.isInteger(input.replacementCount) ||
    input.replacementCount < 0
  ) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `validation basis of ${requestId}: attemptNumber must be an integer >= 1 and replacementCount an integer >= 0`,
    });
  }
  return Object.freeze({
    validationVersion: 1 as const,
    verdict: input.verdict,
    attemptNumber: input.attemptNumber,
    replacementCount: input.replacementCount,
    verdictId: input.verdictId ?? null,
    recordDigest: input.recordDigest ?? null,
  });
}

function toRoutingBasis(input: RoutingBasisInput, requestId: string): RoutingBasis {
  if (input.outcome !== 'matched' && input.outcome !== 'no-match') {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `routing outcome must be 'matched' or 'no-match': ${JSON.stringify(input.outcome)}`,
    });
  }
  if (
    !Array.isArray(input.resourceClasses) ||
    !input.resourceClasses.every(isEconomicsResourceClass)
  ) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `routing basis of ${requestId}: resourceClasses must be a subset of the closed vocabulary`,
    });
  }
  return Object.freeze({
    routingVersion: 1 as const,
    outcome: input.outcome,
    resourceClasses: Object.freeze([...input.resourceClasses]),
    primaryResourceClass: input.resourceClasses[0] ?? null,
    matchDigest: input.matchDigest ?? null,
  });
}

function toEffortBasis(input: EffortBasisInput, requestId: string): EffortBasis {
  if (
    input.sessionDurationMinutes !== null &&
    (typeof input.sessionDurationMinutes !== 'number' ||
      !Number.isFinite(input.sessionDurationMinutes) ||
      input.sessionDurationMinutes < 0)
  ) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `effort basis of ${requestId}: sessionDurationMinutes must be a finite number >= 0 or null`,
    });
  }
  if (
    !Number.isInteger(input.revisionRounds) ||
    input.revisionRounds < 0 ||
    !Number.isInteger(input.replacementCount) ||
    input.replacementCount < 0
  ) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `effort basis of ${requestId}: revisionRounds and replacementCount must be integers >= 0`,
    });
  }
  if (!Array.isArray(input.sourceRefs) || !input.sourceRefs.every((ref) => typeof ref === 'string')) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `effort basis of ${requestId}: sourceRefs must be an array of strings`,
    });
  }
  return Object.freeze({
    effortVersion: 1 as const,
    sessionDurationMinutes: input.sessionDurationMinutes,
    revisionRounds: input.revisionRounds,
    replacementCount: input.replacementCount,
    sourceRefs: Object.freeze([...input.sourceRefs]),
  });
}

/**
 * Compile one unit-economics record. THE construction path: the ledger is
 * REQUIRED, integrity-verified, and the cost figures are folded from it;
 * absent optional inputs are recorded as missing (closed reasons); the
 * truth label and currency are inherited from the ledger. Deterministic
 * given identical inputs (the economicsId derivation excludes
 * recordedAt, so recomputation of the same substantive state addresses
 * the same record id).
 */
export async function compileUnitEconomics(
  input: CompileUnitEconomicsInput,
): Promise<UnitEconomicsRecord> {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: 'compileUnitEconomics input must be an object',
    });
  }
  if (typeof input.ledger !== 'object' || input.ledger === null) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.LEDGER_BACKING_MISSING, {
      message: 'a unit-economics record requires the backing C010 PaymentLedger — a cost figure with no C010 backing is unrepresentable',
    });
  }
  if (!isEconomicsPolicy(input.policy)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_POLICY, {
      message: 'compileUnitEconomics requires a structurally valid EconomicsPolicy',
    });
  }
  const ledger = input.ledger;
  const requestId = requireBoundedString(ledger.requestId, 'ledger.requestId');
  const tenantId = ledger.tenantId;
  if (!isEconomicsTenantId(tenantId)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `ledger tenant id is not a valid economics tenant id: ${JSON.stringify(tenantId)}`,
    });
  }
  const correlationId = requireBoundedString(input.correlationId, 'correlationId');
  const recordedAt = toEconomicsTimestamp(input.recordedAt);

  // NO-MONEY-TRUTH: fold (integrity-verified) — the only cost path.
  const commercial = await foldCommercialBasis(ledger);

  const missingInputs: MissingInputReason[] = [];
  const validation =
    input.validation !== undefined ? toValidationBasis(input.validation, requestId) : null;
  if (validation === null) missingInputs.push('validation-outcome-unavailable');
  const routing = input.routing !== undefined ? toRoutingBasis(input.routing, requestId) : null;
  if (routing === null) missingInputs.push('routing-decision-unavailable');
  const effort = input.effort !== undefined ? toEffortBasis(input.effort, requestId) : null;
  if (effort === null) missingInputs.push('effort-signals-unavailable');

  let value: ValueBasis | null = null;
  if (input.value !== undefined) {
    if (!isCapabilityLiftValueRecord(input.value)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
        message: 'linked value record is not a structurally valid CapabilityLiftValueRecord',
      });
    }
    if (input.value.tenantId !== tenantId || input.value.requestId !== requestId) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `linked value record ${input.value.valueRecordId} does not belong to ledger ${requestId} of tenant ${tenantId}`,
        details: {
          valueTenant: input.value.tenantId,
          ledgerTenant: tenantId,
          valueRequest: input.value.requestId,
        },
      });
    }
    value = Object.freeze({
      valueVersion: 1 as const,
      valueRecordId: input.value.valueRecordId,
      capabilityId: input.value.capabilityId,
      liftPoints: input.value.liftPoints,
    });
  } else {
    missingInputs.push('value-record-not-linked');
  }

  const context: UnitEconomicsContext = Object.freeze({
    capabilityId: input.context?.capabilityId ?? value?.capabilityId ?? null,
    domain: input.context?.domain ?? null,
  });

  // The SUBSTANTIVE state (everything but recordedAt / economicsId): the
  // derivation basis of the record identity.
  const substantiveView = {
    recordVersion: UNIT_ECONOMICS_RECORD_VERSION,
    requestId,
    tenantId,
    correlationId,
    currency: ledger.currency,
    truth: ledger.truth,
    commercial,
    effort,
    routing,
    validation,
    value,
    context,
    missingInputs: Object.freeze([...missingInputs]),
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
  };

  const economicsId =
    input.economicsId !== undefined
      ? (input.economicsId as EconomicsRecordId)
      : // Deterministic derivation over the SUBSTANTIVE state (excludes
        // recordedAt): recomputing the same commercial/effort/routing/
        // validation/value state addresses the same record identity.
        toEconomicsRecordId(
          `econ_${(await digestCanonical(substantiveView)).slice(0, 32)}`,
        );

  const digestFree = {
    recordVersion: UNIT_ECONOMICS_RECORD_VERSION,
    economicsId,
    requestId,
    tenantId,
    correlationId,
    currency: ledger.currency,
    truth: ledger.truth,
    commercial,
    effort,
    routing,
    validation,
    value,
    context,
    missingInputs: Object.freeze([...missingInputs]),
    policyId: input.policy.policyId,
    policyVersion: input.policy.version,
    recordedAt,
  };
  const digest = await digestCanonical(digestFree);
  const record: UnitEconomicsRecord = Object.freeze({ ...digestFree, digest });
  if (!isUnitEconomicsRecord(record)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_RECORD, {
      message: 'compiled unit-economics record failed its own structural guard',
    });
  }
  return record;
}

// ---------------------------------------------------------------------------
// Append-only history (supersession by append — the house pattern)
// ---------------------------------------------------------------------------

export type AppendUnitEconomicsOutcome =
  | { readonly outcome: 'appended'; readonly record: UnitEconomicsRecord; readonly history: readonly UnitEconomicsRecord[] }
  | { readonly outcome: 'replay'; readonly record: UnitEconomicsRecord; readonly history: readonly UnitEconomicsRecord[] };

/**
 * Append one record to a per-request history. The prior history is never
 * mutated; an identical recompute (same economicsId AND same digest)
 * REPLAYS the recorded record verbatim; a changed recomputation is a
 * supersession APPEND (the prior records are retained — never a silent
 * restatement). Cross-tenant appends are typed denials.
 */
export async function appendUnitEconomics(
  history: readonly UnitEconomicsRecord[],
  record: UnitEconomicsRecord,
): Promise<AppendUnitEconomicsOutcome> {
  if (!Array.isArray(history)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: 'unit-economics history must be an array',
    });
  }
  if (!isUnitEconomicsRecord(record)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_RECORD, {
      message: 'appended value is not a structurally valid UnitEconomicsRecord',
    });
  }
  for (const prior of history) {
    if (!isUnitEconomicsRecord(prior)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.TAMPERED, {
        message: 'history contains a structurally invalid unit-economics record',
      });
    }
    if (prior.tenantId !== record.tenantId) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `unit-economics history of ${record.requestId} is tenant ${prior.tenantId}; record claims ${record.tenantId}`,
      });
    }
    if (prior.requestId !== record.requestId) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
        message: `unit-economics history is keyed per request: ${prior.requestId} vs ${record.requestId}`,
      });
    }
    if (prior.economicsId === record.economicsId) {
      if (prior.digest === record.digest) {
        return { outcome: 'replay', record: prior, history };
      }
      // Same record identity, different content → supersede by append.
      break;
    }
  }
  const next = [...history, record];
  return { outcome: 'appended', record, history: Object.freeze(next) };
}
