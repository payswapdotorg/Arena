/**
 * SLA policy, clocks and breach records (Work Order C011; issue #117;
 * spec/expert-escalation-api.md — urgency/deadline request fields; the
 * SLA measurements C021 observability will consume).
 *
 *   - SlaPolicy — the VERSIONED record of response windows (accept /
 *     start / submit) by urgency class (the C001 closed urgency
 *     vocabulary — routine | priority | urgent | critical). Custom
 *     policies are explicit and complete (all four classes, all three
 *     windows — never silent defaults).
 *   - deriveSlaClocks — deadline-aware clock derivation: accept-by from
 *     the offer time, start-by from acceptance, submit-by capped by the
 *     escalation request's deadline. PURE + deterministic.
 *   - evaluateSlaClocks — the clock states (on-track | at-risk |
 *     breached | satisfied) with machine-readable reasons. At-risk is
 *     the last quarter of the window (DEFAULT_AT_RISK_FRACTION — a
 *     documented derived default, architecture question in the PR).
 *   - SlaBreachRecord — breach records are EXPLICIT, append-only,
 *     content-addressed EVENTS with reasons. MEASUREMENT ONLY: this
 *     package records and reads breaches; enforcement (routing
 *     penalties, C020 quality consequences) belongs to downstream
 *     consumers — never a silent penalty here.
 *
 * All timestamps injected (lock rule 17); records deep-frozen;
 * tenant-scoped at the domain level (lock rule 11).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';
import {
  deepFreeze,
  isEngagementContentDigest,
  isEngagementTimestamp,
  isSlaUrgencyClass,
  toEngagementContentDigest,
  toEngagementId,
  toEngagementTimestamp,
  toNonNegativeInteger,
  toPositiveInteger,
  toSlaRecordId,
  toSlaUrgencyClass,
} from './shared.js';
import type {
  EngagementContentDigest,
  EngagementId,
  EngagementTimestamp,
  SlaUrgencyClass,
} from './shared.js';

/** Wire version of the SLA policy shape. */
export const SLA_POLICY_VERSION = 1 as const;

/** Wire version of the SLA breach-record shape. */
export const SLA_BREACH_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The versioned SLA policy (response windows by urgency class)
// ---------------------------------------------------------------------------

/** The three SLA clocks every engagement runs (typed clock kinds). */
export const SLA_CLOCK_KINDS = Object.freeze(['accept', 'start', 'submit'] as const);
export type SlaClockKind = (typeof SLA_CLOCK_KINDS)[number];

export function isSlaClockKind(value: unknown): value is SlaClockKind {
  return (
    typeof value === 'string' && (SLA_CLOCK_KINDS as readonly string[]).includes(value)
  );
}

/** The response windows for one urgency class (milliseconds, positive). */
export interface SlaWindows {
  /** Offer → expert must accept within this window (accept-by). */
  readonly acceptMs: number;
  /** Acceptance → session must start within this window (start-by). */
  readonly startMs: number;
  /** Session start → expert must submit within this window (submit-by). */
  readonly submitMs: number;
}

/** A versioned SLA policy: one response-window triple per urgency class. */
export interface SlaPolicy {
  readonly policyVersion: typeof SLA_POLICY_VERSION;
  readonly windowsByUrgency: Readonly<Record<SlaUrgencyClass, SlaWindows>>;
}

/**
 * The DEFAULT response windows (milliseconds). DERIVED defaults (no
 * dedicated canonical engagement/SLA spec — architecture question in the
 * PR): urgency tightens every window roughly one order of magnitude at
 * each step.
 */
export const DEFAULT_SLA_WINDOWS_BY_URGENCY: Readonly<Record<SlaUrgencyClass, SlaWindows>> =
  Object.freeze({
    routine: Object.freeze({ acceptMs: 24 * 3600_000, startMs: 72 * 3600_000, submitMs: 168 * 3600_000 }),
    priority: Object.freeze({ acceptMs: 4 * 3600_000, startMs: 24 * 3600_000, submitMs: 72 * 3600_000 }),
    urgent: Object.freeze({ acceptMs: 3600_000, startMs: 4 * 3600_000, submitMs: 24 * 3600_000 }),
    critical: Object.freeze({ acceptMs: 15 * 60_000, startMs: 3600_000, submitMs: 4 * 3600_000 }),
  } as const);

