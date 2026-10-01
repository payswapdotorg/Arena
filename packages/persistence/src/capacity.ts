/**
 * Capacity state model (Work Order B002; issue #64; governing spec
 * spec/free-tier-contract.md FT2.0 "Capacity state").
 *
 * Every hosted adapter surfaces one of four capacity states — AVAILABLE,
 * DEGRADED, EXHAUSTED, DISABLED — with structured reasons. The module also
 * defines the fail-closed exhaustion policy:
 *
 *   - `CAPACITY_EXHAUSTION_POLICY` is the literal `'fail-closed'` and its
 *     type `CapacityExhaustionPolicy` has EXACTLY ONE inhabitant. No
 *     alternate-route or escalation policy value exists in the type
 *     system, so a silent billable switch is not representable at the
 *     type level.
 *   - `assertCapacityUsable` THROWS the typed exhaustion error
 *     (PersistenceError with code PERSISTENCE_CAPACITY_EXHAUSTED or
 *     PERSISTENCE_CAPACITY_DISABLED) whenever the observed status is
 *     EXHAUSTED or DISABLED. Callers cannot get a "second path" — they get
 *     an exception or nothing.
 *
 * The module is fully provider-neutral: dimensions are logical names
 * ('storage', 'requests', 'bandwidth', ...) and reasons are closed codes.
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from './errors.js';
import { isProviderId } from './shared.js';
import type { CorrelationId } from '@arena/protocol-core';

// ---------------------------------------------------------------------------
// Capacity state vocabulary (FT2.0)
// ---------------------------------------------------------------------------

export const PROVIDER_CAPACITY_STATUSES = Object.freeze([
  'AVAILABLE',
  'DEGRADED',
  'EXHAUSTED',
  'DISABLED',
] as const);

export type ProviderCapacityStatus = (typeof PROVIDER_CAPACITY_STATUSES)[number];

export function isProviderCapacityStatus(value: unknown): value is ProviderCapacityStatus {
  return (
    typeof value === 'string' &&
    (PROVIDER_CAPACITY_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Severity order used for worst-of aggregation (higher = more severe).
 * DISABLED is the most severe (the capability does not exist at all);
 * EXHAUSTED fails closed but is recoverable within the window; DEGRADED is
 * impaired but usable; AVAILABLE is healthy.
 */
export const CAPACITY_STATUS_SEVERITY: Readonly<Record<ProviderCapacityStatus, number>> =
  Object.freeze({
    AVAILABLE: 0,
    DEGRADED: 1,
    EXHAUSTED: 2,
    DISABLED: 3,
  });

// ---------------------------------------------------------------------------
// Structured reasons (closed vocabulary)
// ---------------------------------------------------------------------------

export const CAPACITY_REASON_CODES = Object.freeze([
  'quota-exhausted',
  'configuration-missing',
  'probe-failed',
  'dimension-near-limit',
  'limit-unknown',
  'no-dimensions',
] as const);

export type CapacityReasonCode = (typeof CAPACITY_REASON_CODES)[number];

export function isCapacityReasonCode(value: unknown): value is CapacityReasonCode {
  return (
    typeof value === 'string' &&
    (CAPACITY_REASON_CODES as readonly string[]).includes(value)
  );
}

/** A structured reason attached to a capacity state (never free text alone). */
export interface CapacityReason {
  readonly code: CapacityReasonCode;
  /** The logical dimension the reason refers to, when applicable. */
  readonly dimension?: string;
}

export function isCapacityReason(value: unknown): value is CapacityReason {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCapacityReasonCode(candidate['code']) &&
    (candidate['dimension'] === undefined || typeof candidate['dimension'] === 'string')
  );
}

// ---------------------------------------------------------------------------
// Fail-closed exhaustion policy
// ---------------------------------------------------------------------------

/**
 * The one and only capacity exhaustion policy. `CapacityExhaustionPolicy`
 * has exactly one inhabitant ('fail-closed'); no alternate-route or
 * escalation policy is representable in the type system.
 */
export const CAPACITY_EXHAUSTION_POLICY = 'fail-closed' as const;
export type CapacityExhaustionPolicy = typeof CAPACITY_EXHAUSTION_POLICY;

