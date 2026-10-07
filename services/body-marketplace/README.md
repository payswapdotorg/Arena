# @arena/body-marketplace-service (Work Order C014)

Where the learning loop meets the marketplace (issue #120): on-demand
Agent Body pretraining from **rights-cleared, validated intervention
data**, and the **capability-body marketplace** that lists and publishes
the results.

## What this service owns

- **The pretraining pipeline** — a typed `PretrainingRequest` compiled
  from rights-cleared inputs: C009-validated intervention evidence (only
  `accepted` adjudications are admissible), C008 improvement candidates
  (body-improvement / tool-specification / knowledge) and customer
  commissions. Every input carries provenance, scope and rights
  metadata. Compilation has **typed closed outcomes**:
  `compilable` | `blocked` with reasons (`rights-insufficient`,
  `evidence-insufficient`). A blocked run is RECORDED — nothing trains.
- **The forge handoff** — a compilable run PROPOSES a **NEW immutable
  BodyVersion** through the A021 forge's public port
  (`@arena/body-forge`). A certified Body is never mutated (lock rule 5;
  AB1.0 Evolution law). Re-forging an existing version identity with
  different content fails CLOSED. The new version's lineage records its
  intervention-derived provenance end-to-end (the PretrainingRunRecord +
  the forge-record notes).
- **Certification posture** — the new version enters the A023 pipeline
  as a **certification candidate** (REAL `CertificationRecord` through
  `@arena/certification`). A listing's certification state is
  **record-backed only**: derived from resolvable A023 records about the
  EXACT body version (`satisfied` verdict + granted level + exact
  subject scope). Certification applies to the tested composition,
  never the base model (AB1.0).
- **The capability-body listing model** — typed listings over A024
  body-registry releases (`@arena/body-registry`): version,
  capability-evidence refs, certification state, provenance/lineage,
  license/rights metadata, substrate-compatibility profile and pricing
  as **explicit metadata**. Publication is an **explicit versioned
  transition with typed guard outcomes** (lock rule 12) — record-backed
  certification AND an explicitly published A024 release are both
  required. Lifecycle: `DRAFT → PUBLISHED → SUSPENDED/RETIRED` with
  reasons; history is append-only; every transition bumps the listing
  revision.
- **Commercial seams** — offer/grant records (`ListingGrantRecord`)
  following the A031/A032 marketplace house patterns through injected
  ports. Settlement vocabulary stays with the payments/economics
  surfaces (architecture question — no money truth invented here).
- **Fail-closed errors + envelope conventions** — the typed
  `BodyMarketplaceError` taxonomy; command/event/query envelopes per the
  house discipline (commands REQUIRE idempotency keys — lock rule 17).

## Seams (all injected; defaults are the in-process reference composition)

| Port | Seam | Default |
|---|---|---|
| `ValidatedEvidencePort` | C009 | resolves nothing (hosts wire accepted adjudications) |
| `ImprovementCandidatePort` | C008 | resolves nothing (hosts wire feed candidates) |
| `ForgePort` | A021 | REAL `forge()` compose core + idempotent record registry |
| `CertificationCandidatePort` | A023 | REAL `createCertificationRecord`/`createCertificationSuite` |
| `CertificationRecordStore` | A023 reads | the default port's own records |
| `BodyRegistryPort` | A024 | REAL `evaluateReleaseGate`/`publishRelease` + publication ledger |
| `Clock` | — | fixed epoch (time is injected, never a wall-clock read) |

Disclosed default-composition wiring: the A024 admission gate requires a
valid A022 compatibility verdict, so the reference fabric mints one
through the REAL `@arena/compatibility` package constructor
(`createCompatibilityRegistry().createAndRegister`). Hosts wire the real
compatibility surface (architecture question for the TL).

## Surface shape

```
src/
  shared.ts        closed-pattern guards, deepFreeze, strict shapes
  errors.ts        the typed fail-closed error taxonomy
  pretraining.ts   the request domain + typed compilation outcomes (PURE)
  ports.ts         the C008/C009/A021/A023/A024 seams + Clock
  fabric.ts        BodyMarketplaceService — the reference composition
  envelopes.ts     command/event/query wire conventions (lock rule 17)
  service.ts       the envelope-wired facade
  index.ts         the public surface barrel
```

## Commands

```bash
pnpm --filter @arena/body-marketplace-service typecheck
pnpm --filter @arena/body-marketplace-service lint
pnpm --filter @arena/body-marketplace-service test
pnpm --filter @arena/body-marketplace-service build
```

## CONTRACTS DISCLOSURE (C014)

This service owns NO `contracts/` surface. Its schemas live inside the
package as SchemaRef-referenced data (`BODY_MARKETPLACE_SCHEMAS`,
`envelopes.ts`), following the A021/A024 package precedent. No generator
ships, so governance G9 has nothing to drift-check here.
