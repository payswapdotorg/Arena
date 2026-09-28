/**
 * Run lifecycle state machine (Work Order A010 gate 3; spec/environment.md
 * ENV1.0 lifecycle; architecture-lock rule 8 — environment execution is
 * isolated and bounded).
 *
 * The closed lifecycle is:
 *
 *   requested → provisioning → ready → running → (checkpointing → running)*
 *            → completed | failed | timed-out → cleaned
 *
 * `transitionRunState` is a PURE transition function over (state,
 * lifecycle-event) pairs backed by a frozen transition table:
 *   - every legal pair is enumerated (positive tests walk every edge);
 *   - every illegal pair — running → provisioning, completed → running,
 *     cleaned → anything, … — throws a typed EnvironmentRuntimeError
 *     (ILLEGAL_TRANSITION) carrying the OFFENDING from/to states plus
 *     the attempted lifecycle event (negative tests enumerate every
 *     illegal pair class exhaustively);
 *   - terminal states are FINAL except for the single cleanup edge to
 *     `cleaned`, and `cleaned` itself is terminal (nothing follows).
 *
 * Time-limit enforcement (rule 8 boundedness) is the pure `enforceTimeLimit`
 * helper: a run whose elapsed budget is exhausted in a time-bearing state
 * transitions to `timed-out` (gate 3 test); callers compare pure elapsed
 * data against the declared wall clock — this module never reads a wall
 * clock (lock rule 17: the engine never sleeps).
 */

import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import { expectEnumMember, expectPositiveInteger } from './shared.js';

// ---------------------------------------------------------------------------
// Closed vocabulary
// ---------------------------------------------------------------------------

export const RUN_STATES = Object.freeze([
  'requested',
  'provisioning',
  'ready',
  'running',
  'checkpointing',
  'completed',
  'failed',
  'timed-out',
  'cleaned',
] as const);
export type RunState = (typeof RUN_STATES)[number];

/** Outcome states — a run ends in exactly one of these before cleanup. */
export const RUN_OUTCOME_STATES = Object.freeze(['completed', 'failed', 'timed-out'] as const);
export type RunOutcomeState = (typeof RUN_OUTCOME_STATES)[number];

/** `cleaned` is absorbing: nothing may follow it. */
export const RUN_FINAL_STATES = Object.freeze(['cleaned'] as const);
export type RunFinalState = (typeof RUN_FINAL_STATES)[number];

/**
 * The closed set of lifecycle EVENTS driving transitions (distinct from
 * states: an event names WHY the state changed).
 */
export const RUN_LIFECYCLE_EVENTS = Object.freeze([
  'provision-started',
  'provisioned',
  'started',
  'checkpoint-started',
  'checkpoint-completed',
  'completed',
  'failed',
  'timed-out',
  'cleaned',
] as const);
export type RunLifecycleEvent = (typeof RUN_LIFECYCLE_EVENTS)[number];

export function isRunState(value: unknown): value is RunState {
  return typeof value === 'string' && (RUN_STATES as readonly string[]).includes(value);
}

export function isRunLifecycleEvent(value: unknown): value is RunLifecycleEvent {
  return (
    typeof value === 'string' && (RUN_LIFECYCLE_EVENTS as readonly string[]).includes(value)
  );
}

export function isRunOutcomeState(value: unknown): value is RunOutcomeState {
  return (
    typeof value === 'string' && (RUN_OUTCOME_STATES as readonly string[]).includes(value)
  );
}

