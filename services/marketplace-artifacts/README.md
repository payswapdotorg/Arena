# @arena/marketplace-artifacts-fabric

The dataset / evaluation-suite / environment marketplace for Arena
(Work Order **A032**; requirements R23/R24/R31 — publication, listing,
entitlement and usage records per `spec/service-boundaries.md`
§Marketplace/Billing).

## What this is

A **pure reference fabric + envelope-wired service** for the EPOCH
CONSUMPTION stage of the Arena loop: publication and consumption of
Arena artifacts (datasets, evaluation suites, environments) as
marketplace listings.

- `src/offers.ts` — versioned offer/license records with append-only
  lineage (registration / supersession / retirement, A024-style
  per-kind forbidden-field discipline, content-addressed digests);
- `src/gate.ts` — the listing admission gate: publication requires
  resolvable, tamper-verified, subject-matching **A002 provenance
  records** AND a **PASSING A013 verification statement** (outcome
  `pass` — the derived verdict, never caller-supplied). Gate verdicts
  are fail-closed structured values over a closed rejection vocabulary;
- `src/grants.ts` — access-grant records with A034 data-rights
  enforcement (`checkDataRightsForAction`) and closed license rules
  (redistribution / commercial-use / customer-data) over the A002
  RightsMetadata vocabulary;
- `src/reviews.ts` — review/rating records with closed vocabularies;
- `src/queries.ts` — the closed search/browse query vocabulary (every
  query carries a required read scope; cross-tenant reads fail closed);
- `src/fabric.ts` — the reference fabric: guard-validated idempotent
  ingest of authoritative A002/A009/A012/A013/A014 records through
  INJECTED digest-addressed evidence stores, and the four-step offer
  orchestration (gate → idempotency → identity binding → append);
- `src/service.ts` — the envelope-wired facade (command → event with
  the same correlation id; query → response; every failure normalized
  into the typed `MARKETPLACE_*` taxonomy).

## What this deliberately is NOT

- No HTTP layer, no filesystem, no database, no process state — the
  marketplace is an in-process reference fabric like the A013/A023/
  A024/A025 services. Deployment-tier persistence is out of scope for
  the A032 reference slice.
- The fabric NEVER writes another service's authoritative state; hosts
  ingest the owning packages' records through `put*` (read-model
  projection) and the gate resolves evidence through injected stores.
- No billing/usage accounting (A033 owns that); grants here record
  entitlement decisions only.

## Wire surface

Commands (`kind: 'command'`, REQUIRED idempotency key, schema namespace
`marketplace-artifacts`): `register-offer-command`,
`supersede-offer-command`, `retire-offer-command`,
`grant-access-command`, `revoke-grant-command`, `submit-review-command`.

Events (same correlation id, NULL idempotency key):
`offer-registered-event`, `offer-superseded-event`, `offer-retired-event`,
`access-granted-event`, `grant-revoked-event`, `review-submitted-event`.

Queries (`kind: 'query'`, NULL idempotency key): `list-offers`,
`get-offer`, `resolve-offer-status`, `search-offers`, `list-reviews`,
`get-grant`, `list-grants`.

## Battery

```bash
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
```
