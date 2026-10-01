/**
 * The Arena v1 SLO catalog (DEP1.0 wiring to A035).
 *
 * This is the deployment-side copy of the A035 service-level objectives
 * published in `docs/operations/slo-targets.md` (Work Order A035). Health
 * gates in deployment topologies resolve their `sloId` against THIS
 * catalog — an unknown id is rejected fail-closed, and a gate whose
 * service does not match the SLO's owning service is rejected as a
 * wiring error.
 *
 * Documented deviation: the A035 doc expresses three targets as a
 * "perfect 1.00" (zero error budget). `SloDefinition` targets are
 * strict ratios in (0, 1) — a literal 1.0 is structurally invalid —
 * so the zero-budget intent is represented as 0.9999 with a 25%
 * at-risk threshold. The zero-tolerance SEMANTICS (any bad event is
 * an incident; the freeze rule) live in the ops rollback policy,
 * which triggers on ANY bad event for these SLOs.
 */

import type { SloDefinition } from '@arena/observability';
import { toSloDefinition } from '@arena/observability';

/** A035 target: 0.99 job completion over 1h, min 20 samples. */
const JOB_COMPLETION = {
  definitionVersion: 1,
  sloId: 'slo-job-completion',
  name: 'Job completion ratio',
  service: 'job-orchestrator',
  sli: { kind: 'good-total-ratio', metricName: 'job-outcome-good', thresholdMs: null },
  targetRatio: 0.99,
  windowMs: 3_600_000,
  minSampleCount: 20,
  atRiskThresholdRatio: 0.5,
  description: 'share of jobs that complete successfully',
} as const;

/** A035 target: 0.95 of jobs under 300s over 1h, min 20 samples. */
const JOB_LATENCY = {
  definitionVersion: 1,
  sloId: 'slo-job-latency',
  name: 'Job latency under 5 minutes',
  service: 'job-orchestrator',
  sli: { kind: 'latency-threshold-ratio', metricName: 'job-duration-ms', thresholdMs: 300_000 },
  targetRatio: 0.95,
  windowMs: 3_600_000,
  minSampleCount: 20,
  atRiskThresholdRatio: 0.5,
  description: 'share of jobs completing within 300000ms',
} as const;

/** A035 target: perfect isolation over 24h — zero error budget. */
const ENVIRONMENT_ISOLATION = {
  definitionVersion: 1,
  sloId: 'slo-environment-isolation',
  name: 'Environment isolation integrity',
  service: 'environment-runner',
  sli: { kind: 'good-total-ratio', metricName: 'run-isolation-violation', thresholdMs: null },
  targetRatio: 0.9999,
  windowMs: 86_400_000,
  minSampleCount: 10,
  atRiskThresholdRatio: 0.25,
  description: 'share of runs with zero isolation violations',
} as const;

/** A035 target: 0.999 runner-lease renewal over 24h. */
const RUNNER_LEASE = {
  definitionVersion: 1,
  sloId: 'slo-runner-lease',
  name: 'Runner lease renewal ratio',
  service: 'environment-runner',
  sli: { kind: 'good-total-ratio', metricName: 'runner-lease-renewed', thresholdMs: null },
  targetRatio: 0.999,
  windowMs: 86_400_000,
  minSampleCount: 100,
  atRiskThresholdRatio: 0.5,
  description: 'share of runner lease renewals that succeed on time',
} as const;

/** A035 target: perfect certification replay determinism over 24h. */
const CERTIFICATION_DETERMINISM = {
  definitionVersion: 1,
  sloId: 'slo-certification-determinism',
  name: 'Certification replay determinism',
  service: 'certification-fabric',
  sli: { kind: 'good-total-ratio', metricName: 'certification-replay-identical', thresholdMs: null },
  targetRatio: 0.9999,
  windowMs: 86_400_000,
  minSampleCount: 10,
  atRiskThresholdRatio: 0.25,
  description: 'share of certification replays that are identical',
} as const;

/** A035 target: perfect security audit chain integrity over 24h. */
const AUDIT_CHAIN_INTEGRITY = {
  definitionVersion: 1,
  sloId: 'slo-audit-chain-integrity',
  name: 'Security audit chain integrity',
  service: 'security-service',
  sli: { kind: 'good-total-ratio', metricName: 'audit-chain-verified', thresholdMs: null },
  targetRatio: 0.9999,
  windowMs: 86_400_000,
  minSampleCount: 10,
  atRiskThresholdRatio: 0.25,
  description: 'share of audit-chain verifications that pass',
} as const;

/** A035 target: 0.995 console availability over 1h, min 100 samples. */
const CONSOLE_AVAILABILITY = {
  definitionVersion: 1,
  sloId: 'slo-console-availability',
  name: 'Console availability ratio',
  service: 'console',
  sli: { kind: 'good-total-ratio', metricName: 'console-request-good', thresholdMs: null },
  targetRatio: 0.995,
  windowMs: 3_600_000,
  minSampleCount: 100,
  atRiskThresholdRatio: 0.5,
  description: 'share of console requests served successfully',
} as const;

/** A035 target: 0.999 telemetry ingestion acceptance over 1h. */
const OBSERVABILITY_INGESTION = {
  definitionVersion: 1,
  sloId: 'slo-observability-ingestion',
  name: 'Observability ingestion acceptance',
  service: 'observability-service',
  sli: { kind: 'good-total-ratio', metricName: 'ingest-accepted', thresholdMs: null },
  targetRatio: 0.999,
  windowMs: 3_600_000,
  minSampleCount: 100,
  atRiskThresholdRatio: 0.5,
  description: 'share of telemetry ingestions accepted',
} as const;

const RAW_CATALOG = [
  JOB_COMPLETION,
  JOB_LATENCY,
  ENVIRONMENT_ISOLATION,
  RUNNER_LEASE,
  CERTIFICATION_DETERMINISM,
  AUDIT_CHAIN_INTEGRITY,
  CONSOLE_AVAILABILITY,
  OBSERVABILITY_INGESTION,
] as const;

/**
 * The frozen A035 SLO catalog, typed as `SloDefinition` records.
 * Every entry is validated fail-closed through A035's own
 * `toSloDefinition` — a malformed copy cannot reach the gates.
 */
export const ARENA_V1_SLO_CATALOG: readonly SloDefinition[] = Object.freeze(
  RAW_CATALOG.map((raw) => toSloDefinition(raw)),
);

/** Slo ids owned by the catalog (closed set). */
export const ARENA_V1_SLO_IDS: readonly string[] = Object.freeze(
  ARENA_V1_SLO_CATALOG.map((slo) => slo.sloId),
);

/** Look up one SLO definition by id (null when unknown). */
export function findSlo(catalog: readonly SloDefinition[], sloId: string): SloDefinition | null {
  return catalog.find((slo) => slo.sloId === sloId) ?? null;
}
