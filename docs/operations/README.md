# Arena Operations

Operational content for the Arena platform (Work Order A035): SLO targets with error-budget policy, the alert catalog, dashboard specifications, the incident runbook, and the A034 security-audit integration guide.

The typed substrate behind these documents is `@arena/observability` (SLO definitions, alert rules with closed evaluation semantics, health vocabularies, telemetry protocol objects riding the A015 envelope discipline) and `@arena/observability-service` (the reference ingestion/query/evaluation fabric).

## Contents

| Document | Purpose |
|---|---|
| [slo-targets.md](./slo-targets.md) | SLO targets per service + the error-budget policy (burn rates, freeze rule, no-data fail-closed) |
| [alert-catalog.md](./alert-catalog.md) | The closed alert catalog: severities, conditions, cooldowns, runbook links |
| [dashboards.md](./dashboards.md) | Operational dashboard specifications (jobs, environments, certification, security/audit, SLO board) and their wiring into the A018 console |
| [runbook.md](./runbook.md) | Incident procedures: severity levels, diagnostic queries, escalation, postmortem discipline |
| [audit-integration.md](./audit-integration.md) | A034 integration: security audit events as first-class telemetry |

## Operating law

1. **Telemetry is protocol.** Metrics, traces, logs and audit events are typed, frozen, validated records — never free-form strings. Unknown kinds fail closed (`OBS_UNKNOWN_EVENT`).
2. **Every signal is correlation-addressable.** A REQUIRED correlation id plus an optional causation id ride every signal (A015 envelope discipline); every command carries an idempotency key, and replays never double-count.
3. **Error budgets are derived, not negotiated.** `allowedBad = 1 - target`; burn is measured, never estimated.
4. **No data is not good news.** Below `minSampleCount` the SLO verdict is `no-data` with the budget reported exhausted; alert evaluation treats this as a trip condition.
5. **Alerting is deterministic.** Identical inputs produce identical verdicts; state transitions are closed (`inactive → pending → firing → resolved`) and flap-protected by cooldowns.
