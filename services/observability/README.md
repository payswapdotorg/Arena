# @arena/observability-service

Reference observability service fabric (Work Order A035).

A deterministic in-process service over `@arena/observability` with pluggable persistence — the job-orchestrator fabric precedent: pure decisions in the engine, ALL effects through injected ports (`Clock`, `TelemetryStore`, `AlertStateStore`, `EventSink`). Zero external infrastructure, zero new runtime dependencies.

## Law

- **Ingestion is envelope-wired and idempotent.** Signals enter through `ingest-telemetry-command` envelopes (idempotency key REQUIRED); replaying the same command re-acknowledges with the SAME event envelope and never double-appends — SLO math never counts replays.
- **The store owns the stream discipline.** Per-source sequence contiguity, timestamp monotonicity and signal-id dedup are enforced at the persistence port (fail-closed `OBS_*` errors), never trusted from callers.
- **SLO evaluation rides the window fabric.** `evaluateSlo(sloId, windowEnd)` pulls the indicator's samples from the store, sorts them, and delegates to the pure package evaluator. Unknown ids fail closed; windows that would start before the epoch are rejected.
- **Alert verdicts are deterministic and persisted.** `evaluateAlerts(now)` evaluates every registered rule against fresh SLO evaluations / latest metrics / log-error ratio / reported health, advances the closed state machine (`inactive → pending → firing → resolved`) through the `AlertStateStore`, and enforces cooldown flap protection.
- **Queries are correlation-addressable.** `queryTelemetry({ correlationId, kind, from, to })`; `evaluateSloQuery` / `evaluateAlertsQuery` parse query envelopes and answer with response envelopes carrying the same correlation id.

## Surfaces

- `service.ts` — `ObservabilityService`: ingestion, queries, SLO evaluation, alert evaluation, health reporting, closed registries
- `ports.ts` — `Clock`, `TelemetryStore`, `AlertStateStore`, `EventSink`
- `in-memory.ts` — `ManualClock`, `SystemClock`, `InMemoryTelemetryStore`, `InMemoryAlertStateStore`

## Operations content

See `docs/operations/` for the runbook, SLO targets + error-budget policy, alert catalog, dashboard specs and the A034 security-audit integration guide.
