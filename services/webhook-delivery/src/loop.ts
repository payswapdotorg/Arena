/**
 * services/webhook-delivery/src/loop.ts — the dedicated webhook delivery
 * loop (Work Order P003; issue #155; ADR-P001-01).
 *
 * WHY A DEDICATED LOOP (honestly disclosed): ADR-P001-01 binds P003 to
 * "job-driven webhook dispatch" through the ONE shared durable job runner
 * — but the frozen host seam provides no registrable webhook job kind:
 * `RUNTIME_JOB_KIND_NAMES` is a CLOSED registry inside the frozen
 * packages/runtime-host (escalation-recompute, escalation-projection,
 * learning-candidate-projection, retention-sweep), and
 * `HostJobsSurface.submitByKind` resolves ONLY those names (callers
 * cannot smuggle ad-hoc definitions across the host boundary). Adding a
 * webhook-delivery kind would edit the frozen P002 package — prohibited.
 * The runner's interface therefore does NOT cover webhook dispatch, and
 * the mission's documented alternative applies: "a dedicated durable loop
 * honestly disclosed". This is that loop; registering the kind on the
 * host registry is recorded as a TL follow-up in the PR body.
 *
 * A015 law discipline: the DRAIN never sleeps and never reads a wall
 * clock (the adapter reads the injected clock). The loop owns ONLY the
 * drain schedule (setInterval, unref'd optional) and fail-closed failure
 * accounting — every drain outcome is recorded, never swallowed.
 */

import type { WebhookDeliverySweepReport } from '@arena/escalation-adapters';

/** Default drain interval (5 seconds). */
export const DEFAULT_WEBHOOK_LOOP_INTERVAL_MS = 5_000;

/** One recorded loop outcome (append-only audit trail, never swallowed). */
export interface WebhookLoopTickRecord {
  readonly tick: number;
  readonly at: number;
  readonly outcome: 'swept' | 'drain-failed' | 'drain-skipped';
  readonly deliveredCount?: number;
  readonly deadLetteredCount?: number;
  readonly pendingConsidered?: number;
  readonly error?: string;
}

/** Options for the loop (all defaulted). */
export interface WebhookDeliveryLoopOptions {
  readonly intervalMs?: number;
  readonly clock?: { now(): number };
  /** Keep the Node event loop alive while the loop runs (default true). */
  readonly keepAlive?: boolean;
  readonly onTick?: (record: WebhookLoopTickRecord) => void;
}

/** The drain the loop schedules (the adapter's deliverPending). */
export type WebhookDrain = () => Promise<WebhookDeliverySweepReport>;

/**
 * The dedicated delivery loop: schedules `drain()` on an interval, records
 * every outcome, and never lets a failed drain crash the process (a
 * failed drain is one failed sweep — the durable outbox keeps the events).
 */
export class WebhookDeliveryLoop {
  readonly #drain: WebhookDrain;
  readonly #intervalMs: number;
  readonly #clock: { now(): number };
  readonly #keepAlive: boolean;
  readonly #onTick: ((record: WebhookLoopTickRecord) => void) | undefined;
  #timer: ReturnType<typeof setInterval> | null = null;
  #tickCount = 0;
  #records: WebhookLoopTickRecord[] = [];
  #draining = false;

  constructor(drain: WebhookDrain, options: WebhookDeliveryLoopOptions = {}) {
    this.#drain = drain;
    this.#intervalMs =
      typeof options.intervalMs === 'number' &&
      Number.isFinite(options.intervalMs) &&
      options.intervalMs > 0
        ? options.intervalMs
        : DEFAULT_WEBHOOK_LOOP_INTERVAL_MS;
    this.#clock = options.clock ?? { now: () => Date.now() };
    this.#keepAlive = options.keepAlive ?? true;
    this.#onTick = options.onTick;
  }

  /** Is the loop currently scheduled? */
  get running(): boolean {
    return this.#timer !== null;
  }

  /** The recorded tick history (append-only audit view). */
  get ticks(): readonly WebhookLoopTickRecord[] {
    return [...this.#records];
  }

  /** Start scheduling drains (idempotent). */
  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#intervalMs);
    if (!this.#keepAlive) {
      this.#timer.unref();
    }
  }

  /** Stop scheduling drains (idempotent). */
  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Run ONE drain now (also what the interval schedules). Fail-closed: a
   * throwing drain is recorded as a failed tick and re-thrown NEVER — the
   * events stay durable in the outbox for the next tick. A drain that
   * overlaps a still-running drain is recorded as SKIPPED (honest audit:
   * skipped ≠ failed — the sweep is idempotent and the outbox is the
   * durable substrate).
   */
  async tick(): Promise<
    WebhookDeliverySweepReport | { readonly outcome: 'drain-failed' } | { readonly outcome: 'drain-skipped' }
  > {
    if (this.#draining) {
      this.#tickCount += 1;
      this.#record({
        tick: this.#tickCount,
        at: this.#clock.now(),
        outcome: 'drain-skipped',
      });
      return { outcome: 'drain-skipped' as const };
    }
    this.#draining = true;
    this.#tickCount += 1;
    try {
      const report = await this.#drain();
      this.#record({
        tick: this.#tickCount,
        at: this.#clock.now(),
        outcome: 'swept',
        deliveredCount: report.deliveredCount,
        deadLetteredCount: report.deadLetteredCount,
        pendingConsidered: report.pendingConsidered,
      });
      return report;
    } catch (error: unknown) {
      this.#record({
        tick: this.#tickCount,
        at: this.#clock.now(),
        outcome: 'drain-failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return { outcome: 'drain-failed' as const };
    } finally {
      this.#draining = false;
    }
  }

  #record(record: WebhookLoopTickRecord): void {
    this.#records = [...this.#records, record];
    this.#onTick?.(record);
  }
}
