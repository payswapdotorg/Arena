/**
 * Clock fakes for @arena/auth (Work Order B004) — the deterministic time
 * seam for session lifecycle tests (expiry, rotation windows, revocation
 * epochs). Mirrors the @arena/persistence ManualClock/SystemClock pattern:
 * implementations never read a wall clock directly; they receive an
 * injected AuthClock at construction time.
 */

import type { AuthClock } from '../shared.js';

/** Real wall-clock time (default for production compositions). */
export class SystemAuthClock implements AuthClock {
  now(): number {
    return Date.now();
  }
}

/** Deterministic, manually advanced clock (tests + local parity). */
export class ManualAuthClock implements AuthClock {
  private current: number;

  constructor(startAt: number = 0) {
    this.current = startAt;
  }

  now(): number {
    return this.current;
  }

  /** Advance deterministic time by `ms`; returns the new time. */
  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }
}

/** An AuthClock whose time can be advanced (the contract-suite fixture seam). */
export type ControllableAuthClock = AuthClock & {
  advance(ms: number): number;
};