/** The default in-force SLA policy. */
export const DEFAULT_SLA_POLICY: SlaPolicy = Object.freeze({
  policyVersion: SLA_POLICY_VERSION,
  windowsByUrgency: DEFAULT_SLA_WINDOWS_BY_URGENCY,
} as const);

export interface CreateSlaPolicyInput {
  readonly windowsByUrgency: Record<string, { acceptMs: number; startMs: number; submitMs: number }>;
}

/** Build a validated SLA policy (all four urgency classes, positive windows). */
export function createSlaPolicy(input: CreateSlaPolicyInput): SlaPolicy {
  const windowsByUrgency = {} as Record<SlaUrgencyClass, SlaWindows>;
  for (const urgency of ['routine', 'priority', 'urgent', 'critical'] as const) {
    const entry = input.windowsByUrgency[urgency];
    if (entry === undefined) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_POLICY, {
        message: `SLA policy: missing response windows for urgency class '${urgency}' (explicit complete policies — never silent defaults)`,
        details: { urgency },
      });
    }
    windowsByUrgency[urgency] = Object.freeze({
      acceptMs: toPositiveInteger(entry.acceptMs, `windowsByUrgency.${urgency}.acceptMs`),
      startMs: toPositiveInteger(entry.startMs, `windowsByUrgency.${urgency}.startMs`),
      submitMs: toPositiveInteger(entry.submitMs, `windowsByUrgency.${urgency}.submitMs`),
    });
  }
  for (const key of Object.keys(input.windowsByUrgency)) {
    toSlaUrgencyClass(key, 'windowsByUrgency');
  }
  return Object.freeze({
    policyVersion: SLA_POLICY_VERSION,
    windowsByUrgency: Object.freeze({ ...windowsByUrgency }),
  } as const);
}

// ---------------------------------------------------------------------------
// Deadline-aware clock derivation (pure + deterministic)
// ---------------------------------------------------------------------------

/** The three typed SLA clocks (derived, never stored as mutable state). */
export interface SlaClocks {
  readonly acceptBy: EngagementTimestamp;
  readonly startBy: EngagementTimestamp;
  readonly submitBy: EngagementTimestamp;
  /** True when the request deadline (not the policy window) set submit-by. */
  readonly submitByIsDeadlineCapped: boolean;
}

export interface DeriveSlaClocksInput {
  /** The escalation request's urgency class (C001 vocabulary, mirrored). */
  readonly urgency: string;
  /** The escalation request's deadline (the outermost bound). */
  readonly requestDeadline: string;
  /** When the offer was issued (the accept clock's origin). */
  readonly offerIssuedAt: string;
  /** When the expert accepted (the start clock's origin; null pre-acceptance). */
  readonly acceptedAt?: string | null;
  /** When the session started (the submit clock's origin; null pre-activation). */
  readonly activatedAt?: string | null;
}

function shiftMs(originMs: number, deltaMs: number): EngagementTimestamp {
  return toEngagementTimestamp(
    new Date(originMs + deltaMs).toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z'),
    'slaClock',
  );
}

/**
 * Derive the three SLA clocks. Deterministic deadline-aware arithmetic:
 *   - accept-by  = offerIssuedAt + policy acceptMs (never past the deadline);
 *   - start-by   = (acceptedAt ?? accept-by) + policy startMs;
 *   - submit-by  = min((activatedAt ?? start-by) + policy submitMs, requestDeadline)
 * The request deadline always caps submit-by (ES1.0 deadline routing
 * input) and the offer can never outlive the deadline.
 */