/** Statuses on which every operation MUST fail closed (typed error). */
export const CAPACITY_BLOCKING_STATUSES: readonly ProviderCapacityStatus[] = Object.freeze([
  'EXHAUSTED',
  'DISABLED',
]);

/** True when the status permits operations (AVAILABLE or DEGRADED). */
export function isCapacityUsable(status: ProviderCapacityStatus): boolean {
  return status === 'AVAILABLE' || status === 'DEGRADED';
}

/** The capacity fields every gated operation observes. */
export interface CapacityObservation {
  readonly status: ProviderCapacityStatus;
  readonly reasons?: readonly CapacityReason[];
}

/**
 * Fail-closed capacity gate (FT2.0: adapters never silently switch to a
 * billable path). Throws the typed exhaustion error for EXHAUSTED /
 * DISABLED; returns void otherwise. This is the ONLY sanctioned way for
 * hosted paths to react to exhaustion: there is no alternate-route
 * parameter, no second destination and no swallowed error.
 */
export function assertCapacityUsable(
  observation: CapacityObservation,
  correlationId?: CorrelationId,
): void {
  if (observation.status === 'AVAILABLE' || observation.status === 'DEGRADED') return;
  const status: 'EXHAUSTED' | 'DISABLED' = observation.status;
  const reasons: readonly CapacityReason[] =
    observation.reasons !== undefined && observation.reasons.length > 0
      ? observation.reasons
      : [
          {
            code: status === 'EXHAUSTED' ? 'quota-exhausted' : 'configuration-missing',
          } satisfies CapacityReason,
        ];
  const code =
    status === 'EXHAUSTED'
      ? PERSISTENCE_ERROR_CODES.CAPACITY_EXHAUSTED
      : PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED;
  throw new PersistenceCapacityError(code, status, reasons, {
    message:
      status === 'EXHAUSTED'
        ? 'provider capacity is exhausted; failing closed (no alternate path is representable)'
        : 'provider is disabled (missing configuration); failing closed',
    details: {
      status,
      policy: CAPACITY_EXHAUSTION_POLICY,
      reasons,
    },
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

// ---------------------------------------------------------------------------
// Typed capacity error (exhaustion / disabled)
// ---------------------------------------------------------------------------

/**
 * The fail-closed capacity error: thrown when a hosted dimension is
 * EXHAUSTED or an adapter is DISABLED. Carries the blocking status and the
 * structured reasons so callers (and the UI later) can surface WHY the
 * operation failed without any alternate-route semantics.
 */
export class PersistenceCapacityError extends PersistenceError {
  readonly capacityStatus: 'EXHAUSTED' | 'DISABLED';
  readonly capacityReasons: readonly CapacityReason[];

  constructor(
    code: 'PERSISTENCE_CAPACITY_EXHAUSTED' | 'PERSISTENCE_CAPACITY_DISABLED',
    capacityStatus: 'EXHAUSTED' | 'DISABLED',
    reasons: readonly CapacityReason[],
    init: { message: string; details?: Readonly<Record<string, unknown>>; cause?: unknown },
  ) {
    super(code, {
      message: init.message,
      ...(init.details !== undefined ? { details: init.details } : {}),
      ...(init.cause !== undefined ? { cause: init.cause } : {}),
    });
    this.name = 'PersistenceCapacityError';
    this.capacityStatus = capacityStatus;
    this.capacityReasons = Object.freeze([...reasons]);
  }
}

export function isPersistenceCapacityError(value: unknown): value is PersistenceCapacityError {
  return value instanceof PersistenceCapacityError;
}

// ---------------------------------------------------------------------------
// Dimension readings
// ---------------------------------------------------------------------------

/**
 * One provider dimension reading: remaining/limit/window (FT2.0 "Capacity
 * state"; free-tier-architecture.md "Budget guardrails" — allowance,
 * consumption, exhausted state). `null` means unknown/unbounded; a known
 * limit with a known usage MUST carry `remaining === limit - used`.
 */
export interface CapacityDimensionReading {
  /** Logical dimension name (e.g. 'storage', 'requests', 'bandwidth'). */
  readonly dimension: string;
  /** Current consumption, or null when the provider does not report it. */
  readonly used: number | null;
  /** The allowance, or null when unbounded/unknown. */
  readonly limit: number | null;
  /** limit - used when both are known, else null. Never negative. */
  readonly remaining: number | null;
  /** Window length in ms for recurring allowances, null for totals. */
  readonly windowMs: number | null;
}

const DIMENSION_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export function isCapacityDimensionName(value: unknown): value is string {
  return typeof value === 'string' && DIMENSION_PATTERN.test(value);
}

/**
 * Validate and normalize a dimension reading (fail closed):
 * non-negative numbers, remaining === limit - used when both known,
 * used <= limit, bounded dimension name. Returns a frozen reading.
 */
export function toCapacityDimensionReading(value: unknown): CapacityDimensionReading {
  const fail = (reason: string): never => {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
      message: `invalid capacity dimension reading: ${reason}`,
      details: { received: typeof value },
    });
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;
  const dimension = record['dimension'];
  if (!isCapacityDimensionName(dimension)) {
    return fail(`dimension must match ${DIMENSION_PATTERN.source}`);
  }
  const used = record['used'];
  const limit = record['limit'];
  const remaining = record['remaining'];
  const windowMs = record['windowMs'];
  // Omitted fields mean UNKNOWN (null) — the neutral representation for
  // "the provider does not report this".
  const normalize = (field: string, value: unknown): number | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return fail(`${field} must be a non-negative finite number or null`);
    }
    return value;
  };
  const usedNumber = normalize('used', used);
  const limitNumber = normalize('limit', limit);
  const remainingNumber = normalize('remaining', remaining);
  const windowMsNumber = normalize('windowMs', windowMs);
  if (usedNumber !== null && limitNumber !== null && usedNumber > limitNumber) {
    return fail(`used (${String(usedNumber)}) exceeds limit (${String(limitNumber)})`);
  }
  const expectedRemaining =
    usedNumber !== null && limitNumber !== null ? limitNumber - usedNumber : null;
  if (remainingNumber !== expectedRemaining) {
    return fail(
      `remaining must equal limit - used (${String(expectedRemaining)}) when both are known`,
    );
  }
  return Object.freeze({
    dimension,
    used: usedNumber,
    limit: limitNumber,
    remaining: remainingNumber,
    windowMs: windowMsNumber,
  } satisfies CapacityDimensionReading);
}

