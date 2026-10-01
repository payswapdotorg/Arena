/**
 * Clock fakes (local parity, Work Order B002): SystemClock (real wall
 * clock) and ManualClock (deterministic, advanceable) — the same seam the
 * observability service uses. Hosted adapters default to SystemClock and
 * accept an injected ControllableClock in tests.
 */

import type { Clock, ControllableClock } from '../ports/clock.js';

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class ManualClock implements ControllableClock {
  private current: number;

  constructor(startAt = 0) {
    this.current = startAt;
  }

  now(): number {
    return this.current;
  }

  advance(ms: number): number {
    this.current += ms;
    return this.current;
  }
}
