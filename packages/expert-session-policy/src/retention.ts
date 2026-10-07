/**
 * Retention engine (Work Order C018; spec/security.md S1.0 "Data rights"
 * retention + the revocation law: "Revocation or expiry produces a status
 * transition; historical records remain auditable").
 *
 *   - RetentionSchedule — one entry per EES session artifact class
 *     (session transcript / observation stream / artifacts / annotations);
 *     every class is REQUIRED (an ungoverned artifact class is never
 *     allowed — fail closed);
 *   - disposition state machine — RETAIN → ANONYMIZE → DELETE_PENDING →
 *     DELETED with a CLOSED transition graph and typed reasons;
 *   - expert-withdrawal and customer-erasure are EXPLICIT state-machine
 *     requests (never silent drops); deletion is DOUBLE-SPEND SAFE (a
 *     second erasure request yields the typed duplicate outcome with no
 *     second effect);
 *   - the subject's append-only history is RETAINED after deletion (the
 *     audit history outlives the data — security.md revocation law).
 */

import { ExpertSessionPolicyError } from './errors.js';
import { deepFreeze, expectPolicyId, expectPolicyTimestamp, expectTenantId } from './shared.js';

/** Wire version of the retention schedule shape. */
export const RETENTION_SCHEDULE_VERSION = 1 as const;

/** The four EES session artifact classes (closed vocabulary). */
export const RETENTION_ARTIFACT_CLASSES = Object.freeze([
  'session-transcript',
  'observation-stream',
  'artifacts',
  'annotations',
] as const);
export type RetentionArtifactClass = (typeof RETENTION_ARTIFACT_CLASSES)[number];

export function isRetentionArtifactClass(value: unknown): value is RetentionArtifactClass {
  return (
    typeof value === 'string' && (RETENTION_ARTIFACT_CLASSES as readonly string[]).includes(value)
  );
}

/** The terminal disposition an expiry executes (closed vocabulary). */
export const RETENTION_DISPOSITIONS = Object.freeze(['ANONYMIZE', 'DELETE'] as const);
export type RetentionDisposition = (typeof RETENTION_DISPOSITIONS)[number];

/** The closed disposition state vocabulary. */
export const DISPOSITION_STATES = Object.freeze(['RETAIN', 'ANONYMIZE', 'DELETE_PENDING', 'DELETED'] as const);
export type DispositionState = (typeof DISPOSITION_STATES)[number];

/** The closed disposition transition graph (from → allowed targets). */
function frozenTargets(targets: readonly DispositionState[]): readonly DispositionState[] {
  return Object.freeze([...targets]);
}

export const DISPOSITION_TRANSITIONS: Readonly<Record<DispositionState, readonly DispositionState[]>> =
  Object.freeze({
    RETAIN: frozenTargets(['ANONYMIZE', 'DELETE_PENDING']),
    ANONYMIZE: frozenTargets(['DELETE_PENDING']),
    DELETE_PENDING: frozenTargets(['DELETED']),
    DELETED: frozenTargets([]),
  });

/** The closed transition-reason vocabulary. */
export const DISPOSITION_TRANSITION_REASONS = Object.freeze([
  'retention-expiry',
  'expert-withdrawal',
  'customer-erasure',
  'disposition-executed',
] as const);
export type DispositionTransitionReason = (typeof DISPOSITION_TRANSITION_REASONS)[number];

const DAY_MS = 86_400_000;

/** One schedule entry: days of retention + the terminal disposition. */
export interface RetentionScheduleEntry {
  readonly artifactClass: RetentionArtifactClass;
  /** Integer 0..36500 days from recordedAt. */
  readonly retentionDays: number;
  readonly disposition: RetentionDisposition;
}

/** Per-artifact-class retention schedule (exactly one entry per class). */
export interface RetentionSchedule {
  readonly scheduleVersion: typeof RETENTION_SCHEDULE_VERSION;
  readonly entries: readonly RetentionScheduleEntry[];
}

export interface CreateRetentionScheduleInput {
  readonly entries: readonly {
    artifactClass: string;
    retentionDays: number;
    disposition: string;
  }[];
}

