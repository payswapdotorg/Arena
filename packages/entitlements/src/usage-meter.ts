/**
 * Usage-meter event types riding the A015 envelope discipline (Work Order
 * A033; requirements R34, R48; architecture-lock rules 17, 18).
 *
 * A `UsageMeterEvent` is one append-only event in a tenant's usage-meter
 * stream — the payload half of the wire form; every event ALSO travels
 * inside a versioned `Envelope<T>` (see envelopes.ts /
 * makeUsageMeterEventEnvelope) carrying the correlation id and idempotency
 * key of the flow it belongs to, exactly like @arena/job-protocol's events.
 *
 * Taxonomy (closed set, v1):
 *   usage-recorded  — incremental metered units against a feature;
 *   usage-revised   — a correction (delta, possibly negative) whose
 *                     application must never drive a feature's running
 *                     metered total below zero.
 *
 * Ordering invariants enforced EVERYWHERE events are appended (per-tenant
 * UsageMeterLog, strict wire parsing):
 *   - sequences are exactly 1..n, contiguous, per tenant log;
 *   - the first event of a log is always `usage-recorded`;
 *   - timestamps are monotonically non-decreasing;
 *   - the running per-feature total never goes negative.
 */

import { ENTITLEMENT_ERROR_CODES, EntitlementError } from './errors.js';
import {
  isFeatureKey,
  isMeterNote,
  isMeterTimestamp,
  isPositiveInteger,
  isTenantId,
  isUsageId,
  toTenantId,
} from './shared.js';
import { MAX_METER_UNITS } from './shared.js';

/** Wire version of every usage-meter event payload. */
export const USAGE_METER_EVENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Event payloads (discriminated union)
// ---------------------------------------------------------------------------

interface UsageMeterEventCommon {
  readonly eventVersion: typeof USAGE_METER_EVENT_VERSION;
  /** 1-based monotonic sequence within the tenant log this event belongs to. */
  readonly sequence: number;
  /** Canonical ms-UTC timestamp (when the usage occurred). */
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly featureKey: string;
}

export interface UsageRecordedEvent extends UsageMeterEventCommon {
  readonly kind: 'usage-recorded';
  /** Metered units (positive integer, bounded). */
  readonly units: number;
  /** The job whose execution produced this usage (when job-sourced). */
  readonly jobId?: string;
}

export interface UsageRevisedEvent extends UsageMeterEventCommon {
  readonly kind: 'usage-revised';
  /** Signed correction delta (non-zero integer; totals never go negative). */
  readonly delta: number;
  readonly reason: string;
}

export type UsageMeterEvent = UsageRecordedEvent | UsageRevisedEvent;

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

function invalidMeterEvent(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** Structural (non-throwing) check for any event in the taxonomy. */
export function isUsageMeterEvent(value: unknown): value is UsageMeterEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['eventVersion'] !== USAGE_METER_EVENT_VERSION) return false;
  if (
    candidate['kind'] !== 'usage-recorded' &&
    candidate['kind'] !== 'usage-revised'
  ) {
    return false;
  }
  if (!isPositiveInteger(candidate['sequence'])) return false;
  if (!isMeterTimestamp(candidate['occurredAt'])) return false;
  if (!isTenantId(candidate['tenantId'])) return false;
  if (!isFeatureKey(candidate['featureKey'])) return false;

  switch (candidate['kind']) {
    case 'usage-recorded':
      return (
        isPositiveInteger(candidate['units']) &&
        (candidate['units'] as number) <= MAX_METER_UNITS &&
        (candidate['jobId'] === undefined || isUsageId(candidate['jobId']))
      );
    case 'usage-revised':
      return (
        typeof candidate['delta'] === 'number' &&
        Number.isInteger(candidate['delta']) &&
        candidate['delta'] !== 0 &&
        Math.abs(candidate['delta'] as number) <= MAX_METER_UNITS &&
        isMeterNote(candidate['reason'])
      );
    default:
      return false;
  }
}

/** Validate and freeze a usage-recorded event. */
export function toUsageRecordedEvent(value: {
  eventVersion?: number;
  sequence: number;
  occurredAt: string;
  tenantId: string;
  featureKey: string;
  units: number;
  jobId?: string;
}): UsageRecordedEvent {
  const candidate = {
    eventVersion: USAGE_METER_EVENT_VERSION,
    sequence: value.sequence,
    occurredAt: value.occurredAt,
    tenantId: value.tenantId,
    featureKey: value.featureKey,
    kind: 'usage-recorded' as const,
    units: value.units,
    ...(value.jobId !== undefined ? { jobId: value.jobId } : {}),
  };
  if (!isUsageMeterEvent(candidate)) {
    invalidMeterEvent(
      `invalid usage-recorded event: ${JSON.stringify(value)} (units must be a positive integer <= ${String(MAX_METER_UNITS)}; jobId must match the identifier charset when present)`,
      { maxUnits: MAX_METER_UNITS },
    );
  }
  return Object.freeze(candidate);
}