export function isFinalRunState(value: unknown): value is RunFinalState {
  return typeof value === 'string' && (RUN_FINAL_STATES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Transition table (frozen; the single source of truth)
// ---------------------------------------------------------------------------

/** One legal edge: event → target state, from any state in `from`. */
export interface RunTransitionEdge {
  readonly event: RunLifecycleEvent;
  readonly from: readonly RunState[];
  readonly to: RunState;
}

function fromStates(...states: readonly RunState[]): readonly RunState[] {
  return Object.freeze([...states]);
}

export const RUN_TRANSITIONS: readonly RunTransitionEdge[] = Object.freeze([
  Object.freeze({ event: 'provision-started' as const, from: fromStates('requested'), to: 'provisioning' as const }),
  Object.freeze({ event: 'provisioned' as const, from: fromStates('provisioning'), to: 'ready' as const }),
  Object.freeze({ event: 'started' as const, from: fromStates('ready'), to: 'running' as const }),
  Object.freeze({ event: 'checkpoint-started' as const, from: fromStates('running'), to: 'checkpointing' as const }),
  Object.freeze({ event: 'checkpoint-completed' as const, from: fromStates('checkpointing'), to: 'running' as const }),
  Object.freeze({
    event: 'failed' as const,
    from: fromStates('requested', 'provisioning', 'ready', 'running', 'checkpointing'),
    to: 'failed' as const,
  }),
  Object.freeze({
    event: 'timed-out' as const,
    from: fromStates('provisioning', 'running', 'checkpointing'),
    to: 'timed-out' as const,
  }),
  Object.freeze({ event: 'completed' as const, from: fromStates('running'), to: 'completed' as const }),
  Object.freeze({
    event: 'cleaned' as const,
    from: fromStates('completed', 'failed', 'timed-out'),
    to: 'cleaned' as const,
  }),
] as const);

/** Target state for a legal (from, event) pair, or undefined when illegal. */
export function targetRunState(from: RunState, event: RunLifecycleEvent): RunState | undefined {
  for (const edge of RUN_TRANSITIONS) {
    if (edge.event === event && edge.from.includes(from)) return edge.to;
  }
  return undefined;
}

/** Non-throwing legality check. */
export function canTransitionRunState(from: RunState, event: RunLifecycleEvent): boolean {
  return targetRunState(from, event) !== undefined;
}

/**
 * The PURE transition function (gate 3). Legal pairs return the target
 * state; illegal pairs throw EnvironmentRuntimeError with code
 * ENVIRONMENT_RUNTIME_ILLEGAL_TRANSITION carrying the offending from/to
 * states and the attempted lifecycle event in `details`.
 */
export function transitionRunState(from: RunState, event: RunLifecycleEvent): RunState {
  if (!isRunState(from)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
      message: `unknown run state: ${JSON.stringify(from)}`,
      details: { from, event, known: [...RUN_STATES] },
    });
  }
  if (!isRunLifecycleEvent(event)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
      message: `unknown run lifecycle event: ${JSON.stringify(event)}`,
      details: { from, event, known: [...RUN_LIFECYCLE_EVENTS] },
    });
  }
  const to = targetRunState(from, event);
  if (to === undefined) {
    const legal = RUN_LIFECYCLE_EVENTS.filter((candidate) =>
      targetRunState(from, candidate) !== undefined,
    );
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
      message: `illegal run lifecycle transition: event '${event}' cannot be applied in state '${from}' (offending transition ${from} → ${eventTargetLabel(from, event)}; legal events from '${from}': ${legal.length > 0 ? legal.join(', ') : 'none (terminal)'})`,
      details: { from, to: eventTargetLabel(from, event), event, legalEvents: legal },
    });
  }
  return to;
}

/** Best-effort label of the state an illegal event was attempting to reach. */
function eventTargetLabel(from: RunState, event: RunLifecycleEvent): string {
  for (const edge of RUN_TRANSITIONS) {
    if (edge.event === event) return edge.to;
  }
  return `${from} (unknown target)`;
}

// ---------------------------------------------------------------------------
// Deadline enforcement (bounded execution — lock rule 8)
// ---------------------------------------------------------------------------

/**
 * Pure time-limit enforcement: a run in a time-bearing state
 * (provisioning / running / checkpointing) whose elapsed seconds have
 * exhausted the declared wall clock transitions to `timed-out`; every
 * other state is returned unchanged. Callers supply pure elapsed data —
 * this function never reads a wall clock.
 */
export function enforceTimeLimit(
  state: RunState,
  elapsedSeconds: number,
  wallClockSeconds: number,
): RunState {
  if (!isRunState(state)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
      message: `unknown run state: ${JSON.stringify(state)}`,
    });
  }
  const elapsed = expectPositiveInteger(
    elapsedSeconds,
    'elapsedSeconds',
    ENVIRONMENT_RUNTIME_ERROR_CODES.TIME_LIMIT_EXCEEDED,
    'time-limit enforcement',
  );
  const budget = expectPositiveInteger(
    wallClockSeconds,
    'wallClockSeconds',
    ENVIRONMENT_RUNTIME_ERROR_CODES.TIME_LIMIT_EXCEEDED,
    'time-limit enforcement',
  );
  const timeBearing =
    state === 'provisioning' || state === 'running' || state === 'checkpointing';
  if (timeBearing && elapsed >= budget) {
    return transitionRunState(state, 'timed-out');
  }
  return state;
}

/** True when `state` may still bear time (and therefore a deadline). */
export function isTimeBearingRunState(state: RunState): boolean {
  return (
    state === 'provisioning' || state === 'running' || state === 'checkpointing'
  );
}

// ---------------------------------------------------------------------------
// Reachability (property-test support: every reachable path)
// ---------------------------------------------------------------------------

/** Outgoing legal events from a state (frozen array). */
export function legalRunEventsFrom(state: RunState): readonly RunLifecycleEvent[] {
  if (!isRunState(state)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
      message: `unknown run state: ${JSON.stringify(state)}`,
    });
  }
  return Object.freeze(
    RUN_LIFECYCLE_EVENTS.filter((event) => targetRunState(state, event) !== undefined),
  );
}

/**
 * Validate a lifecycle event value read from untrusted input (closed
 * enum, typed error otherwise) — used by the event fold and wire
 * parsers.
 */
export function toRunLifecycleEvent(value: string): RunLifecycleEvent {
  return expectEnumMember(
    value,
    RUN_LIFECYCLE_EVENTS,
    'lifecycleEvent',
    ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT,
    'run lifecycle',
  );
}
