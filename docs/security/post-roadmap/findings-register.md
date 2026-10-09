# P007 Findings Register — post-roadmap productionization (R1.0 skeleton)

- **Work order:** P007 — Security, privacy and resilience (issue #159)
- **Dispatch:** 30-b — threat-model register, **read-only / docs-only scope**. This file is the
  SKELETON: vocabulary + the initial honestly-dispositioned rows seeded from wave-1
  disclosures (P002/P004/P005) and the P001 register.
- **Modeled baseline:** main `ae6df29246528cd490a2cfad6f753960c4003283` (2026-10-09).
- **Companion document:** `threat-model.md` (the 14 attack classes AC-01…AC-14; each row below
  cross-references the classes it tracks).
- **Law of this register:** **NO finding is marked closed by this register.** Rows close only
  via `fixed-with-regression-test` (the integrated pass, post-P006, with reproducing
  regression tests under `tests/security/production/*` / `tests/resilience/production/*` and
  evidence under `docs/evidence/production/security/*`) or via a release-owner **WAIVED**
  disposition with written rationale. Every row carries an owner and a next step.

## 1. Severity vocabulary

Per the work-items §P007 acceptance ("critical/high findings fixed or explicitly block
release; regression tests reproduce findings; lower-severity findings have owners/
dispositions") — identical definitions to `threat-model.md` §5 (they must never diverge; if
one changes, both change in the same PR):

| Severity | Definition | Gate consequence |
|---|---|---|
| **critical** | A confirmed bypass of tenant isolation, capsule privacy, learning rights, evidence integrity, live-world boundary or the commercial boundary reachable in the integrated path without privileged preconditions; OR live-money movement outside the R-008 gate. | Blocks release until fixed (with regression test) or formally accepted in writing by the release owner with recorded rationale. |
| **high** | A confirmed bypass needing non-default preconditions or a narrower blast radius; a money/integrity double-act class (idempotency race, webhook forgery) reachable in the integrated path; OR a disclosed structural gap that leaves any of the above unproven at gate time. | Blocks release until fixed or formally accepted with rationale; owner + next step mandatory. |
| **medium** | Degradation or partial-scope integrity/visibility risk (single-run evidence scope, metering gaps, port coverage gaps, durability seams on reference fabrics) that does not itself cross a trust boundary. | Owner + disposition required; fix may land post-gate with release-owner acceptance. |
| **low** | Cosmetic/documentation/naming divergences and hardening opportunities with no boundary crossing. | Owner + disposition required. |

## 2. Disposition vocabulary

Reuses `spec/post-roadmap-release-gate.md` §3 exactly, extended with the security register's
closing state (release-gate §5.8: "regression tests reproduce every fixed finding"):

| Disposition | Meaning |
|---|---|
| **OPEN** | Has an owner and a next step; not yet resolved; not yet blocking. |
| **BLOCKED** | Has an owner and a blocking dependency. Any BLOCKED row forces NO-GO at the release gate while open. |
| **WAIVED** | The release owner approved an explicit written rationale (including not-applicable rows, which are WAIVED with an N/A rationale). Not available to the TL; never used by this skeleton. |
| **fixed-with-regression-test** | The integrated pass's only closing state for a fixed finding: the finding was reproduced, fixed, and a regression test in the committed battery fails on the unfixed code and passes on the fix. A finding without a reproducing regression test is NOT closed. |

Evidence-class labels on mitigation claims (DEMONSTRATED-LIVE / AUTOMATED-TEST-ONLY) follow
release-gate §3 verbatim. A reference-fabric test, in-process walkthrough or successful build
is never DEMONSTRATED-LIVE evidence.

## 3. Register rows (initial — seeded from wave-1 disclosures; ALL still open or blocked)

| Row | Finding (honest statement) | Severity | Disposition | Attack classes tracked | Owner | Next step |
|---|---|---|---|---|---|---|
| **F-01** | **Durability seams on live surfaces: process-local idempotency memo + in-memory reference fabrics.** The developer-portal writes (`apps/web/src/app/developers/_lib/portal-writes.ts`) key idempotency on a REQUIRED `x-arena-idempotency-key` with typed replay/`PORTAL_IDENTITY_CONFLICT` semantics, but the memo is **process-local** (P005 route-inventory §6.3) — a replay landing on another process/instance is not recognized. The backing `DeveloperPlatformService` is the process-singleton **in-memory reference fabric** (P005 §6.4): key records, rotations and revocations do not survive restart; the durable swap (P002's `arena_runtime_idempotency` + durable control-plane stores) is designed but not wired to this surface. | high | OPEN | AC-01, AC-02, AC-03, AC-04, AC-05, AC-07, AC-10, AC-13 | P003 (transport binds the durable host + real auth at the boundary); P006 (integrated duplicate/restart proof); P007 integrated pass (attack it) | Wire the developer-platform surface and portal writes onto the durable host stores; prove replay/conflict across a hard restart and across two processes in the P006 battery; regression-test the cross-process replay case under `tests/security/production/*`. |
| **F-02** | **Sequential, non-transactional multi-command DDL application on the Neon HTTP transport.** The Neon HTTP SQL proxy executes one command per prepared statement, so `apply_migration`'s multi-command source is split into top-level commands and executed sequentially WITHOUT a wrapping transaction (the HTTP driver has no cross-request session) — `adapters/hosted/neon-postgres/src/sql-transport.ts`. A crash mid-sequence leaves a partially-applied migration; today this re-runs cleanly only because the DDL is idempotent-by-contract and the ledger records a version only after its source applied fully (P002 EVIDENCE.md, honest limitations). | medium | OPEN | AC-08, AC-11 | P007 integrated pass (verify adversarially); remediation would reopen `adapters/hosted/neon-postgres/*` (P002 surface — TL-coordinated with P004) | Integrated pass: kill the process between split commands and prove the re-run converges (idempotency-by-contract is a claim to test, not assume). Remediation options to price: single-command migration files, or an advisory-lock + ledger-guarded application protocol. |
| **F-03** | **Single-run live-evidence class — no soak, no concurrency, no outage windows, no multi-instance.** P002's live Neon evidence is one run per fresh branch; P004's provider matrices are single re-verification transcripts. Concurrency races, provider-outage windows, sustained load and two-hosts-one-store lease racing were explicitly deferred to P006/P007 (P002 EVIDENCE.md honest limitations; work-items §P006 "restart, duplicate, concurrency, timeout, provider outage and recovery"). | high | OPEN | AC-01, AC-02, AC-03, AC-04, AC-07, AC-08, AC-10, AC-11, AC-12, AC-13, AC-14 | P006 (integrated acceptance battery); P007 integrated pass (adversarial variants) | Execute the restart/duplicate/concurrency/timeout/outage/recovery battery against the real host + providers; add two-instance lease-racing and provider-outage injection under `tests/resilience/production/*`; record outcomes under `docs/evidence/production/security/*`. |
| **F-04a** | **Live quota exhaustion NOT demonstrated and NOT claimed (metering gap).** No safe live trigger exists for the shared account (filling the 10 GiB free tier or throttling shared credentials would damage other tenants of the account). The 429 path and the port-level `PERSISTENCE_CAPACITY_EXHAUSTED` gate are AUTOMATED-TEST-ONLY; usage metering that decides EXHAUSTED lives in the deploy wiring (`deploy/src/hosted/quotas.ts`) and `used`/`remaining` stay `null` until a meter exists — adapters never fabricate an EXHAUSTED reading (honest, but the fail-closed gate is partially blind). P004 R2 failure-capacity matrix, "live quota exhaustion" row. | medium | OPEN | AC-06, AC-12, AC-14 | Deploy/B019 follow-up (metering build); P007 integrated pass (fail-closed verification under a declared-EXHAUSTED snapshot) | Decide with the release owner: build usage metering (declared-allowance reading) or accept the blind spot in writing; either way the integrated pass must verify fail-closed behavior under an operator-declared EXHAUSTED state end to end. |
| **F-04b** | **R2 retention/lifecycle operations absent from the port.** No retention/lifecycle op exists in `BlobStore` or `ObjectStorageTransport`; deletion is immediate. Retention-semantics enforcement (lock rule: retention semantics preserved by the durable host) is unreachable through the object-store adapter today. P004 R2 object-lifecycle matrix, retention row ("NOT CLAIMED … not applicable (honestly recorded)"). | medium | OPEN | AC-06, AC-12 | Future adapter/contract WO (port extension is a provider-neutral contract change — TL-serialized); P008 may WAIVE with N/A rationale if no retention requirement is adopted | Decide whether the product requires object-retention semantics; if yes, version the `BlobStore` port (additive), implement in `adapters/hosted/r2-object-store`, prove with the contract suite + live lifecycle evidence; if no, WAIVE with rationale at the gate. |
| **F-04c** | **Upstash queue semantics absent from the CoordinationStore port (honestly recorded as not applicable).** Cache/idempotency/rate-limit/lease are the four bounded sub-surfaces; queue enqueue/dequeue is NOT PRESENT — the runtime's queue semantics are owned by the durable job runner over the control plane (P002 surface). No queue claim is made and none is simulated. P004 Upstash coordination-semantics matrix, queue row. | low | OPEN | AC-07, AC-14 | P006 (prove the durable job runner's queue semantics suffice under load/outage); candidate for WAIVED-with-N/A-rationale at P008 | Verify in the integrated battery that job-queue behavior under restart/outage needs no broker-level queue; if a distributed-queue requirement emerges, it is a new port + ADR, not a silent adapter addition. |
| **F-04d** | **Cross-account object-store access not demonstrable with single-account credentials.** P004's "foreign/unauthorized bucket" row is the client-side shape only (valid credentials against a bucket not in this account → 404 `NoSuchBucket`); a TRUE cross-tenant bucket in ANOTHER Cloudflare account is unreachable from the evidence credentials (P004 R2 failure-capacity matrix, honest scope note). The D-8 adversary (provider-account compromise) is therefore unexercised. | medium | OPEN | AC-06 | P007 integrated pass (if the release owner authorizes a second throwaway account); otherwise P008 WAIVED with scope rationale | Decision required: spend for a second credential set vs. accept the documented single-account scope. The domain-side mitigations (digest keys, tenant gating before issuance) are unaffected either way. |
| **F-05** | **Console UI not yet wired to the S-03 endpoints.** The five developer-portal POST routes (`/developers/api/client-apps`, `/keys`, `/keys/rotate`, `/keys/revoke`, `/sandbox/runs`) are real, tested and documented, but the `/developers/**` read views remain read-only — the C017 feature surface (`apps/web/src/developers/**`) was frozen for P005 (P005 route-inventory §6.2). Consequence for AC-05: no human-facing key lifecycle flow exists yet, so the one-time-secret display path is unexercised in real usage. | low | OPEN | AC-05 | Follow-up WO on `apps/web/src/developers/**` (needs its own dispatch; surface is C017-frozen) | Wire the console's buttons to the endpoints (fetch + typed-envelope handling + one-time secret reveal UX); add served-route tests; then exercise a full register→issue→rotate→revoke flow by a human operator and record evidence. |
| **F-06** | **`/runs/:id` spec naming divergence.** The UXM1.0 route matrix spells the run-detail capability `/runs/:id`; the served route is `/replay/[runKey]` (B011), and `/replay` itself has no matrix row. No capability is missing — the matrix text and the router disagree on the NAME. The spec is TL-owned and was outside P005's frozen surfaces (P005 route-inventory §3 note + §6.1). | low | OPEN | AC-12 (documentation/policy drift only) | TL (spec owner) | Reconcile at the TL station: update the UXM1.0 matrix text to `/replay/[runKey]` (and add the `/replay` list row), or add `/runs/**` alias routes under a dispatched WO. Not security-relevant beyond drift hygiene. |
| **F-07** | **R-008 BLOCKED-COMMERCIAL: merchant-of-record, payout rails, tax, refunds/disputes and jurisdiction unsettled (register row R-008; release-gate §4 hard gate 1).** Deterministic payment abstractions and sandbox flows do not satisfy the gate. `DEMO_PROVIDER_POSTURE.executesCustomerMoney = false` (`adapters/payments/src/demo-provider.ts`) is the recorded commercial truth; no customer-truth payment label may be issued before the boundary is settled. Mandated to appear in the threat model (register Part 5) — done: `threat-model.md` AC-09. | critical (if the boundary is bypassed) | **BLOCKED** (BLOCKED-COMMERCIAL — release-owner decision under the P008 hard gate; forces NO-GO while open) | AC-09 | Release owner (P008) | Settle the real payment provider, merchant-of-record, payouts, tax, refunds/disputes and jurisdiction responsibilities in writing and record them in the repo; until then, keep all payment surfaces sandbox/test-only and keep `executesCustomerMoney = false`. The integrated pass must additionally attack sandbox partial-payment states (charge-succeeded/record-failed races). |

| **F-08** | **Idempotency-race loser distribution: concurrent identical submissions surface the typed fail-closed conflict, not the smooth 200 replay.** The durable escalation store's insert is check-then-act (`services/runtime-host/src/durable.ts` — pre-check select then insert): under N concurrent SAME-identity submissions exactly ONE record is created (the double-act is unreachable — verified by ac07's audit-chain + event-id dedupe assertions), but racing losers receive `PERSISTENCE_RECORD_EXISTS` surfacing as the typed `ESCALATION_UNKNOWN_ERROR` 500 rather than the C001-law verbatim replay outcome. The sequential replay path is green (P002/P006 proofs); the gap is contention-only. | medium | OPEN (integrated-pass finding — reproduced and pinned) | AC-07 | TL serialization: the catch-and-replay conversion lives in `services/escalation-api/src/service.ts` + `services/runtime-host/src/durable.ts` (P003/P002 surfaces) | Convert the loser path: on `PERSISTENCE_RECORD_EXISTS` from a same-identity insert, re-read and return the recorded outcome with the replay marker (the C001 law under contention); regression = ac07's loser distribution flips from typed-conflict to replay. |
| **F-09** | **The payments service's in-process ledger/outbox reference fabric is not race-safe: concurrent SAME-operation-key settlement operations ALL apply (the charge-succeeded/record-failed double-act).** `services/payments/src/service.ts` over `InMemoryPaymentLedgerStore` is check-then-act: N concurrent `holdBudget` calls with the SAME operation key produce N `applied` outcomes (reproduced: 6/6 applied in ac09) — the escrow ledger multiplies the budget under contention. The SEQUENTIAL same-key replay is correct (`duplicate`); the ledger's own state machine refuses non-adjacent ops typed (`PAYMENTS_INVALID_TRANSITION`). The durable payment ledger is designed but not wired (the P002 durable stores cover escalation/event/job/idempotency records — NOT the payment ledger; the payment event outbox is likewise in-process). | high | OPEN (integrated-pass finding — reproduced and pinned) | AC-09, AC-13 | TL serialization: the durable payment ledger swap is a P002-surface (+ C010 payments service) follow-up | Swap the payment ledger/outbox onto the durable host stores with per-operation-key uniqueness; regression = ac09's F-09 reproduction flips from 6/6 applied to exactly-one applied + N-1 duplicate; then re-run the P006 integrated battery. |
**Row count: 12** (F-01…F-09 with F-04 split a/b/c/d; F-08/F-09 added by the integrated pass with reproduced regressions). Dispositions at integrated-pass time: 11 OPEN,
1 BLOCKED (F-07). Zero rows closed; zero rows WAIVED (a waiver requires the release owner's
written rationale — not available to this dispatch, and not available to the TL).

