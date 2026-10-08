/**
 * SLA measurement over the C011 clocks (Work Order C021; issue #127).
 *
 * The C011 SLA surface (packages/expert-engagement/src/sla.ts) OWNS the
 * policy + clock arithmetic: deriveSlaClocks (accept-by / start-by /
 * submit-by, deadline-capped) and evaluateSlaClocks (states with
 * machine-readable reasons). This file MEASURES it into durable,
 * versioned, append-only records for the operator surface:
 *
 *   - SlaMeasurementDefinition: typed, versioned SLA definitions with
 *     FOUR clock windows per urgency class (accept-by / start-by /
 *     submit-by / validate-by). DEVIATION NOTE: C011 policies carry
 *     THREE clocks (accept/start/submit); the C021 work order brief
 *     specifies a fourth (validate-by — ES1.0 validation is a lifecycle
 *     stage with its own response window). The first three windows
 *     default to the C011 DEFAULT_SLA_WINDOWS_BY_URGENCY values;
 *     validate-by defaults to the SAME class's accept window (a
 *     disclosed derived default — architecture question in the PR).
 *   - measureSlaClocks: the PURE measurement of all four clocks from a
 *     C011 SlaClocks + recorded milestones, mapping the C011 clock
 *     states (satisfied / on-track / at-risk / breached) onto the C021
 *     measured vocabulary (met / pending / at-risk / breached) with
 *     machine-readable reasons.
 *   - MeasuredSlaRecord: the frozen, append-only measured record.
 *     EVIDENCE LAW: a 'met' record MUST carry a milestone time AND at
 *     least one backing event id — a fabricated SLA-met record not
 *     backed by events FAILS CLOSED (INVALID_SLA).
 *   - supersedeMeasuredSlaRecord: corrections are SUPERSESSIONS — a new
 *     record that references the prior record id; the prior record is
 *     never edited in place (no retroactive silent edits; the no-edit
 *     invariant is structural — records are deep-frozen).
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  DEFAULT_SLA_POLICY,
  DEFAULT_SLA_WINDOWS_BY_URGENCY,
  deriveSlaClocks,
  evaluateSlaClocks,
} from '@arena/expert-engagement';
import type {
  SlaClocks,
  SlaEvaluation,
  SlaPolicy,
} from '@arena/expert-engagement';
import type { EscalationUrgency } from '@arena/escalation';

import { ESCALATION_OBSERVABILITY_ERROR_CODES, EscalationObservabilityError } from './errors.js';
import { deepFreeze, isEnumMember, toProjectionTimestamp, toTenantScope } from './shared.js';

/** Wire version of the SLA measurement shapes. */
export const SLA_MEASUREMENT_VERSION = 1 as const;

/** The urgency vocabulary (mirrored from C001 — no second authority). */
export const SLA_URGENCY_CLASSES = Object.freeze([
  'routine',
  'priority',
  'urgent',
  'critical',
] as const);
export type SlaUrgencyClass = (typeof SLA_URGENCY_CLASSES)[number];

export function isSlaUrgencyClass(value: unknown): value is SlaUrgencyClass {
  return isEnumMember(value, SLA_URGENCY_CLASSES);
}

// ---------------------------------------------------------------------------
// Typed, versioned SLA definitions (four clock kinds)
// ---------------------------------------------------------------------------

/** The four measured SLA clock kinds (C011's three + validate-by). */
export const MEASURED_SLA_CLOCK_KINDS = Object.freeze([
  'accept',
  'start',
  'submit',
  'validate',
] as const);
export type MeasuredSlaClockKind = (typeof MEASURED_SLA_CLOCK_KINDS)[number];

export function isMeasuredSlaClockKind(value: unknown): value is MeasuredSlaClockKind {
  return isEnumMember(value, MEASURED_SLA_CLOCK_KINDS);
}

/** The response windows for one urgency class (ms, positive). */
export interface SlaMeasurementWindows {
  readonly acceptMs: number;
  readonly startMs: number;
  readonly submitMs: number;
  readonly validateMs: number;
}

/**
 * The DEFAULT measurement windows. DERIVED: the first three mirror the
 * C011 DEFAULT_SLA_WINDOWS_BY_URGENCY exactly; validate-by takes the
 * same class's accept window (disclosed derived default — architecture
 * question in the PR).
 */
