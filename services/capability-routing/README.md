# @arena/capability-routing-service

Arena capability-routing reference service (Work Order **C015**, issue
#121). Wires the `@arena/capability-routing` cross-resource compiler +
ResourceMatch engine to **injected catalog ports only** (boundary rule
B2 — no service-to-service imports):

- C002/C005 expert directory (RoutingCandidate views + performance-profile digests);
- C014 capability-body listings;
- C008 tool-gap / tool-specification records;
- C008 knowledge-tier lattice records;
- A032 marketplace offers + entitlement projections.

## What this service owns

1. **The capability-routing seam** (`service.ts`) —
   `routeCrossResource(demand, { demandId })` is the port the escalation
   flow (C001/C002) and observability (C021) consult. Rich engine
   verdicts map onto the closed seam vocabulary (matched components /
   no-capable-resource / budget-below-floor / class-not-allowed /
   routing-unavailable); the FULL ResourceMatch verdict and per-candidate
   causes are preserved in the append-only decision history.
2. **Fail-closed discipline** — under-specified / not-derivable demands
   never invent a match; a broken catalog port is a typed
   `catalog-unavailable` cause (never a silent empty pool); a broken
   graph source degrades to `routing-unavailable`.
3. **Durable idempotent routing jobs** (`jobs.ts`) — the A015
   job-protocol submission identity (`capability-routing-<tenant>` key
   space), closed status vocabulary, bounded attempts (3), deterministic
   drain.
4. **Reference fabric + structural-mirror adapters** (`fabric.ts`) —
   in-memory ports for tests/host wiring, plus plain-data adapters from
   C014 `CapabilityBodyListing`-shaped records, A032 offer/entitlement
   projections and C008 tool specifications into the validated candidate
   views. The mirror shapes are documented in the PR as architecture
   questions (hosts wire the real read surfaces through these ports).

## Wiring

```ts
const service = new CapabilityRoutingService({
  clock: new FixedClock(Date.now()),
  graphSource: new StaticGraphSource(graph),
  expertDirectory,   // C002/C005 host-wired
  bodyCatalog,       // C014 host-wired
  toolCatalog,       // C008 host-wired
  knowledgeCatalog,  // C008 host-wired
  artifactCatalog,   // A032 host-wired
  decisionLog,       // persistence adapter
  jobStore,          // persistence adapter
});
const result = await service.routeCrossResource(demand, { demandId });
```

Every catalog port's HOST CONTRACT: return only the demand tenant's or
the reserved global `public` scope candidates (lock rule 11). The engine
double-guards this — cross-tenant candidates are ELIMINATED
(adversarially tested against a deliberately leaky directory).
