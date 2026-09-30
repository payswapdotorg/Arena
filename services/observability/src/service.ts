/**
 * @arena/observability-service — the reference observability fabric
 * (Work Order A035; requirements R33, R26, R27, R28).
 *
 * A deterministic in-process service over @arena/observability with
 * pluggable persistence: the ONLY workspace imports are
 * @arena/observability and @arena/protocol-core (service layer →
 * domain + protocol layers, enforced by the boundary checker). Zero
 * external infrastructure and zero new runtime dependencies — the
 * job-orchestrator fabric precedent.
 *
 * Authority boundary (spec/service-boundaries.md): this service OWNS
 * telemetry ingestion/query wiring, SLO registration/evaluation and
 * alert verdicts over consumed telemetry. It NEVER judges domain
 * outcomes and never reaches into another service's state — sibling
 * services EMIT typed telemetry (A015 envelope discipline), this
 * service consumes it.
 *
 * Surfaces:
 *   - ingest()            — envelope-wired ingestion: fail-closed
 *                           parsing, idempotent by command idempotency
 *                           key (re-acks, never double-appends);
 *   - queryTelemetry()    — correlation / kind / time-range queries;
 *   - registerSlo()/registerAlertRule() — closed validated registries;
 *   - evaluateSlo()       — SLO evaluation over the store's window
 *                           fabric (pure package evaluator);
 *   - evaluateAlerts()    — deterministic alert verdicts with persisted
 *                           state-machine transitions + flap cooldown;
 *   - reportHealth()      — worst-of fail-closed health aggregation.
 */

import type { Envelope, IdempotencyKey } from '@arena/protocol-core';
import {
  alertStateAfter,
  evaluateAlertRule,
  initialAlertRuleState,
  makeAlertEvaluationResponse,
  makeSloEvaluationResponse,
  makeTelemetryIngestedEvent,
  OBS_ERROR_CODES,
  ObservabilityError,
  parseIngestTelemetryCommand,
  parseObservabilityEnvelope,
  toAlertRule,
  toHealthReport,
  toSloDefinition,
  toTelemetrySignal,
} from '@arena/observability';
import type {
  AlertEvaluation,
  AlertRule,
  AlertRuleState,
  EvaluateAlertsQuery,
  EvaluateSloQuery,
  HealthReport,
  LogSignal,
  MetricSignal,
  SloDefinition,
  SloEvaluation,
  TelemetryIngestedEvent,
  TelemetrySignal,
} from '@arena/observability';
import { evaluateSlo } from '@arena/observability';
import type {
  AlertStateStore,
  Clock,
  EventSink,
  StoredTelemetrySignal,
  TelemetryStore,
} from './ports.js';

/** Window the log-error-ratio condition evaluates over (5 minutes). */
export const LOG_ERROR_RATIO_WINDOW_MS = 300_000 as const;

export interface ObservabilityServiceDeps {
  readonly clock: Clock;
  readonly store: TelemetryStore;
  readonly alertStates: AlertStateStore;
  readonly sink: EventSink;
}

export interface TelemetryQuery {
  readonly correlationId?: string;
  readonly kind?: TelemetrySignal['kind'];
  readonly from?: number;
  readonly to?: number;
}

export class ObservabilityService {
  private readonly sloDefinitions = new Map<string, SloDefinition>();
  private readonly alertRules = new Map<string, AlertRule>();
  private readonly acks = new Map<string, Envelope<TelemetryIngestedEvent>>();
  private readonly ruleRegisteredAt = new Map<string, number>();
  private latestHealth: HealthReport | null = null;

  private readonly clock: Clock;
  private readonly store: TelemetryStore;
  private readonly alertStates: AlertStateStore;
  private readonly sink: EventSink;

  constructor(deps: ObservabilityServiceDeps) {
    this.clock = deps.clock;
    this.store = deps.store;
    this.alertStates = deps.alertStates;
    this.sink = deps.sink;
  }