/** Build + validate a retention schedule (all four classes, closed). */
export function toRetentionSchedule(input: CreateRetentionScheduleInput): RetentionSchedule {
  if (typeof input !== 'object' || input === null || !Array.isArray(input.entries)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
      message: 'retention schedule requires an entries array',
    });
  }
  const byClass = new Map<RetentionArtifactClass, RetentionScheduleEntry>();
  for (const entry of input.entries) {
    if (!isRetentionArtifactClass(entry.artifactClass)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
        message: `unknown retention artifact class: ${JSON.stringify(entry.artifactClass)}`,
        details: { approved: RETENTION_ARTIFACT_CLASSES },
      });
    }
    const artifactClass = entry.artifactClass;
    if (byClass.has(artifactClass)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
        message: `duplicate retention schedule entry for artifact class '${artifactClass}'`,
      });
    }
    if (!Number.isInteger(entry.retentionDays) || entry.retentionDays < 0 || entry.retentionDays > 36500) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
        message: `retentionDays for '${artifactClass}' must be an integer 0..36500`,
        details: { received: String(entry.retentionDays) },
      });
    }
    if (!(RETENTION_DISPOSITIONS as readonly string[]).includes(entry.disposition)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
        message: `unknown retention disposition for '${artifactClass}': ${JSON.stringify(entry.disposition)}`,
        details: { approved: RETENTION_DISPOSITIONS },
      });
    }
    byClass.set(artifactClass, {
      artifactClass,
      retentionDays: entry.retentionDays,
      disposition: entry.disposition as RetentionDisposition,
    });
  }
  for (const artifactClass of RETENTION_ARTIFACT_CLASSES) {
    if (!byClass.has(artifactClass)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
        message: `retention schedule is missing the REQUIRED '${artifactClass}' entry (every artifact class is governed — fail closed)`,
        details: { required: RETENTION_ARTIFACT_CLASSES },
      });
    }
  }
  return deepFreeze({
    scheduleVersion: RETENTION_SCHEDULE_VERSION,
    entries: Object.freeze([...RETENTION_ARTIFACT_CLASSES].map((artifactClass) => byClass.get(artifactClass) as RetentionScheduleEntry)),
  });
}

// ---------------------------------------------------------------------------
// Retention subjects (the per-artifact disposition state machine)
// ---------------------------------------------------------------------------

/** Wire version of the retention subject shape. */
export const RETENTION_SUBJECT_VERSION = 1 as const;

/** One append-only disposition transition (the auditable history). */
export interface DispositionTransition {
  readonly from: DispositionState;
  readonly to: DispositionState;
  readonly occurredAt: string;
  readonly reason: DispositionTransitionReason;
  readonly requestId: string | null;
}

/**
 * A retention subject: ONE artifact class of ONE escalation under the
 * disposition state machine. `history` is append-only and RETAINED after
 * DELETED (records stay auditable); `erasureRequestIds` dedups customer
 * erasure requests (deletion double-spend safety).
 */
export interface RetentionSubject {
  readonly subjectVersion: typeof RETENTION_SUBJECT_VERSION;
  readonly subjectId: string;
  readonly tenantId: string;
  readonly requestId: string | null;
  readonly artifactClass: RetentionArtifactClass;
  readonly state: DispositionState;
  readonly recordedAt: string;
  readonly expiresAt: string;
  readonly targetDisposition: RetentionDisposition;
  readonly history: readonly DispositionTransition[];
  readonly erasureRequestIds: readonly string[];
}

export interface CreateRetentionSubjectInput {
  readonly subjectId: string;
  readonly tenantId: string;
  readonly requestId: string | null;
  readonly artifactClass: RetentionArtifactClass;
  readonly entry: RetentionScheduleEntry;
  readonly now: number | string | Date;
}

/** Build a fresh RETAIN subject from a schedule entry. */
export function createRetentionSubject(input: CreateRetentionSubjectInput): RetentionSubject {
  const subjectId = expectPolicyId(input.subjectId, 'RetentionSubject.subjectId');
  const tenantId = expectTenantId(input.tenantId, 'RetentionSubject.tenantId');
  if (!isRetentionArtifactClass(input.artifactClass)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_SCHEDULE', {
      message: `unknown retention artifact class: ${JSON.stringify(input.artifactClass)}`,
    });
  }
  const recordedAt = expectPolicyTimestamp(
    input.now instanceof Date ? input.now.toISOString() : typeof input.now === 'number' ? new Date(input.now).toISOString() : input.now,
    'RetentionSubject.recordedAt',
  );
  const expiresAt = new Date(Date.parse(recordedAt) + input.entry.retentionDays * DAY_MS).toISOString();
  return deepFreeze({
    subjectVersion: RETENTION_SUBJECT_VERSION,
    subjectId,
    tenantId,
    requestId: input.requestId,
    artifactClass: input.artifactClass,
    state: 'RETAIN',
    recordedAt,
    expiresAt,
    targetDisposition: input.entry.disposition,
    history: Object.freeze([]),
    erasureRequestIds: Object.freeze([]),
  });
}

