# Arena Architecture-Question Register — P001 (issue #153)

**Work order:** P001 — architecture-question closure and host-boundary decisions.
**Base SHA:** `5067356` (live main, 2026-10-09). **Author:** Worker P001 (Task subagent).
**Status:** ADRs Proposed — they bind downstream dispatch only after TL harvest/merge.

## Sources and method

1. Every architecture-question section of C-series PR bodies **#129–#150** (fetched verbatim
   from the GitHub API at dispatch time; 83 numbered questions total — 4+3+6+3+3+5+4+4+5+3+3+4+3+3+4+3+3+5+4+2+4+5).
2. The C-series harvest record in `spec/PROJECT-STATE.md` (its per-WO "Open (recorded)" lines).
3. The material-limitations list in `docs/LLM-ARCHITECT-FINAL-HANDOFF.md` §1 (11 items).
4. The live app route tree (`apps/web/src/app/**` page files) cross-referenced with the
   web feature modules (`apps/web/src/*`) for the unmounted/unintegrated surface derivation.

Register rows are numbered `R-001…R-084` (PR questions plus one limitation-sourced row),
`L-001…L-011` (material limitations) and `S-01…S-03` (the three unmounted/unintegrated web
feature surfaces). Questions are condensed faithfully; the PR bodies remain the verbatim record.

### Status vocabulary

| Status | Meaning |
|---|---|
| **RESOLVED-ADR** | Blocking semantic question closed by an ADR in `docs/decisions/post-roadmap/` (Proposed until merge) |
| **RESOLVED-BY-PRECEDENT** | Already settled by merged sibling work orders / spec text; recorded here to prevent silent normalization |
| **ACCEPTED POSTURE** | Current recorded behavior is confirmed as intended; no change |
| **FOLLOW-UP** | Explicit non-blocking follow-up with owner (TL backlog or P-series WO) |
| **BLOCKED-COMMERCIAL** | Blocked pending a release-owner decision; gates commercial claims only (P008 hard gate) |

### Summary counts