export function deriveSlaClocks(
  input: DeriveSlaClocksInput,
  policy: SlaPolicy = DEFAULT_SLA_POLICY,
): SlaClocks {
  const urgency = toSlaUrgencyClass(input.urgency, 'urgency');
  const windows = policy.windowsByUrgency[urgency];
  const offerMs = Date.parse(toEngagementTimestamp(input.offerIssuedAt, 'offerIssuedAt'));
  const deadlineMs = Date.parse(
    toEngagementTimestamp(input.requestDeadline, 'requestDeadline'),
  );
  if (deadlineMs <= offerMs) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.DEADLINE_PASSED, {
      message: 'requestDeadline must be after offerIssuedAt',
      details: { requestDeadline: input.requestDeadline, offerIssuedAt: input.offerIssuedAt },
    });
  }
  const acceptBy = shiftMs(offerMs, windows.acceptMs);
  const acceptMs = Math.min(Date.parse(acceptBy), deadlineMs);
  const acceptedMs =
    input.acceptedAt === undefined || input.acceptedAt === null
      ? acceptMs
      : Date.parse(toEngagementTimestamp(input.acceptedAt, 'acceptedAt'));
  const startBy = shiftMs(acceptedMs, windows.startMs);
  const activatedMs =
    input.activatedAt === undefined || input.activatedAt === null
      ? Date.parse(startBy)
      : Date.parse(toEngagementTimestamp(input.activatedAt, 'activatedAt'));
  const policySubmitBy = shiftMs(activatedMs, windows.submitMs);
  const submitByIsDeadlineCapped = Date.parse(policySubmitBy) > deadlineMs;
  const submitBy = submitByIsDeadlineCapped
    ? toEngagementTimestamp(input.requestDeadline, 'requestDeadline')
    : policySubmitBy;
  return deepFreeze({
    acceptBy: toEngagementTimestamp(acceptBy, 'acceptBy'),
    startBy,
    submitBy,
    submitByIsDeadlineCapped,
  });
}

// ---------------------------------------------------------------------------
// Clock evaluation (states with machine-readable reasons)
// ---------------------------------------------------------------------------

/** The closed SLA clock-state vocabulary (measurements, not penalties). */
export const SLA_CLOCK_STATES = Object.freeze([
  'satisfied',
  'on-track',
  'at-risk',
  'breached',
] as const);
export type SlaClockState = (typeof SLA_CLOCK_STATES)[number];

export function isSlaClockState(value: unknown): value is SlaClockState {
  return (
    typeof value === 'string' && (SLA_CLOCK_STATES as readonly string[]).includes(value)
  );
}

/** The at-risk threshold: the last quarter of the window (derived default). */
export const DEFAULT_AT_RISK_FRACTION = 0.25 as const;

/** The closed reason vocabulary for one clock's state. */
export const SLA_CLOCK_REASONS = Object.freeze([
  'clock-satisfied-before-due',
  'clock-on-track',
  'clock-at-risk-remaining-quarter',
  'clock-breached-deadline-passed',
  'clock-awaiting-milestone',
] as const);
export type SlaClockReason = (typeof SLA_CLOCK_REASONS)[number];

/** The typed evaluation of ONE SLA clock at a projection time. */
export interface SlaClockEvaluation {
  readonly clock: SlaClockKind;
  readonly state: SlaClockState;
  readonly reasons: readonly SlaClockReason[];
  readonly dueAt: EngagementTimestamp;
  /** The milestone time when it already happened (null otherwise). */
  readonly milestoneAt: EngagementTimestamp | null;
  readonly remainingMs: number | null;
}

function evaluateOneClock(
  clock: SlaClockKind,
  dueAt: string,
  windowMs: number,
  at: string,
  milestoneAt: string | null,
): SlaClockEvaluation {
  const due = toEngagementTimestamp(dueAt, `${clock}Clock.dueAt`);
  const milestone =
    milestoneAt === null ? null : toEngagementTimestamp(milestoneAt, `${clock}Clock.milestoneAt`);
  const dueMs = Date.parse(due);
  const atMs = Date.parse(toEngagementTimestamp(at, 'at'));
  if (milestone !== null) {
    if (Date.parse(milestone) <= dueMs) {
      return deepFreeze({
        clock,
        state: 'satisfied',
        reasons: Object.freeze(['clock-satisfied-before-due'] as const),
        dueAt: due,
        milestoneAt: milestone,
        remainingMs: null,
      });
    }
    // The milestone happened LATE — the breach is recorded below.
  }
  const remainingMs = dueMs - atMs;
  if (remainingMs < 0) {
    return deepFreeze({
      clock,
      state: 'breached',
      reasons: Object.freeze(['clock-breached-deadline-passed'] as const),
      dueAt: due,
      milestoneAt: milestone,
      remainingMs,
    });
  }
  if (remainingMs <= Math.floor(windowMs * DEFAULT_AT_RISK_FRACTION)) {
    return deepFreeze({
      clock,
      state: 'at-risk',
      reasons: Object.freeze(['clock-at-risk-remaining-quarter'] as const),
      dueAt: due,
      milestoneAt: milestone,
      remainingMs,
    });
  }
  return deepFreeze({
    clock,
    state: 'on-track',
    reasons: Object.freeze(['clock-on-track'] as const),
    dueAt: due,
    milestoneAt: milestone,
    remainingMs,
  });
}

