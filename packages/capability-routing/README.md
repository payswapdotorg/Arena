# @arena/capability-routing

Arena capability routing — the cross-resource capability-demand compiler
and ResourceMatch composition engine (Work Order **C015**, issue #121;
`spec/human-escalation-work-items.md` C015 row; `spec/expert-escalation-api.md`
ES1.0 "Routing" generalized per resource class).

Owned surface: `packages/capability-routing/*` (this package) and
`services/capability-routing/*` (the reference service wiring the engine
to injected catalog ports).

## What this package owns

1. **CrossResourceDemand compiler** (`demand.ts`) — the resource-class-aware
   generalization of the C002 `DemandProfile` over the A004 capability
   graph. One demand view carries a typed facet per requested class
   (human expert / Agent Body / tool / scoped knowledge / marketplace
   artifact); the expert facet is **delegated to the C002 compiler**
   (compose, never fork — the embedded `DemandProfile` digest is committed
   to by this profile's digest). Typed CLOSED outcomes — never a bare
   boolean: `compilable` / `under-specified` (closed reason list +
   unresolved inputs) / `not-derivable` (graph-missing / graph-lookup-failed).
2. **Resolution policy** (`policy.ts`) — the versioned escalation-mode →
   resource-class mapping (`TOOL_GAP` → tool+artifact; `KNOWLEDGE` →
   knowledge; `SOLVE/CORRECT/UNBLOCK/REVIEW/TEACH` → expert+body;
   `EVALUATE` → artifact+expert — derived, architecture question in the
   PR). **No silent coercion**: a requested class no mode allows is typed
   `class-not-allowed`, never reinterpreted.
3. **Catalog candidate views** (`catalog.ts`) — the routing-side DATA
   views per class, structural mirrors of the merged read surfaces
   (C002 RoutingCandidate + C005 performance-profile digest; C014 listing
   state/substrate/pricing; C008 tool availability; C008 knowledge
   tier/scope/rights; A032 offer state + entitlement). Strict typed
   constructors, deep-frozen. Qualification and performance evidence
   are INPUT to ranking, NEVER access grants (lock rules 9/35).
4. **Matching engine** (`engine.ts`) — pure, deterministic per-class
   filter pipelines (the order is the contract), deterministic ranking,
   and **typed compositions** across classes: a multi-class demand is
   matched only when every requested class matched AND the combined
   component cost is within the budget cap — a budget-infeasible
   composition FAILS CLOSED (never an over-cap or partial match). Closed
   outcome vocabulary: `matched / no-match / blocked-by-coi /
   blocked-by-privacy / budget-infeasible / deadline-infeasible /
   incompatible-substrate / class-not-allowed`, with per-candidate
   machine-readable elimination causes (stale/delisted artifacts are
   excluded with reasons).
5. **Decision history** (`history.ts`) — the append-only, digest-chained
   per-demand routing decision log (supersession by append — the house
   pattern).

## Dependencies (consumed, never forked)

- `@arena/protocol-core` — canonical JSON + sha256 digests;
- `@arena/capability-graph` (A004) — the capability vocabulary the demand
  resolves over;
- `@arena/escalation-routing` (C002) — the expert-facet compiler and
  expert routing engine.

## The seam

`services/capability-routing` wires the engine to injected read ports
(C002 expert directory, C005 performance lens, C014 body listings, C008
tool-gap/knowledge records, A032 marketplace offers) with durable
idempotent routing jobs on the A015 fabric. C001/C002/C021 consume this
surface through that port — composition questions are recorded in the
PR, never edits into another surface.
