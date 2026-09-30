/**
 * Test support for @arena/observability (Work Order A035) — deterministic
 * builders for valid protocol objects. Test-only surface (imported by
 * *.test.ts files; never exported from src/index.ts).
 *
 * Branded values are produced with explicit casts (the @arena/security
 * test-support precedent) — builders validate structurally valid shapes
 * by construction; adversarial cases are built inline by tests.
 */

import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { newCorrelationId } from '@arena/protocol-core';
import type { SecurityAuditEvent } from '@arena/security';
import type {
  AlertEvaluation,
  AlertRule,
  AlertRuleState,
} from './alerts.js';
import { initialAlertRuleState } from './alerts.js';
import type { EvaluationWindow, SloDefinition } from './slo.js';
import type {
  AuditSignal,
  LogSignal,
  MetricSignal,
  TelemetrySignal,
  TraceSignal,
} from './telemetry.js';
import { TELEMETRY_SIGNAL_VERSION } from './telemetry.js';
import type { NeutralId, ObservabilityTimestamp, TelemetryId } from './shared.js';

export function correlation(): CorrelationId {
  return newCorrelationId();
}

/** Brand a plain string as a CorrelationId (deterministic tests). */
export function corr(value: string): CorrelationId {
  return value as CorrelationId;
}

export function idempotency(): IdempotencyKey {
  return globalThis.crypto.randomUUID() as IdempotencyKey;
}

/** Brand a plain string as an IdempotencyKey (deterministic tests). */
export function idem(value: string): IdempotencyKey {
  return value as IdempotencyKey;
}

function ts(value: number): ObservabilityTimestamp {
  return value as ObservabilityTimestamp;
}

function tid(value: string): TelemetryId {
  return value as TelemetryId;
}

function nid(value: string): NeutralId {
  return value as NeutralId;
}

export function metricSignal(overrides: {
  signalId?: string;
  sequence?: number;
  occurredAt?: number;
  sourceService?: string;
  correlationId?: CorrelationId;
  metricName?: string;
  value?: number;
  causationId?: string | null;
  tenantId?: string | null;
} = {}): MetricSignal {
  return {
    signalVersion: TELEMETRY_SIGNAL_VERSION,
    kind: 'metric',
    signalId: tid(overrides.signalId ?? `metric-${globalThis.crypto.randomUUID()}`),
    sequence: overrides.sequence ?? 1,
    occurredAt: ts(overrides.occurredAt ?? 1_000),
    sourceService: nid(overrides.sourceService ?? 'job-orchestrator'),
    correlationId: overrides.correlationId ?? correlation(),
    causationId: overrides.causationId ?? null,
    tenantId: overrides.tenantId ?? null,
    metricName: nid(overrides.metricName ?? 'job-outcome-good'),
    metricType: 'counter',
    unit: 'count',
    value: overrides.value ?? 1,
    labels: Object.freeze({}),
  };
}

export function traceSignal(overrides: {
  signalId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  sequence?: number;
  occurredAt?: number;
  sourceService?: string;
  correlationId?: CorrelationId;
  operation?: string;
  status?: 'open' | 'succeeded' | 'failed';
  durationMs?: number | null;
} = {}): TraceSignal {
  const status = overrides.status ?? 'succeeded';
  return {
    signalVersion: TELEMETRY_SIGNAL_VERSION,
    kind: 'trace',
    signalId: tid(overrides.signalId ?? `trace-${globalThis.crypto.randomUUID()}`),
    sequence: overrides.sequence ?? 1,
    occurredAt: ts(overrides.occurredAt ?? 1_000),
    sourceService: nid(overrides.sourceService ?? 'environment-runner'),
    correlationId: overrides.correlationId ?? correlation(),
    causationId: null,
    tenantId: null,
    spanId: tid(overrides.spanId ?? `span-${globalThis.crypto.randomUUID()}`),
    parentSpanId: overrides.parentSpanId != null ? tid(overrides.parentSpanId) : null,
    operation: nid(overrides.operation ?? 'run-isolated-workload'),
    status,
    durationMs: overrides.durationMs ?? (status === 'open' ? null : 50),
    attributes: Object.freeze({}),
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
    correlationId: overrides.correlationId ?? correlation(),
    causationId: null,
    tenantId: null,
    level: overrides.level ?? 'info',
    message: overrides.message ?? 'certification run recorded',
    fields: Object.freeze({}),
  };
}

