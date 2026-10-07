# @arena/network-quality

Arena network quality — **Work Order C020 / issue #126** — the integrity
layer of the expert network: dimensional reputation, the dispute state
machine, the conflict-of-interest registry, and the anti-gaming/fraud
controls that detect sybils, vote abuse, brigading and payout anomalies
across the escalation, competition and payment surfaces. Spec anchors:
the C020 row of `spec/human-escalation-work-items.md`, the AE1.0 "Raw
community signal" guardrails (`spec/adversarial-expert-evaluation.md`),
FINAL-HANDOFF §7/§18, `spec/security.md` and `spec/quality-model.md`
("never a single global score"). There is no dedicated canonical
network-quality spec — semantics are derived from those sources; every
deviation is recorded as an architecture question in the PR.

## The proposal law (the one law everything else serves)

**Findings PROPOSE actions into the owning surfaces; nothing is silently
adjusted.** `silentlyAdjustReputation` and `silentlyDropEnforcementTarget`
have no happy paths (`NETWORK_QUALITY_SILENT_ADJUSTMENT_REJECTED`); a
score-shaped key in any free-form payload is rejected at construction.

## The no-single-global-score law (structural)

| Boundary | Enforcement |
|---|---|
| Record/log types | no score field exists; exact-field validation rejects smuggled keys; score-shaped proposal payload keys fail closed |
| Aggregates | the ONLY aggregate is `FamilyOutcomeAggregate` — typed, versioned, **single-family**, disclosing formula (`family-outcome-frequency`), sample sizes and MANDATORY limitation notes |
| No-happy-path markers | `buildNetworkQualityScore`, `consumeReputationAsGlobalScore`, `applyReputationWeights` always throw `NETWORK_QUALITY_GLOBAL_SCORE_REJECTED` |
| Wire | no score-shaped schema exists in `NETWORK_QUALITY_SCHEMAS`; cross-family queries are rejected at envelope construction |

## Dimensional reputation records

Five append-only, provenance-addressed record families per expert
(`spec/quality-model.md` Expert quality discipline applied to network
integrity): `dispute-outcome`, `competition-agreement` (C013),
`validation-outcome` (C009), `coi-record`, `conduct-flag`. Each record
carries the family's closed outcome vocabulary, applicability context,
sample size and dep-surface provenance ref (content digest). Reputation
evidence is DATA, never authorization and never correctness verification
(lock rules 9/35).

## The dispute state machine

`OPEN -> UNDER_REVIEW -> RESOLVED-with-typed-outcome` (+ `ESCALATED` /
`WITHDRAWN`). Disputes reference escalations, validation verdicts and
payment records through their owning surfaces' public refs; resolution is
a typed transition with machine-readable reasons; the audit history is
append-only and digest-committed. **Reviewer COI is structural**: a
reviewer party to the dispute can never be assigned
(`NETWORK_QUALITY_REVIEWER_COI_CONFLICT`).

## The COI registry + typed check read port

Declared + derived conflicts (tenant overlap, prior engagement,
marketplace interest). `checkConflictOfInterest` closes over the
tenant-scoped registry and returns exactly one of `clear` /
`conflicted-with-reasons` / `unknown-insufficient-data` — the honest
unknown, never a silent pass. A READ PORT for the C002/C009/C013 seams:
the registry never writes into routing or adjudication. Retraction is a
status transition; records stay auditable (`spec/security.md`).

## Anti-gaming + fraud controls

Typed findings (closed `FINDING_KINDS`) from C013 voting data
(self-voting attempts — both denied and post-admission seam bypasses,
duplicate-account/sybil vote inflation, coordinated-brigading patterns,
rate-limit breaches), C011-shaped engagement signals (capacity gaming),
C010 audit events (duplicate-payout attempts, payout velocity anomalies)
and identity signals (expert impersonation). Findings carry evidence refs
+ machine-readable reasons + typed proposals (`requalification-trigger`
to C004, `profile-evidence` to C005, `enforcement-action` to the C020
enforcement case machine). Enforcement (HOLD / SUSPEND / INVESTIGATE) is
an explicit state transition with append-only audit history.

## Ingestion

Pure closed mapping tables turn C009 adjudication outcomes and C013
competition outcomes into dimensional reputation records, and findings
into conduct-flag records. Profile evidence into the C005 profile and
requalification triggers travel as typed PROPOSALS (see AQ-1: C005's
closed evidence-source-family vocabulary needs a network-quality family
before these land in the real profile).

## Conventions

Pure TypeScript; only workspace dependency is `@arena/protocol-core`.
Typed `NetworkQualityError` taxonomy; envelope shapes in
`NETWORK_QUALITY_SCHEMAS`; tenant isolation at the domain level; injected
time (no hidden clocks). The reference service lives in
`services/network-quality`.
