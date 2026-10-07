# @arena/network-quality-service

Arena network-quality reference service — **Work Order C020 / issue
#126** — dispute intake/resolution, COI registration/checks and the
anti-gaming + fraud detection jobs over `@arena/network-quality`, on the
house service-fabric conventions (injected ports, deterministic clocks,
fail-closed errors, envelope events, REQUIRED idempotency keys).

## Seams (injected ports — never dep writes)

| Port | Seam | Consumes |
|---|---|---|
| `ValidationOutcomeSourcePort` | THE C009 SEAM | adjudication outcomes (provenance-verified ingestion) |
| `VotingSourcePort` | THE C013 SEAM | competition voting data (participants, submissions, judgments, denied attempts, outcomes) |
| `PayoutAuditSourcePort` | THE C010 SEAM | payment audit events (fraud detection) |
| `IdentitySignalSourcePort` | registry seam | impersonation signals |
| `EngagementSignalSourcePort` | THE C011 SEAM | capacity-gaming signals |
| `ProfileEvidenceProposalSink` | THE C005 PROPOSAL SEAM | profile-evidence proposals (AQ-1) |
| `RequalificationProposalSink` | THE C004 PROPOSAL SEAM | requalification-trigger proposals |

## Command surface (idempotency key REQUIRED — lock rule 17)

- `openDispute` / `transitionDispute` / `getDispute` — the dispute state
  machine with reviewer-COI exclusion and digest re-verification of
  stored entries;
- `registerCoi` / `retractCoi` / `checkCoi` — the COI registry + the
  typed check read port (`clear` / `conflicted-with-reasons` /
  `unknown-insufficient-data`);
- `ingestValidationOutcome` / `ingestCompetitionOutcomes` —
  provenance-verified dimensional reputation ingestion (fabricated or
  cross-tenant provenance fails closed; the same source digest cannot
  book twice);
- `runAntiGamingDetection` / `runCapacityGamingDetection` /
  `runFraudDetection` — idempotent detection jobs (per tenant + scope):
  typed findings, finding-recorded events, conduct-flag reputation
  evidence, requalification + enforcement proposals (the capacity-gaming
  job consumes the C011 engagement seam; a cross-tenant signal leak fails
  closed);
- `openEnforcement` / `transitionEnforcement` — explicit HOLD / SUSPEND /
  INVESTIGATE state transitions with append-only audit history;
- `getReputationFamily` / `listFindings` — tenant-scoped reads.

## Fail-closed laws

Cross-tenant reads fail closed (`NETWORK_QUALITY_NOT_FOUND`); tampered
store entries fail closed on digest re-verification
(`NETWORK_QUALITY_TAMPERED`); idempotency keys bound to different
commands fail closed (`NETWORK_QUALITY_IDEMPOTENCY_CONFLICT`). The
service exposes no score or adjustment surface anywhere — findings
PROPOSE into the owning surfaces; nothing is silently adjusted.

## The reference fabric

`createNetworkQualityFabric(at)` assembles the fixed clock, the
tenant-scoped in-memory stores, the capturing proposal sinks, the event
sink and the dep-seam fakes. Hosts swap the fabric for real persistence
(adapters, never here).