export function auditSignal(overrides: {
  signalId?: string;
  sequence?: number;
  occurredAt?: number;
  sourceService?: string;
  correlationId?: CorrelationId;
  auditKind?: string;
} = {}): AuditSignal {
  const auditEvent = {
    recordVersion: 1,
    eventId: `audit-evt-${globalThis.crypto.randomUUID()}`,
    kind: (overrides.auditKind ?? 'policy-registered') as SecurityAuditEvent['kind'],
    tenantId: 'tenant-alpha',
    principalId: 'principal-1',
    action: 'register-policy',
    boundaryClass: null,
    outcome: { effect: 'recorded', reason: 'policy registered' },
    correlationId: overrides.correlationId ?? correlation(),
    causationId: null,
    occurredAt: '2026-10-01T00:00:00.000Z',
  } as SecurityAuditEvent;
  return {
    signalVersion: TELEMETRY_SIGNAL_VERSION,
    kind: 'audit',
    signalId: tid(overrides.signalId ?? `audit-${globalThis.crypto.randomUUID()}`),
    sequence: overrides.sequence ?? 1,
    occurredAt: ts(overrides.occurredAt ?? 1_000),
    sourceService: nid(overrides.sourceService ?? 'security-service'),
    correlationId: auditEvent.correlationId,
    causationId: null,
    tenantId: 'tenant-alpha',
    auditEvent,
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
  sliKind?: 'good-total-ratio' | 'latency-threshold-ratio' | 'log-error-ratio';
  thresholdMs?: number | null;
} = {}): SloDefinition {
  const sliKind = overrides.sliKind ?? 'good-total-ratio';
  return {
    definitionVersion: 1,
    sloId: tid(overrides.sloId ?? 'slo-job-completion'),
    name: 'Job completion ratio',
    service: nid(overrides.service ?? 'job-orchestrator'),
    sli: {
      kind: sliKind,
      metricName: nid(overrides.metricName ?? 'job-outcome-good'),
      thresholdMs:
        sliKind === 'latency-threshold-ratio'
          ? (overrides.thresholdMs !== undefined ? overrides.thresholdMs : 200)
          : null,
    },
    targetRatio: overrides.targetRatio ?? 0.99,
    windowMs: overrides.windowMs ?? 3_600_000,
    minSampleCount: overrides.minSampleCount ?? 10,
    atRiskThresholdRatio: overrides.atRiskThresholdRatio ?? 0.5,
    description: 'share of jobs that complete successfully',
  };
}

/** Deterministic evaluation window starting at 1_000_000. */
export function windowOf(windowMs = 3_600_000, start = 1_000_000): EvaluationWindow {
  return {
    windowStart: ts(start),
    windowEnd: ts(start + windowMs),
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

export function alertState(rule: AlertRule, now = 1_000): AlertRuleState {
  return initialAlertRuleState(rule.ruleId, now);
}

export function firingEvaluation(rule: AlertRule, at: number): AlertEvaluation {
  return {
    ruleId: rule.ruleId,
    severity: rule.severity,
    evaluatedAt: ts(at),
    conditionMet: true,
    state: 'firing',
    reason: { kind: 'condition-met', detail: 'test fixture' },
    stateChanged: true,
  };
}

export type { TelemetrySignal };

import type { ComponentHealth } from './health.js';
import type { HealthStatus } from './shared.js';

/** Deterministic component health fixture (branded fields cast). */
export function healthComponent(
  status: HealthStatus,
  name = 'job-orchestrator',
  checkedAt = 1_000,
): ComponentHealth {
  return {
    component: nid(name),
    status,
    detail: null,
    checkedAt: ts(checkedAt),
  };
}
