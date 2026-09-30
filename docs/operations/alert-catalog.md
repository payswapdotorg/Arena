# Alert Catalog

The closed alert-rule catalog (Work Order A035). Every rule is an `AlertRule` record evaluated by `@arena/observability`'s deterministic engine — closed condition kinds, closed state machine (`inactive → pending → firing → resolved`), `forDurationMs` sustainment and `cooldownMs` flap protection. Free-form alert expressions do not exist.

## Condition kinds (closed vocabulary)

| Condition | Semantics | Required params |
|---|---|---|
| `slo-error-budget-exhausted` | fires when the referenced SLO's budget is exhausted | `sloId` |
| `slo-burn-rate` | fires when budget consumption ≥ threshold | `sloId`, `threshold > 0` |
| `slo-no-data` | fires when the SLO verdict is `no-data` (fail-closed) | `sloId` |
| `metric-above-threshold` / `metric-below-threshold` | latest metric value beyond threshold | `metricName`, `threshold` |
| `log-error-ratio` | error-level share of the log stream ≥ threshold over the 5-minute window | `threshold ∈ (0,1)` |
| `health-status-degraded` | aggregate health at or beyond the trip level | `healthStatus` |

## Catalog

| Rule id | Condition | Severity | Sustain | Cooldown | Runbook |
|---|---|---|---|---|---|
| `rule-job-budget-exhausted` | `slo-error-budget-exhausted` on `slo-job-completion` | critical | 0 ms | 5 min | [runbook §J1](./runbook.md) |
| `rule-job-fast-burn` | `slo-burn-rate` ≥ 0.5 on `slo-job-completion` | high | 5 min | 10 min | [runbook §J2](./runbook.md) |
| `rule-job-no-data` | `slo-no-data` on `slo-job-completion` | high | 0 ms | 5 min | [runbook §N1](./runbook.md) |
| `rule-job-latency-budget` | `slo-error-budget-exhausted` on `slo-job-latency` | high | 10 min | 10 min | [runbook §J3](./runbook.md) |
| `rule-isolation-zero-budget` | `slo-error-budget-exhausted` on `slo-environment-isolation` | critical | 0 ms | 30 min | [runbook §E1](./runbook.md) (freeze rule) |
| `rule-runner-lease-budget` | `slo-error-budget-exhausted` on `slo-runner-lease` | critical | 0 ms | 5 min | [runbook §E2](./runbook.md) |
| `rule-cert-determinism-zero-budget` | `slo-error-budget-exhausted` on `slo-certification-determinism` | critical | 0 ms | 30 min | [runbook §C1](./runbook.md) (freeze rule) |
| `rule-audit-chain-zero-budget` | `slo-error-budget-exhausted` on `slo-audit-chain-integrity` | critical | 0 ms | 30 min | [runbook §S1](./runbook.md) (freeze rule) |
| `rule-audit-chain-slow-burn` | `slo-burn-rate` ≥ 0.25 on `slo-audit-chain-integrity` | high | 15 min | 30 min | [runbook §S1](./runbook.md) |
| `rule-console-budget` | `slo-error-budget-exhausted` on `slo-console-availability` | high | 5 min | 10 min | [runbook §U1](./runbook.md) |
| `rule-obs-ingestion-budget` | `slo-error-budget-exhausted` on `slo-observability-ingestion` | critical | 0 ms | 5 min | [runbook §N2](./runbook.md) |
| `rule-queue-depth` | `metric-above-threshold` on `job-queue-depth` > 10,000 | medium | 10 min | 10 min | [runbook §J4](./runbook.md) |
| `rule-log-error-rate` | `log-error-ratio` ≥ 0.05 (any service, 5-min window) | medium | 5 min | 10 min | [runbook §L1](./runbook.md) |
| `rule-health-degraded` | `health-status-degraded` at trip level `degraded` | high | 0 ms | 5 min | [runbook §H1](./runbook.md) |
| `rule-health-unhealthy` | `health-status-degraded` at trip level `unhealthy` | critical | 0 ms | 5 min | [runbook §H1](./runbook.md) |

## Evaluation semantics (mechanical guarantees)

- **Determinism.** Identical (rule, prior state, now, inputs) → identical verdict. No randomness, no wall-clock reads (time is injected).
- **Sustainment.** `forDurationMs > 0` requires the condition to hold continuously before firing; a broken streak demotes `pending → inactive`.
- **Flap protection.** After `firing → resolved`, re-firing is suppressed until `cooldownMs` elapses (`OBS_ALERT_COOLDOWN_ACTIVE` semantics; surfaced as reason `cooldown-suppressed`).
- **Fail-closed inputs.** Missing SLO evaluations, metric values, log ratios or health reports surface as `slo-not-registered` / `insufficient-input` reasons and NEVER fire — but `no-data` SLO verdicts themselves trip `slo-no-data` rules.
- **Severity rollup.** `worstFiringSeverity` reports the most severe firing rule (low < medium < high < critical) for paging decisions.
