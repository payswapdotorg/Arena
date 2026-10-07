/**
 * The competition lifecycle (Work Order C013; issue #119; spec/
 * adversarial-expert-evaluation.md AE1.0 "Competition model").
 *
 * The AE1.0 chain, as a TYPED state machine (never a convention):
 *
 *   OPEN -> SOLICITING -> SUBMITTED -> CHALLENGE -> RESPONSE -> VOTING
 *        -> ADJUDICATION -> VERIFIED_RESULT
 *
 * plus the two typed terminal failure states:
 *
 *   ABANDONED                    — cancelled-by-owner | task-withdrawn |
 *                                  challenge-window-expired
 *   INSUFFICIENT_PARTICIPATION   — too-few-solutions | too-few-qualified-voters
 *
 * Every transition appends to an append-only state history (lock rule 6);
 * terminal states accept NO outgoing transition (the bypass is
 * impossible by construction); every state entry carries its reason.
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';
import {
  deepFreeze,
  isEscalationTimestamp,
  rejectUnknownFields,
  requireBoundedString,
  toEscalationTimestamp,
} from './shared.js';
import type { CompetitionId } from './shared.js';

/** Wire version of the competition lifecycle shapes. */
export const COMPETITION_LIFECYCLE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The closed state vocabulary
// ---------------------------------------------------------------------------

export const COMPETITION_STATES = Object.freeze([
  'open',
  'soliciting',
  'submitted',
  'challenge',
  'response',
  'voting',
  'adjudication',
  'verified_result',
  'abandoned',
  'insufficient_participation',
] as const);
export type CompetitionState = (typeof COMPETITION_STATES)[number];

export function isCompetitionState(value: unknown): value is CompetitionState {
  return (
    typeof value === 'string' && (COMPETITION_STATES as readonly string[]).includes(value)
  );
}

/** The typed terminal states (no outgoing transition, ever). */
export const TERMINAL_COMPETITION_STATES: readonly CompetitionState[] = Object.freeze([
  'verified_result',
  'abandoned',
  'insufficient_participation',
]);

