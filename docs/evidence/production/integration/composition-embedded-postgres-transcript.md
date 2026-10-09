# P006 integrated acceptance — composition-embedded-postgres

- captured-at: 2026-10-09T10:41:22.540Z (fresh timestamp — no historical evidence rewritten)
- deployed-source-sha: 19fbcf775ba7038981dec74a18bbc776c22d80d9
- engine: embedded-postgres (evidence class AUTOMATED-TEST-ONLY)
- transport: public HTTP listener (node:http, ephemeral port) over the frozen host surface — (assigned at boot)
- truth-lens: customer (ADR-P001-02; recorded per observation, never blended)
- payment-posture: not exercised in this proof (see integrated-flow transcript)

## Observations

- composition.start: migrations 1,2,3,4,5 applied from zero; recovery={"nonTerminalJobs":0,"reclaimedLeases":0,"terminalJobsUntouched":0}
- listener: http://127.0.0.1:32979 (actual local URL)
- /healthz: 200 {"state":"started","ready":true,"capacity":"AVAILABLE","components":[{"component":"persistence","state":"ready","reasons
- POST /v1/escalations: 201 kind=escalation-created requestId=esc_e40752d3007144579b0239cde1b500d8
- GET /v1/escalations/{id}: 200 state=matching
- replay POST: 200 kind=escalation-replayed duplicate=true
- restart.start: migrationsApplied=0 (idempotent no-op); recovery={"nonTerminalJobs":0,"reclaimedLeases":0,"terminalJobsUntouched":0}
- post-restart GET: 200 state=matching (same durable record, no loss, no duplicate)
- post-restart replay: duplicate=true (deterministic recorded outcome)
- evidence-class: AUTOMATED-TEST-ONLY (embedded real PostgreSQL 17 — PGlite WASM)
