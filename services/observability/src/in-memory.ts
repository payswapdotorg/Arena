/**
 * In-memory reference adapters for the observability service (Work Order
 * A035). Shipped for tests and local reference deployments — the
 * job-orchestrator in-memory precedent: the invariants are enforced HERE
 * (per-source sequence discipline, dedup, idempotent append), never
 * trusted from callers.
 */

import type { IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';
import {
  appendTelemetrySignal,
  createTelemetryStream,
  OBS_ERROR_CODES,
  ObservabilityError,
  toTelemetrySignal,
  verifyTelemetryStream,
} from '@arena/observability';
import type {
  AlertRuleState,
  TelemetrySignal,
  TelemetryStream,
} from '@arena/observability';
import type {
  AlertStateStore,
  Clock,
  StoredTelemetrySignal,
  TelemetryStore,
} from './ports.js';

/** Deterministic manual clock (tests drive time explicitly). */
export class ManualClock implements Clock {
  private current: number;
  constructor(start = 0) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advance(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `clock advance must be a non-negative integer, got ${String(ms)}`,
      });
    }
    this.current += ms;
  }
  setTo(ms: number): void {
    if (!Number.isSafeInteger(ms) || ms < 0) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `clock set must be a non-negative integer, got ${String(ms)}`,
      });
    }
    this.current = ms;
  }
}

/** Reads the real wall clock (production default). */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

/** The last signal sequence persisted per source stream. */
interface SourceState {
  lastSequence: number;
  lastOccurredAt: number;
  signalIds: Set<string>;
}

/**
 * In-memory telemetry store. Enforces the full per-source append-only
 * discipline; append is IDEMPOTENT by signalId (same signal → same
 * stored record, no double-count — SLO math never counts replays).
 */
export class InMemoryTelemetryStore implements TelemetryStore {
  private readonly stored = new Map<string, StoredTelemetrySignal>();
  private readonly byCorrelation = new Map<string, Set<string>>();
  private readonly sources = new Map<string, SourceState>();

  async append(
    signal: TelemetrySignal,
    ingestedAt: number,
    idempotencyKey: IdempotencyKey | null,
  ): Promise<StoredTelemetrySignal> {
    // Structural validation happens on EVERY append (fail-closed even
    // for values that already passed the wire boundary).
    const validated = toTelemetrySignal(signal);
    const existing = this.stored.get(validated.signalId);
    if (existing !== undefined) {
      if (existing.signal.sequence === validated.sequence && existing.signal.sourceService === validated.sourceService) {
        return existing;
      }
      throw new ObservabilityError(OBS_ERROR_CODES.SEQUENCE_DUPLICATE, {
        message: `signalId ${validated.signalId} already stored with a different sequence/source (id conflicts are integrity failures)`,
        details: { stored: existing.signal.sequence, attempted: validated.sequence },
      });
    }
    let source = this.sources.get(validated.sourceService);
    if (source === undefined) {
      source = { lastSequence: 0, lastOccurredAt: Number.NaN, signalIds: new Set<string>() };
      this.sources.set(validated.sourceService, source);
    }
    const expected = source.lastSequence + 1;
    if (validated.sequence < expected) {
      throw new ObservabilityError(OBS_ERROR_CODES.SEQUENCE_DUPLICATE, {
        message: `signal sequence ${String(validated.sequence)} regresses behind the expected next sequence ${String(expected)} for source ${validated.sourceService}`,
        details: { expected, actual: validated.sequence },
      });
    }
    if (validated.sequence > expected) {
      throw new ObservabilityError(OBS_ERROR_CODES.SEQUENCE_GAP, {
        message: `signal sequence ${String(validated.sequence)} leaves a gap before the expected next sequence ${String(expected)} for source ${validated.sourceService}`,
        details: { expected, actual: validated.sequence },
      });
    }
    if (Number.isFinite(source.lastOccurredAt) && validated.occurredAt < source.lastOccurredAt) {
      throw new ObservabilityError(OBS_ERROR_CODES.SAMPLES_UNORDERED, {
        message: `signal timestamps must be non-decreasing within source ${validated.sourceService}`,
        details: { last: source.lastOccurredAt, attempted: validated.occurredAt },
      });
    }
    const record: StoredTelemetrySignal = Object.freeze({
      signal: validated,
      ingestedAt,
      commandIdempotencyKey: idempotencyKey,
    });
    this.stored.set(validated.signalId, record);
    source.lastSequence = validated.sequence;
    source.lastOccurredAt = validated.occurredAt;
    source.signalIds.add(validated.signalId);
    if (isCorrelationId(validated.correlationId)) {
      const ids = this.byCorrelation.get(validated.correlationId) ?? new Set<string>();
      ids.add(validated.signalId);
      this.byCorrelation.set(validated.correlationId, ids);
    }
    return record;
  }

  async list(): Promise<readonly StoredTelemetrySignal[]> {
    return [...this.stored.values()].sort((a, b) =>
      a.signal.sourceService === b.signal.sourceService
        ? a.signal.sequence - b.signal.sequence
        : a.signal.sourceService < b.signal.sourceService
          ? -1
          : 1,
    );
  }

  async findByCorrelationId(correlationId: string): Promise<readonly StoredTelemetrySignal[]> {
    const ids = this.byCorrelation.get(correlationId);
    if (ids === undefined) return [];
    const out: StoredTelemetrySignal[] = [];
    for (const id of ids) {
      const record = this.stored.get(id);
      if (record !== undefined) out.push(record);
    }
    return out;
  }

  async queryWindow(
    kind: TelemetrySignal['kind'],
    from: number,
    to: number,
  ): Promise<readonly StoredTelemetrySignal[]> {
    return (await this.list()).filter(
      (record) =>
        record.signal.kind === kind &&
        record.signal.occurredAt >= from &&
        record.signal.occurredAt <= to,
    );
  }

  async stream(sourceService: string): Promise<TelemetryStream> {
    let stream = createTelemetryStream(sourceService);
    for (const record of await this.list()) {
      if (record.signal.sourceService === sourceService) {
        stream = appendTelemetrySignal(stream, record.signal);
      }
    }
    verifyTelemetryStream(stream);
    return stream;
  }
}

/** In-memory alert-rule state store. */
export class InMemoryAlertStateStore implements AlertStateStore {
  private readonly states = new Map<string, AlertRuleState>();

  async get(ruleId: string): Promise<AlertRuleState | null> {
    return this.states.get(ruleId) ?? null;
  }

  async save(state: AlertRuleState): Promise<void> {
    this.states.set(state.ruleId, state);
  }
}