  // -------------------------------------------------------------------------
  // Registries (closed, validated, fail-closed)
  // -------------------------------------------------------------------------

  /** Validate + register an SLO definition (unknown ids rejected). */
  registerSlo(raw: unknown): SloDefinition {
    const definition = toSloDefinition(raw);
    this.sloDefinitions.set(definition.sloId, definition);
    return definition;
  }

  /** Validate + register an alert rule (unknown conditions rejected). */
  registerAlertRule(raw: unknown, registeredAt: number = this.clock.now()): AlertRule {
    const rule = toAlertRule(raw);
    this.alertRules.set(rule.ruleId, rule);
    this.ruleRegisteredAt.set(rule.ruleId, registeredAt);
    return rule;
  }

  // -------------------------------------------------------------------------
  // Ingestion (envelope-wired, idempotent, fail-closed)
  // -------------------------------------------------------------------------

  /**
   * Ingest one telemetry signal from a wire command envelope.
   * R27 discipline: the command REQUIRES an idempotency key; replaying
   * the same command re-acknowledges with the SAME event envelope —
   * signals are never double-appended (SLO math never counts replays).
   */
  async ingest(rawCommand: string): Promise<Envelope<TelemetryIngestedEvent>> {
    const command = parseIngestTelemetryCommand(rawCommand);
    const key = command.idempotencyKey;
    if (key === null) {
      // Defensive: the core parser already rejects this; fail-closed again.
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SIGNAL, {
        message: 'ingest commands require a non-null idempotency key (architecture-lock rule 17)',
      });
    }
    const cached = this.acks.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const ingestedAt = this.clock.now();
    const stored = await this.store.append(
      toTelemetrySignal(command.payload),
      ingestedAt,
      key,
    );
    const ack = makeTelemetryIngestedEvent(
      {
        signalId: stored.signal.signalId,
        sourceService: stored.signal.sourceService,
        sequence: stored.signal.sequence,
        ingestedAt: stored.ingestedAt,
      },
      { correlationId: command.correlationId, idempotencyKey: key },
    );
    await this.sink.appendTelemetryIngested(ack);
    this.acks.set(key, ack);
    return ack;
  }

  /**
   * Ingest a structurally valid signal directly (library/embedded use —
   * the envelope path above is the wire boundary). Validates again
   * (fail-closed) and returns the stored record.
   */
  async ingestSignal(
    signal: TelemetrySignal,
    idempotencyKey: IdempotencyKey | null = null,
  ): Promise<StoredTelemetrySignal> {
    return this.store.append(toTelemetrySignal(signal), this.clock.now(), idempotencyKey);
  }

  // -------------------------------------------------------------------------
  // Queries (correlation-addressable, typed)
  // -------------------------------------------------------------------------

  /** Query stored telemetry by correlation id, kind and/or time range. */
  async queryTelemetry(query: TelemetryQuery): Promise<readonly StoredTelemetrySignal[]> {
    let records = await this.store.list();
    if (query.correlationId !== undefined) {
      records = await this.store.findByCorrelationId(query.correlationId);
    }
    return records.filter((record) => {
      if (query.kind !== undefined && record.signal.kind !== query.kind) return false;
      if (query.from !== undefined && record.signal.occurredAt < query.from) return false;
      if (query.to !== undefined && record.signal.occurredAt > query.to) return false;
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // SLO evaluation (pure evaluator over the store's window fabric)
  // -------------------------------------------------------------------------

  /** All registered SLO definitions (frozen records). */
  listSlos(): readonly SloDefinition[] {
    return [...this.sloDefinitions.values()];
  }

  /**
   * Evaluate one registered SLO over its rolling window ending at
   * `windowEnd` (default: the injected clock's now). Deterministic:
   * same store state + same windowEnd → same evaluation.
   */
  async evaluateSlo(sloId: string, windowEnd?: number): Promise<SloEvaluation> {
    const definition = this.sloDefinitions.get(sloId);
    if (definition === undefined) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
        message: `unknown SLO id: ${JSON.stringify(sloId)} (registered: ${[...this.sloDefinitions.keys()].join(', ') || 'none'})`,
      });
    }
    const end = windowEnd ?? this.clock.now();
    if (!Number.isSafeInteger(end) || end < 0) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_WINDOW, {
        message: `windowEnd must be an epoch-ms integer >= 0, got ${String(end)}`,
      });
    }
    if (end < definition.windowMs) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_WINDOW, {
        message: `windowEnd ${String(end)} cannot precede the window length ${String(definition.windowMs)} (window start would be negative)`,
      });
    }
    const windowStart = end - definition.windowMs;
    const kinds: readonly TelemetrySignal['kind'][] =
      definition.sli.kind === 'log-error-ratio' ? ['log'] : ['metric'];
    const samples: (MetricSignal | LogSignal)[] = [];
    for (const kind of kinds) {
      for (const record of await this.store.queryWindow(kind, windowStart, end)) {
        const signal = record.signal;
        if (signal.sourceService !== definition.service) continue;
        if (signal.kind === 'metric' && signal.metricName !== definition.sli.metricName) continue;
        if (signal.kind === 'trace' || signal.kind === 'audit') continue;
        samples.push(signal);
      }
    }
    samples.sort((a, b) => a.occurredAt - b.occurredAt || a.sequence - b.sequence);
    return evaluateSlo({
      definition,
      window: {
        windowStart: windowStart as SloEvaluation['windowStart'],
        windowEnd: end as SloEvaluation['windowEnd'],
      },
      samples,
    });
  }

  /**
   * Envelope-wired SLO evaluation: parse an evaluate-slo QUERY envelope,
   * evaluate, and wrap the result in a response envelope carrying the
   * same correlation id.
   */
  async evaluateSloQuery(rawQuery: string): Promise<Envelope<SloEvaluation>> {
    const query = parseObservabilityEnvelope<EvaluateSloQuery>(
      rawQuery,
      'observability/evaluate-slo-query',
    );
    if (query.kind !== 'query') {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_SLO, {
        message: `evaluate-slo payloads must travel as query envelopes, got ${query.kind}`,
      });
    }
    const evaluation = await this.evaluateSlo(query.payload.sloId, query.payload.windowEnd);
    return makeSloEvaluationResponse(evaluation, { correlationId: query.correlationId });
  }

  // -------------------------------------------------------------------------
  // Alert evaluation (deterministic verdicts, persisted state machine)
  // -------------------------------------------------------------------------

  /** All registered alert rules (frozen records). */
  listAlertRules(): readonly AlertRule[] {
    return [...this.alertRules.values()];
  }

  /**
   * Evaluate every registered alert rule as of `now` (default: the
   * injected clock). Deterministic verdicts; state transitions persist
   * through the AlertStateStore port; cooldown flap protection is
   * enforced by the package state machine.
   */
  async evaluateAlerts(now?: number): Promise<readonly AlertEvaluation[]> {
    const at = now ?? this.clock.now();
    if (!Number.isSafeInteger(at) || at < 0) {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `now must be an epoch-ms integer >= 0, got ${String(at)}`,
      });
    }
    const evaluations: AlertEvaluation[] = [];
    for (const rule of this.alertRules.values()) {
      const input = await this.alertInputFor(rule, at);
      const registeredAt = this.ruleRegisteredAt.get(rule.ruleId) ?? at;
      const stored = await this.alertStates.get(rule.ruleId);
      const priorState: AlertRuleState =
        stored ?? initialAlertRuleState(rule.ruleId, Math.min(registeredAt, at));
      const evaluation = evaluateAlertRule({ rule, priorState, now: at, input });
      await this.alertStates.save(alertStateAfter(priorState, evaluation));
      evaluations.push(evaluation);
    }
    return evaluations;
  }

  /**
   * Envelope-wired alert evaluation: parse an evaluate-alerts QUERY
   * envelope, evaluate every rule, and return one alert-evaluation
   * RESPONSE envelope per rule (same correlation id).
   */
  async evaluateAlertsQuery(
    rawQuery: string,
  ): Promise<readonly Envelope<AlertEvaluation>[]> {
    const query = parseObservabilityEnvelope<EvaluateAlertsQuery>(
      rawQuery,
      'observability/evaluate-alerts-query',
    );
    if (query.kind !== 'query') {
      throw new ObservabilityError(OBS_ERROR_CODES.INVALID_ALERT_RULE, {
        message: `evaluate-alerts payloads must travel as query envelopes, got ${query.kind}`,
      });
    }
    const evaluations = await this.evaluateAlerts(query.payload.now);
    return evaluations.map((evaluation) =>
      makeAlertEvaluationResponse(evaluation, { correlationId: query.correlationId }),
    );
  }

  private async alertInputFor(
    rule: AlertRule,
    now: number,
  ): Promise<Parameters<typeof evaluateAlertRule>[0]['input']> {
    // SLO-scoped conditions: evaluate the referenced SLO at `now`.
    if (rule.sloId !== null && rule.condition.startsWith('slo-')) {
      let sloEvaluation: SloEvaluation | null = null;
      if (this.sloDefinitions.has(rule.sloId)) {
        sloEvaluation = await this.evaluateSlo(rule.sloId, now);
      }
      return {
        sloEvaluation,
        healthStatus: this.healthTripStatus(),
        metricValue: null,
        logErrorRatio: null,
      };
    }
    // Metric-scoped conditions: the latest sample of the rule's metric.
    if (rule.condition.startsWith('metric-')) {
      const records = await this.store.queryWindow('metric', 0, now);
      let latest: MetricLike | null = null;
      for (const record of records) {
        const signal = record.signal;
        if (signal.kind !== 'metric' || signal.metricName !== rule.metricName) continue;
        if (latest === null || signal.occurredAt > latest.occurredAt) {
          latest = signal;
        }
      }
      return {
        sloEvaluation: null,
        healthStatus: this.healthTripStatus(),
        metricValue: latest === null ? null : latest.value,
        logErrorRatio: null,
      };
    }
    // Log-error ratio: share of error-level logs across the window.
    if (rule.condition === 'log-error-ratio') {
      const from = Math.max(0, now - LOG_ERROR_RATIO_WINDOW_MS);
      const logs = await this.store.queryWindow('log', from, now);
      let errors = 0;
      for (const record of logs) {
        if (record.signal.kind === 'log' && record.signal.level === 'error') errors++;
      }
      return {
        sloEvaluation: null,
        healthStatus: this.healthTripStatus(),
        metricValue: null,
        logErrorRatio: logs.length === 0 ? null : errors / logs.length,
      };
    }
    // Health-scoped condition: the latest reported aggregate health.
    return {
      sloEvaluation: null,
      healthStatus: this.healthTripStatus(),
      metricValue: null,
      logErrorRatio: null,
    };
  }

  private healthTripStatus(): 'degraded' | 'unhealthy' | 'unknown' | null {
    if (this.latestHealth === null) return null;
    switch (this.latestHealth.aggregate) {
      case 'healthy':
        return null;
      case 'degraded':
        return 'degraded';
      case 'unknown':
        return 'unknown';
      case 'unhealthy':
        return 'unhealthy';
    }
  }

  // -------------------------------------------------------------------------
  // Health (worst-of, fail-closed)
  // -------------------------------------------------------------------------

  /**
   * Report component health contributions and store the aggregate
   * report (feeds health-scoped alert rules).
   */
  async reportHealth(components: readonly unknown[]): Promise<HealthReport> {
    const report = toHealthReport(components, this.clock.now());
    this.latestHealth = report;
    return report;
  }

  /** The latest health report (or null when nothing reported yet). */
  currentHealth(): HealthReport | null {
    return this.latestHealth;
  }

  /** The service's own clock (epoch ms; injected, never a wall read). */
  now(): number {
    return this.clock.now();
  }
}

type MetricLike = { occurredAt: number; value: number };