export function isTerminalCompetitionState(state: CompetitionState): boolean {
  return TERMINAL_COMPETITION_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Typed terminal reasons (closed vocabularies)
// ---------------------------------------------------------------------------

export const ABANDONMENT_REASONS = Object.freeze([
  'cancelled-by-owner',
  'task-withdrawn',
  'challenge-window-expired',
] as const);
export type AbandonmentReason = (typeof ABANDONMENT_REASONS)[number];

export const INSUFFICIENT_PARTICIPATION_REASONS = Object.freeze([
  'too-few-solutions',
  'too-few-qualified-voters',
] as const);
export type InsufficientParticipationReason = (typeof INSUFFICIENT_PARTICIPATION_REASONS)[number];

export type TerminalReason =
  | { readonly kind: 'abandoned'; readonly code: AbandonmentReason; readonly detail: string }
  | {
      readonly kind: 'insufficient-participation';
      readonly code: InsufficientParticipationReason;
      readonly detail: string;
    };

// ---------------------------------------------------------------------------
// The transition table (the ONLY legal edges — everything else fails closed)
// ---------------------------------------------------------------------------

export const COMPETITION_TRANSITIONS: Readonly<Record<CompetitionState, readonly CompetitionState[]>> =
  Object.freeze({
    open: Object.freeze<readonly CompetitionState[]>(['soliciting', 'abandoned']),
    soliciting: Object.freeze<readonly CompetitionState[]>([
      'submitted',
      'abandoned',
      'insufficient_participation',
    ]),
    submitted: Object.freeze<readonly CompetitionState[]>([
      'challenge',
      'adjudication',
      'abandoned',
      'insufficient_participation',
    ]),
    challenge: Object.freeze<readonly CompetitionState[]>([
      'response',
      'adjudication',
      'insufficient_participation',
    ]),
    response: Object.freeze<readonly CompetitionState[]>([
      'voting',
      'adjudication',
      'insufficient_participation',
    ]),
    voting: Object.freeze<readonly CompetitionState[]>([
      'adjudication',
      'insufficient_participation',
    ]),
    adjudication: Object.freeze<readonly CompetitionState[]>([
      'verified_result',
      'insufficient_participation',
    ]),
    verified_result: Object.freeze<readonly CompetitionState[]>([]),
    abandoned: Object.freeze<readonly CompetitionState[]>([]),
    insufficient_participation: Object.freeze<readonly CompetitionState[]>([]),
  });

/** Can `from` legally become `to`? (Pure lookup; the table is the law.) */
export function canTransition(from: CompetitionState, to: CompetitionState): boolean {
  return COMPETITION_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// The competition record
// ---------------------------------------------------------------------------

/** The task a competition is run over (AE1.0 step 1: the problem statement). */
export interface CompetitionTask {
  readonly taskId: string;
  readonly title: string;
  readonly statement: string;
  /** Skill refs the experts must be qualified in (qualification-aware guardrails). */
  readonly requiredSkills: readonly string[];
}

export interface CompetitionStateEntry {
  readonly state: CompetitionState;
  readonly enteredAt: string;
  readonly reason: string | null;
}

export interface CompetitionRecord {
  readonly competitionVersion: typeof COMPETITION_LIFECYCLE_VERSION;
  readonly competitionId: CompetitionId;
  readonly tenantId: string;
  readonly task: CompetitionTask;
  readonly state: CompetitionState;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Append-only state history (lock rule 6 — supersession, never mutation). */
  readonly stateHistory: readonly CompetitionStateEntry[];
  /** Present only on terminal failure states; null otherwise. */
  readonly terminalReason: TerminalReason | null;
}

export const COMPETITION_RECORD_FIELDS = Object.freeze([
  'competitionVersion',
  'competitionId',
  'tenantId',
  'task',
  'state',
  'createdAt',
  'updatedAt',
  'stateHistory',
  'terminalReason',
] as const);

export interface CreateCompetitionInput {
  readonly competitionId: string;
  readonly tenantId: string;
  readonly task: {
    readonly taskId: string;
    readonly title: string;
    readonly statement: string;
    readonly requiredSkills: readonly string[];
  };
  readonly now: number;
}

/**
 * Create a competition in OPEN (strict, fail-closed): unknown fields are
 * rejected, the task must carry a non-empty statement and at least one
 * required skill, and the clock is INJECTED.
 */
export function createCompetition(input: CreateCompetitionInput): CompetitionRecord {
  if (typeof input !== 'object' || input === null) {
    throw new AdversarialEvaluationError(
      ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION,
      { message: 'competition input must be an object' },
    );
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    ['competitionId', 'tenantId', 'task', 'now'],
    'CreateCompetitionInput',
  );
  requireBoundedString(input.competitionId, 'competitionId');
  requireBoundedString(input.tenantId, 'tenantId');
  requireBoundedString(input.task.taskId, 'task.taskId');
  requireBoundedString(input.task.title, 'task.title');
  requireBoundedString(input.task.statement, 'task.statement');
  if (!Array.isArray(input.task.requiredSkills) || input.task.requiredSkills.length === 0) {
    throw new AdversarialEvaluationError(
      ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION,
      {
        message: 'a competition task REQUIRES at least one required skill (qualification-aware guardrails depend on it)',
      },
    );
  }
  for (const skill of input.task.requiredSkills) {
    requireBoundedString(skill, 'task.requiredSkills entry');
  }
  if (typeof input.now !== 'number' || !Number.isFinite(input.now) || input.now < 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION, {
      message: 'now must be injected epoch milliseconds (never a wall-clock read)',
    });
  }
  const at = toEscalationTimestamp(input.now);
  const entry: CompetitionStateEntry = deepFreeze({
    state: 'open',
    enteredAt: at,
    reason: null,
  });
  return deepFreeze({
    competitionVersion: COMPETITION_LIFECYCLE_VERSION,
    competitionId: input.competitionId as CompetitionId,
    tenantId: input.tenantId,
    task: deepFreeze({
      taskId: input.task.taskId,
      title: input.task.title,
      statement: input.task.statement,
      requiredSkills: Object.freeze([...input.task.requiredSkills]),
    }),
    state: 'open',
    createdAt: at,
    updatedAt: at,
    stateHistory: Object.freeze([entry]),
    terminalReason: null,
  });
}

export interface TransitionCompetitionInput {
  readonly target: CompetitionState;
  readonly reason: string | null;
  /** REQUIRED for terminal failure states (typed, machine-readable). */
  readonly terminalReason?: TerminalReason;
  readonly now: number;
}

/**
 * Transition a competition along ONE legal edge (append-only: returns a
 * NEW frozen record; the source record is never mutated). Illegal edges,
 * terminal-state escapes and missing terminal reasons fail CLOSED.
 */
export function transitionCompetition(
  record: CompetitionRecord,
  input: TransitionCompetitionInput,
): CompetitionRecord {
  const target = input.target;
  if (!isCompetitionState(target)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
      message: `unknown competition state: ${JSON.stringify(target)}`,
      details: { vocabulary: COMPETITION_STATES },
    });
  }
  if (isTerminalCompetitionState(record.state)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
      message: `competition ${record.competitionId} is TERMINAL (${record.state}) — terminal states accept no outgoing transition`,
      details: { state: record.state },
    });
  }
  if (!canTransition(record.state, target)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
      message: `illegal competition transition ${record.state} -> ${target}`,
      details: { from: record.state, to: target, legal: COMPETITION_TRANSITIONS[record.state] },
    });
  }
  const isTerminalFailure = target === 'abandoned' || target === 'insufficient_participation';
  if (isTerminalFailure && input.terminalReason === undefined) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
      message: `terminal failure state ${target} REQUIRES a typed terminal reason`,
      details: { state: target },
    });
  }
  if (!isTerminalFailure && input.terminalReason !== undefined) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
      message: `non-failure state ${target} must NOT carry a terminal reason`,
      details: { state: target },
    });
  }
  if (isTerminalFailure) {
    const reason = input.terminalReason as TerminalReason;
    const expectedKind =
      target === 'abandoned' ? 'abandoned' : 'insufficient-participation';
    if (reason.kind !== expectedKind) {
      throw new AdversarialEvaluationError(
        ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION,
        {
          message: `terminal reason kind ${JSON.stringify(reason.kind)} does not match terminal state ${target}`,
          details: { state: target, expectedKind },
        },
      );
    }
    requireBoundedString(reason.detail, 'terminalReason.detail');
  }
  if (typeof input.now !== 'number' || !Number.isFinite(input.now) || input.now < 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
      message: 'now must be injected epoch milliseconds (never a wall-clock read)',
    });
  }
  const at = toEscalationTimestamp(input.now);
  if (!isEscalationTimestamp(record.updatedAt) || at < record.updatedAt) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
      message: 'transition timestamps must be monotonically non-decreasing',
      details: { previous: record.updatedAt, attempted: at },
    });
  }
  const entry: CompetitionStateEntry = deepFreeze({
    state: target,
    enteredAt: at,
    reason: input.reason === null ? null : requireBoundedString(input.reason, 'reason'),
  });
  return deepFreeze({
    ...record,
    state: target,
    updatedAt: at,
    stateHistory: Object.freeze([...record.stateHistory, entry]),
    terminalReason: isTerminalFailure ? deepFreeze(input.terminalReason as TerminalReason) : null,
  });
}

/** Structural guard for wire values claiming to be competition records. */
export function isCompetitionRecord(value: unknown): value is CompetitionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['competitionVersion'] === COMPETITION_LIFECYCLE_VERSION &&
    typeof candidate['competitionId'] === 'string' &&
    isCompetitionState(candidate['state']) &&
    typeof candidate['tenantId'] === 'string' &&
    Array.isArray(candidate['stateHistory']) &&
    candidate['stateHistory'].length > 0
  );
}
