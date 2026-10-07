# @arena/escalation-routing

Arena escalation routing — the capability-demand compiler and expert routing
engine (Work Order **C002**, issue #76; `spec/expert-escalation-api.md` ES1.0
"Routing"; `spec/escalation-reference-flow.md` steps 1–3).

Owned surface: `packages/escalation-routing/*` (this package) and
`services/escalation-routing/*` (the reference service that wires this engine
into the C001 routing seam).

## What this package owns

1. **DemandProfile compiler** (`demand-profile.ts`) — compiles an escalation
   request's `capabilityNeed` (+ expert requirements, locale, jurisdictions,
   budget, deadline, privacy policy) into a versioned, content-addressed
   DemandProfile over the A004 capability graph. Typed CLOSED outcomes —
   never a bare boolean:
   - `compilable` — the profile (deterministic digest);
   - `under-specified` — closed reason list + the unresolved inputs;
   - `not-derivable` — the graph itself cannot answer.
2. **Routing engine** (`engine.ts`) — pure, deterministic routing over the
   ES1.0 routing inputs, as an EXPLICIT ordered filter pipeline:
   tenant scope → conflict-of-interest → privacy clearance → qualification →
   required tools → locale → jurisdiction → budget → availability/deadline;
   then deterministic ranking (historical task fit, demonstrated performance,
   exact-locale match, evidence depth, expert-id tie-break). The verdict is a
   content-addressed `RoutingVerdict` with the closed outcome vocabulary
   `matched / no-match / blocked-by-coi / blocked-by-privacy /
   budget-infeasible / deadline-infeasible / locale-uncovered` and
   per-candidate machine-readable elimination causes.
3. **RoutingCandidate** (`candidate.ts`) — the routing-side expert view
   (A006 registry + A007 qualification read data). **Qualification is DATA,
   INPUT to ranking — NEVER authorization** (architecture-lock rule 9).
4. **Decision history** (`history.ts`) — append-only, digest-chained routing
   decision records per escalation (supersession by append — the house
   pattern), with full chain verification.

## Invariants

- Pure TypeScript; runtime deps are `@arena/protocol-core` (canonical JSON +
  sha256 digests — never reimplemented), `@arena/capability-graph` (A004
  taxonomy queries) and `@arena/expert-qualification` (A007 view types).
- No service imports, no provider surface (lock rule 10), no clock reads —
  `evaluatedAt` is always injected (lock rule 17).
- Deterministic: identical inputs always produce identical digests,
  independent of candidate input order (property-tested).
- Fail-closed: every failure is a typed closed outcome or a typed
  `EscalationRoutingError`; there is no silent best-effort routing.

## Tests

`pnpm run test` inside this package runs the vitest suite: compiler
determinism + typed outcomes, engine filter order + COI/privacy/budget/
deadline blocks, ranking determinism, history chains/tamper detection,
property-style order-independence, and hygiene.