export const DEFAULT_SLA_MEASUREMENT_WINDOWS: Readonly<
  Record<SlaUrgencyClass, SlaMeasurementWindows>
> = Object.freeze({
  routine: Object.freeze({
    ...DEFAULT_SLA_WINDOWS_BY_URGENCY.routine,
    validateMs: DEFAULT_SLA_WINDOWS_BY_URGENCY.routine.acceptMs,
  }),
  priority: Object.freeze({
    ...DEFAULT_SLA_WINDOWS_BY_URGENCY.priority,
    validateMs: DEFAULT_SLA_WINDOWS_BY_URGENCY.priority.acceptMs,
  }),
  urgent: Object.freeze({
    ...DEFAULT_SLA_WINDOWS_BY_URGENCY.urgent,
    validateMs: DEFAULT_SLA_WINDOWS_BY_URGENCY.urgent.acceptMs,
  }),
  critical: Object.freeze({
    ...DEFAULT_SLA_WINDOWS_BY_URGENCY.critical,
    validateMs: DEFAULT_SLA_WINDOWS_BY_URGENCY.critical.acceptMs,
  }),
} as const);

/** A typed, versioned SLA measurement definition (all four classes). */
export interface SlaMeasurementDefinition {
  readonly definitionVersion: typeof SLA_MEASUREMENT_VERSION;
  readonly windowsByUrgency: Readonly<Record<SlaUrgencyClass, SlaMeasurementWindows>>;
}

export interface CreateSlaMeasurementDefinitionInput {
  readonly windowsByUrgency: Record<
    string,
    { acceptMs: number; startMs: number; submitMs: number; validateMs: number }
  >;
}

function toPositiveMs(value: number, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
      message: `${field} must be a positive integer (milliseconds): ${JSON.stringify(value)}`,
      details: { field },
    });
  }
  return value;
}

/** Build a validated SLA measurement definition (complete, never silent defaults). */
export function createSlaMeasurementDefinition(
  input: CreateSlaMeasurementDefinitionInput,
): SlaMeasurementDefinition {
  const windowsByUrgency = {} as Record<SlaUrgencyClass, SlaMeasurementWindows>;
  for (const urgency of SLA_URGENCY_CLASSES) {
    const entry = input.windowsByUrgency[urgency];
    if (entry === undefined) {
      throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
        message: `SLA measurement definition: missing windows for urgency class '${urgency}' (explicit complete definitions — never silent defaults)`,
        details: { urgency },
      });
    }
    windowsByUrgency[urgency] = Object.freeze({
      acceptMs: toPositiveMs(entry.acceptMs, `windowsByUrgency.${urgency}.acceptMs`),
      startMs: toPositiveMs(entry.startMs, `windowsByUrgency.${urgency}.startMs`),
      submitMs: toPositiveMs(entry.submitMs, `windowsByUrgency.${urgency}.submitMs`),
      validateMs: toPositiveMs(entry.validateMs, `windowsByUrgency.${urgency}.validateMs`),
    });
  }
  for (const key of Object.keys(input.windowsByUrgency)) {
    if (!isSlaUrgencyClass(key)) {
      throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
        message: `unknown urgency class: ${JSON.stringify(key)}`,
        details: { vocabulary: SLA_URGENCY_CLASSES },
      });
    }
  }
  return Object.freeze({
    definitionVersion: SLA_MEASUREMENT_VERSION,
    windowsByUrgency: Object.freeze({ ...windowsByUrgency }),
  } satisfies SlaMeasurementDefinition);
}

// ---------------------------------------------------------------------------
// Measurement states + reasons (closed vocabularies)
// ---------------------------------------------------------------------------

/** The closed measured-state vocabulary. */
export const MEASURED_SLA_STATES = Object.freeze([
  'met',
  'pending',
  'at-risk',
  'breached',
] as const);
export type MeasuredSlaState = (typeof MEASURED_SLA_STATES)[number];

export function isMeasuredSlaState(value: unknown): value is MeasuredSlaState {
  return isEnumMember(value, MEASURED_SLA_STATES);
}

