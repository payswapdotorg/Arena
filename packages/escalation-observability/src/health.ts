/**
 * Operational health signals (Work Order C021; issue #127).
 *
 * Typed, dimensional, DETERMINISTIC health signals over the escalation
 * network — identical event inputs always yield identical signals
 * (all times injected, no ambient state):
 *
 *   - matching latency: created → offered (the C001 matching span);
 *   - queue depth: escalations observed in pre-offer states at a
 *     projection time;
 *   - validation backlog: escalations submitted/validating without a
 *     recorded verdict at a projection time;
 *   - replacement rate: expert_replaced events over observed escalations;
 *   - expert availability coverage: declared-vs-remaining capacity over
 *     the C011 availability declarations (projection only — the C011
 *     surface owns availability truth).
 *
 * These are MEASUREMENTS, never health AUTHORITY: the A035
 * health-status vocabulary stays owned by @arena/observability.
 */

import { isEscalationWebhookEvent } from '@arena/escalation';
import type { EscalationWebhookEvent } from '@arena/escalation';

import { ESCALATION_OBSERVABILITY_ERROR_CODES, EscalationObservabilityError } from './errors.js';
import { deepFreeze, toProjectionTimestamp, toTenantScope } from './shared.js';

/** Wire version of the health-signal shapes. */
export const HEALTH_SIGNAL_VERSION = 1 as const;

/** The closed health-signal kinds. */
export const HEALTH_SIGNAL_KINDS = Object.freeze([
  'matching-latency',
  'queue-depth',
  'validation-backlog',
  'replacement-rate',
  'expert-availability-coverage',
] as const);
export type HealthSignalKind = (typeof HEALTH_SIGNAL_KINDS)[number];

/** The closed units. */
export const HEALTH_SIGNAL_UNITS = Object.freeze([
  'count',
  'milliseconds',
  'ratio',
] as const);
export type HealthSignalUnit = (typeof HEALTH_SIGNAL_UNITS)[number];

/** The base of every health signal (typed, dimensional, frozen). */
export interface HealthSignalBase {
  readonly signalVersion: typeof HEALTH_SIGNAL_VERSION;
  readonly kind: HealthSignalKind;
  readonly unit: HealthSignalUnit;
  readonly tenant: string;
  /** The measurement time (injected). */
  readonly measuredAt: string;
  /** Deterministic derivation note (disclosed, rendered verbatim). */
  readonly derivation: string;
}

/** Matching latency: the created → offered span per escalation (ms). */
export interface MatchingLatencySignal extends HealthSignalBase {
  readonly kind: 'matching-latency';
  readonly unit: 'milliseconds';
  /** Latencies in ms, one per matched escalation, sorted ascending. */
  readonly latenciesMs: readonly number[];
  readonly matchedCount: number;
  readonly medianMs: number | null;
  readonly p95Ms: number | null;
}

/** Queue depth: escalations in pre-offer states at the measurement time. */
export interface QueueDepthSignal extends HealthSignalBase {
  readonly kind: 'queue-depth';
  readonly unit: 'count';
  readonly queuedCount: number;
  /** Per-state breakdown (only pre-offer states, deterministic order). */
  readonly byState: Readonly<Record<string, number>>;
}

/** Validation backlog: submitted/validating escalations without a verdict. */
export interface ValidationBacklogSignal extends HealthSignalBase {
  readonly kind: 'validation-backlog';
  readonly unit: 'count';
  readonly backlogCount: number;
  readonly oldestSinceMs: number | null;
}

/** Replacement rate: expert_replaced events over observed escalations. */
export interface ReplacementRateSignal extends HealthSignalBase {
  readonly kind: 'replacement-rate';
  readonly unit: 'ratio';
  readonly replacementCount: number;
  readonly escalationCount: number;
  readonly replacementRate: number;
}

/** Expert availability coverage: declared vs remaining capacity (C011). */
export interface AvailabilityCoverageSignal extends HealthSignalBase {
  readonly kind: 'expert-availability-coverage';
  readonly unit: 'ratio';
  readonly declaredCapacity: number;
  readonly remainingCapacity: number;
  /** remaining / declared (0 when nothing declared — fail-closed honest). */
  readonly coverageRatio: number;
  readonly windowCount: number;
}

// ---------------------------------------------------------------------------
// Event-stream ingestion (dedupe + tenant scope, shared by the signals)
// ---------------------------------------------------------------------------

