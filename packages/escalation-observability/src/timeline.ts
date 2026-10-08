/**
 * Lifecycle projections over the C001 event taxonomy (Work Order C021;
 * issue #127; spec/expert-escalation-api.md ES1.0 "Webhook events" +
 * "Lifecycle").
 *
 * The C001 webhook stream is ALREADY a projection of the append-only
 * lifecycle history (STATE_TO_WEBHOOK_EVENT maps states → events 1:1) —
 * this file projects it ONE step further into operator read models:
 *
 *   - projectEscalationTimeline: the per-escalation timeline (state
 *     transitions with DWELL TIMES, validation-verdict refs,
 *     payment-state refs and replacement events), deduped by eventId
 *     (at-least-once delivery is safe) and ordered on the C001 consumer
 *     ordering key (requestId, sequence);
 *   - foldEscalationSummary: the per-escalation summary (state counts,
 *     total dwell, replacement count, terminal outcome);
 *   - projectEscalationRollup: per-client-app / per-capability /
 *     per-urgency dimensional rollups over a set of timelines.
 *
 * PROJECTIONS ONLY: every function is PURE — the identical event input
 * always yields the identical frozen projection; there is NO code path
 * that mutates an EscalationRecord or emits a domain event (the read
 * side owns no domain truth — spec/service-boundaries.md). Tenant
 * isolation is enforced at the domain level: an event from another
 * tenant fails closed with CROSS_TENANT_ACCESS.
 */

import {
  ESCALATION_WEBHOOK_TERMINAL_EVENT_TYPES,
  isEscalationWebhookEvent,
  isEscalationWebhookEventType,
} from '@arena/escalation';
import type {
  EscalationState,
  EscalationWebhookEvent,
  EscalationWebhookEventType,
} from '@arena/escalation';

import { ESCALATION_OBSERVABILITY_ERROR_CODES, EscalationObservabilityError } from './errors.js';
import { deepFreeze, toProjectionTimestamp, toTenantScope } from './shared.js';

/** Wire version of the timeline projection shape. */
export const ESCALATION_TIMELINE_VERSION = 1 as const;

/** One projected step of the per-escalation timeline. */
export interface TimelineStepView {
  /** The C001 webhook sequence (the consumer ordering key). */
  readonly sequence: number;
  readonly eventType: EscalationWebhookEventType;
  /** The lifecycle state this event projects (null for out-of-band updates). */
  readonly state: EscalationState | null;
  readonly occurredAt: string;
  /**
   * Milliseconds spent in this step before the next event arrived
   * (null on the last observed step — the current state's dwell is
   * still accumulating).
   */
  readonly dwellMs: number | null;
}

/** A projected validation verdict reference (validation-verdict refs). */
export interface ValidationVerdictRefView {
  readonly sequence: number;
  readonly occurredAt: string;
  /** The validation status carried by the event data (closed C001 vocabulary). */
  readonly validationStatus: string;
}

/** A projected payment-state reference (payment-state refs). */
export interface PaymentStateRefView {
  readonly sequence: number;
  readonly occurredAt: string;
  /** The payment/payout state carried by the event data (opaque ref — C010 owns money truth). */
  readonly paymentState: string;
}

/** A projected expert-replacement event. */
export interface ReplacementEventView {
  readonly sequence: number;
  readonly occurredAt: string;
}

/** The per-escalation lifecycle timeline projection (frozen). */
export interface EscalationTimelineProjection {
  readonly projectionVersion: typeof ESCALATION_TIMELINE_VERSION;
  readonly tenant: string;
  readonly requestId: string;
  readonly correlationId: string | null;
  /** Declared subject fields (resolved by the caller through its request port). */
  readonly clientAppId: string | null;
  readonly capabilityNeed: string | null;
  readonly urgency: string | null;
  readonly steps: readonly TimelineStepView[];
  readonly validationVerdicts: readonly ValidationVerdictRefView[];
  readonly paymentStates: readonly PaymentStateRefView[];
  readonly replacements: readonly ReplacementEventView[];
  /** The last projected lifecycle state (null when no state-bearing event). */
  readonly currentState: EscalationState | null;
  readonly terminal: boolean;
  readonly lastObservedAt: string;
  /** Projection time (injected — never a hidden clock). */
  readonly projectedAt: string;
}

