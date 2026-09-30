# Incident Runbook

Arena operational incident procedures (Work Order A035). The mechanical observability guarantees (deterministic alert verdicts, idempotent ingestion, fail-closed no-data handling, tamper-evident envelopes) do the detection; this runbook does the response.

## Severity levels

| Level | Meaning | Response |
|---|---|---|
| SEV-1 | A zero-budget SLO is breached (`slo-environment-isolation`, `slo-certification-determinism`, `slo-audit-chain-integrity`) or a critical alert fires | Page on-call now; freeze rule active; Tech Lead informed |
| SEV-2 | A budgeted SLO is breached or a high-severity alert fires | On-call acks within 15 min; ticket + mitigation |
| SEV-3 | `at-risk` burn, medium alerts (queue depth, log-error rate) | Business-hours triage |
| SEV-4 | `no-data` on a non-critical SLO, single degraded component | Queue with the next scheduled review |

## Universal first five minutes

1. **Read the alert payload — it is structured, trust it.** The `reason.kind` tells you the trip: `condition-met` (real threshold), `no-data-fail-closed` (telemetry gap, not necessarily a domain failure), `insufficient-input` (the rule was never wired — config bug), `cooldown-suppressed` (flap history).
2. **Pull the correlation id.** Every signal is correlation-addressable: `queryTelemetry({ correlationId })` returns the full metric/log/trace/audit flow for the incident's causal chain.
3. **Check ingestion health first** (`slo-observability-ingestion`, dashboard D6). A `no-data` verdict caused by broken ingestion is an observability incident, not a domain incident.
4. **Classify** using the sections below; when in doubt, escalate one level.

## §J — Jobs (orchestrator)

- **J1 budget exhausted (`rule-job-budget-exhausted`)**: pull the failed jobs via the correlation flow; check retry/timeout policy snapshots on the failing definitions; do NOT resubmit at scale (ingestion dedup will hide replays — fix the cause).
- **J2 fast burn (`rule-job-fast-burn`)**: identify the burst window (`evaluateSlo` verdicts over consecutive windows); correlate with deployment or task-compiler changes; if a rollback is indicated, it lands on the same correlation id.
- **J3 latency budget (`rule-job-latency-budget`)**: histogram tail analysis from `job-duration-ms` timer signals; check environment-runner lease panel (D2) for co-tenant contention.
- **J4 queue depth (`rule-queue-depth`)**: verify the orchestrator's retryDue/timeoutDue scans are progressing (their event envelopes timestamp the scans); scale workers, not retries.
- **N1 job no-data (`rule-job-no-data`)**: confirm the job-orchestrator's emitter sequence — a sequence GAP or DUPLICATE rejection at ingestion means an emitter bug (the store rejects out-of-order appends by design; the rejection IS the diagnostic).

## §E — Environments & runner

- **E1 isolation zero-budget (`rule-isolation-zero-budget`) — FREEZE RULE**: any isolation violation is SEV-1. Stop dispatching new runs to the affected runner class, preserve the run streams (`stream(sourceService)`), and do not resume until the postmortem lands. The freeze is mechanical policy (slo-targets.md §5).
- **E2 runner lease budget (`rule-runner-lease-budget`)**: expired leases surface as `unhealthy` component health; check the run-event monotonicity (timestamp regressions at ingestion indicate clock skew — a runner host problem).

## §C — Certification

- **C1 determinism zero-budget (`rule-cert-determinism-zero-budget`) — FREEZE RULE**: a non-identical certification replay invalidates the affected certification statement's reproducibility (R22). Quarantine the suite revision; re-run from the pinned artifacts; the diff log signals carry the divergent step.

## §S — Security & audit

- **S1 audit chain zero-budget (`rule-audit-chain-zero-budget`) — FREEZE RULE**: a broken audit chain is tamper evidence, not noise (A034). Preserve the chain snapshot, notify the Tech Lead AND security on-call; the audit signals' causation ids point at the commands around the break. Slow burn (`rule-audit-chain-slow-burn`) = page latency issues in the audit sink, investigate before it exhausts.

## §U — Console

- **U1 console budget (`rule-console-budget`)**: check control-plane request metrics; the A018 console degrades to read-only notice pages when availability < 0.995.

## §N — Observability itself

- **N2 ingestion budget (`rule-obs-ingestion-budget`)**: rejections mean malformed producer signals — find the offending source from the rejection's error code (`OBS_UNKNOWN_EVENT` = producer version skew; `OBS_SEQUENCE_*` = emitter ordering bug; `OBS_INVALID_AUDIT` = audit producer regression). Producers fix forward; the observability service never "tolerates" malformed telemetry.

## §L / §H — Logs & health

- **L1 log-error rate (`rule-log-error-rate`)**: read the error logs' `fields` (closed attribute maps); error-rate spikes on `certification-fabric` or `job-orchestrator` usually co-occur with J/C alerts — treat as confirmation, not a separate incident.
- **H1 health degraded/unhealthy (`rule-health-degraded`, `rule-health-unhealthy`)**: the aggregate is worst-of; the `ComponentHealth` list names the failing component. `unknown` (amber) means MISSING reports — check the component's emitter before assuming failure.

## Escalation

SEV-1 → page + Tech Lead immediately. SEV-2 unacked for 15 min → escalate to SEV-1. Any incident touching tenant data or the audit chain → security on-call is mandatory (A034 integration).

## Postmortems (the freeze-release gate)

1. Timeline reconstructed from signal streams (correlation ids + monotonic per-source sequences make the ordering authoritative).
2. Root cause with evidence (telemetry excerpts, not screenshots).
3. Corrective actions with owners and dates; regression signal(s) added to the alert catalog when a new trip condition is discovered.
4. The freeze (slo-targets.md §5) lifts only when the SLO verdict returns to `met` AND action items 1–3 are complete — the error budget, not a human, is the release authority.