export interface EvaluateSlaClocksInput {
  readonly clocks: SlaClocks;
  readonly urgency: string;
  /** Caller-injected projection time (no hidden clock). */
  readonly at: string;
  /** Recorded milestone times (null when the milestone has not happened). */
  readonly acceptedAt?: string | null;
  readonly activatedAt?: string | null;
  readonly completedAt?: string | null;
}

/** The evaluation of all three clocks + the derived breach records. */
export interface SlaEvaluation {
  readonly acceptClock: SlaClockEvaluation;
  readonly startClock: SlaClockEvaluation;
  readonly submitClock: SlaClockEvaluation;
  /** The deterministic breach records for every breached clock (append-only events). */
  readonly breaches: readonly SlaBreachRecord[];
}

/**
 * Evaluate the three SLA clocks at a projection time. PURE — the same
 * (clocks, milestones, at) always yields the same evaluation; breaches
 * are DERIVED as explicit typed records here (the service appends them
 * once per breached clock under its idempotency discipline).
 */
export function evaluateSlaClocks(
  input: EvaluateSlaClocksInput,
  policy: SlaPolicy = DEFAULT_SLA_POLICY,
): SlaEvaluation {
  const urgency = toSlaUrgencyClass(input.urgency, 'urgency');
  const windows = policy.windowsByUrgency[urgency];
  // Window arithmetic for the at-risk threshold: each clock's effective
  // window is its policy window (acceptMs / startMs / the effective
  // submit span), so at-risk means "the last quarter of that window".
  const acceptWindow = Math.max(1, windows.acceptMs);
  const startWindow = Math.max(1, windows.startMs);
  const submitWindow = Math.max(
    1,
    Date.parse(input.clocks.submitBy) - Date.parse(input.clocks.startBy),
  );
  const acceptClock = evaluateOneClock(
    'accept',
    input.clocks.acceptBy,
    acceptWindow,
    input.at,
    input.acceptedAt ?? null,
  );
  const startClock = evaluateOneClock(
    'start',
    input.clocks.startBy,
    startWindow,
    input.at,
    input.activatedAt ?? null,
  );
  const submitClock = evaluateOneClock(
    'submit',
    input.clocks.submitBy,
    submitWindow,
    input.at,
    input.completedAt ?? null,
  );
  const breaches: SlaBreachRecord[] = [];
  for (const clock of [acceptClock, startClock, submitClock] as const) {
    if (clock.state !== 'breached') continue;
    breaches.push(
      newSlaBreachRecord({
        breachId: '', // assigned by the caller (idempotent, addressable)
        tenant: '',
        engagementId: '',
        engagementRef: '',
        clock: clock.clock,
        dueAt: clock.dueAt,
        observedAt: input.at,
        reason: slaBreachReasonFor(clock.clock),
      }),
    );
  }
  return deepFreeze({
    acceptClock,
    startClock,
    submitClock,
    breaches: Object.freeze([...breaches]),
  });
}

// ---------------------------------------------------------------------------
// Breach records (explicit append-only events with reasons)
// ---------------------------------------------------------------------------