export function isCapacityDimensionReading(value: unknown): value is CapacityDimensionReading {
  try {
    toCapacityDimensionReading(value);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

/** The result of probing one provider's capacity (the CapacityMeter port). */
export interface CapacitySnapshot {
  readonly status: ProviderCapacityStatus;
  readonly checkedAt: number;
  readonly dimensions: readonly CapacityDimensionReading[];
  readonly reasons: readonly CapacityReason[];
}

/** One provider's health entry inside an aggregate snapshot. */
export interface ProviderHealth {
  /** Neutral logical provider id assigned at composition time. */
  readonly providerId: string;
  readonly status: ProviderCapacityStatus;
  readonly checkedAt: number;
  readonly dimensions: readonly CapacityDimensionReading[];
  readonly reasons: readonly CapacityReason[];
}

/** Aggregate health across providers (worst-of severity wins). */
export interface ProviderHealthSnapshot {
  readonly overall: ProviderCapacityStatus;
  readonly checkedAt: number;
  readonly providers: readonly ProviderHealth[];
}

/**
 * Derive the capacity status from dimension readings (pure, deterministic):
 *   - EXHAUSTED when any known-limit dimension has remaining === 0;
 *   - DEGRADED when any known-limit dimension has remaining/limit below
 *     `degradedFraction` (default 0.1) — near-limit warning;
 *   - AVAILABLE otherwise.
 * Unknown limits never change the status (they add a 'limit-unknown'
 * reason instead). An empty dimension list yields AVAILABLE with a
 * 'no-dimensions' reason.
 */
export function deriveCapacityStatus(
  dimensions: readonly CapacityDimensionReading[],
  options?: { readonly degradedFraction?: number },
): { status: ProviderCapacityStatus; reasons: CapacityReason[] } {
  const degradedFraction = options?.degradedFraction ?? 0.1;
  const reasons: CapacityReason[] = [];
  if (dimensions.length === 0) {
    reasons.push({ code: 'no-dimensions' });
    return { status: 'AVAILABLE', reasons };
  }
  let status: ProviderCapacityStatus = 'AVAILABLE';
  for (const reading of dimensions) {
    if (reading.limit === null || reading.remaining === null) {
      reasons.push({ code: 'limit-unknown', dimension: reading.dimension });
      continue;
    }
    if (reading.remaining === 0) {
      reasons.push({ code: 'quota-exhausted', dimension: reading.dimension });
      status = 'EXHAUSTED';
      continue;
    }
    if (reading.remaining / reading.limit < degradedFraction) {
      reasons.push({ code: 'dimension-near-limit', dimension: reading.dimension });
      if (status !== 'EXHAUSTED') status = 'DEGRADED';
    }
  }
  return { status, reasons };
}

/** Build a validated, frozen CapacitySnapshot from raw readings. */
export function toCapacitySnapshot(
  value: unknown,
): CapacitySnapshot {
  const fail = (reason: string): never => {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_CAPACITY_READING, {
      message: `invalid capacity snapshot: ${reason}`,
    });
  };
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;
  if (!isProviderCapacityStatus(record['status'])) {
    return fail('status must be one of AVAILABLE, DEGRADED, EXHAUSTED, DISABLED');
  }
  const status = record['status'];
  const checkedAt = record['checkedAt'];
  if (typeof checkedAt !== 'number' || !Number.isFinite(checkedAt) || checkedAt < 0) {
    return fail('checkedAt must be a non-negative finite number');
  }
  const rawDimensions = record['dimensions'];
  if (!Array.isArray(rawDimensions)) return fail('dimensions must be an array');
  const dimensions = rawDimensions.map((entry) => toCapacityDimensionReading(entry));
  const rawReasons = record['reasons'];
  if (rawReasons === undefined) return fail('reasons must be an array');
  if (!Array.isArray(rawReasons)) return fail('reasons must be an array');
  const reasons: CapacityReason[] = [];
  for (const entry of rawReasons) {
    if (!isCapacityReason(entry)) return fail('each reason must be a structured capacity reason');
    reasons.push(Object.freeze({ ...entry }));
  }
  return Object.freeze({
    status,
    checkedAt,
    dimensions: Object.freeze(dimensions),
    reasons: Object.freeze(reasons),
  } satisfies CapacitySnapshot);
}

/** Build a ProviderHealth entry from a snapshot + logical provider id. */
export function toProviderHealth(providerId: string, snapshot: CapacitySnapshot): ProviderHealth {
  if (!isProviderId(providerId)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
      message: `invalid provider id: ${JSON.stringify(providerId)}`,
    });
  }
  return Object.freeze({
    providerId,
    status: snapshot.status,
    checkedAt: snapshot.checkedAt,
    dimensions: snapshot.dimensions,
    reasons: snapshot.reasons,
  } satisfies ProviderHealth);
}

/**
 * Aggregate provider health (worst-of severity wins; FT2.0 "quota state is
 * visible"). An empty provider list yields AVAILABLE with no entries.
 */
export function aggregateProviderHealth(
  providers: readonly ProviderHealth[],
  checkedAt: number,
): ProviderHealthSnapshot {
  const validated = providers.map((entry) => {
    if (!isProviderId(entry.providerId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_PROVIDER_ID, {
        message: `invalid provider id: ${JSON.stringify(entry.providerId)}`,
      });
    }
    return toProviderHealth(entry.providerId, entry);
  });
  let overall: ProviderCapacityStatus = 'AVAILABLE';
  for (const entry of validated) {
    if (CAPACITY_STATUS_SEVERITY[entry.status] > CAPACITY_STATUS_SEVERITY[overall]) {
      overall = entry.status;
    }
  }
  return Object.freeze({
    overall,
    checkedAt,
    providers: Object.freeze(validated),
  } satisfies ProviderHealthSnapshot);
}
