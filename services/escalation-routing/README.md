# @arena/escalation-routing-service

Arena escalation routing reference service (Work Order **C002**, issue #76).
Wires the `@arena/escalation-routing` capability-demand compiler + expert
routing engine to the **C001 routing seam** — it is the real RoutingPort
implementation that replaces C001's labelled round-robin stub.

Owned surface: `services/escalation-routing/*` (this package) +
`packages/escalation-routing/*` (the domain engine).

## Architecture

- **Injected ports only** (`ports.ts`): `Clock` (rule 17 — time is injected),
  `RoutingCandidateDirectory` (the A006/A007 expert read surface; hosts wire
  it — this service never imports another service, boundary rule B2),
  `CapabilityGraphSource` (A004), `RoutingDecisionLog` (append-only history
  persistence).
- **Structural RoutingPort implementation** — `route(request:
  EscalationRecord): Promise<RoutingDecision>` satisfies the C001 seam
  without importing `services/escalation-api` (B2). The port's closed
  no-match vocabulary is mirrored byte-equal and parity-checked at runtime.
- **Documented decision mapping** (service.ts): `matched` → matched;
  `blocked-by-coi`/`blocked-by-privacy`/`no-match` → `no-qualified-expert`;
  `budget-infeasible` → `budget-below-floor`; `locale-uncovered` →
  `locale-uncovered`; `deadline-infeasible` → `routing-unavailable`;
  compile failures and internal errors → `routing-unavailable`
  (fail-closed — never a silent match). The full verdict + per-candidate
  causes are preserved in the append-only decision history.
- **Durable routing jobs** (`jobs.ts`) over the A015 job-protocol submission
  identity (scope `escalation-routing-<tenant>` ⇒ tenant-isolated key
  spaces), bounded attempts, deterministic drain.
- **Reference fabric** (`fabric.ts`): in-memory decision log (digest-chained,
  chain-verified on read), job store, fixed clock, static sources.

## Qualification is data, never an access grant

The service records routing decisions; it grants nothing. A fully-qualified
expert that fails conflict-of-interest or privacy-clearance rules is BLOCKED
— tested adversarially (qualification-masquerading-as-an-access-grant,
cross-tenant candidate leakage, COI bypass).

## Tests

`pnpm run test` — service routing over injected ports, port-decision
mapping table, decision-history chaining, durable-job idempotency/drain,
structural C001 seam wiring (plug compatibility + reference lifecycle
drive), adversarial suites, hygiene.
