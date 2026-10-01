/**
 * Clock port (Work Order B002) — time is INJECTED (architecture-lock rule
 * 17: deterministic, correlation-addressed operations). Persistence
 * implementations never read a wall clock directly; they receive a Clock
 * at construction time. The fakes ship ManualClock for deterministic
 * contract tests; hosted adapters default to SystemClock and accept an
 * injected one.
 */

export interface Clock {
  /** Current time in epoch milliseconds. */
  now(): number;
}

export type ControllableClock = Clock & {
  /** Advance deterministic time by `ms`; returns the new time. */
  advance(ms: number): number;
};