/** The closed measured-reason vocabulary (machine-readable, never free text). */
export const MEASURED_SLA_REASONS = Object.freeze([
  'clock-met-before-due',
  'clock-pending-before-due',
  'clock-at-risk-remaining-quarter',
  'clock-breached-deadline-passed',
  'correction-supersedes-prior-record',
] as const);
export type MeasuredSlaReason = (typeof MEASURED_SLA_REASONS)[number];

export function isMeasuredSlaReason(value: unknown): value is MeasuredSlaReason {
  return isEnumMember(value, MEASURED_SLA_REASONS);
}

/** Map a C011 clock state onto the measured vocabulary (disclosed mapping). */
export function toMeasuredState(state: 'satisfied' | 'on-track' | 'at-risk' | 'breached'): MeasuredSlaState {
  if (state === 'satisfied') return 'met';
  if (state === 'on-track') return 'pending';
  return state;
}

// ---------------------------------------------------------------------------
// Measured records (append-only, evidence-backed)
// ---------------------------------------------------------------------------

/** A measured SLA clock record (frozen; append-only by construction). */
export interface MeasuredSlaRecord {
  readonly recordVersion: typeof SLA_MEASUREMENT_VERSION;
  readonly slaRecordId: string;
  readonly tenant: string;
  readonly requestId: string;
  /** The C011 engagement the clocks were measured over (when resolved). */
  readonly engagementId: string | null;
  readonly urgency: SlaUrgencyClass;
  readonly clock: MeasuredSlaClockKind;
  readonly dueAt: string;
  /** When the milestone actually happened (null when not yet). */
  readonly milestoneAt: string | null;
  readonly state: MeasuredSlaState;
  readonly reasons: readonly MeasuredSlaReason[];
  /** The projection time this measurement was taken at (injected). */
  readonly observedAt: string;
  /** The event ids backing this measurement (EVIDENCE LAW — see createMeasuredSlaRecord). */
  readonly evidenceEventIds: readonly string[];
  /** Supersession chain: the prior record this correction replaces (null on originals). */
  readonly supersedes: string | null;
}

export interface CreateMeasuredSlaRecordInput {
  readonly slaRecordId: string;
  readonly tenant: string;
  readonly requestId: string;
  readonly engagementId?: string | null;
  readonly urgency: string;
  readonly clock: string;
  readonly dueAt: number | string | Date;
  readonly milestoneAt?: number | string | Date | null;
  readonly state: string;
  readonly reasons: readonly string[];
  readonly observedAt: number | string | Date;
  readonly evidenceEventIds?: readonly string[];
  readonly supersedes?: string | null;
}

/**
 * Construct + validate + freeze one measured SLA record. FAIL-CLOSED
 * EVIDENCE LAW: a 'met' record must carry a milestone time AND at least
 * one backing event id — a fabricated SLA-met record not backed by
 * events is rejected (INVALID_SLA). A 'breached' record must carry the
 * breached reason. The record is deep-frozen: there is no edit path.
 */