function ingestEvents(
  events: readonly unknown[],
  tenant: string,
): readonly EscalationWebhookEvent[] {
  toTenantScope(tenant, 'tenant');
  const deduped = new Map<string, EscalationWebhookEvent>();
  for (const candidate of events) {
    if (!isEscalationWebhookEvent(candidate)) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_EVENT,
        { message: 'health signals require structurally valid C001 webhook events' },
      );
    }
    if (candidate.tenantId !== tenant) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.CROSS_TENANT_ACCESS,
        {
          message: `event ${candidate.eventId} belongs to tenant ${candidate.tenantId}; tenant ${tenant} may not measure it`,
          details: { eventId: candidate.eventId, eventTenant: candidate.tenantId, tenant },
        },
      );
    }
    deduped.set(candidate.eventId, candidate);
  }
  return Object.freeze(
    [...deduped.values()].sort((a, b) =>
      a.occurredAt === b.occurredAt
        ? a.sequence - b.sequence
        : Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
    ),
  );
}

function percentile(sorted: readonly number[], fraction: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? null;
}

function medianOf(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) return null;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/** The pre-offer (queued) states — the queue-depth lens. */
export const PRE_OFFER_STATES = Object.freeze([
  'created',
  'triaged',
  'matching',
] as const);

/** The awaiting-validation states — the validation-backlog lens. */
export const AWAITING_VALIDATION_STATES = Object.freeze(['submitted', 'validating'] as const);

// ---------------------------------------------------------------------------
// The signals (each PURE + deterministic)
// ---------------------------------------------------------------------------

