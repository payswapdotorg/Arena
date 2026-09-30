# @arena/observability

Observability, operations and SLO core protocol (Work Order A035).

Typed telemetry (metrics, traces, logs, security audit events), SLO definitions with derived error budgets, alert rules with closed evaluation semantics, and health vocabularies — all riding `@arena/protocol-core`'s `Envelope<T>` discipline (correlation ids, idempotent commands, canonical-JSON digests).

## Law

- **Telemetry is protocol, not strings.** Every signal is a closed, frozen, strictly validated record carrying a REQUIRED correlation id, an optional causation id, and a 1-based sequence contiguous within its emitting source's stream (gaps, duplicates, regressions and replays are rejected — the A015 event-log discipline applied to telemetry).
- **Unknown fails closed.** Unknown signal kinds, unsupported wire versions, malformed audit events, unrecognized health statuses: rejected, never coerced.
- **Error budgets are derived, never hand-set.** `allowedBadRatio = 1 - targetRatio`; the evaluator reports consumed/remaining/exhausted against the observed window.
- **Windows are strict.** Samples outside the window are rejected (`OBS_SAMPLE_OUTSIDE_WINDOW`) — the evaluator never silently widens a window; window duration must equal the definition's `windowMs`.
- **No data fails closed.** Below `minSampleCount` the SLO verdict is `no-data` — never `met` — and the budget is reported exhausted.
- **Alerting is a closed state machine.** `inactive → pending → firing → resolved` with validated transitions; `pending` requires the condition to hold continuously for `forDurationMs`; a resolved rule cannot re-fire until `cooldownMs` elapses (flap protection, `OBS_ALERT_COOLDOWN_ACTIVE`).
- **Health aggregates worst-of, fail-closed.** Missing components contribute `unknown`; an empty report aggregates to `unknown` — "no news" is never "good news".
- **A034 integration.** `audit` signals wrap structurally valid `@arena/security` audit events — security audit is first-class telemetry.

## Contracts disclosure (A034 precedent)

A035 owns no `contracts/` surface. Schemas live in-package as SchemaRef data: `OBSERVABILITY_SCHEMAS` is the authority for the `observability` namespace (`arena:schema/observability/<name>@1.0.0`). No package-level contract generator ships, so the G9 governance drift check has no generated surface to assert here.

## Surfaces

- `telemetry.ts` — `TelemetrySignal` union (`metric`/`trace`/`log`/`audit`), `toTelemetrySignal`, per-source `TelemetryStream` append/verify
- `slo.ts` — `SloDefinition`, `evaluateSlo`, `SloEvaluation`, `ErrorBudget`
- `alerts.ts` — `AlertRule`, `evaluateAlertRule`, `alertStateAfter`, `AlertRuleState`
- `health.ts` — `ComponentHealth`, `aggregateHealth`, `HealthReport`
- `envelopes.ts` — `OBSERVABILITY_SCHEMAS`, ingest command / ingested event / SLO + alert query-response envelope constructors, parse/verify
- `errors.ts` — closed `OBS_*` taxonomy

## Reference service

`services/observability` (`@arena/observability-service`) is the envelope-wired reference fabric over this package: ingestion with idempotent acknowledgement, window queries, SLO evaluation and deterministic alert verdicts with persisted rule state.