export function createMeasuredSlaRecord(
  input: CreateMeasuredSlaRecordInput,
): MeasuredSlaRecord {
  if (!isMeasuredSlaClockKind(input.clock)) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
      message: `measured SLA clock must be one of ${MEASURED_SLA_CLOCK_KINDS.join('|')}, got: ${JSON.stringify(input.clock)}`,
    });
  }
  if (!isSlaUrgencyClass(input.urgency)) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
      message: `measured SLA urgency must be one of ${SLA_URGENCY_CLASSES.join('|')}, got: ${JSON.stringify(input.urgency)}`,
    });
  }
  if (!isMeasuredSlaState(input.state)) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
      message: `measured SLA state must be one of ${MEASURED_SLA_STATES.join('|')}, got: ${JSON.stringify(input.state)}`,
    });
  }
  const reasons = [...input.reasons];
  for (const reason of reasons) {
    if (!isMeasuredSlaReason(reason)) {
      throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
        message: `measured SLA reason must be one of ${MEASURED_SLA_REASONS.join('|')}, got: ${JSON.stringify(reason)}`,
      });
    }
  }
  if (input.state === 'breached' && !reasons.includes('clock-breached-deadline-passed')) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
      message: "a breached measured SLA record must carry the 'clock-breached-deadline-passed' reason",
    });
  }
  const evidenceEventIds = Object.freeze([...(input.evidenceEventIds ?? [])]);
  const milestoneAt =
    input.milestoneAt === undefined || input.milestoneAt === null
      ? null
      : toProjectionTimestamp(input.milestoneAt, 'milestoneAt');
  if (input.state === 'met') {
    if (milestoneAt === null || evidenceEventIds.length === 0) {
      throw new EscalationObservabilityError(
        ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA,
        {
          message:
            "EVIDENCE LAW: a 'met' measured SLA record must carry a milestone time and at least one backing event id — a fabricated SLA-met record not backed by events fails closed",
          details: { requestId: input.requestId, clock: input.clock },
        },
      );
    }
  }
  const observedAt = toProjectionTimestamp(input.observedAt, 'observedAt');
  const dueAt = toProjectionTimestamp(input.dueAt, 'dueAt');
  const urgency: SlaUrgencyClass = input.urgency;
  const clock: MeasuredSlaClockKind = input.clock;
  const state: MeasuredSlaState = input.state;
  const frozenReasons = Object.freeze([...new Set(reasons)]) as readonly MeasuredSlaReason[];
  return deepFreeze({
    recordVersion: SLA_MEASUREMENT_VERSION,
    slaRecordId: input.slaRecordId,
    tenant: toTenantScope(input.tenant, 'tenant'),
    requestId: input.requestId,
    engagementId: input.engagementId ?? null,
    urgency,
    clock,
    dueAt,
    milestoneAt,
    state,
    reasons: frozenReasons,
    observedAt,
    evidenceEventIds,
    supersedes: input.supersedes ?? null,
  } satisfies MeasuredSlaRecord);
}

