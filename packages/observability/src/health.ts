/**
 * Health/status vocabularies (Work Order A035; requirement R33).
 *
 * Closed vocabulary + worst-of aggregation, fail-closed on missing data:
 *
 *   - HealthStatus is CLOSED: healthy / degraded / unhealthy / unknown;
 *   - 'unknown' is the FAIL-CLOSED default: a component that does not
 *     report, or reports an unrecognized status, aggregates as
 *     'unknown' — never as healthy;
 *   - aggregation is worst-of with the severity ranking
 *     healthy(0) < degraded(1) < unknown(2) < unhealthy(3);
 *   - an EMPTY component list aggregates to 'unknown' (fail-closed —
 *     "no news" is never "good news").
 */

import { OBS_ERROR_CODES, ObservabilityError } from './errors.js';
import { deepFreeze, isEnumMember, isNeutralId, isObservabilityTimestamp, isNeutralText } from './shared.js';
import type { HealthStatus, NeutralId, ObservabilityTimestamp } from './shared.js';
import { HEALTH_STATUSES } from './shared.js';

export const HEALTH_REPORT_VERSION = 1 as const;

export function isHealthStatus(value: unknown): value is HealthStatus {
  return isEnumMember(value, HEALTH_STATUSES);
}

/** Worst-of severity ranking (higher = worse). */
export const HEALTH_RANK: Readonly<Record<HealthStatus, number>> = Object.freeze({
  healthy: 0,
  degraded: 1,
  unknown: 2,
  unhealthy: 3,
});

/** One component's health contribution. */
export interface ComponentHealth {
  readonly component: NeutralId;
  readonly status: HealthStatus;
  /** Structured, closed reason (neutral text or null). */
  readonly detail: string | null;
  readonly checkedAt: ObservabilityTimestamp;
}

export interface HealthReport {
  readonly reportVersion: typeof HEALTH_REPORT_VERSION;
  readonly aggregate: HealthStatus;
  readonly components: readonly ComponentHealth[];
  readonly reportedAt: ObservabilityTimestamp;
}

export function isComponentHealth(value: unknown): value is ComponentHealth {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isNeutralId(record['component']) &&
    isHealthStatus(record['status']) &&
    (record['detail'] === null || isNeutralText(record['detail'])) &&
    isObservabilityTimestamp(record['checkedAt'])
  );
}

/** Validate + freeze a raw value into a ComponentHealth record. */
export function toComponentHealth(value: unknown): ComponentHealth {
  if (typeof value !== 'object' || value === null) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_HEALTH, {
      message: 'component health must be a JSON object',
    });
  }
  const record = value as Record<string, unknown>;
  if (!isNeutralId(record['component'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_HEALTH, {
      message: `component must be a neutral id, got ${JSON.stringify(record['component'])}`,
    });
  }
  if (!isHealthStatus(record['status'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_HEALTH, {
      message: `status must be one of ${HEALTH_STATUSES.join(', ')}, got ${String(record['status'])}`,
    });
  }
  const detail = record['detail'];
  if (detail !== null && detail !== undefined && !isNeutralText(detail)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_HEALTH, {
      message: 'detail must be neutral text (printable ASCII, <= 4096 chars) or null',
    });
  }
  if (!isObservabilityTimestamp(record['checkedAt'])) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_HEALTH, {
      message: `checkedAt must be an epoch-ms integer >= 0, got ${String(record['checkedAt'])}`,
    });
  }
  return Object.freeze({
    component: record['component'] as NeutralId,
    status: record['status'] as HealthStatus,
    detail: (detail ?? null) as string | null,
    checkedAt: record['checkedAt'] as ObservabilityTimestamp,
  });
}

/** Worst-of aggregation (fail-closed on empty input: 'unknown'). */
export function aggregateHealth(components: readonly ComponentHealth[]): HealthStatus {
  if (components.length === 0) {
    return 'unknown';
  }
  let worst: HealthStatus = 'healthy';
  for (const component of components) {
    if (!isComponentHealth(component)) {
      // Malformed contribution fails CLOSED as unknown, never ignored.
      worst = HEALTH_RANK[worst] < HEALTH_RANK.unknown ? 'unknown' : worst;
      continue;
    }
    if (HEALTH_RANK[component.status] > HEALTH_RANK[worst]) {
      worst = component.status;
    }
  }
  return worst;
}

/** Build a frozen HealthReport from raw component contributions. */
export function toHealthReport(
  rawComponents: readonly unknown[],
  reportedAt: number,
): HealthReport {
  if (!isObservabilityTimestamp(reportedAt)) {
    throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `reportedAt must be an epoch-ms integer >= 0, got ${String(reportedAt)}`,
    });
  }
  const components = rawComponents.map((raw) =>
    isComponentHealth(raw) ? raw : toComponentHealth(raw),
  );
  return deepFreeze({
    reportVersion: HEALTH_REPORT_VERSION,
    aggregate: aggregateHealth(components),
    components: Object.freeze([...components]),
    reportedAt: reportedAt as ObservabilityTimestamp,
  });
}
