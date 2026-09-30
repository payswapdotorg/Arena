# SLO Targets and Error-Budget Policy

Arena service-level objectives (Work Order A035). Every target below is expressed as a `SloDefinition` record in `@arena/observability` and evaluated by `@arena/observability-service` over its rolling window. The error budget is DERIVED (`allowedBadRatio = 1 − targetRatio`) — never hand-set.

## Service SLO targets (v1)

| SLO id | Service | Indicator (SLI) | Target | Window | Min samples | At-risk burn |
|---|---|---|---|---|---|---|
| `slo-job-completion` | job-orchestrator | good-total-ratio over `job-outcome-good` counter (1 = succeeded job, 0 = failed) | 0.99 | 1h | 20 | ≥ 50% |
| `slo-job-latency` | job-orchestrator | latency-threshold-ratio over `job-duration-ms` (timer) ≤ 300,000 ms | 0.95 | 1h | 20 | ≥ 50% |
| `slo-environment-isolation` | environment-runner | good-total-ratio over `run-isolation-violation` (1 = clean, 0 = violation) | 1.00 | 24h | 10 | ≥ 25% |
| `slo-runner-lease` | environment-runner | good-total-ratio over `runner-lease-renewed` | 0.999 | 24h | 100 | ≥ 50% |
| `slo-certification-determinism` | certification-fabric | good-total-ratio over `certification-replay-identical` (1 = identical replay) | 1.00 | 24h | 10 | ≥ 25% |
| `slo-audit-chain-integrity` | security-service | good-total-ratio over `audit-chain-verified` (1 = chain intact) | 1.00 | 24h | 10 | ≥ 25% |
| `slo-console-availability` | console (A018) | good-total-ratio over `console-request-good` | 0.995 | 1h | 100 | ≥ 50% |
| `slo-observability-ingestion` | observability-service | good-total-ratio over `ingest-accepted` (1 = accepted, 0 = rejected) | 0.999 | 1h | 100 | ≥ 50% |

Rationale anchors: R33 (observability for jobs, environments and certification runs), R26/R27 (durable, idempotent, correlation-addressable jobs), R28 (audit trail integrity), A010 runner lifecycle signals, A018 console availability, and the A034 security-audit chain. A perfect-1.00 target means the error budget is zero: ANY bad event exhausts it — isolation violations, certification non-determinism and audit-chain breaks are never budgeted.

## Error-budget policy

1. **Budget derivation.** `allowedBadRatio = 1 − targetRatio`; `observedBadRatio = bad / total` over the window; `consumedRatio = observed / allowed` (capped at 1); `exhausted = consumed ≥ 1` (deterministic 1e-12 boundary tolerance).
2. **Verdicts.** `met` (budget burn below the at-risk threshold) → `at-risk` (burn ≥ threshold) → `breached` (achieved < target) → `no-data` (samples < min). No other verdicts exist.
3. **No-data fails closed.** A `no-data` verdict reports the budget as fully exhausted. `slo-no-data` alert rules trip on it. Missing telemetry is an incident, not a pass.
4. **Burn-rate alerting.** `slo-burn-rate` rules trip at budget-consumption thresholds: fast burn (≥ 50% of a 1h-window budget consumed) pages; slow burn (≥ 25% of a 24h-window budget) tickets.
5. **Freeze rule.** When a 24h-window SLO with a zero error budget (`slo-environment-isolation`, `slo-certification-determinism`, `slo-audit-chain-integrity`) reports `breached`, feature work on the affected service freezes until the verdict returns to `met` AND the postmortem action items land (see [runbook.md](./runbook.md)).
6. **Window discipline.** Windows are exact: the evaluator rejects samples outside `[windowStart, windowEnd]` (`OBS_SAMPLE_OUTSIDE_WINDOW`) and windows whose duration differs from the definition (`OBS_INVALID_WINDOW`). Operators never widen a window to make a breach disappear — that is a policy violation and the evaluator refuses it mechanically.
7. **Replays never count.** Ingestion is idempotent by command idempotency key and deduplicated by signal id; retried deliveries cannot inflate good totals.

## Registering these targets

```ts
import { ObservabilityService } from '@arena/observability-service';

service.registerSlo({
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
});
```

Every registration is validated fail-closed (`toSloDefinition`); malformed definitions never reach the evaluator.