/** The closed breach-reason vocabulary (machine-readable, never free text). */
export const SLA_BREACH_REASONS = Object.freeze([
  'accept-deadline-passed-unaccepted',
  'start-deadline-passed-unstarted',
  'submit-deadline-passed-unsubmitted',
] as const);
export type SlaBreachReason = (typeof SLA_BREACH_REASONS)[number];

export function isSlaBreachReason(value: unknown): value is SlaBreachReason {
  return (
    typeof value === 'string' &&
    (SLA_BREACH_REASONS as readonly string[]).includes(value)
  );
}

/** The reason for one breached clock kind. */
export function slaBreachReasonFor(clock: SlaClockKind): SlaBreachReason {
  if (clock === 'accept') return 'accept-deadline-passed-unaccepted';
  if (clock === 'start') return 'start-deadline-passed-unstarted';
  return 'submit-deadline-passed-unsubmitted';
}

/** Digest-free view of one SLA breach record. */
export interface SlaBreachRecordView {
  readonly recordVersion: typeof SLA_BREACH_RECORD_VERSION;
  readonly breachId: string;
  readonly tenant: string;
  readonly engagementId: string;
  /** The digest of the engagement record the breach was observed on. */
  readonly engagementRef: string;
  readonly clock: SlaClockKind;
  readonly dueAt: EngagementTimestamp;
  /** When the breach was observed (the evaluation's projection time). */
  readonly observedAt: EngagementTimestamp;
  readonly reason: SlaBreachReason;
}

/** A frozen, content-addressed SLA breach record: view + digest. */
export interface SlaBreachRecord extends SlaBreachRecordView {
  readonly digest: EngagementContentDigest;
}

export interface CreateSlaBreachRecordInput {
  readonly breachId: string;
  readonly tenant: string;
  readonly engagementId: string;
  readonly engagementRef: string;
  readonly clock: string;
  readonly dueAt: string;
  readonly observedAt: string;
  readonly reason: string;
}

export function isSlaBreachRecord(value: unknown): value is SlaBreachRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== SLA_BREACH_RECORD_VERSION) return false;
  if (typeof candidate['breachId'] !== 'string') return false;
  if (typeof candidate['tenant'] !== 'string') return false;
  if (typeof candidate['engagementId'] !== 'string') return false;
  if (!isEngagementContentDigest(candidate['engagementRef'])) return false;
  if (!isSlaClockKind(candidate['clock'])) return false;
  if (!isEngagementTimestamp(candidate['dueAt'])) return false;
  if (!isEngagementTimestamp(candidate['observedAt'])) return false;
  if (!isSlaBreachReason(candidate['reason'])) return false;
  return isEngagementContentDigest(candidate['digest']);
}

/**
 * Construct + validate + digest + freeze one breach record. APPEND-ONLY:
 * there is no update or delete path; a re-observation is a NEW record
 * (the service dedups by breachId under its idempotency discipline).
 */
export async function createSlaBreachRecord(
  input: CreateSlaBreachRecordInput,
): Promise<SlaBreachRecord> {
  if (!isSlaClockKind(input.clock)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: `SLA breach clock must be one of ${SLA_CLOCK_KINDS.join('|')}, got: ${JSON.stringify(input.clock)}`,
    });
  }
  if (!isSlaBreachReason(input.reason)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: `SLA breach reason must be one of ${SLA_BREACH_REASONS.join('|')}, got: ${JSON.stringify(input.reason)}`,
    });
  }
  const view: SlaBreachRecordView = {
    recordVersion: SLA_BREACH_RECORD_VERSION,
    breachId: toSlaRecordId(input.breachId, 'breachId'),
    tenant: requireTenant(input.tenant),
    engagementId: toEngagementId(input.engagementId, 'engagementId'),
    engagementRef: toEngagementContentDigest(input.engagementRef, 'engagementRef'),
    clock: input.clock,
    dueAt: toEngagementTimestamp(input.dueAt, 'dueAt'),
    observedAt: toEngagementTimestamp(input.observedAt, 'observedAt'),
    reason: input.reason,
  };
  if (Date.parse(view.observedAt) < Date.parse(view.dueAt)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'a breach record can only be observed at or after its due time (never a pre-breach record)',
      details: { dueAt: view.dueAt, observedAt: view.observedAt },
    });
  }
  const digest = (await digestCanonical(view)) as EngagementContentDigest;
  return deepFreeze({ ...view, digest });
}

