/**
 * Test support for @arena/observability-service (Work Order A035) —
 * deterministic builders for valid protocol objects (local copies of
 * the package-side fixtures; the package's test-support is internal).
 */

import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { newCorrelationId } from '@arena/protocol-core';
import type { AlertRule, SloDefinition } from '@arena/observability';
import type { LogSignal, MetricSignal } from '@arena/observability';
import { TELEMETRY_SIGNAL_VERSION } from '@arena/observability';
import type { NeutralId, ObservabilityTimestamp, TelemetryId } from '@arena/observability';

function tid(value: string): TelemetryId {
  return value as TelemetryId;
}

function nid(value: string): NeutralId {
  return value as NeutralId;
}

function ts(value: number): ObservabilityTimestamp {
  return value as ObservabilityTimestamp;
}

export function corr(value: string): CorrelationId {
  return value as CorrelationId;
}

export function idem(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}

export function metricSignal(overrides: {
  signalId?: string;
  sequence?: number;
  occurredAt?: number;
  sourceService?: string;
  correlationId?: CorrelationId;
  metricName?: string;
  value?: number;
} = {}): MetricSignal {
  return {
    signalVersion: TELEMETRY_SIGNAL_VERSION,
    kind: 'metric',
    signalId: tid(overrides.signalId ?? `metric-${globalThis.crypto.randomUUID()}`),
    sequence: overrides.sequence ?? 1,
    occurredAt: ts(overrides.occurredAt ?? 1_000),
    sourceService: nid(overrides.sourceService ?? 'job-orchestrator'),
    correlationId: overrides.correlationId ?? newCorrelationId(),
    causationId: null,
    tenantId: null,
    metricName: nid(overrides.metricName ?? 'job-outcome-good'),
    metricType: 'counter',
    unit: 'count',
    value: overrides.value ?? 1,
    labels: Object.freeze({}),
  };
}

export function logSignal(overrides: {
  signalId?: string;
  sequence?: number;
  occurredAt?: number;
  sourceService?: string;
  correlationId?: CorrelationId;
  level?: 'debug' | 'info' | 'warn' | 'error';
  message?: string;
} = {}): LogSignal {
  return {
    signalVersion: TELEMETRY_SIGNAL_VERSION,
    kind: 'log',
    signalId: tid(overrides.signalId ?? `log-${globalThis.crypto.randomUUID()}`),
    sequence: overrides.sequence ?? 1,
    occurredAt: ts(overrides.occurredAt ?? 1_000),
    sourceService: nid(overrides.sourceService ?? 'certification-fabric'),
    correlationId: overrides.correlationId ?? newCorrelationId(),
    causationId: null,
    tenantId: null,
    level: overrides.level ?? 'info',
    message: overrides.message ?? 'certification run recorded',
    fields: Object.freeze({}),
  };
}

export function sloDefinition(overrides: {
  sloId?: string;
  service?: string;
  metricName?: string;
  targetRatio?: number;
  windowMs?: number;
  minSampleCount?: number;
  atRiskThresholdRatio?: number;
} = {}): SloDefinition {
  return {
    definitionVersion: 1,
    sloId: tid(overrides.sloId ?? 'slo-job-completion'),
    name: 'Job completion ratio',
    service: nid(overrides.service ?? 'job-orchestrator'),
    sli: {
      kind: 'good-total-ratio',
      metricName: nid(overrides.metricName ?? 'job-outcome-good'),
      thresholdMs: null,
    },
    targetRatio: overrides.targetRatio ?? 0.99,
    windowMs: overrides.windowMs ?? 3_600_000,
    minSampleCount: overrides.minSampleCount ?? 10,
    atRiskThresholdRatio: overrides.atRiskThresholdRatio ?? 0.5,
    description: 'share of jobs that complete successfully',
  };
}

export function alertRule(overrides: {
  ruleId?: string;
  condition?: string;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  sloId?: string | null;
  metricName?: string | null;
  threshold?: number | null;
  forDurationMs?: number;
  cooldownMs?: number;
  enabled?: boolean;
  healthStatus?: 'degraded' | 'unhealthy' | 'unknown' | null;
} = {}): AlertRule {
  const condition = overrides.condition ?? 'slo-error-budget-exhausted';
  return {
    ruleVersion: 1,
    ruleId: tid(overrides.ruleId ?? 'rule-budget-exhausted'),
    name: 'Error budget exhausted',
    severity: overrides.severity ?? 'critical',
    condition,
    sloId:
      overrides.sloId !== undefined
        ? (overrides.sloId as string | null)
        : condition.startsWith('slo-')
          ? 'slo-job-completion'
          : null,
    metricName:
      overrides.metricName !== undefined
        ? (overrides.metricName as string | null)
        : condition.startsWith('metric-')
          ? 'job-outcome-good'
          : null,
    threshold:
      overrides.threshold !== undefined
        ? overrides.threshold
        : condition === 'slo-burn-rate'
          ? 0.5
          : condition === 'log-error-ratio'
            ? 0.05
            : condition.startsWith('metric-')
              ? 1
              : null,
    healthStatus:
      overrides.healthStatus !== undefined
        ? overrides.healthStatus
        : condition === 'health-status-degraded'
          ? 'degraded'
          : null,
    forDurationMs: overrides.forDurationMs ?? 0,
    cooldownMs: overrides.cooldownMs ?? 0,
    enabled: overrides.enabled ?? true,
    description: null,
  } as AlertRule;
}

/**
 * Build a batch of job-outcome-good metric samples with CONTIGUOUS
 * sequences starting at `sequence` — the store's per-source discipline
 * requires explicit sequence bookkeeping across batches.
 */
export function outcomeBatch(options: {
  count: number;
  bad: number;
  sequence: number;
  occurredAt: number;
  step?: number;
}): MetricSignal[] {
  const step = options.step ?? 1_000;
  const out: MetricSignal[] = [];
  for (let i = 0; i < options.count; i++) {
    out.push(
      metricSignal({
        sequence: options.sequence + i,
        occurredAt: options.occurredAt + i * step,
        value: i < options.count - options.bad ? 1 : 0,
      }),
    );
  }
  return out;
}
