# P006 integrated acceptance — resilience-matrix

- captured-at: 2026-10-09T12:46:54.545Z (fresh timestamp — no historical evidence rewritten)
- deployed-source-sha: c207d01db003e80ff90101a5ed6d6431572ce390
- engine: embedded-postgres (evidence class AUTOMATED-TEST-ONLY)
- transport: public HTTP listener (node:http, ephemeral port) over the frozen host surface; arena-side operator handles drive the ARENA side only — http://127.0.0.1:40169
- truth-lens: customer (ADR-P001-02; recorded per observation, never blended)
- payment-posture: DEMO provider (executesCustomerMoney=false) — CI moves NO real money

## Observations

- concurrency-distinct-keys: 8 parallel submissions → 8×201, 8 distinct durable requestIds (no cross-talk)
- concurrency-same-key-race: 5 parallel identical submissions → 1×201 created + 4 successful replays/conflicts + 0 typed fail-closed conflicts (F-08 distribution); exactly ONE durable record; double-act unreachable — the C001 idempotency law's exactly-once invariant under contention
- timeout-post-deadline-denial: advance('offered') past deadline → typed denial EscalationError: transition offered -> offered denied (transition_deadline_passed) on escalation esc_d3b88779c0bf47e481631398f3475155 (only the explicit timeout state is reachable)
- timeout-sweep+public-observation: sweepTimeouts() → timed_out; public poll → state=timed_out (typed, explicit — never an invented match)
- cross-tenant-isolation: tenant-beta client → tenant-gamma record poll → typed failure (fail-closed, no existence leak)
- recovery-hard-restart: hard restart at state=offered (post-offer, pre-session) — fresh host + listener over the SAME durable transport
- recovery-flow-completes: post-restart drive → public poll state=closed result=unblock (outage window crossed without loss)
- evidence-class: AUTOMATED-TEST-ONLY (engine embedded-postgres)