/** Internal: build an UNDIGESTED placeholder for derived breach sets. */
function newSlaBreachRecord(input: CreateSlaBreachRecordInput): SlaBreachRecord {
  // The derived evaluation path builds placeholder records without ids;
  // the SERVICE re-constructs each one through createSlaBreachRecord
  // before appending (ids are minted under the idempotency discipline).
  if (!isSlaClockKind(input.clock)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: `SLA breach clock must be one of ${SLA_CLOCK_KINDS.join('|')}`,
    });
  }
  if (!isSlaBreachReason(input.reason)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: `SLA breach reason must be one of ${SLA_BREACH_REASONS.join('|')}`,
    });
  }
  return {
    recordVersion: SLA_BREACH_RECORD_VERSION,
    breachId: input.breachId,
    tenant: input.tenant,
    engagementId: input.engagementId,
    engagementRef: input.engagementRef,
    clock: input.clock,
    dueAt: toEngagementTimestamp(input.dueAt, 'dueAt'),
    observedAt: toEngagementTimestamp(input.observedAt, 'observedAt'),
    reason: input.reason,
    digest: '0'.repeat(64) as EngagementContentDigest,
  };
}

function requireTenant(value: string): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{1,62}$/.test(value)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `tenant requires a scope matching ^[a-z][a-z0-9-]{1,62}$: ${JSON.stringify(value)}`,
    });
  }
  return value;
}

/** Tamper detection — recompute the breach-record digest (TAMPERED). */
export async function verifySlaBreachRecordDigest(
  record: SlaBreachRecord,
): Promise<EngagementContentDigest> {
  const { digest: _digest, ...view } = record;
  const recomputed = (await digestCanonical(view)) as EngagementContentDigest;
  if (recomputed !== record.digest) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.TAMPERED, {
      message: 'SLA breach record digest mismatch — the committed record was mutated',
      details: { breachId: record.breachId },
    });
  }
  return recomputed;
}

/** The C021 observability read view over breach records (typed projection). */
export interface SlaBreachSummary {
  readonly tenant: string;
  readonly engagementId: string;
  readonly totalBreaches: number;
  readonly breachedClocks: readonly SlaClockKind[];
  readonly reasons: readonly SlaBreachReason[];
}

/** Fold breach records into the C021-facing summary (deterministic order). */
export function toSlaBreachSummary(
  records: readonly SlaBreachRecord[],
): SlaBreachSummary | null {
  if (records.length === 0) return null;
  const first = records[0];
  if (first === undefined) return null;
  const clocks: SlaClockKind[] = [];
  const reasons: SlaBreachReason[] = [];
  for (const record of records) {
    if (record.tenant !== first.tenant || record.engagementId !== first.engagementId) {
      throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
        message: 'a breach summary folds records of exactly ONE engagement',
      });
    }
    if (!clocks.includes(record.clock)) clocks.push(record.clock);
    if (!reasons.includes(record.reason)) reasons.push(record.reason);
  }
  return deepFreeze({
    tenant: first.tenant,
    engagementId: first.engagementId,
    totalBreaches: toNonNegativeInteger(records.length, 'totalBreaches'),
    breachedClocks: Object.freeze([...clocks]),
    reasons: Object.freeze([...reasons]),
  });
}

/** Convenience: derive clocks directly off an engagement record view. */
export function clocksForEngagement(
  engagement: {
    readonly urgency: string;
    readonly requestDeadline: string;
    readonly offeredAt: string;
    readonly acceptedAt?: string;
    readonly activatedAt?: string;
  },
  policy: SlaPolicy = DEFAULT_SLA_POLICY,
): SlaClocks {
  return deriveSlaClocks(
    {
      urgency: engagement.urgency,
      requestDeadline: engagement.requestDeadline,
      offerIssuedAt: engagement.offeredAt,
      acceptedAt: engagement.acceptedAt ?? null,
      activatedAt: engagement.activatedAt ?? null,
    },
    policy,
  );
}