## 4. How the integrated pass uses this register

1. **Attack, don't assume** — each AC class from `threat-model.md` §4 becomes executed
   adversarial/resilience suites under `tests/security/production/*` and
   `tests/resilience/production/*` against the real host, real transport and real providers
   (P006-complete tree).
2. **New findings get rows immediately** — severity per §1, disposition per §2, owner + next
   step mandatory. No authority/privacy/rights/evidence bypass goes unreported (work-items
   acceptance).
3. **Closure discipline** — `fixed-with-regression-test` requires a regression test that
   fails on the vulnerable code and passes on the fix, committed in the same PR; anything else
   is OPEN (with owner/next step) or BLOCKED (with dependency) or WAIVED (release owner's
   written rationale only).
4. **Evidence** — outcomes land under `docs/evidence/production/security/*` classified with
   release-gate §3 vocabulary; a build or in-process walkthrough is never
   DEMONSTRATED-LIVE.
5. **Refresh obligation** — when P003/P006 merge, re-derive the trust-boundary diagram and
   attack-class affected-surfaces (TB-1 flips from DESIGN to REAL); add delta rows rather than
   rewriting history (no evidence is rewritten after the fact — release-gate §9).

## 5. Honest limitations of this skeleton

1. Seeded from KNOWN, already-disclosed limitations only (P002/P004/P005 evidence files and
   the P001 register) — the integrated pass's executed attacks are expected to add rows.
2. Severity assignments are pre-test judgments per `threat-model.md` §7.5; the integrated
   pass may raise/lower them with reproduced evidence.
3. This register deliberately makes NO release claims and closes NOTHING (dispatch scope:
   read-only, docs-only; issue #159 stays open after this PR merges — the integrated pass
   remains pending).