/** Validate and freeze a usage-revised event. */
export function toUsageRevisedEvent(value: {
  eventVersion?: number;
  sequence: number;
  occurredAt: string;
  tenantId: string;
  featureKey: string;
  delta: number;
  reason: string;
}): UsageRevisedEvent {
  const candidate = {
    eventVersion: USAGE_METER_EVENT_VERSION,
    sequence: value.sequence,
    occurredAt: value.occurredAt,
    tenantId: value.tenantId,
    featureKey: value.featureKey,
    kind: 'usage-revised' as const,
    delta: value.delta,
    reason: value.reason,
  };
  if (!isUsageMeterEvent(candidate)) {
    invalidMeterEvent(
      `invalid usage-revised event: ${JSON.stringify(value)} (delta must be a non-zero integer with |delta| <= ${String(MAX_METER_UNITS)}; reason must be 1..200 characters)`,
      { maxDelta: MAX_METER_UNITS },
    );
  }
  return Object.freeze(candidate);
}

// ---------------------------------------------------------------------------
// Per-tenant usage-meter log (append-only, ordered, contiguous)
// ---------------------------------------------------------------------------

/**
 * The meter stream of ONE tenant: every UsageMeterEvent the tenant emitted,
 * in order. Append-only: `appendUsageMeterEvent` validates the per-tenant
 * sequence (gap/duplicate rejection), timestamp monotonicity, tenant
 * identity, the closed ordering (a log starts with usage-recorded) and the
 * non-negative running total per feature, and returns a NEW frozen log.
 */
export interface UsageMeterLog {
  readonly tenantId: string;
  readonly events: readonly UsageMeterEvent[];
}

export function createUsageMeterLog(tenantId: string): UsageMeterLog {
  const tenant = toTenantId(tenantId);
  return Object.freeze({ tenantId: tenant, events: Object.freeze([]) });
}

/** Running metered total per feature over a log prefix (pure helper). */
export function meteredTotals(log: UsageMeterLog): Readonly<Record<string, number>> {
  const totals: Record<string, number> = {};
  for (const event of log.events) {
    const key = event.featureKey;
    if (event.kind === 'usage-recorded') {
      totals[key] = (totals[key] ?? 0) + event.units;
    } else {
      totals[key] = (totals[key] ?? 0) + event.delta;
    }
  }
  return Object.freeze(totals);
}

/** Validate + append: returns a NEW log; the input log is never modified. */
export function appendUsageMeterEvent(
  log: UsageMeterLog,
  event: UsageMeterEvent,
): UsageMeterLog {
  if (!isUsageMeterEvent(event)) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
      message: 'usage meter log appends require a structurally valid usage meter event payload',
    });
  }
  if (event.tenantId !== log.tenantId) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.TENANT_MISMATCH, {
      message: `usage event belongs to tenant ${event.tenantId}, not ${log.tenantId} (per-tenant meter logs are isolated)`,
      details: { logTenantId: log.tenantId, eventTenantId: event.tenantId },
    });
  }
  const expected = log.events.length + 1;
  if (event.sequence < expected) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.METER_SEQUENCE_DUPLICATE, {
      message: `usage event sequence ${String(event.sequence)} duplicates or regresses behind the expected next sequence ${String(expected)} (append-only logs never rewrite history)`,
      details: { expected, actual: event.sequence, kind: event.kind },
    });
  }
  if (event.sequence > expected) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.METER_SEQUENCE_GAP, {
      message: `usage event sequence ${String(event.sequence)} leaves a gap before the expected next sequence ${String(expected)} (per-tenant sequences must be contiguous and monotonically increasing)`,
      details: { expected, actual: event.sequence, kind: event.kind },
    });
  }
  const last = log.events.length > 0 ? log.events[log.events.length - 1] : undefined;
  if (last !== undefined) {
    if (last.occurredAt > event.occurredAt) {
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
        message: `usage event timestamps must be monotonically non-decreasing (last: ${last.occurredAt}, attempted: ${event.occurredAt})`,
        details: { last: last.occurredAt, attempted: event.occurredAt },
      });
    }
  } else if (event.kind !== 'usage-recorded') {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
      message: `a usage meter log must start with usage-recorded, got ${String(event.kind)}`,
      details: { attemptedKind: event.kind },
    });
  }
  // Non-negative running total per feature (revisions can correct, never invert).
  const totals = meteredTotals(log);
  if (event.kind === 'usage-revised') {
    const projected = (totals[event.featureKey] ?? 0) + event.delta;
    if (projected < 0) {
      throw new EntitlementError(ENTITLEMENT_ERROR_CODES.METER_NEGATIVE_TOTAL, {
        message: `usage revision for feature ${event.featureKey} would drive the metered total below zero (current: ${String(totals[event.featureKey] ?? 0)}, delta: ${String(event.delta)}, projected: ${String(projected)})`,
        details: {
          featureKey: event.featureKey,
          current: totals[event.featureKey] ?? 0,
          delta: event.delta,
          projected,
        },
      });
    }
  }
  return Object.freeze({
    tenantId: log.tenantId,
    events: Object.freeze([...log.events, event]),
  });
}

/**
 * Re-validate an entire log (contiguity, ordering, monotonic timestamps,
 * single tenant identity, structural payloads, non-negative totals).
 * Throws on any violation — the verification entry point for persisted logs.
 */
export function verifyUsageMeterLog(log: UsageMeterLog): void {
  let reconstructed = createUsageMeterLog(log.tenantId);
  for (const event of log.events) {
    reconstructed = appendUsageMeterEvent(reconstructed, event);
  }
  if (reconstructed.events.length !== log.events.length) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT, {
      message: 'usage meter log revalidation mismatch',
    });
  }
}
