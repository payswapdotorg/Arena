/**
 * Observability service ports (Work Order A035) — the ONLY things
 * services/observability depends on besides @arena/observability and
 * @arena/protocol-core.
 *
 * The service is a deterministic in-process reference fabric over the
 * observability protocol; ALL effects beyond pure decisions go through
 * these ports (the job-orchestrator ports precedent):
 *
 *   - Clock           — time is INJECTED (the engine never reads a wall
 *                       clock; architecture-lock rule 17);
 *   - TelemetryStore  — persistence port for telemetry signals (per-source
 *                       sequence discipline and signal-id dedup live
 *                       behind this port);
 *   - AlertStateStore — persistence port for alert-rule state (the
 *                       cooldown/for-duration state machine);
 *   - EventSink       — where acknowledgement event envelopes go.
 *
 * Authority boundary: the service OWNS telemetry ingestion/query
 * wiring, SLO registration + evaluation scheduling and alert verdicts.
 * It NEVER judges domain outcomes (jobs, environments, certification)
 * — it consumes their typed telemetry, exactly as
 * spec/service-boundaries.md requires (no cross-service state access).
 */

import type { Envelope, IdempotencyKey } from '@arena/protocol-core';
import type {
  AlertRule,
  AlertRuleState,
  TelemetrySignal,
  TelemetryStream,
} from '@arena/observability';
import type { TelemetryIngestedEvent } from '@arena/observability';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** What the store persists per ingested signal (audit-friendly). */
export interface StoredTelemetrySignal {
  readonly signal: TelemetrySignal;
  readonly ingestedAt: number;
  readonly commandIdempotencyKey: IdempotencyKey | null;
}

/** Persistence port for telemetry signals. */
export interface TelemetryStore {
  /**
   * Append a signal. Enforces the per-source append-only discipline
   * (sequence contiguity, timestamp monotonicity, signal-id dedup) and
   * throws ObservabilityError on violations. Idempotent by signalId:
   * re-appending the same signal returns the stored record.
   */
  append(signal: TelemetrySignal, ingestedAt: number, idempotencyKey: IdempotencyKey | null): Promise<StoredTelemetrySignal>;
  /** All stored signals ordered by (sourceService, sequence). */
  list(): Promise<readonly StoredTelemetrySignal[]>;
  /** Signals for one correlation id (correlation-addressable path). */
  findByCorrelationId(correlationId: string): Promise<readonly StoredTelemetrySignal[]>;
  /** Signals of one kind within [from, to] (the SLO window fabric). */
  queryWindow(kind: TelemetrySignal['kind'], from: number, to: number): Promise<readonly StoredTelemetrySignal[]>;
  /** The verified per-source stream (for audit/replay). */
  stream(sourceService: string): Promise<TelemetryStream>;
}

/** Persistence port for alert-rule state. */
export interface AlertStateStore {
  get(ruleId: string): Promise<AlertRuleState | null>;
  save(state: AlertRuleState): Promise<void>;
}

/** Append port for acknowledgement event envelopes. */
export interface EventSink {
  appendTelemetryIngested(envelope: Envelope<TelemetryIngestedEvent>): Promise<void>;
}

/** Rule + state pair used by alert evaluation. */
export interface RegisteredAlertRule {
  readonly rule: AlertRule;
}