/** Deterministic record id for a measured clock (content-addressed). */
export async function measuredSlaRecordId(
  requestId: string,
  clock: MeasuredSlaClockKind,
  observedAt: string,
): Promise<string> {
  const digest = await digestCanonical({ requestId, clock, observedAt });
  return `obs_${digest.slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// The pure four-clock measurement
// ---------------------------------------------------------------------------

/** The recorded milestones a measurement derives from. */
export interface SlaMilestones {
  /** Expert accepted the offer (accept clock milestone). */
  readonly acceptedAt?: string | null;
  /** Session activated (start clock milestone). */
  readonly activatedAt?: string | null;
  /** Expert submitted the result (submit clock milestone). */
  readonly submittedAt?: string | null;
  /** Validation verdict issued (validate clock milestone). */
  readonly validationVerdictAt?: string | null;
}

/** One measured clock (pre-id view; ids are minted under idempotency). */
export interface MeasuredSlaClockView {
  readonly clock: MeasuredSlaClockKind;
  readonly dueAt: string;
  readonly milestoneAt: string | null;
  readonly state: MeasuredSlaState;
  readonly reasons: readonly MeasuredSlaReason[];
}

export interface MeasureSlaClocksInput {
  readonly tenant: string;
  readonly requestId: string;
  readonly engagementId?: string | null;
  readonly urgency: string;
  /** The request deadline (the outermost bound — C001 field). */
  readonly requestDeadline: string;
  /** When the offer was issued (the accept clock's origin). */
  readonly offerIssuedAt: string;
  readonly milestones: SlaMilestones;
  /** Caller-injected projection time. */
  readonly at: string;
  /** The event ids backing the milestones (evidence). */
  readonly evidenceEventIds?: readonly string[];
  /** Optional C011 policy override (defaults to the C011 default policy). */
  readonly policy?: SlaPolicy;
}

/**
 * Measure all four SLA clocks. PURE + deterministic: the identical
 * (inputs, milestones, at) always yields the identical measurement. The
 * first three clocks are measured through the C011 evaluator (the SAME
 * arithmetic C011 enforces — this package never re-implements clock
 * math); the validate-by clock is derived here (submittedAt + validate
 * window, deadline-capped).
 */
export function measureSlaClocks(input: MeasureSlaClocksInput): {
  readonly clocks: readonly MeasuredSlaClockView[];
  readonly engagementClocks: SlaClocks;
  readonly evaluation: SlaEvaluation;
} {
  if (!isSlaUrgencyClass(input.urgency)) {
    throw new EscalationObservabilityError(ESCALATION_OBSERVABILITY_ERROR_CODES.INVALID_SLA, {
      message: `measured SLA urgency must be one of ${SLA_URGENCY_CLASSES.join('|')}, got: ${JSON.stringify(input.urgency)}`,
    });
  }
  const policy = input.policy ?? DEFAULT_SLA_POLICY;
  const clocks = deriveSlaClocks(
    {
      urgency: input.urgency,
      requestDeadline: input.requestDeadline,
      offerIssuedAt: input.offerIssuedAt,
      acceptedAt: input.milestones.acceptedAt ?? null,
      activatedAt: input.milestones.activatedAt ?? null,
    },
    policy,
  );
  const evaluation = evaluateSlaClocks(
    {
      clocks,
      urgency: input.urgency,
      at: input.at,
      acceptedAt: input.milestones.acceptedAt ?? null,
      activatedAt: input.milestones.activatedAt ?? null,
      completedAt: input.milestones.submittedAt ?? null,
    },
    policy,
  );

  const views: MeasuredSlaClockView[] = [
    {
      clock: 'accept',
      dueAt: clocks.acceptBy,
      milestoneAt: input.milestones.acceptedAt ?? null,
      state: toMeasuredState(evaluation.acceptClock.state),
      reasons: Object.freeze([
        reasonFor(evaluation.acceptClock.state),
      ]),
    },
    {
      clock: 'start',
      dueAt: clocks.startBy,
      milestoneAt: input.milestones.activatedAt ?? null,
      state: toMeasuredState(evaluation.startClock.state),
      reasons: Object.freeze([reasonFor(evaluation.startClock.state)]),
    },
    {
      clock: 'submit',
      dueAt: clocks.submitBy,
      milestoneAt: input.milestones.submittedAt ?? null,
      state: toMeasuredState(evaluation.submitClock.state),
      reasons: Object.freeze([reasonFor(evaluation.submitClock.state)]),
    },
  ];

  // The validate-by clock: due at submission + validate window, capped
  // by the request deadline (the outermost bound, ES1.0 deadline).
  const validateWindowMs = DEFAULT_SLA_MEASUREMENT_WINDOWS[input.urgency].validateMs;
  const submittedMs =
    input.milestones.submittedAt === undefined || input.milestones.submittedAt === null
      ? null
      : Date.parse(input.milestones.submittedAt);
  const deadlineMs = Date.parse(input.requestDeadline);
  let validateDueMs: number;
  if (submittedMs === null) {
    // Not submitted yet: the validate clock hangs off the submit-by
    // bound (the last moment a submission can still arrive).
    validateDueMs = Math.min(Date.parse(clocks.submitBy) + validateWindowMs, deadlineMs);
  } else {
    validateDueMs = Math.min(submittedMs + validateWindowMs, deadlineMs);
  }
  const validateDueAt = toProjectionTimestamp(validateDueMs, 'validateBy');
  const verdictMs =
    input.milestones.validationVerdictAt === undefined ||
    input.milestones.validationVerdictAt === null
      ? null
      : Date.parse(input.milestones.validationVerdictAt);
  const atMs = Date.parse(input.at);
  if (verdictMs !== null && verdictMs <= validateDueMs) {
    views.push({
      clock: 'validate',
      dueAt: validateDueAt,
      milestoneAt: input.milestones.validationVerdictAt ?? null,
      state: 'met',
      reasons: Object.freeze(['clock-met-before-due']),
    });
  } else if (verdictMs !== null) {
    views.push({
      clock: 'validate',
      dueAt: validateDueAt,
      milestoneAt: input.milestones.validationVerdictAt ?? null,
      state: 'breached',
      reasons: Object.freeze(['clock-breached-deadline-passed']),
    });
  } else if (atMs > validateDueMs) {
    views.push({
      clock: 'validate',
      dueAt: validateDueAt,
      milestoneAt: null,
      state: 'breached',
      reasons: Object.freeze(['clock-breached-deadline-passed']),
    });
  } else {
    const remainingMs = validateDueMs - atMs;
    const state: MeasuredSlaState =
      remainingMs <= Math.floor(validateWindowMs * 0.25) ? 'at-risk' : 'pending';
    views.push({
      clock: 'validate',
      dueAt: validateDueAt,
      milestoneAt: null,
      state,
      reasons: Object.freeze([
        state === 'at-risk' ? 'clock-at-risk-remaining-quarter' : 'clock-pending-before-due',
      ]),
    });
  }

  return deepFreeze({
    clocks: Object.freeze(
      views.map((view) =>
        deepFreeze({
          ...view,
          reasons: Object.freeze([...view.reasons]),
        }),
      ),
    ),
    engagementClocks: clocks,
    evaluation,
  });
}

function reasonFor(state: 'satisfied' | 'on-track' | 'at-risk' | 'breached'): MeasuredSlaReason {
  if (state === 'satisfied') return 'clock-met-before-due';
  if (state === 'on-track') return 'clock-pending-before-due';
  if (state === 'at-risk') return 'clock-at-risk-remaining-quarter';
  return 'clock-breached-deadline-passed';
}

// ---------------------------------------------------------------------------
// Supersession (corrections are supersessions — never retroactive edits)
// ---------------------------------------------------------------------------

export interface SlaCorrectionInput {
  readonly slaRecordId: string;
  readonly state: string;
  readonly reasons: readonly string[];
  readonly milestoneAt?: number | string | Date | null;
  readonly observedAt: number | string | Date;
  readonly evidenceEventIds?: readonly string[];
}

/**
 * Correct a measured SLA record by SUPERSESSION: the correction is a NEW
 * record referencing the prior record's id; the prior record is never
 * mutated (it is deep-frozen — there is no edit path at all). The
 * correction must be observed at or after the prior observation (no
 * retroactive silent edits) and must carry the supersession reason.
 */
export function supersedeMeasuredSlaRecord(
  prior: MeasuredSlaRecord,
  correction: SlaCorrectionInput,
): MeasuredSlaRecord {
  const observedAt = toProjectionTimestamp(correction.observedAt, 'observedAt');
  if (Date.parse(observedAt) < Date.parse(prior.observedAt)) {
    throw new EscalationObservabilityError(
      ESCALATION_OBSERVABILITY_ERROR_CODES.SUPERSESSION_REQUIRED,
      {
        message: `a superseding SLA record may not be observed before the record it supersedes (${prior.observedAt}) — corrections are supersessions, never retroactive edits`,
        details: { priorObservedAt: prior.observedAt, correctionObservedAt: observedAt },
      },
    );
  }
  if (correction.slaRecordId === prior.slaRecordId) {
    throw new EscalationObservabilityError(
      ESCALATION_OBSERVABILITY_ERROR_CODES.SUPERSESSION_REQUIRED,
      {
        message: 'a superseding record must carry its OWN id (append-only store, unique ids)',
        details: { slaRecordId: correction.slaRecordId },
      },
    );
  }
  const reasons = [...correction.reasons, 'correction-supersedes-prior-record'];
  return createMeasuredSlaRecord({
    slaRecordId: correction.slaRecordId,
    tenant: prior.tenant,
    requestId: prior.requestId,
    engagementId: prior.engagementId,
    urgency: prior.urgency,
    clock: prior.clock,
    dueAt: prior.dueAt,
    milestoneAt: correction.milestoneAt ?? prior.milestoneAt,
    state: correction.state,
    reasons,
    observedAt,
    evidenceEventIds: correction.evidenceEventIds ?? prior.evidenceEventIds,
    supersedes: prior.slaRecordId,
  });
}

/** The effective records of an append-only store: last record per clock wins. */
export function effectiveMeasuredSlaRecords(
  records: readonly MeasuredSlaRecord[],
): readonly MeasuredSlaRecord[] {
  const effective = new Map<string, MeasuredSlaRecord>();
  for (const record of [...records].sort((a, b) =>
    a.observedAt === b.observedAt
      ? a.slaRecordId.localeCompare(b.slaRecordId)
      : Date.parse(a.observedAt) - Date.parse(b.observedAt),
  )) {
    effective.set(`${record.requestId}:${record.clock}`, record);
  }
  const values = [...effective.values()].sort(
    (a, b) => MEASURED_SLA_CLOCK_KINDS.indexOf(a.clock) - MEASURED_SLA_CLOCK_KINDS.indexOf(b.clock),
  );
  return Object.freeze(values);
}

/** Type re-export: an escalation urgency value (C001 vocabulary). */
export type { EscalationUrgency };