export interface ProjectTimelineOptions {
  readonly tenant: string;
  readonly requestId: string;
  /** Caller-injected projection time. */
  readonly at: number | string | Date;
  /** Subject fields resolved through the caller's escalation-request port. */
  readonly clientAppId?: string | null;
  readonly capabilityNeed?: string | null;
  readonly urgency?: string | null;
}

function readStringField(data: unknown, field: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as Record<string, unknown>)[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Project the per-escalation timeline from a C001 webhook event batch.
 * PURE + fail-closed:
 *   - events from another tenant → CROSS_TENANT_ACCESS;
 *   - events of another request → INVALID_EVENT;
 *   - non-monotonic ordering / duplicate sequences → INVALID_EVENT;
 *   - duplicate eventIds are DROPPED (at-least-once delivery is safe).
 */
export function projectEscalationTimeline(
  events: readonly unknown[],
  options: ProjectTimelineOptions,
): EscalationTimelineProjection {
  const tenant = toTenantScope(options.tenant, 'tenant');
  const projectedAt = toProjectionTimestamp(options.at, 'at');

  const deduped = new Map<string, EscalationWebhookEvent>();
  for (const candidate of events) {
    if (!isEscalationWebhookEvent(candidate)) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_EVENT,
        {
          message: 'timeline projection requires structurally valid C001 webhook events',
          details: { requestId: options.requestId },
        },
      );
    }
    if (candidate.tenantId !== tenant) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.CROSS_TENANT_ACCESS,
        {
          message: `event ${candidate.eventId} of escalation ${candidate.requestId} belongs to tenant ${candidate.tenantId}; tenant ${tenant} may not project it`,
          details: { eventId: candidate.eventId, eventTenant: candidate.tenantId, tenant },
        },
      );
    }
    if (candidate.requestId !== options.requestId) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_EVENT,
        {
          message: `event ${candidate.eventId} belongs to escalation ${candidate.requestId}, not ${options.requestId} (one timeline projects exactly one escalation's stream)`,
          details: { eventId: candidate.eventId, expectedRequestId: options.requestId },
        },
      );
    }
    deduped.set(candidate.eventId, candidate);
  }

  const ordered = [...deduped.values()].sort((a, b) => a.sequence - b.sequence);
  // Two DISTINCT events (different eventIds) claiming the same sequence
  // are a conflicting stream — the projection fails closed rather than
  // silently picking one (delivery re-orders on (requestId, sequence);
  // it never invents sequence collisions).
  const seenSequences = new Set<number>();
  let lastAtMs: number | null = null;
  for (const event of ordered) {
    if (seenSequences.has(event.sequence)) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_EVENT,
        {
          message: `two distinct events claim sequence ${event.sequence} of escalation ${event.requestId} — a conflicting stream fails closed`,
          details: { requestId: options.requestId, sequence: event.sequence },
        },
      );
    }
    seenSequences.add(event.sequence);
    const atMs = Date.parse(event.occurredAt);
    if (lastAtMs !== null && atMs < lastAtMs) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_EVENT,
        {
          message: 'event occurredAt timestamps must be non-decreasing within one escalation stream',
          details: { requestId: options.requestId, sequence: event.sequence },
        },
      );
    }
    lastAtMs = atMs;
  }

  const steps: TimelineStepView[] = [];
  const validationVerdicts: ValidationVerdictRefView[] = [];
  const paymentStates: PaymentStateRefView[] = [];
  const replacements: ReplacementEventView[] = [];
  let currentState: EscalationState | null = null;
  let correlationId: string | null = null;

  for (let index = 0; index < ordered.length; index += 1) {
    const event = ordered[index] as EscalationWebhookEvent;
    const next = ordered[index + 1];
    const occurredMs = Date.parse(event.occurredAt);
    const dwellMs =
      next === undefined
        ? null
        : Math.max(0, Date.parse(next.occurredAt) - occurredMs);
    steps.push({
      sequence: event.sequence,
      eventType: event.eventType,
      state: event.state,
      occurredAt: event.occurredAt,
      dwellMs,
    });
    if (event.state !== null) currentState = event.state;
    if (correlationId === null) correlationId = event.correlationId;

    if (event.eventType === 'escalation.validation.updated') {
      const status =
        readStringField(event.data, 'validationStatus') ??
        readStringField(event.data, 'validationRef');
      if (status !== null) {
        validationVerdicts.push({
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          validationStatus: status,
        });
      }
    }
    if (event.eventType === 'escalation.payment.updated') {
      const state =
        readStringField(event.data, 'paymentState') ??
        readStringField(event.data, 'payoutStatus');
      if (state !== null) {
        paymentStates.push({
          sequence: event.sequence,
          occurredAt: event.occurredAt,
          paymentState: state,
        });
      }
    }
    if (event.state === 'expert_replaced') {
      replacements.push({ sequence: event.sequence, occurredAt: event.occurredAt });
    }
  }

  const lastEvent = ordered[ordered.length - 1];
  const terminal =
    lastEvent !== undefined &&
    (ESCALATION_WEBHOOK_TERMINAL_EVENT_TYPES as readonly string[]).includes(
      lastEvent.eventType,
    );

  return deepFreeze({
    projectionVersion: ESCALATION_TIMELINE_VERSION,
    tenant,
    requestId: options.requestId,
    correlationId,
    clientAppId: options.clientAppId ?? null,
    capabilityNeed: options.capabilityNeed ?? null,
    urgency: options.urgency ?? null,
    steps: Object.freeze([...steps]),
    validationVerdicts: Object.freeze([...validationVerdicts]),
    paymentStates: Object.freeze([...paymentStates]),
    replacements: Object.freeze([...replacements]),
    currentState,
    terminal,
    lastObservedAt: lastEvent === undefined ? projectedAt : lastEvent.occurredAt,
    projectedAt,
  } satisfies EscalationTimelineProjection);
}