/** Measure matching latency (created → offered per escalation, ms). */
export function computeMatchingLatency(
  events: readonly unknown[],
  options: { tenant: string; at: number | string | Date },
): MatchingLatencySignal {
  const ordered = ingestEvents(events, options.tenant);
  const measuredAt = toProjectionTimestamp(options.at, 'at');
  const latencies: number[] = [];
  for (const event of ordered) {
    if (event.eventType !== 'escalation.matched') continue;
    // The matching span: earliest created event for the SAME request
    // before this matched event.
    const created = ordered.find(
      (candidate) =>
        candidate.requestId === event.requestId &&
        candidate.eventType === 'escalation.created' &&
        Date.parse(candidate.occurredAt) <= Date.parse(event.occurredAt),
    );
    if (created === undefined) continue;
    const latency = Date.parse(event.occurredAt) - Date.parse(created.occurredAt);
    if (latency >= 0) latencies.push(latency);
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return deepFreeze({
    signalVersion: HEALTH_SIGNAL_VERSION,
    kind: 'matching-latency',
    unit: 'milliseconds',
    tenant: options.tenant,
    measuredAt,
    derivation:
      'per matched escalation: matched.occurredAt - created.occurredAt (the C001 created→offered span), deduped by eventId, ordered by (occurredAt, sequence)',
    latenciesMs: Object.freeze(sorted),
    matchedCount: sorted.length,
    medianMs: medianOf(sorted),
    p95Ms: percentile(sorted, 0.95),
  } satisfies MatchingLatencySignal);
}

/** Measure queue depth (pre-offer states at the projection time). */
export function computeQueueDepth(
  events: readonly unknown[],
  options: { tenant: string; at: number | string | Date },
): QueueDepthSignal {
  const ordered = ingestEvents(events, options.tenant);
  const measuredAt = toProjectionTimestamp(options.at, 'at');
  const atMs = Date.parse(measuredAt);
  const latestByRequest = new Map<string, EscalationWebhookEvent>();
  for (const event of ordered) {
    if (Date.parse(event.occurredAt) > atMs) continue;
    const prior = latestByRequest.get(event.requestId);
    if (prior === undefined || event.sequence >= prior.sequence) {
      latestByRequest.set(event.requestId, event);
    }
  }
  const byState: Record<string, number> = {};
  let queuedCount = 0;
  for (const event of latestByRequest.values()) {
    if (event.state === null) continue;
    if (!(PRE_OFFER_STATES as readonly string[]).includes(event.state)) continue;
    queuedCount += 1;
    byState[event.state] = (byState[event.state] ?? 0) + 1;
  }
  return deepFreeze({
    signalVersion: HEALTH_SIGNAL_VERSION,
    kind: 'queue-depth',
    unit: 'count',
    tenant: options.tenant,
    measuredAt,
    derivation:
      'latest state per escalation at the projection time; queued = escalations whose latest state is created | triaged | matching',
    queuedCount,
    byState: deepFreeze({ ...byState }),
  } satisfies QueueDepthSignal);
}

/** Measure validation backlog (submitted/validating without a verdict). */
export function computeValidationBacklog(
  events: readonly unknown[],
  options: { tenant: string; at: number | string | Date },
): ValidationBacklogSignal {
  const ordered = ingestEvents(events, options.tenant);
  const measuredAt = toProjectionTimestamp(options.at, 'at');
  const atMs = Date.parse(measuredAt);
  const latestByRequest = new Map<string, EscalationWebhookEvent>();
  for (const event of ordered) {
    if (Date.parse(event.occurredAt) > atMs) continue;
    const prior = latestByRequest.get(event.requestId);
    if (prior === undefined || event.sequence >= prior.sequence) {
      latestByRequest.set(event.requestId, event);
    }
  }
  let backlogCount = 0;
  let oldestSinceMs: number | null = null;
  for (const event of latestByRequest.values()) {
    if (event.state === null) continue;
    if (!(AWAITING_VALIDATION_STATES as readonly string[]).includes(event.state)) continue;
    backlogCount += 1;
    const sinceMs = atMs - Date.parse(event.occurredAt);
    if (oldestSinceMs === null || sinceMs > oldestSinceMs) oldestSinceMs = sinceMs;
  }
  return deepFreeze({
    signalVersion: HEALTH_SIGNAL_VERSION,
    kind: 'validation-backlog',
    unit: 'count',
    tenant: options.tenant,
    measuredAt,
    derivation:
      'latest state per escalation at the projection time; backlog = escalations whose latest state is submitted | validating (no verdict yet); oldestSinceMs = projection time - oldest backlog entry time',
    backlogCount,
    oldestSinceMs,
  } satisfies ValidationBacklogSignal);
}

/** Measure replacement rate (expert_replaced over observed escalations). */
export function computeReplacementRate(
  events: readonly unknown[],
  options: { tenant: string; at: number | string | Date },
): ReplacementRateSignal {
  const ordered = ingestEvents(events, options.tenant);
  const measuredAt = toProjectionTimestamp(options.at, 'at');
  const escalationIds = new Set<string>();
  let replacementCount = 0;
  for (const event of ordered) {
    escalationIds.add(event.requestId);
    if (event.state === 'expert_replaced') replacementCount += 1;
  }
  const escalationCount = escalationIds.size;
  return deepFreeze({
    signalVersion: HEALTH_SIGNAL_VERSION,
    kind: 'replacement-rate',
    unit: 'ratio',
    tenant: options.tenant,
    measuredAt,
    derivation:
      'replacementCount = events projecting the explicit expert_replaced lifecycle state; escalationCount = distinct requestIds observed; replacementRate = replacementCount / escalationCount',
    replacementCount,
    escalationCount,
    replacementRate: escalationCount === 0 ? 0 : replacementCount / escalationCount,
  } satisfies ReplacementRateSignal);
}

/** One declared availability window (C011 projection input). */
export interface AvailabilityWindowInput {
  /** Declared total capacity of the window. */
  readonly declaredCapacity: number;
  /** Remaining capacity at the measurement time. */
  readonly remainingCapacity: number;
}

/** Measure expert availability coverage over C011-declared windows. */
export function computeAvailabilityCoverage(
  windows: readonly AvailabilityWindowInput[],
  options: { tenant: string; at: number | string | Date },
): AvailabilityCoverageSignal {
  const measuredAt = toProjectionTimestamp(options.at, 'at');
  let declaredCapacity = 0;
  let remainingCapacity = 0;
  for (const window of windows) {
    if (
      typeof window.declaredCapacity !== 'number' ||
      !Number.isSafeInteger(window.declaredCapacity) ||
      window.declaredCapacity < 0 ||
      typeof window.remainingCapacity !== 'number' ||
      !Number.isSafeInteger(window.remainingCapacity) ||
      window.remainingCapacity < 0 ||
      window.remainingCapacity > window.declaredCapacity
    ) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SIGNAL,
        {
          message:
            'availability windows require 0 <= remainingCapacity <= declaredCapacity (integer slots — the C011 capacity accounting invariant)',
        },
      );
    }
    declaredCapacity += window.declaredCapacity;
    remainingCapacity += window.remainingCapacity;
  }
  return deepFreeze({
    signalVersion: HEALTH_SIGNAL_VERSION,
    kind: 'expert-availability-coverage',
    unit: 'ratio',
    tenant: options.tenant,
    measuredAt,
    derivation:
      'coverageRatio = sum(remainingCapacity) / sum(declaredCapacity) over the C011 availability declarations (0 when nothing is declared — honest, never fabricated)',
    declaredCapacity,
    remainingCapacity,
    coverageRatio: declaredCapacity === 0 ? 0 : remainingCapacity / declaredCapacity,
    windowCount: windows.length,
  } satisfies AvailabilityCoverageSignal);
}