/** Retention expiry verdict (typed, never boolean). */
export const RETENTION_EXPIRY_OUTCOMES = Object.freeze(['within-window', 'disposition-due'] as const);
export type RetentionExpiryOutcome = (typeof RETENTION_EXPIRY_OUTCOMES)[number];

export interface RetentionExpiryVerdict {
  readonly outcome: RetentionExpiryOutcome;
  readonly subjectId: string;
  readonly state: DispositionState;
  readonly targetDisposition: RetentionDisposition;
}

/** Is the subject's disposition due as of `asOf`? (pure, injected clock) */
export function evaluateRetentionExpiry(subject: RetentionSubject, asOf: string): RetentionExpiryVerdict {
  if (subject.state !== 'RETAIN') {
    return deepFreeze({
      outcome: 'within-window',
      subjectId: subject.subjectId,
      state: subject.state,
      targetDisposition: subject.targetDisposition,
    });
  }
  const due = Date.parse(asOf) >= Date.parse(subject.expiresAt);
  return deepFreeze({
    outcome: due ? 'disposition-due' : 'within-window',
    subjectId: subject.subjectId,
    state: subject.state,
    targetDisposition: subject.targetDisposition,
  });
}

export interface ApplyDispositionInput {
  readonly to: DispositionState;
  readonly reason: DispositionTransitionReason;
  readonly requestId?: string | null;
  readonly now: number | string | Date;
}

/**
 * Apply ONE disposition transition along the CLOSED graph. Illegal
 * transitions (including anything out of terminal DELETED) throw the
 * typed INVALID_TRANSITION failure; the returned subject carries the
 * appended history entry (audit history retained after deletion).
 */
export function applyDispositionTransition(subject: RetentionSubject, input: ApplyDispositionInput): RetentionSubject {
  if (!(DISPOSITION_STATES as readonly string[]).includes(input.to)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `unknown disposition state: ${JSON.stringify(input.to)}`,
      details: { approved: DISPOSITION_STATES },
    });
  }
  const allowed = DISPOSITION_TRANSITIONS[subject.state];
  if (!allowed.includes(input.to)) {
    if (subject.state === 'DELETED') {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_TERMINAL_STATE', {
        message: `retention subject '${subject.subjectId}' is DELETED (terminal): disposition transitions are closed`,
        details: { subjectId: subject.subjectId, requested: input.to },
      });
    }
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_TRANSITION', {
      message: `illegal disposition transition '${subject.state}' → '${input.to}' (allowed: [${allowed.join(', ')}])`,
      details: { subjectId: subject.subjectId, from: subject.state, to: input.to, allowed: [...allowed] },
    });
  }
  const occurredAt = expectPolicyTimestamp(
    input.now instanceof Date ? input.now.toISOString() : typeof input.now === 'number' ? new Date(input.now).toISOString() : input.now,
    'DispositionTransition.occurredAt',
  );
  const transition = deepFreeze({
    from: subject.state,
    to: input.to,
    occurredAt,
    reason: input.reason,
    requestId: input.requestId ?? null,
  });
  const erasureRequestIds =
    input.reason === 'customer-erasure' && input.requestId !== undefined && input.requestId !== null
      ? Object.freeze([...new Set([...subject.erasureRequestIds, input.requestId])])
      : subject.erasureRequestIds;
  return deepFreeze({
    ...subject,
    state: input.to,
    history: Object.freeze([...subject.history, transition]),
    erasureRequestIds,
  });
}

// ---------------------------------------------------------------------------
// Explicit erasure / withdrawal state machines (never silent drops)
// ---------------------------------------------------------------------------