// ---------------------------------------------------------------------------
// Per-escalation summary
// ---------------------------------------------------------------------------

/** The per-escalation summary fold (deterministic, frozen). */
export interface EscalationSummaryView {
  readonly tenant: string;
  readonly requestId: string;
  readonly clientAppId: string | null;
  readonly capabilityNeed: string | null;
  readonly urgency: string | null;
  readonly currentState: EscalationState | null;
  readonly terminal: boolean;
  readonly stepCount: number;
  readonly replacementCount: number;
  /** Total observed dwell ms (steps with known dwell). */
  readonly observedDwellMs: number;
  /** Longest dwell across observed steps (ms; null when no dwell observed). */
  readonly longestDwellMs: number | null;
  readonly validationVerdictCount: number;
  readonly paymentStateCount: number;
}

/** Fold a timeline into its summary (pure). */
export function foldEscalationSummary(
  timeline: EscalationTimelineProjection,
): EscalationSummaryView {
  let observedDwellMs = 0;
  let longestDwellMs: number | null = null;
  for (const step of timeline.steps) {
    if (step.dwellMs === null) continue;
    observedDwellMs += step.dwellMs;
    if (longestDwellMs === null || step.dwellMs > longestDwellMs) {
      longestDwellMs = step.dwellMs;
    }
  }
  return deepFreeze({
    tenant: timeline.tenant,
    requestId: timeline.requestId,
    clientAppId: timeline.clientAppId,
    capabilityNeed: timeline.capabilityNeed,
    urgency: timeline.urgency,
    currentState: timeline.currentState,
    terminal: timeline.terminal,
    stepCount: timeline.steps.length,
    replacementCount: timeline.replacements.length,
    observedDwellMs,
    longestDwellMs,
    validationVerdictCount: timeline.validationVerdicts.length,
    paymentStateCount: timeline.paymentStates.length,
  } satisfies EscalationSummaryView);
}

// ---------------------------------------------------------------------------
// Dimensional rollups
// ---------------------------------------------------------------------------