| Bucket | Count |
|---|---|
| PR-body architecture questions inventoried (R-001…R-083) | 83 |
| Limitation-sourced register rows (R-084 C022 web-surface disclosure; S-02 body-marketplace mount gap) | 2 |
| Material limitations inventoried (L-001…L-011) | 11 |
| Unmounted/unintegrated web feature surfaces named (S-01…S-03) | 3 |
| Register rows with RESOLVED-ADR status (13 direct blocking rows in Part 1 + 6 rows resolved via an ADR's consequences) | 19 |
| BLOCKED-COMMERCIAL (release-owner decision, P008 hard gate) | 1 |
| RESOLVED-BY-PRECEDENT | 10 |
| ACCEPTED POSTURE | 22 |
| FOLLOW-UP (TL backlog) | 11 |
| FOLLOW-UP (P-series WO detail) | 22 |
| Total register rows (R + S-02) | 85 |
| **Every recorded question has a decision or an explicit non-blocking follow-up** | ✅ |

ADR list (one-line decisions):

- **ADR-P001-01** — one shared durable job runner at the host boundary over `@arena/job-protocol` + `services/job-orchestrator`; no per-service private job persistence.
- **ADR-P001-02** — the explicit Demo/customer truth lens is the canonical read-model convention for every service query surface.
- **ADR-P001-03** — C022 gated proposal envelopes keep full program lineage in v1; host-side A021/A022/A023 sink adapters accept and record them.
- **ADR-P001-04** — the fourth SLA clock (validate-by) stays a C021 measurement definition with the derived default; C011's three-clock `SlaPolicy` contract is unchanged; `DEFAULT_SMALL_SAMPLE_MIN = 5` ratified as the platform default.
- **ADR-P001-05** — the longitudinal expert-performance read surface remains C005's own; escalation-observability adds no C005 projection; C021's declared-but-unconsumed C005 dependency is recorded as an accepted over-declaration.
- **ADR-P001-06** — learning-candidate projection for C008/C009/C013/C014 outputs is host-side under P002 (`services/runtime-host`); producer-package first-party projector exports are deferred.
- **ADR-P001-07** — host/provider responsibility split: the host owns composition/persistence/jobs/transport/secrets/tenant policy/fail-closed capacity; providers own only primitives behind `adapters/hosted/*`.
- **ADR-P001-08** — public HTTP/MCP/webhook lifecycle bound to existing C001/ES1.0 + developer-platform contracts: scoped API-key auth, idempotent submission replay with typed conflict, at-least-once signed webhooks deduped per event id, shared error taxonomy, no Epoch-specific API.
- **ADR-P001-09** — the exact three unmounted/unintegrated web feature surfaces are named (competitions; body-marketplace; developer-portal interactive write actions); their route/nested/non-UI disposition is delegated to P005's route inventory.

---

## Part 1 — Blocking questions resolved by ADRs

| ID | Source | Question | ADR |
|---|---|---|---|
| R-073 | PR #148 (C016) Q1 | Should durable recompute jobs move to a shared job runner instead of per-service persistence? | ADR-P001-01 |
| R-074 | PR #148 (C016) Q2 | Is the EXPLICIT demo-vs-customer truth lens the canonical pattern for other read-model services? | ADR-P001-02 |
| R-075 | PR #149 (C022) Q1 | Should A021/A022/A023 proposal envelopes carry full program lineage or a digest reference? | ADR-P001-03 |
| R-076 | PR #149 (C022) Q2 | Should each source package export a first-party projector for learning candidates? | ADR-P001-06 |
| R-079 | PR #150 (C021) Q1 | Fourth SLA clock: C011 policy concern or C021 measurement definition? | ADR-P001-04 |
| R-080 | PR #150 (C021) Q2 | Ratify `DEFAULT_SMALL_SAMPLE_MIN = 5` as platform default or make it tenant-configurable? | ADR-P001-04 |
| R-081 | PR #150 (C021) Q3 | Is a longitudinal expert-performance projection expected inside escalation-ops, or does it remain C005's read surface? | ADR-P001-05 |
| R-082 | PR #150 (C021) Q4 | Projection feeding: event-fed vs scheduler-driven? | ADR-P001-01 |
| R-028 | PR #135 (C017) Q4 | Interactive portal writes (key issue/rotate/revoke, sandbox runs) need server actions/API routes with CSRF/idempotency posture. | ADR-P001-09 |
| R-054 | PR #143 (C013) Q1 | Who mounts `/competitions` in `apps/web/src/app/**`? | ADR-P001-09 |
| S-02  | PR #144 (C014) limitation + PROJECT-STATE C014 harvest | No app-router route mounts for the body-marketplace web feature. | ADR-P001-09 |
| R-003 | PR #129 (C001) Q3 | HTTP listener ownership: composition root vs adapter binding. | ADR-P001-07/08 |
| R-032 | PR #136 (C019) Q4 | Webhook dedupe discipline (per event id, not per type). | ADR-P001-08 |

Host/provider responsibility split and public transport lifecycle (work-items explicit
topics with no single numbered PR question) are closed by **ADR-P001-07** and
**ADR-P001-08** respectively, grounded in PR #129 Q3, PR #136 Q4, the C010 provider-posture
disclosure (R-008) and the FINAL-HANDOFF §1 limitations L-01…L-05.

---

## Part 2 — Per-PR question inventory (R-001…R-084)

Columns: **Q** (question, condensed) · **Options** · **Seams/contracts** · **Risk** ·
**Decision / owner** · **Status**.

### PR #129 — C001 expert escalation API (4 questions)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-001 | RoutingPort contract shape (`route() → matched/no-match`, closed reasons) | as-is; widen (ranked candidates, hold-for-quote) | `services/escalation-api/src/ports.ts`; C002/C015 consumers | vocabulary drift if widened post-hoc | As-is confirmed — C002 (merged) implements it; C015 delegates its expert facet to C002. Owner: TL | RESOLVED-BY-PRECEDENT |
| R-002 | `services/escalation-api` dev-depends on `@arena/escalation-adapters` (B4 downward edge) vs relocating wiring tests to `apps/web` | keep devDep; relocate tests | boundary B4; wiring tests | layering violation if reversed | Keep devDep (B4-approved, parity-tested). Owner: TL/boundary | ACCEPTED POSTURE |
| R-003 | HTTP listener ownership | C017 composition root mounts transport; `adapters/escalation` HTTP binding first; dedicated host | ES1.0 public surface; `apps/api`; `services/escalation-api/src/http-host`,`mcp-host` | wrong owner fragments transport authority | P002 owns the composition root; P003 owns the real HTTP/MCP/webhook transport; C017 portal stays a web client. ADR-P001-07/08 | RESOLVED-ADR |
| R-004 | A007 qualified-expert read surface (`listQualifiedExperts`); qualification ≠ authorization | confirm projection; change shape | A007 registry read; C002/C005 | qualification-as-authorization leak | Confirmed — qualification records candidates, grants nothing (adversarially tested in C015). Owner: TL | RESOLVED-BY-PRECEDENT |

### PR #130 — C002 capability-demand compiler and routing (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-005 | Hoist `RoutingPort`/`RoutingDecision` to a package (nominal vs mirrored seam) | hoist to `packages/escalation`; keep structural mirrors; new ports package | B2 (services never import services); C001/C015 mirrors | drift between mirrors | Keep structural mirrors pinned by parity tests for P-series v1 (no P-WO owns `packages/escalation` edits); hoisting is a TL-scheduled refactor. Owner: TL | FOLLOW-UP (TL backlog) |
| R-006 | No dedicated COI/privacy no-match reason — compress to `no-qualified-expert`? | compress; extend vocabulary (breaking) | `ROUTING_NO_MATCH_REASONS` closed list; C020 COI registry | silent semantic loss of COI evidence | Compress (closed 4-reason list stands); the C002 decision record carries the COI evidence via C020's registry. Extension requires a versioned vocabulary bump. Owner: TL | ACCEPTED POSTURE |
| R-007 | Swap the reference fabric's default RoutingPort to the C002 service at a TL-owned commit? | swap + keep labelled stub fallback; keep stub default | escalation-api fabric; C002 service | demo determinism break | P002 host wiring composes the real routing service; the labelled stub remains the explicit zero-dependency fallback. ADR-P001-07 | RESOLVED-ADR |

### PR #131 — C010 payments (6)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-008 | Provider posture: merchant-of-record, payout rails, tax, jurisdiction (blocking customer money) | decide now; defer to release owner | `PROVIDER_POSTURE_OPEN_QUESTIONS`; `DEMO_PROVIDER_POSTURE`; C010 commercial truth | unlawful money movement if unresolved | Deferred to the release owner under the P008 hard gate (`spec/post-roadmap-release-gate.md` commercial boundary). No customer-truth label may be issued before it. Owner: release owner (P008) | BLOCKED-COMMERCIAL |
| R-009 | `paid` lifecycle transition: payment-event-driven vs independent C001 transition observed by payments | payments→lifecycle write; observed-only; host-mediated command | C001 lifecycle; `escalation.payment.updated`; C010 ledger | split-brain money/lifecycle truth | C001 keeps transition authority; the P002 host mediates payment completion into an authorized lifecycle command (observed event → command bridge, never a direct cross-service write). Owner: P002 | FOLLOW-UP (P002 detail) |
| R-010 | Duplicate replay asymmetry (derived-amount ops replay from recorded entry; hold/offer/acceptance replay naturally) | accept; unify | C010 ledger idempotency; digest verification | subtle replay divergence | Accepted (asymmetry disclosed; digest-verified replay from recorded entries). Owner: TL | ACCEPTED POSTURE |
| R-011 | Dispute persistence: ledger audit stream vs own store port | audit stream; dedicated port; C020 dispute machine | C010 refund audit; C020 disputes | dispute truth fragmentation | Keep explicit in-service states + refund-path audit; C020 (merged) owns the dispute state machine; P002 persists both through the shared store adapter. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-012 | Fee-schedule governance (10% default) | TL-governed versioned config; tenant self-serve; A033 adjacency | C010 fee schedule versioning | silent fee drift | Versioned reference data owned by the payments domain; operational changes are TL-governed config, not tenant-self-serve in P-series v1. Owner: TL | ACCEPTED POSTURE |
| R-013 | Zero-budget escalation opens no ledger (typed refusal) | confirm; change | C010 ledger; free-tier contract | hidden paid fallback | Confirmed — matches the free-tier/demo fail-closed posture (G002 evidence class). Owner: TL | ACCEPTED POSTURE |

### PR #132 — C006 expert session capsule (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-014 | A015 durability seam for `SessionStore`/`EscalationSessionPort`: dedicated adapter package vs host composition | `adapters/expert-session-persistence`; host composition onto B002 persistence | C006 session ports; A015; B002 adapters | duplicate persistence paths | Host composition under P002 (existing ports suffice; no new adapter package). Owner: P002 | FOLLOW-UP (P002 detail) |
| R-015 | A010 execution boundary: runner-backed session environment vs host-side | service-executed; host-side | C006 capsule view; A010 runner | capsule becomes a live-world write path | Stays host-side — P002 composes the environment runner; the capsule view derivation is unchanged (lock rule 28). Owner: P002 | FOLLOW-UP (P002 detail) |
| R-016 | Centralize mode↔permittedActions mapping tables (duplicated in service fabric and adapter) | centralize now; on next vocabulary extension | `PERMITTED_ACTION_TO_SESSION_ACTION`; C001 vocabulary | mapping drift | Centralize when C001's permitted-action vocabulary next extends; duplicates are parity-tested until then. Owner: TL | FOLLOW-UP (TL backlog) |

### PR #133 — C007 intervention modes (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-017 | `captureMandatory` scope: TEACH-only vs SOLVE/takeover | TEACH-scoped; extend | EES1.0; C007 mode table; A011 trajectory binding | over-capture dilutes TEACH law | Stays TEACH-scoped per EES1.0; extension is a spec change (ACR-adjacent). Owner: TL | ACCEPTED POSTURE |
| R-018 | Validation-handoff routing conditions: request validation-condition alone vs + mode `primaryResultKind` | condition-only; both | C007 `StubValidationHandoff`; C009 seam | double authority on validation routing | Superseded — C009 (merged) landed the real validation seam plug-compatibly; the escalation request's validation condition is the single authority. Owner: TL | RESOLVED-BY-PRECEDENT |
| R-019 | `revision_required` re-entry: distinct `resubmitted` state vs single-state re-entry | add state; keep re-entry | C001 lifecycle vocabulary; C009 revision loop | audit ambiguity | Single-state re-entry stays; the append-only transition history carries round-trip audit. A distinct state needs a versioned vocabulary bump. Owner: TL | ACCEPTED POSTURE |

### PR #134 — C003 expert intake (5)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-020 | Intake must never capture routing-time concerns (budget/deadline/COI) even as declared preferences | confirm; allow as preferences | C002 routing inputs; C003 claims | intake ghost-routing | Confirmed — routing-time concerns stay in C002 (lock rule 16). Owner: TL | RESOLVED-BY-PRECEDENT |
| R-021 | `ExpertRegistryProposalPort`/`QualificationClaimPort` shapes vs real A006/A007 submission APIs | bind real; adjust ports | A006/A007 published types; C003 injected fakes | port/producer mismatch at wiring | P002 host wiring binds the real A006/A007 ports; injected fakes remain test-only. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-022 | Session timer ownership: caller, service, or A015 expiry sweep | caller; service; host runner | C003 session lifecycle; A015 timeout policy | orphaned timeouts | A015 job-protocol timeout policy at the host runner (ADR-P001-01); services declare timeouts as pure data. Owner: P002 | RESOLVED-ADR (via ADR-P001-01) |
| R-023 | IntakeProfile/transcript versioning (v1; version-bump not mutate) for C004 | confirm versioned seam | C003 IntakeProfile v1; C004 calibration programs | silent schema mutation | Confirmed — C004 landed probe-pinned programs respecting the versioned-session contract. Owner: TL | RESOLVED-BY-PRECEDENT |
| R-024 | Durable consent ledger home: in-session vs A018 expert-session-policy | consolidate under C018; keep in-session | C003 consent; C018 policy packs | consent truth fragmentation | Consolidate under C018 pack pinning at P002 host wiring. Owner: P002 | FOLLOW-UP (P002 detail) |

### PR #135 — C017 developer portal (4)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-025 | Generated JSON contracts for the developer-platform wire surface now vs after write actions stabilize | generate now; wait | `contracts/developer-platform/*`; shared manifest script (TL-serialized) | stale generated contracts | Register when P003 stabilizes the transport surface; the manifest script is root-serialized. Owner: TL/P003 | FOLLOW-UP (P003 detail) |
| R-026 | Demo portal merges live+sandbox dashboards at the view-model layer vs service tenant-wide query | view-model merge; service query | `mergeObservabilityDashboards`; developer-platform projections | blended truth labels | View-model merge stays (service keeps per-client-app authority; per-row truth labels preserved). A tenant-wide query would be a C021-style projection if demanded. Owner: TL | ACCEPTED POSTURE |
| R-027 | Route mounts at `apps/web/src/app/developers/**` (house M3 pattern) vs strict owned surface `apps/web/src/developers/*` | keep; relocate/revert | app-router mount pattern | ownership ambiguity | Keep — the M3 thin-mount pattern is the house precedent (C012/C021 followed it). Owner: TL | ACCEPTED POSTURE |
| R-028 | Interactive portal writes (issue/rotate/revoke keys, run sandbox) need server actions/API routes with CSRF/idempotency posture | follow-up work item; rush into C017 | developers portal write actions; P003 transport auth | unsafe writes or none | **Unintegrated surface S-03.** Integrated under P005 coordinated with P003 (server actions vs API routes + CSRF + idempotency). ADR-P001-09 | RESOLVED-ADR |

### PR #136 — C019 reference integrations (4)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-029 | Should `examples/*` become workspace globs so their gates ride the root battery? | workspace glob; self-contained (A027 precedent) | `pnpm-workspace.yaml` (TL-serialized); `examples/generic-ai-client` | gate coverage gap | Keep self-contained for P-series v1; P006's `examples/generic-ai-client/deployment-tests/*` may propose workspace inclusion if deployment tests need it. Owner: TL/P006 | FOLLOW-UP (P006 detail) |
| R-030 | EPI1.0 (capability-development shape) vs ES1.0 escalation shape for the Epoch mapping | derived mapping per lock rule 36; new Epoch-specific shape | `adapters/epoch-escalation`; EPI1.0/ES1.0 | Epoch becoming a semantic center | Accepted — derived mapping stands; Epoch stays a reference customer (lock rule 36). Owner: TL | ACCEPTED POSTURE |
| R-031 | Consumers cannot pin per-transition timestamps through the public surface (service clock) | injectable clock at host; pin via public surface | `advanceLifecycle` transition context | non-deterministic ordering claims | Service-clock stamping stays (determinism law); the host injects the clock. Owner: P002 | ACCEPTED POSTURE |
| R-032 | Webhook event vocabulary: recurring types; dedupe per event id, not per type | per-event-id dedupe; per-type dedupe | ES1.0 webhook taxonomy; at-least-once delivery | duplicate suppression errors | Confirmed and codified in ADR-P001-08 — at-least-once with per-event-id dedupe. Owner: P003 | RESOLVED-ADR |

### PR #137 — C004 expert calibration (5)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-033 | Version C003 gap-lists so re-derived tracks detect drift | version; accept snapshot | C003 gap lists; C004 pre-training tracks | stale-gap training | Accept snapshot semantics for v1 (disclosed); versioning gap-lists is a C003/C004 cross-package follow-up. Owner: TL | FOLLOW-UP (TL backlog) |
| R-034 | Codify `pre-training-completed`/requalification proposals as first-class A007 envelope schemas | codify; keep parity-tested tuples | A007 proposal vocabulary; C004 transitions | mirror drift | Parity tests pin them today; codification happens when a WO owns A007 edits (none in P-series). Owner: TL | FOLLOW-UP (TL backlog) |
| R-035 | Who schedules requalification checks: cron vs event-driven | host cron; event-driven; both | C004 schedule/run commands; A015/A002 | missed requalification | The P002 host runner schedules (ADR-P001-01: job definitions with cadence policy) fed by R-036 triggers. Owner: P002 | RESOLVED-ADR (via ADR-P001-01) |
| R-036 | `domain-pack-change`/`dispute-raised` trigger event ownership | A004 capability graph; escalation; C020 | requalification policy triggers | missing producer ports | Triggers emit from their authority surfaces — domain-pack-change from the A004-owning surface, dispute-raised from C020 (disputes authority); the policy subscribes at the host. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-037 | `DemonstratedPerformance` as C002 routing input vs batching/projection port | direct read; projection port | C005 frozen read; C002 routing inputs | stale routing evidence | C005's frozen `DemonstratedPerformance` read is the contract (C004 consumes with `inForce`); routing-input wiring is host composition. Owner: P002 | FOLLOW-UP (P002 detail) |

### PR #138 — C008 tool-gap/knowledge capture (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-038 | Feed terminals reachable from BOTH `triaged` and `tool-specification-proposed` (vs linear EES1.0 chain) | disjunction; linear chain | EES1.0 feed chain; tool-gap stage machine | spec/tree divergence | Accepted (staged disjunction disclosed); recorded as an EES1.0 erratum note — no lock change. Owner: TL | ACCEPTED POSTURE |
| R-039 | Typed scope convention `<kind>:<ref>` on C006 free-text field vs structured field | keep convention; C006 structured field | C006 artifact scope; tool-gap typed scope | unparsable-scope failures | Keep the typed convention with fail-closed parsing for v1; a structured C006 scope field is a schema-extension follow-up. Owner: TL | FOLLOW-UP (TL backlog) |
| R-040 | Add a rejection/withdrawal terminal to the feed lifecycle | add; defer | EES1.0 feed list; lifecycle hygiene | stuck records | Follow-up — add when a WO owns tool-gap edits. Owner: TL | FOLLOW-UP (TL backlog) |

### PR #139 — C018 policy packs (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-041 | Wire `SessionPolicySink`/`ModePolicySink` by the C006/C007 services themselves vs reference fabric | constructor injection at composition; fabric wiring | C006/C007 sinks; C018 packs | unregistered policy packs | P002 host composition root injects (ADR-P001-07). Owner: P002 | RESOLVED-ADR (via ADR-P001-07) |
| R-042 | Pack pinning vs upgrades: notify in-flight v1 sessions on v2 publish? | pinned-until-completion (current); typed re-pin notification | C018 pack pinning; in-flight sessions | silent policy staleness | Pinned-until-completion stays (determinism/session law); a typed re-pin-available notification is a follow-up. Owner: TL | FOLLOW-UP (TL backlog) |
| R-043 | Retention sweep scheduling: service cron vs deployment scheduler vs ops tooling | host runner job; ops tooling | C018 retention engine; A015 | unenforced retention | Host runner job under ADR-P001-01. Owner: P002 | RESOLVED-ADR (via ADR-P001-01) |

### PR #140 — C005 expert performance (4)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-044 | "Merit-style" has no in-repo spec — confirm derivation | confirm derivation; point at canonical spec | C005 record families; `spec/quality-model.md` | unfounded dimension set | Derivation confirmed canonical (quality-model §Expert quality + work-items row + FINAL-HANDOFF §10); no external spec exists. Owner: TL | RESOLVED-BY-PRECEDENT |
| R-045 | C002 consumes the lens envelope directly vs a narrower projection | full envelope; narrow projection | C005 `getRoutingInput`; C002 routing read | over-broad coupling | Narrow projections via read seams (C004 `inForce` precedent; C015 delegate-to-C002 pattern). Owner: TL | ACCEPTED POSTURE |
| R-046 | Attribution vocabulary extension ownership (A020 adds kinds) | A020 owner bumps; consumers coordinate | A020 attribution vocabulary; C005 `dimensions.ts`/`record.ts` | uncoordinated vocabulary split | A020 is the single vocabulary source; coordinated versioned bumps with consumer parity tests. Owner: TL | ACCEPTED POSTURE |
| R-047 | Shared aggregate-formula-version registry in protocol-core | registry now; defer until 2nd consumer | `DimensionalSummaryAggregate` formula version | divergent aggregate math | Defer until a second consumer exists (as proposed). Owner: TL | ACCEPTED POSTURE |

### PR #141 — C011 expert engagement/SLA (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-048 | DECLINED→re-offer: new engagement record (supersession chain) vs mutate | supersession chain; mutate in place | C011 engagement lifecycle | history rewrite | Supersession chain stays (append-only law). Owner: TL | ACCEPTED POSTURE |
| R-049 | Availability projection refresh: push vs pull | push on declaration commit; pull at match time | C011 availability projection; C002 matching | stale availability | Pull-based at read time stays (deterministic at offer time); the host may add event-fed materialization under ADR-P001-01 without changing the contract. Owner: TL/P002 | ACCEPTED POSTURE |
| R-050 | Per-tenant SLA rollup index: C011 read surface vs C021 | C011 owns; C021 owns | C011 breach records; C021 SLO rollups | double-measurement authority | C021 owns SLA rollups (its merged projection surface measures them); C011 owns clocks/policy — the lock-rule-16 split is confirmed by ADR-P001-04. Owner: TL | RESOLVED-ADR (via ADR-P001-04) |

### PR #142 — C009 validation/adjudication (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-051 | Hoist the validation-handoff port into a domain package (repeat of C002's hoisting question) | hoist; keep structural mirrors | B2; `services/intervention/src/ports.ts` mirror in escalation-validation | mirror drift | Same decision as R-005 — structural mirrors + parity tests for v1; hoist is a TL-scheduled refactor. Owner: TL | FOLLOW-UP (TL backlog) |
| R-052 | Register escalation-validation closed vocabularies in the repo-wide contracts manifest | register; defer | `scripts/generate-contracts.mjs` (TL-serialized); escalation-validation vocabularies | unregistered wire contracts | TL-serialized contract registration at the P002/P003 harvest points. Owner: TL | FOLLOW-UP (TL backlog) |
| R-053 | Verdict/stage agreement policy boundary (fail-closed half in domain; revision-vs-rejected boundary to caller) | confirm split; move boundary | C009 adjudication outcomes; caller revision budget | policy leakage into domain | Confirmed — the ownership line is intended (caller owns the revision budget). Owner: TL | RESOLVED-BY-PRECEDENT |

### PR #143 — C013 adversarial evaluation (4)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-054 | Who mounts `/competitions` in `apps/web/src/app/**`? | mount as route; nested route; non-UI | `apps/web/src/competitions` barrel/resolvers; app-router mounts | dead feature code | **Unmounted surface S-01** — P005 mounts over the exported resolvers. ADR-P001-09 | RESOLVED-ADR |
| R-055 | Web features consume domain packages as workspace deps vs relative imports | workspace deps; relative imports (sibling pattern) | `apps/web/package.json` (TL-serialized) | import-path fragility | Relative imports stay for v1; workspace-dep consumption is a TL-serialized manifest change, revisited at P005 if mounting needs it. Owner: TL/P005 | FOLLOW-UP (P005 detail) |
| R-056 | ui-platform `StateKind` has no `community`/`discovery` kind (rendered as `suggestion`) | add kinds; keep suggestion + labelling | `@arena/ui-platform` StateKind; discovery-signal law | badge-kind ambiguity | Keep `kind="suggestion"` with explicit discovery-signal labelling (ratio law); a distinct badge kind is a ui-platform RFC. Owner: TL | ACCEPTED POSTURE |
| R-057 | Make host-side C005 calibration wiring mandatory for adjudication? | mandatory; optional with disclosed 0.5 default | C005 calibration read seam; C013/C009 adjudication | silent neutral weighting | P002 host wires the real C005 calibration read; the disclosed neutral 0.5 default remains the fail-safe. Owner: P002 | FOLLOW-UP (P002 detail) |

### PR #144 — C014 body marketplace (3) + the mount-gap disclosure

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-058 | Settlement seam: where do payments/economics pick up listing grants? | read seam at composition; direct cross-service write | C014 offer/grant records; C010/C016 | settlement truth split | Host-mediated read seams at the P002 composition root (same pattern as R-009); no direct cross-service writes. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-059 | A022 compatibility default wiring (fabric mints the A024 gate verdict) | host responsibility; forge-release-time input | A022 compatibility; A024 release gate | unverified release gates | P002 host wires the real compatibility surface (adapters swap the minted verdict); forge-release-time input stays the fallback. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-060 | Certification candidacy SLA: per-tenant gating policy | default candidacy-on-forge-success; configurable per tenant | A023 candidacy; EV1.0 minimum evidence | low-evidence certifications | Default stays for v1; per-tenant gating is a follow-up (EV1.0 minimum-evidence config). Owner: TL | FOLLOW-UP (TL backlog) |
| S-02 | (limitation + PROJECT-STATE harvest, not a numbered PR question) No app-router route mounts for the body-marketplace web feature | mount as route; nested route; non-UI | `apps/web/src/body-marketplace` barrel/route compositions (11 route tests); app-router mounts | dead feature code | **Unmounted surface S-02** — P005 mounts. ADR-P001-09 | RESOLVED-ADR |

### PR #145 — C012 human-data studio (3)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-061 | Escalation port emits domain events on projection failure as well as success? | success-only; success+failure | C001 escalation port events; C012 projections | silent projection failure | Failure events added at P002 host wiring (fail-closed observability). Owner: P002 | FOLLOW-UP (P002 detail) |
| R-062 | EES1.0 replay-law enforcement point: deliverable assembly vs service layer | keep at assembly; move to service | EES1.0 replay law; C012 deliverable assembly | replay-law bypass | Stays at deliverable assembly for v1; revisit if a second consumer lands. Owner: TL | ACCEPTED POSTURE |
| R-063 | Collapse thin mounts to server-component fetchers post-C017 | thin mounts; fetchers | app-router mount pattern | pattern churn | P005's mount work follows the thin-mount precedent (C012/C021); collapsing to fetchers is a post-P1 UX refactor. Owner: TL/P005 | ACCEPTED POSTURE |

### PR #146 — C015 capability-demand matching (5)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-064 | EVALUATE mode → artifact+expert derivation (work-items row silent) | confirm derivation; other mapping | escalation modes; C015 resolution policy | wrong resource class for EVALUATE | Confirmed — EVALUATE wants an evaluation artifact + expert reviewer per the escalation-modes law. Owner: TL | RESOLVED-BY-PRECEDENT |
| R-065 | Escalation flow consults C015 once (single seam) vs C002 and C015 both | single seam; both | C002 `DemandProfile`; C015 cross-resource engine | double routing authority | Single-seam consultation at P002 host wiring (escalation → C015; C002 consumes the cross-resource verdict); both remain possible in-process. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-066 | C021 observability contract: raw records vs cause-code rollups | raw digest-chained records; rollups only | C015 decision history; C021 projections | lossy observability | C021 (merged) consumes the raw digest-chained decision history and computes its own rollups. Owner: TL | RESOLVED-BY-PRECEDENT |
| R-067 | Cross-class budget semantics (per-invocation Bodies amortize differently?) | summed costs (current); amortization model | C015 composition budget cap; C016 unit economics | budget bypass via amortization | Summed component costs with fail-closed over-cap stays for v1; amortization models are a C016-domain follow-up. Owner: TL | ACCEPTED POSTURE |
| R-068 | Mirror shapes (C014 `CapabilityBodyListing` / A032 offer+entitlement / C008 tool-spec) | confirm mirrors; re-type | C015 fabric mirrors; producer packages | shape drift at host wiring | P002 host wiring pins the mirrors with parity tests against the real surfaces. Owner: P002 | FOLLOW-UP (P002 detail) |

### PR #147 — C020 network quality (4)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-069 | COI consumption point: synchronous routing-time check vs `coi-check-verdict` events | synchronous read port; event subscription; both | C020 COI registry read port; C002 routing | stale COI at routing | Synchronous read port at routing time (fail-closed) at P002 wiring; event subscription stays optional telemetry. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-070 | Enforcement ownership for HOLD/SUSPEND/INVESTIGATE proposals | proposals-only (lock rule 16); direct enforcement | C020 findings; payments hold; registry suspension | vigilantism (network-quality writing other domains) | Proposals-only stands; execution authority stays with payments/registry via host-mediated commands (R-009 pattern). Owner: P002 | FOLLOW-UP (P002 detail) |
| R-071 | Proposal sink port shapes (C005 profile-evidence, C004 requalification sinks) | confirm ports; re-shape | C020 proposal sinks; C005/C004 ports | sink mismatch at wiring | P002 wiring + parity tests confirm the reference contracts. Owner: P002 | FOLLOW-UP (P002 detail) |
| R-072 | No dedicated network-quality spec — derived semantics | confirm derivation; write spec | C020 record families; AE1.0 guardrails; security.md | unfounded semantics | Derivation confirmed canonical; deviations stay recorded (PR + this register), not normalized. Owner: TL | RESOLVED-BY-PRECEDENT |

### PR #148 — C016 capability economics (2)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-073 | Durable recompute jobs: shared job runner vs per-service persistence | shared host runner; per-service persistence; C011-adjacent infra | A015 job-protocol; job-orchestrator; C-series job fabrics | duplicated recovery/idempotency logic | **ADR-P001-01** — one shared durable job runner at the host boundary. Owner: P002 | RESOLVED-ADR |
| R-074 | EXPLICIT truth lens (demo vs customer economics) as the canonical read-model pattern | adopt; ad-hoc per service | C016 read models; all service query surfaces | demo/customer truth blending | **ADR-P001-02** — canonical convention. Owner: P002/P003/P005/P006 | RESOLVED-ADR |

### PR #149 — C022 capability learning compiler (4) + web-surface disclosure

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-075 | A021/A022/A023 sink shapes: full program lineage or digest reference | full lineage; digest; both | `GatedImprovementProposal` envelopes; A021 forge/A022 compatibility/A023 certification sinks | audit gap; resolution ambiguity | **ADR-P001-03** — full lineage in v1; sinks record digests after persisting. Owner: P002 | RESOLVED-ADR |
| R-076 | Candidate projection ownership: first-party producer projectors vs host-side | producer exports; host-side projectors | C008/C009/C013/C014 outputs; capability-learning candidate view | untyped producer seam | **ADR-P001-06** — host-side projectors under P002 now; producer-side exports deferred. Owner: P002 | RESOLVED-ADR |
| R-077 | Feedback-record consumption: broader cross-WO experiment-prioritization surface | defer; build surface | CC1.0 feedback ledger; Q1.0 gate | unowned cross-cutting surface | Defer — CC1.0 ranking serves the compiler; a cross-WO prioritization surface has no current owner. Owner: TL | FOLLOW-UP (TL backlog) |
| R-078 | Recertification trigger semantics: unconditional vs configurable A022 re-test | unconditional (current); configurable | A023 triggers; SUBSTRATE_AFFECTING_CLASSES | substrate drift without re-test | Unconditional for substrate-affecting classes stays (safety posture); configurability is a follow-up. Owner: TL | ACCEPTED POSTURE |
| R-084 | (limitation-sourced) No `apps/web` routes for capability-learning — resolvers exported "if the TL wants a UI" | add UI; intentionally non-UI | `services/capability-learning` query surface | unmounted-feature ambiguity | Intentionally non-UI for P-series v1 (a compiler, not a user surface); P005 records the disposition in its route inventory so this disclosure is not silently dropped. Owner: TL/P005 | FOLLOW-UP (P005 detail) |

### PR #150 — C021 observability/SLA ops (5)

| ID | Q | Options | Seams/contracts | Risk | Decision / owner | Status |
|---|---|---|---|---|---|---|
| R-079 | Fourth SLA clock (validate-by): C011 policy vs C021 measurement definition | C011 `SlaPolicy` extension; C021 measurement (current) | C011 `SLA_CLOCK_KINDS` (3 clocks); C021 4-clock `SlaMeasurementDefinition` | policy/measurement authority split | **ADR-P001-04** — stays a C021 measurement definition; C011's three-clock contract unchanged; derived default ratified. Owner: P002/P006 | RESOLVED-ADR |
| R-080 | Small-sample floor: ratify `DEFAULT_SMALL_SAMPLE_MIN = 5` vs tenant-configurable | platform default; tenant-configurable | C021 SLO rollups; small-sample suppression | blended low-sample aggregates | **ADR-P001-04** — ratified as the platform default; tenant configurability via the ops surface is a follow-up. Owner: TL | RESOLVED-ADR |
| R-081 | C005 consumption: longitudinal projection inside escalation-ops? | C021 embeds C005 projection; C005 keeps its read surface | C005 read surface; C021 declared deps (C001/C005/C010/C011/C015) | duplicate performance truth | **ADR-P001-05** — remains C005's own read surface; the declared-but-unconsumed dependency is recorded as an accepted over-declaration. Owner: TL | RESOLVED-ADR |
| R-082 | Projection feeding: event-fed vs scheduler-driven | event-fed; scheduler-driven; both | C021 source ports; `materializeTenantProjections` jobs | stale projections | **ADR-P001-01** — both: event-fed subscription drives materialization jobs; scheduler sweeps backstop. Owner: P002 | RESOLVED-ADR |
| R-083 | Alert-rule registration: projected rules first-class vs explicit registration step | first-class; explicit A035 registration | A035 alert catalog; C021 alert-rule projections | catalog authority bypass | Projected rules cite the A035 catalog (never edit); first-class acceptance requires the A035 owner's registration step — P002 wiring records the disposition. Owner: TL/P002 | FOLLOW-UP (P002 detail) |

---

## Part 3 — Material limitations inventory (L-001…L-011)

Source: `docs/LLM-ARCHITECT-FINAL-HANDOFF.md` §1 items 1–11, cross-checked against the
C-series harvest in `spec/PROJECT-STATE.md`. None of these is silently normalized; each
maps to the P-series WO that owns its closure.

| ID | Limitation (condensed) | Owning WO / decision |
|---|---|---|
| L-001 | Reference fabrics are not the production host — several services use in-memory stores/fake ports/collecting sinks | P002 (ADR-P001-01/07); in-memory fabrics remain test-only fixtures |
| L-002 | C019 is a reference integration, not a deployed external runtime; MCP not exercised by the example | P006 (R-029/R-030 dispositions apply) |
| L-003 | Neon proof incomplete (no direct connectivity/migration status) | P002/P004 evidence class DEMONSTRATED-LIVE |
| L-004 | R2 lifecycle unproven (bucket empty at probe) | P004 |
| L-005 | Upstash PING ≠ end-to-end coordination proof | P004 |
| L-006 | Three feature surfaces/mounts unmounted or not host-integrated | P005 (ADR-P001-09; see Part 4) |
| L-007 | /tasks renders the generic landing shell | P005 (fix or formally accept) |
| L-008 | Launch checklist stale at 7/69 | P008 reconciliation |
| L-009 | Current hosted availability not re-probed at the 2026-10-09 review | P006/P008 (fresh probes) |
| L-010 | Branch protection unverified (403 via integration) | P008 (administrator confirmation) |
| L-011 | Commercial release not authorized by deterministic payment tests alone | P008 hard gate (R-008 BLOCKED-COMMERCIAL) |

---

## Part 4 — The three unmounted/unintegrated web feature surfaces (exact naming)

**Derivation method (per the P001 brief: route tree + PR bodies, no guessing):**
`apps/web/src/app/**` page files were enumerated and cross-referenced against every web
feature module under `apps/web/src/*` and against every C-series PR-body/PROJECT-STATE
disclosure about web-surface integration.

Result of the route-tree pass — C-series web feature modules and their mount state:

| Feature module | Delivered by | App-router mount | State |
|---|---|---|---|
| `apps/web/src/developers` | C017 (PR #135) | `/developers/**` (5 routes) | mounted (read-only — see S-03) |
| `apps/web/src/human-data` | C012 (PR #145) | `/human-data/**` (3 routes) | mounted |
| `apps/web/src/competitions` | C013 (PR #143) | **none** | **unmounted — S-01** |
| `apps/web/src/body-marketplace` | C014 (PR #144) | **none** | **unmounted — S-02** |
| `apps/web/src/escalation-ops` | C021 (PR #150) | `/escalation-ops` (page + loading) | mounted |

The three surfaces, named exactly:

1. **S-01 — the competitions web feature (`apps/web/src/competitions`, Work Order C013, PR #143).**
   Unmounted: no `apps/web/src/app/competitions/**` page files exist. PR #143 limitation:
   "The web route mounts (`apps/web/src/app/competitions/**` page.tsx files) are NOT included —
   outside the owned surface; the barrel + resolvers in `apps/web/src/competitions/index.ts`
   are ready for the TL to mount." Architecture question 1: "Who mounts `/competitions`?"
   The resolvers (`resolveCompetitionsHomeExperience` / `resolveCompetitionDetailExperience`)
   are exported and tested for exactly that mount.
2. **S-02 — the body-marketplace web feature (`apps/web/src/body-marketplace`, Work Order C014, PR #144).**
   Unmounted: no app-router route mounts exist. PROJECT-STATE C014 harvest: "Open (recorded):
   no app/ route mounts (outside owned surface)". The module ships browse / detail /
   request-pretraining / my-listings route compositions with a full state vocabulary and 11
   route tests, and its barrel declares itself "one import surface for the route mounts".
3. **S-03 — the developer-portal interactive write actions (`apps/web/src/developers`, Work Order C017, PR #135).**
   Not host-integrated: the `/developers/**` routes are mounted but **read-only in session
   posture** — interactive key issue/rotate/revoke and console-triggered sandbox runs have no
   server actions or API routes with CSRF/idempotency posture. PROJECT-STATE C017 harvest:
   "routes read-only in session posture (interactive key writes + sandbox runs are a proposed
   follow-up with CSRF/idempotency posture)". PR #135 question 4 proposed a follow-up work
   item rather than rushing it into C017.

These three exactly match the disclosures counted in the C-series harvest of
`spec/PROJECT-STATE.md` (C017 read-only posture; C013 mounts not included; C014 no route
mounts) and the final-handoff phrasing "unmounted **or not host-integrated**": S-01/S-02 are
unmounted; S-03 is mounted but not host-integrated. The route/nested-route/intentionally-non-UI
disposition of each is delegated to P005's route inventory (ADR-P001-09).

**Adjacent disclosure, explicitly recorded (not silently omitted, not counted in the three):**
PR #149 (C022) discloses "No `apps/web` routes (outside owned surface — resolvers exported if
the TL wants a UI)" — a conditional, never-built web surface for the capability-learning
compiler. It is registered as R-084 with an intentionally-non-UI disposition for P-series v1
(P005 records it in the route inventory). It is NOT one of the three because no web feature
module exists to mount; the three above are the surfaces the C-series disclosures reported as
unmounted or unintegrated.

**Also out of scope of the three (recorded to avoid duplication):** the `/tasks` route
rendering the generic landing shell (L-007) is a distinct UX finding under P005, explicitly
separate from the three surfaces in the final handoff (§1 items 6 vs 7).

---

## Part 5 — Decisions required by each downstream work order

**P002 (durable host runtime, persistence, jobs) — required decisions:**
ADR-P001-01 (shared durable job runner — the persistence/jobs architecture), ADR-P001-02
(truth-lens convention on persisted/read records), ADR-P001-03 (proposal-envelope sink
wiring), ADR-P001-06 (host-side learning-candidate projectors), ADR-P001-07 (host/provider
split, composition-root ownership). Register detail rows binding P002 wiring: R-007, R-009,
R-011, R-014, R-015, R-021, R-024, R-035, R-036, R-037, R-041, R-043, R-057, R-058, R-059,
R-061, R-065, R-068, R-069, R-070, R-071, R-082, R-083.

**P003 (HTTP/MCP/webhook transport) — required decisions:**
ADR-P001-08 (transport lifecycle: auth, idempotency replay/conflict, webhook signing/retry/
event-id dedupe, shared error taxonomy, health/readiness), ADR-P001-02 (truth lens on read
surfaces), ADR-P001-07 (transport binds at the host, not in domain services). Register rows:
R-003, R-025, R-032; R-029 governs the examples posture for its client suites.

**P004 (hosted-provider lifecycle) — required decisions:**
ADR-P001-07 (host/provider responsibility split; fail-closed capacity, no paid fallback,
zero-credential demo). Evidence-class obligations L-003, L-004, L-005. Neon code ownership is
coordinated with P002 per the work-items spec.

**P005 (route inventory, mounts, UX) — required decisions:**
ADR-P001-09 (the three named surfaces and their disposition protocol), ADR-P001-02
(demo/customer truth states on mounted surfaces). Register rows: R-027, R-055, R-063, R-084;
L-006, L-007. Mounting must use the shared shell/session/tenant protection and the thin-mount
house pattern (C012/C017/C021 precedent).

**P006 (integrated generic-app + Epoch acceptance) — required decisions:**
ADR-P001-01 (restart/recovery semantics of the job runner), ADR-P001-02 (truth lens in
acceptance evidence), ADR-P001-03 (sink compatibility in the integrated loop),
ADR-P001-04 (SLA measurement in acceptance flows), ADR-P001-07/08 (real host + public
transport — both clients must use public transport, not in-process references). Register
rows: R-029, R-030; L-002, L-009.

**P007 (security/privacy/resilience) — required decisions:**
ADR-P001-07 (fail-closed provider posture as an attack class), ADR-P001-08 (auth/forgery/
replay/idempotency-race attack classes). R-008's BLOCKED-COMMERCIAL disposition must appear
in the threat model (commercial boundary). Learning rights/scope classes come from the C022
boundary wall and lock rules 31/32.

**P008 (release evidence/governance) — required decisions:**
R-008 (BLOCKED-COMMERCIAL provider/legal/jurisdiction posture — a hard gate), the full
L-001…L-011 reconciliation to `spec/post-roadmap-release-gate.md` evidence classes, and the
ADR set as release-gate inputs (each ADR's consequences section states what evidence it
implies).

---

## Part 6 — Honest limitations of this register

1. PR-body questions are condensed for tabulation; the verbatim record lives in the PR bodies
   (#129–#150), which remain authoritative. No question was dropped: 83 numbered questions
   were inventoried (count re-verified per PR: 4,3,6,3,3,5,4,4,5,3,3,4,3,3,4,3,3,5,4,2,4,5).
2. The three-surface naming (Part 4) is derived from the live route tree at base SHA 5067356
   plus PR bodies and the PROJECT-STATE harvest. The adjacent C022 web-surface disclosure
   (R-084) is recorded separately so that the "three" count stays exact without omission.
3. ADRs are **Proposed** — they bind downstream dispatch only after TL review/merge (house
   law; workers never self-merge).
4. No Architecture Lock change is made or proposed by this register; any future lock change
   requires an ACR per `docs/architecture-lock.md`. ADR-P001-04 explicitly avoids a C011
   contract change for that reason.
5. Options/risks are the worker's faithful summary of what the PR bodies and repo state
   disclose; where a question had no recorded option set (single-posture disclosures), the
   realistic alternatives were derived from the repo, and this is visible in the tables.
