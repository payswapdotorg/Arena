/**
 * Host runtime lifecycle (Work Order P002; issue #154; ADR-P001-07).
 *
 * The host is a strict lifecycle machine:
 *
 *   constructed → starting → started → stopping → stopped
 *                                    ↘ failed
 *
 *   - every transition is a PURE function returning the next state
 *     (invalid transitions fail closed with a typed error);
 *   - `started` is the only state in which the host surfaces may be
 *     exercised (fail-closed gate for P003 transport binding);
 *   - `stop` is idempotent (stopping/stopped are stable);
 *   - `failed` is terminal and records the failure reason (the host
 *     never silently degrades — a start failure is a failed host, not a
 *     partially-started one).
 */

/** The closed host lifecycle state vocabulary. */
export const RUNTIME_HOST_STATES = Object.freeze([
  'constructed',
  'starting',
  'started',
  'stopping',
  'stopped',
  'failed',
] as const);
export type RuntimeHostState = (typeof RUNTIME_HOST_STATES)[number];

/** Error code namespace for lifecycle failures (closed vocabulary). */
export const LIFECYCLE_ERROR_CODES = Object.freeze({
  INVALID_TRANSITION: 'RUNTIME_INVALID_TRANSITION',
  NOT_STARTED: 'RUNTIME_NOT_STARTED',
  ALREADY_STOPPED: 'RUNTIME_ALREADY_STOPPED',
} as const);
export type LifecycleErrorCode =
  (typeof LIFECYCLE_ERROR_CODES)[keyof typeof LIFECYCLE_ERROR_CODES];

/** Typed, machine-readable lifecycle failure (never a bare boolean). */
export class RuntimeHostLifecycleError extends Error {
  readonly code: LifecycleErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: LifecycleErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RuntimeHostLifecycleError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** The legal forward transitions (fail closed on everything else). */
const TRANSITIONS: Readonly<Record<RuntimeHostState, readonly RuntimeHostState[]>> =
  Object.freeze({
    constructed: Object.freeze(['starting'] as const),
    starting: Object.freeze(['started', 'failed'] as const),
    started: Object.freeze(['stopping', 'failed'] as const),
    stopping: Object.freeze(['stopped', 'failed'] as const),
    stopped: Object.freeze([] as const),
    failed: Object.freeze([] as const),
  });

/** Is the transition from `from` to `to` legal? */
export function isLegalTransition(from: RuntimeHostState, to: RuntimeHostState): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * Apply one lifecycle transition (pure): returns `to` when legal, throws
 * the typed invalid-transition error otherwise. `failed` additionally
 * requires a non-empty failure reason (fail-closed diagnosis).
 */
export function transitionRuntimeHost(
  from: RuntimeHostState,
  to: RuntimeHostState,
  failureReason?: string,
): RuntimeHostState {
  if (!isLegalTransition(from, to)) {
    throw new RuntimeHostLifecycleError(
      LIFECYCLE_ERROR_CODES.INVALID_TRANSITION,
      `illegal host lifecycle transition: ${from} → ${to}`,
      { from, to, legal: [...TRANSITIONS[from]] },
    );
  }
  if (to === 'failed' && (failureReason === undefined || failureReason.trim() === '')) {
    throw new RuntimeHostLifecycleError(
      LIFECYCLE_ERROR_CODES.INVALID_TRANSITION,
      'a failed host must record a non-empty failure reason (fail-closed diagnosis)',
      { from, to },
    );
  }
  return to;
}

/** Guard: the surface may only be exercised while the host is started. */
export function assertStarted(state: RuntimeHostState): void {
  if (state !== 'started') {
    throw new RuntimeHostLifecycleError(
      LIFECYCLE_ERROR_CODES.NOT_STARTED,
      `the host runtime surface is unavailable in state "${state}" (only "started" serves callers; fail closed)`,
      { state },
    );
  }
}

/** Type guard for the closed state vocabulary. */
export function isRuntimeHostState(value: unknown): value is RuntimeHostState {
  return (
    typeof value === 'string' &&
    (RUNTIME_HOST_STATES as readonly string[]).includes(value)
  );
}