/** The closed rollup dimensions (all fail-closed on missing subject fields). */
export const ESCALATION_ROLLUP_DIMENSIONS = Object.freeze([
  'client-app',
  'capability',
  'urgency',
] as const);
export type EscalationRollupDimension = (typeof ESCALATION_ROLLUP_DIMENSIONS)[number];

export function isEscalationRollupDimension(
  value: unknown,
): value is EscalationRollupDimension {
  return (
    typeof value === 'string' &&
    (ESCALATION_ROLLUP_DIMENSIONS as readonly string[]).includes(value)
  );
}

/** One dimensional rollup cell (frozen, deterministic). */
export interface EscalationRollupCell {
  readonly dimension: EscalationRollupDimension;
  readonly key: string;
  readonly escalationCount: number;
  readonly terminalCount: number;
  readonly replacementCount: number;
  /** Replacement rate = replacementCount / escalationCount (0 when empty). */
  readonly replacementRate: number;
  readonly medianDwellMs: number | null;
}

function keyOfTimeline(
  timeline: EscalationTimelineProjection,
  dimension: EscalationRollupDimension,
): string {
  if (dimension === 'client-app') {
    if (timeline.clientAppId === null) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_PROJECTION,
        {
          message: 'client-app rollup requires every timeline to carry its clientAppId subject field (resolve it through the request port before rolling up)',
          details: { requestId: timeline.requestId },
        },
      );
    }
    return timeline.clientAppId;
  }
  if (dimension === 'capability') {
    if (timeline.capabilityNeed === null) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_PROJECTION,
        {
          message: 'capability rollup requires every timeline to carry its capabilityNeed subject field (resolve it through the request port before rolling up)',
          details: { requestId: timeline.requestId },
        },
      );
    }
    return timeline.capabilityNeed;
  }
  if (timeline.urgency === null) {
    throw new EscalationObservabilityError(
      ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_PROJECTION,
      {
        message: 'urgency rollup requires every timeline to carry its urgency subject field (resolve it through the request port before rolling up)',
        details: { requestId: timeline.requestId },
      },
    );
  }
  return timeline.urgency;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid];
  if (upper === undefined) return null;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/**
 * Roll a set of timelines up along one dimension. Deterministic: cells
 * are ordered by key; identical timelines yield an identical rollup.
 */
export function projectEscalationRollup(
  timelines: readonly EscalationTimelineProjection[],
  dimension: EscalationRollupDimension,
): readonly EscalationRollupCell[] {
  if (!isEscalationRollupDimension(dimension)) {
    throw new EscalationObservabilityError(
      ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_PROJECTION,
      {
        message: `unknown rollup dimension: ${JSON.stringify(dimension)}`,
        details: { vocabulary: ESCALATION_ROLLUP_DIMENSIONS },
      },
    );
  }
  const groups = new Map<string, EscalationTimelineProjection[]>();
  for (const timeline of timelines) {
    const key = keyOfTimeline(timeline, dimension);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [timeline]);
    else bucket.push(timeline);
  }
  const cells: EscalationRollupCell[] = [];
  for (const key of [...groups.keys()].sort()) {
    const bucket = groups.get(key) as EscalationTimelineProjection[];
    const dwellValues: number[] = [];
    for (const timeline of bucket) {
      dwellValues.push(foldEscalationSummary(timeline).observedDwellMs);
    }
    const escalationCount = bucket.length;
    const terminalCount = bucket.filter((timeline) => timeline.terminal).length;
    const replacementCount = bucket.reduce(
      (sum, timeline) => sum + timeline.replacements.length,
      0,
    );
    cells.push({
      dimension,
      key,
      escalationCount,
      terminalCount,
      replacementCount,
      replacementRate: escalationCount === 0 ? 0 : replacementCount / escalationCount,
      medianDwellMs: median(dwellValues),
    });
  }
  return Object.freeze([...cells.map((cell) => deepFreeze(cell))]);
}

/** Re-export the C001 event-type guard for consumers of this surface. */
export { isEscalationWebhookEventType };