export const ERASURE_OUTCOMES = Object.freeze([
  'erasure-scheduled',
  'duplicate-erasure-request',
  'erasure-rejected',
] as const);
export type ErasureOutcome = (typeof ERASURE_OUTCOMES)[number];

export interface CustomerErasureVerdict {
  readonly outcome: ErasureOutcome;
  readonly subject: RetentionSubject;
  readonly message: string;
}

/**
 * Customer erasure request — an EXPLICIT state-machine step: RETAIN or
 * ANONYMIZE moves to DELETE_PENDING; a request against a subject already
 * DELETE_PENDING or DELETED is the typed DUPLICATE outcome with NO
 * second effect (deletion double-spend safety).
 */
export function requestCustomerErasure(
  subject: RetentionSubject,
  input: { requestId: string; now: number | string | Date },
): CustomerErasureVerdict {
  if (subject.state === 'DELETE_PENDING' || subject.state === 'DELETED') {
    const duplicate = subject.erasureRequestIds.includes(input.requestId);
    return deepFreeze({
      outcome: 'duplicate-erasure-request',
      subject,
      message: duplicate
        ? `erasure request '${input.requestId}' was already applied to subject '${subject.subjectId}' (state ${subject.state}) — no second effect`
        : `subject '${subject.subjectId}' is already ${subject.state} (from a prior erasure request) — this request is a typed duplicate with no second effect`,
    });
  }
  const next = applyDispositionTransition(subject, {
    to: 'DELETE_PENDING',
    reason: 'customer-erasure',
    requestId: input.requestId,
    now: input.now,
  });
  return deepFreeze({
    outcome: 'erasure-scheduled',
    subject: next,
    message: `customer erasure scheduled: subject '${subject.subjectId}' moved ${subject.state} → DELETE_PENDING`,
  });
}

export const WITHDRAWAL_OUTCOMES = Object.freeze([
  'withdrawal-applied',
  'withdrawal-rejected',
] as const);
export type WithdrawalOutcome = (typeof WITHDRAWAL_OUTCOMES)[number];

export interface ExpertWithdrawalVerdict {
  readonly outcome: WithdrawalOutcome;
  readonly subject: RetentionSubject;
  readonly message: string;
}

/**
 * Expert withdrawal request — the security.md expert-rights
 * withdrawal/deletion policy as an EXPLICIT state machine: the expert's
 * identifying contribution is anonymized (RETAIN → ANONYMIZE; an
 * already-anonymized subject is a no-op rejection carrying the reason).
 */
export function requestExpertWithdrawal(
  subject: RetentionSubject,
  input: { requestId: string; now: number | string | Date },
): ExpertWithdrawalVerdict {
  if (subject.state === 'ANONYMIZE') {
    return deepFreeze({
      outcome: 'withdrawal-rejected',
      subject,
      message: `subject '${subject.subjectId}' is already ANONYMIZE — the expert identity is already withdrawn`,
    });
  }
  if (subject.state === 'DELETE_PENDING' || subject.state === 'DELETED') {
    return deepFreeze({
      outcome: 'withdrawal-rejected',
      subject,
      message: `subject '${subject.subjectId}' is ${subject.state} — withdrawal cannot apply past the deletion boundary`,
    });
  }
  const next = applyDispositionTransition(subject, {
    to: 'ANONYMIZE',
    reason: 'expert-withdrawal',
    requestId: input.requestId,
    now: input.now,
  });
  return deepFreeze({
    outcome: 'withdrawal-applied',
    subject: next,
    message: `expert withdrawal applied: subject '${subject.subjectId}' moved RETAIN → ANONYMIZE`,
  });
}

/** Execute the terminal deletion (DELETE_PENDING → DELETED). */
export function executeDisposition(subject: RetentionSubject, now: number | string | Date): RetentionSubject {
  if (subject.state === 'DELETED') {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_DUPLICATE_DISPOSITION', {
      message: `retention subject '${subject.subjectId}' is already DELETED — executing disposition again is a typed duplicate with no second effect`,
      details: { subjectId: subject.subjectId },
    });
  }
  return applyDispositionTransition(subject, { to: 'DELETED', reason: 'disposition-executed', now });
}

/** The retention window (ms) of a schedule entry — the resolution bound. */
export function retentionWindowMs(entry: RetentionScheduleEntry): number {
  return entry.retentionDays * DAY_MS;
}
