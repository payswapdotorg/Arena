# @arena/marketplace-experts-fabric

The A031 **reference expert marketplace fabric** (Work Order A031; requirements
R31 "Support expert/task/body/evaluation commercial products", R32, R34, R48;
the marketplace/commercial-qualification stage feeding the README "Completion
target" chain's epoch-consumption end): the in-process pool + pure search
engine + command/query orchestration over the REAL sibling protocols —
@arena/expert-registry (A006 profiles), @arena/expert-qualification (A007
qualification evidence), @arena/certification (A023 records, as structural
views) and @arena/body-registry (A024 releases, as structural views).

Pure TypeScript, zero external runtime dependencies (only workspace packages).
No network, no database, no clock reads — every evaluation happens at the
REQUEST's fixed time (determinism anchor).

## Public surface

- **Records** (all content-addressed, deep-frozen, append-only):
  - `ExpertListing` + `ListingStatusRecord` (`listing.ts`) — commercial
    listings with a NON-EMPTY qualification-proof set and the closed
    DRAFT→LISTED→UNLISTED→DELISTED lifecycle (terminal finality);
  - `CommercialOffer` + `OfferStatusRecord` (`offer.ts`) — closed-kind
    commercial products with integer-minor-unit ISO-4217 rates over a closed
    unit vocabulary, notice/duration terms, typed availability, supersession
    lineage for re-pricing, terminal withdrawal;
  - `EngagementRecord` + `EngagementTransitionRecord` (`engagement.ts`) —
    tenant-scoped bookings with the closed
    REQUESTED→ACCEPTED→COMPLETED lifecycle (three terminal states);
  - `ReviewRecord` (`review.ts`) — completion-gated reviews with the closed
    1..5 rating vocabulary and DERIVED verdicts (positive|neutral|negative).
- **Gates** (fail-closed, never best-effort):
  - `verifyListingGate` — the A007 publication gate: published A006 profile
    (identity-matched, digest-verified), registered A007 card, and EVERY
    qualification proof resolved through the INJECTED expert-record store,
    A007-replay tamper-verified, `qualified` and IN FORCE at the publication
    time. Unqualified experts cannot publish listings;
  - `verifyOfferBackingGate` — the A024+A023 body-backed gate: a
    `body-backed-service` offer cites a release whose gate evidence cites
    certification records that must ALL resolve with `satisfied` verdicts.
- **`ExpertMarketplacePool`** (`pool.ts`) — the in-process registry:
  idempotent-by-digest registration, identity/supersession conflict
  discipline, tenant-violation detection, terminal-finality lifecycle
  enforcement, one-review-per-engagement, and statuses/aggregates that are
  RECOMPUTED from the append-only history (nothing is stored twice).
- **`ExpertMarketplaceEngine`** (`engine.ts`) — the deterministic pure
  search: tenant filter FIRST (rule 11), listed-only, closed filters
  (capability/domain/jurisdiction/max-rate/min-rating — fail-closed without
  reviews), deterministic sorts with digest tie-breaks.
- **`ExpertMarketplaceFabric`** (`fabric.ts`) — the command/query
  orchestration with Envelope<T> round trips and REQUIRED idempotency keys
  on commands (lock rule 17), the append-only event log and the
  observability dump.

## Boundary law compliance

The service resolves every cross-service record through INJECTED,
digest-addressed stores (`shared.ts`) — never another service's internals
(boundary rule B2). A023/A024 records are consumed as STRUCTURAL VIEWS
(the A007 shared.ts cross-protocol pattern; real records satisfy the views —
machine-checked by the `*SatisfiesView` type anchors). Commercial listing is
DATA, never authorization (lock rule 9).

## Testing

`pnpm test` — 57 tests: positive + negative/adversarial (unqualified listing
rejection, lapsed-evidence rejection, tamper detection, identity theft,
cross-tenant engagement/review denial, invalid offer terms, notice/duration
violations, terminal-finality probes, review gating, one-review discipline,
closed-vocabulary violations), hygiene (no clocks/randomness, no provider
names, no PII/authority vocabulary, no forbidden imports, frozen
vocabularies, fail-closed NULL stores) and property (deterministic digests,
engine determinism).

## Demo

`pnpm demo` (or `node main.mjs`) — a deterministic end-to-end scenario:
register the A006 profile + A007 evidence chain → publish the listing through
the REAL gate → record an offer → walk an engagement to completion → review
it → search the marketplace → negative probes.
