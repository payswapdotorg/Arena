# Arena Post-Roadmap Release Gate — P008 (R1.0)

**Snapshot:** 2026-10-09. This document defines the release gate that work order P008 owns
and operates, per `spec/post-roadmap-production-work-items.md` (P008 — Release evidence,
checklist and governance) and the final TL handoff
(`docs/LLM-ARCHITECT-FINAL-HANDOFF.md`). It is registered as a P008 owned surface in
`scripts/work-order-surfaces.json`. The repo — not any chat or session — is the source of
truth for the gate's decision record.

## 1. Purpose and authority

P008 owns the final release-gate decision. The TL assembles the evidence bundle and
reconciles the launch checklist; the **release owner** (repository administrator /
operator) issues the GO or NO-GO. Evidence, not narrative, decides. Roadmap completion
(80/80 work orders merged) is explicitly **not** production readiness and never satisfies
this gate by itself.

## 2. Entry criteria

- P001–P007 are MERGED on main, with every P007 critical/high finding either fixed or
  formally accepted in writing by the release owner with recorded rationale.
- No open P-series PRs other than P008's own; tracking issues #153–#159 are closed at
  their acceptances; #160 remains open until the gate decision.
- The integrated-main battery is green at the final release-candidate SHA (all gates:
  governance, boundary, typecheck, lint, test, build), and CI plus Deploy preview are
  green on that same SHA.
- A read-only branch-protection verification may run earlier (per the dependency
  graph); the recorded confirmation must be current at gate time.

## 3. Evidence classes

Every row of `docs/launch-checklist.md` and every gate claim is classified with exactly
one vocabulary term:

- **DEMONSTRATED-LIVE** — the operation was proven against the real host/provider with
  committed evidence: commands, logs or receipts, resource IDs, redacted configuration,
  and timestamps.
- **AUTOMATED-TEST-ONLY** — covered by the CI battery but never demonstrated live. This
  class can never, by itself, support a release claim for that row.
- **OPEN** — has an owner and a next step.
- **BLOCKED** — has an owner and a blocking dependency. Any BLOCKED row forces NO-GO.
- **WAIVED** — the release owner approved an explicit written rationale (including
  not-applicable rows, which are WAIVED with an N/A rationale).

A reference-fabric test, an in-process walkthrough, or a successful build is **never**
DEMONSTRATED-LIVE evidence.

## 4. Hard gates

These cannot be waived by the TL. A waiver requires the release owner's written approval
recorded in the repo.

1. **Commercial boundary** — no live-money activation or claim until the real payment
   provider, merchant-of-record, payouts, tax, refunds/disputes and jurisdiction
   responsibilities are settled in writing. Deterministic payment abstractions and
   sandbox flows do not satisfy this gate.
2. **Tenant isolation and fail-closed behavior** — verified at service boundaries in the
   integrated acceptance (P007), not only in UI or unit tests.
3. **Deployed artifact ↔ source linkage** — the deployed/hosted URL is proven to serve
   the release candidate SHA (deploy record or equivalent committed evidence).
4. **Branch protection** — main branch protection and required checks confirmed by a
   repository administrator, recorded in the repo.
5. **Checklist completeness** — no unchecked launch-checklist row without a class and an
   evidence link; no historical evidence rewritten after the fact.

## 5. Evidence bundle (minimum)

Each item names its producing work order; the P008 reconciliation maps them to checklist
rows and evidence artifacts under `docs/evidence/production/*` and
`release/evidence/production/*`:

1. **Durable runtime** (P002): clean database migrates from zero to latest; an accepted
   escalation is persisted and read back through the real adapter; a hard process
   restart resumes without loss or duplicated transition; retries return the recorded
   deterministic outcome.
2. **Neon** (P002/P004): direct migration and connectivity proof from the actual runtime
   environment — not indirect project listing.
3. **R2 object lifecycle** (P004): authorized write/read/download/list-or-digest/delete/
   retention cycle with redacted live evidence. A configured resource or empty bucket is
   not proof.
4. **Upstash coordination** (P004): the actual lock/idempotency/lease/queue operation the
   runtime uses — not PING alone.
5. **Public transport** (P003): HTTP + MCP + signed webhook lifecycle against the real
   host, including auth/tenant mismatch, idempotent replay/conflict, forgery, timeout and
   retry/dedupe behavior, and health/readiness endpoints.
6. **Web routes** (P005): reconciled route inventory; the three previously
   unmounted/unintegrated surfaces are named exactly and resolved (mounted, nested, or
   intentionally non-UI with rationale); `/tasks` is fixed or formally accepted.
7. **Integrated acceptance** (P006): a generic non-Epoch AI application and the Epoch
   adapter both pass the identical public flow end-to-end against the real host and
   durable stores — including restart, duplicate, concurrency, timeout, provider outage
   and recovery. No real money moves in CI.
8. **Security/privacy/resilience** (P007): threat model plus a findings register with
   severity and disposition; regression tests reproduce every fixed finding.
9. **Launch checklist reconciliation** (P008): every row of `docs/launch-checklist.md`
   classified with the Section 3 vocabulary and linked to committed evidence.
10. **Recovery and limitations record**: current known limitations and recovery notes as
    of the release SHA (probe dates are the dates the probes ran).
11. **Hosted availability**: the current hosted URL re-probed at release time —
    historical probes are not current availability.
12. **Branch protection record**: administrator confirmation committed to the repo.

## 6. GO criteria

All of the following, with no exception:

- Zero BLOCKED rows.
- Every checklist row is classified and linked to evidence.
- Every hard gate is satisfied or waived in writing by the release owner.
- Battery, CI and Deploy preview are green at the release candidate SHA.
- Release-note claims match evidence classes exactly (an AUTOMATED-TEST-ONLY row is
  never claimed as live behavior).

## 7. NO-GO protocol

Any unmet GO criterion records a NO-GO with the blocking items. Each blocking item
becomes a tracked issue with an owner and next step; no partial or conditional release
claims are made from a NO-GO state. The gate may be re-run after the blockers close.

## 8. Release artifacts (on GO)

- A git tag on the release SHA and a GitHub Release whose notes restate the evidence
  classes honestly.
- The final battery output archived under `release/evidence/production/*` and referenced
  from `spec/PROJECT-STATE.md`.
- The deployed URL ↔ SHA linkage recorded.
- Final PROJECT-STATE / AI_CONTINUATION frontier update by the TL.
- Issue #160 closed with the GO decision record and the release owner's confirmation.

## 9. Honesty rules

- A build alone never proves public API availability, persistence, payment execution or
  hosted behavior.
- Demo state is not customer state; truth states stay distinct in evidence.
- No evidence is rewritten after the fact; dated probes carry their own dates.
- The gate decision, its waivers and their rationales live in the repository — not in
  chat history.
