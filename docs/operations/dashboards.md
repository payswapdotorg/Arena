# Dashboard Specifications

Operational dashboard specs (Work Order A035). Each dashboard is a typed query over `@arena/observability-service` surfaces (never a direct database read — spec/service-boundaries.md). The A018 control-plane console (`apps/web/src/console`) renders operational state; these specs define WHAT it shows and WHERE the data comes from.

## D1 — Job Orchestration board

**Audience:** platform on-call. **Refresh:** 30s. **Source:** `queryTelemetry({ kind: 'metric' })` over `job-*` metrics + `evaluateSlo('slo-job-completion')` / `evaluateSlo('slo-job-latency')`.

- Headline: SLO verdict chips (`met` / `at-risk` / `breached` / `no-data`) with error-budget burn bars (`consumedRatio`, `remainingRatio`).
- Panels: `job-outcome-good` ratio over 1h; `job-duration-ms` p50/p95 histogram (derived from `timer` metric signals); queue depth (`job-queue-depth` gauge); retries and timeouts counters.
- Drill-down: per-`correlationId` signal list (metrics + logs + traces for one job's causal flow), reached from any panel point.

## D2 — Environment & Runner board

**Audience:** runtime on-call. **Refresh:** 30s. **Source:** runner lifecycle telemetry (A010 signals), `slo-environment-isolation`, `slo-runner-lease`.

- Isolation-violation count (must read zero — 1.00 target with zero budget); lease renewal ratio; run stream (`run-submitted` … `run-result-produced` mapped from trace spans).
- Component health strip for `environment-runner` (worst-of aggregation, `unknown` renders amber, never green).

## D3 — Certification board

**Audience:** certification owners. **Refresh:** 60s. **Source:** `certification-replay-identical` metrics, `slo-certification-determinism`.

- Determinism verdict chip; replay-diff log stream (log signals from `certification-fabric` at `warn`/`error`); suite version + pinned artifact digests from certification-run attributes.

## D4 — Security & Audit board

**Audience:** security on-call. **Refresh:** 30s. **Source:** `audit` telemetry signals (A034 integration — see [audit-integration.md](./audit-integration.md)), `slo-audit-chain-integrity`.

- Audit-event rate by kind (the closed A034 vocabulary); chain verification verdict (budget = zero); deny/allow decision ratio from `authorization-decision` audit events; latest `tenant-access-denied` / `data-rights-violation` events with correlation ids.

## D5 — SLO & error-budget board

**Audience:** engineering leadership. **Refresh:** 60s. **Source:** `evaluateSlo` across every registered SLO + `evaluateAlerts`.

- One row per SLO: target, achieved ratio, verdict, budget consumed/remaining, at-risk threshold marker.
- One row per alert rule: current state (`inactive`/`pending`/`firing`/`resolved`), severity, last reason kind, cooldown countdown.
- Footer: worst firing severity (`worstFiringSeverity`) — the paging signal.

## D6 — Observability self-monitoring

**Audience:** platform on-call. **Refresh:** 30s. **Source:** `slo-observability-ingestion`, ingestion acknowledgements.

- Accepted vs rejected ingestion commands (`ingest-accepted`), sequence-gap/duplicate rejection counts, replayed-command dedup hits, ack event latency.

## Wiring rules

1. Dashboards query ONLY the observability service's typed query surface (`queryTelemetry`, `evaluateSlo`, `evaluateAlerts`, envelope-wired query/response) — never another service's storage (service-boundary law).
2. Every panel renders the closed vocabularies verbatim (SLO verdicts, alert states, health statuses, audit kinds) — no string munging, no invented states.
3. `no-data` and `unknown` render as amber/red — never as healthy (fail-closed presentation).
4. Every drill-down preserves correlation ids in the URL (correlation-addressable operations).
