# Arena Stateless Continuation

Fresh-session rule: recover Arena entirely from repository state and live GitHub state.

## Status

Arena V1 A001-A036 is complete and merged.

The B-series productization program (B001-B019) is COMPLETE — all 19 work orders
merged; the hosted preview is LIVE at https://arena-preview-five.vercel.app
(deploy pipeline green end-to-end; launch-gate boundary executed by the TL).
The successor program is the C-series, governed by:
- spec/post-v1-work-items.md
- spec/post-v1-dependency-graph.md

Maximum concurrent workers: 3.

## Current objective

Reach the product bar:
1. local install/use with deterministic Demo mode;
2. hosted free-tier-compatible preview;
3. friendly responsive role-aware UI with persistent multi-role switching.

## First dispatch wave — LANDED (2026-10-01)

B001 — Web runtime foundation — PR #67 MERGED (2b01b7b)
B002 — Hosted persistence/infrastructure adapters — PR #68 MERGED (3ab66f9)
B003 — Role/context model — PR #66 MERGED (7605fe6)

Harvest evidence: per-PR TL-station battery + lockfile intake + integration
battery at every merge step (final wave-1 integrated tree 61/61 tasks green).
B002 includes TL live-path hardening (deterministic idempotency replay,
hermetic live contract runs, live rate-limit window) disclosed in PR #68.

B004 — auth/session/tenant browser boundary — PR #70 MERGED (865c851).
Two-session worker delivery + TL completion; battery 63/63; CI green pre-merge.

B005 — persisted control-plane read model — PR #72 MERGED (8a6e6e9).
Worker delivery + TL completion; battery 66/66; CI green pre-merge.

B006 — deterministic demo/preview mode — PR #74 MERGED (aa5d526).
Worker delivery + TL completion (worker died pre-commit at the session
wall-clock; TL verified, normalized cross-package imports to the
@arena/demo workspace alias, took manifest/lockfile intake); battery
268/268; CI green on integrated head 04a6e56. En route this window:
auth-service seal-tamper test flake fixed on main (040dc5c — the last
base64url char carries 2 padding bits; tests now flip the first seal
char, deterministic) and the A1.0→A2.0 architecture-lock bump completed
(83384be, ACR-001) after the approved human-escalation rules landed
without the mechanical lock update.

Architecture lock is now A2.0 (36 locked rules; rules 25-36 are the
approved human escalation product direction; ACR-001 records the bump).
Long-term roadmap: A001-A036 → B001-B019 → C001-C022.

B007 — role-aware capability cockpit + shared shell + global navigation —
PR #79 MERGED (4ff6188). Two-session worker delivery + TL independent
review; battery 268/268 under CI-equivalent clean-.next conditions; branch
CI queued (public-repo runner queue), merged on local-battery truth.
Lens-not-authorization verified (truthful not-granted denial); reads
through the B005 read API; injective state classification; demo cockpit
visibly labelled. TL-owned follow-ups: free-text search deferred to B008+,
job/SLO indicators deferred to B014, stale-.next TS6053 local-only flake.

Fourth wave — LANDED (all three): B008 (capability case/task guided
workflows, PR #85 → 4a857b7; three-session delivery + TL lockfile intake +
semantic app.test.tsx merge), B009 (expert workbench, PR #84 → 6a68895;
continuation session completed the dead worker's uncommitted tree; evidence
INSERT-only via the B002 port; qualification never authorization), B010
(body studio, PR #83 → 377dc01; worker M1+M2 + TL-completed M3 + intake;
possession matrix halves explicit; typed bare-substrate comparison
rejection). Post-merge main CI green (6a68895).

Fifth wave dispatched: B011 (environment/trajectory replay viewer — replay
NEVER implies live mutation), B012 (evaluation/verification/certification/
research UX — the three concepts stay separate), B013 (marketplace UX with
provenance/rights/verification/entitlements). Three concurrent workers.

Slot-blocked ready WOs: B014 (operations/capacity) and B016 (local install)
dispatch as slots free. Then B015 (deployment, needs B014), B017 (product
E2E, needs B008-B016), B018 (UX polish, needs B017), B019 (serialized
launch acceptance). C-series governance roster extension (checker C-id
parsing) is required before any C-series dispatch.

The Tech Lead must record:
- exact base SHA;
- branch names;
- frozen write surfaces;
- worker assignment;
- PRs;
- verification evidence.

## UX invariants

UI is a projection over canonical Arena contracts.

Role context is not permission.

Body is not Substrate.

Possession is the composition.

Certification is scoped to the tested composition.

Replay is not authoritative world mutation.

Demo state is not customer state.

Provider quota is visible and fail-closed.

## Provider posture

Vercel, Neon, R2, Upstash and Apify are infrastructure adapters. No provider details enter domain packages.

## Launch bar

B019 is the final public-preview gate.

Do not declare the product ready merely because source builds. All three product requirements plus product E2E, UX, accessibility, resilience and hosted deployment gates must be green.

After every accepted B merge, update spec/PROJECT-STATE.md, AI_CONTINUATION.md and docs/LLM-ARCHITECT-HANDOFF.md with live GitHub truth.

Do not ask the user to reconstruct prior decisions.

## Long-term product direction

Arena's approved north star is the Stripe of human expert escalation for AI automation.

C-series goal:
Any AI application can call Arena when an agent reaches a capability boundary and receive a validated human result through an API.

The human intervention may:
- solve;
- correct;
- unblock;
- review;
- teach;
- identify a missing tool;
- provide scoped domain knowledge;
- evaluate competing solutions.

Where permitted, experts work inside a privacy-sanitized replica of the agent's actual environment so the intervention is directly observable/replayable and can generate reusable capability artifacts.

Epoch is one client of the generic API.

B019 is MERGED (PR #103; launch gate executed; preview live). The C-series in
spec/human-escalation-work-items.md is the next roadmap; its first recommended
wave is C001, C002, C010 (issues #75/#76/#77 already track them).
- B016 MERGED
- B011 MERGED
- B013 MERGED


## G-CLOSURE — 2026-10-07 14:04 UTC

G001 (PR #108, 61d1f4f), G002 (PR #107, 3126596), G003 (PR #109, 1ca2603) are MERGED and
ACCEPTED. The post-B019 launch-integrity closure is COMPLETE:
Arena is installable, usable and publicly previewable (the strongest statement the
closure spec permits, now evidence-backed).

Operational note (honest infrastructure record): the 2026-10-07 G-wave ran under a
worker-brain outage — the z-ai worker gateway was quota-blocked from 12:08 UTC and
OpenRouter free-tier quota exhausted until midnight UTC; the three G work orders were
delivered by TL direct execution with full method disclosure in each PR/evidence set.
The C-series dispatches require a recovered worker brain (z-ai gateway recovery or the
OpenRouter daily reset at 00:00 UTC).

## FINAL ROADMAP FRONTIER — 2026-10-07

A001-A036: COMPLETE / MERGED.
B001-B019: COMPLETE / MERGED.
Post-B019 launch-integrity closure: COMPLETE (G001/G002/G003 MERGED 2026-10-07; issues #104/#105/#106 closed).

C001-C022 is the active implementation roadmap. First wave: C001 (#75).
Worker-brain status governs dispatch timing (see the operational note above).

Authoritative final handoff:
- docs/LLM-ARCHITECT-FINAL-HANDOFF.md

C-series canonical documents:
- spec/human-escalation-work-items.md
- spec/human-escalation-dependency-graph.md
- spec/arena-product-thesis.md
- spec/expert-escalation-api.md
- spec/expert-environment-session.md
- spec/adversarial-expert-evaluation.md
- spec/escalation-reference-flow.md

Correct C concurrency:
C001
→ C002 + C006 + C010
→ C003 + C007 + C017
→ C004 + C008 + C009
→ C005 + C011 + C012
→ C013 + C014 + C015
→ C016 + C018 + C020
→ C019 + C021 + C022

Maximum concurrent workers: 3.

The product thesis is locked: Arena is the Stripe of human expert escalation for AI automation.

Wave 5 LANDED (2026-10-07 20:23 UTC): C018 (PR #139, b3465ac), C005 (PR #140, 2062e4e) —
merged with TL lockfile intakes; integrated-main battery green at 2062e4e (101/101 tasks
all gates). 12 of 22 C-WOs landed. Worker channel: platform Task subagents; sprint-cycle
cadence (autonomous ~35-min session → reap → finisher re-dispatch returns with PR) proven
four times. Infra note: 3-worker concurrent batteries can transiently OOM the 4GB box on
@arena/web build — re-run solo and disclose; TL battery is authoritative. Wave 6
(C009 + C011, unlocked by C005) AUTHORIZED; wave 7 next: C012+C013+C014 after C009.
=== ROADMAP COMPLETE (2026-10-08 01:14 UTC) ===

Final wave LANDED: C016 (PR #148, 336c4b4), C022 (PR #149, 36b5fc6), C021 (PR #150,
fcc9215) — merged with TL lockfile intakes; integrated-main battery green at fcc9215
(120/120 tasks, all gates). ALL 80 WORK ORDERS MERGED: A001-A036 + B001-B019 + G001-G003 +
C001-C022. Honest notes: the 00:00 UTC deadline was missed by ~1.25h per the operator
directive to finish the roadmap; reference fabrics are in-memory by design (production host
wiring is the post-roadmap program); workers' architecture questions form the next
architecture-review backlog (preserved in PR bodies + PROJECT-STATE). The z-ai gateway
outage that started 12:08 UTC Oct 7 never recovered — the entire C-series (22 WOs, 15 PRs
#129-#150) was executed via platform-native Task subagents with the sprint-cycle cadence
(autonomous session → reap → finisher re-dispatch), documented in the worklog.


## AUTHORITATIVE FRONTIER — POST-ROADMAP PRODUCTIONIZATION (2026-10-09)

This section supersedes all earlier statements in this historical continuation file that say G001–G003 are pending or C001–C022 are the active implementation roadmap.

- A001–A036: COMPLETE / MERGED.
- B001–B019: COMPLETE / MERGED.
- G001–G003: COMPLETE / MERGED, with committed local, hosted and UX evidence.
- C001–C022: COMPLETE / MERGED.
- Roadmap total: 80/80 work orders merged.
- Latest reviewed main: 07a6b72d0fd82e087e159176a999b19adf8ced05.
- Latest integrated-main task battery recorded: 120/120 at fcc9215a548f8caa9b13d88858e07a31eca9c11f.
- CI and Deploy preview on 07a6b72: successful.

Next program: P001–P008 defined in spec/post-roadmap-production-work-items.md with graph in spec/post-roadmap-production-dependency-graph.md. First dispatch is P001 architecture-question closure. Once its blockers are resolved, P002/P004/P005 may run concurrently on disjoint surfaces, maximum three workers.

Critical limitations: reference fabrics remain in-memory in multiple services; C019's generic client is in-process rather than a deployed HTTP host and does not exercise MCP; G002 did not directly prove Neon migration/connectivity, R2 bucket was empty, and Upstash PING alone does not prove coordination; the launch-checklist matrix is stale at 7/69; /tasks has a minor route-surface concern; current hosted availability was not re-probed in this 2026-10-09 review; branch protection could not be verified by the connected GitHub integration. See docs/LLM-ARCHITECT-FINAL-HANDOFF.md and the new P work items.

Do not restart A/B/G/C. Do not claim production/commercial readiness from reference-fabric tests or a successful build alone.

## P000 ACCEPTANCE AND WAVE-0 AUTHORIZATION (2026-10-09, TL)

PR #151 (P000 final TL handoff, head 6e8e944) was merged by the TL at main 42f7ac8 after
the repository's normal merge gate: CI Battery success on the exact head SHA
(install/governance/boundary/typecheck/lint/test/build), mergeable state clean against
07a6b72, and TL content review of the work-items P1.0, dependency-graph P1.0, final
handoff doc, reconciled continuation records and the P-series registry/checker intake.
Issue #152 (P000) closed by the merge; issues #153-#160 track P001-P008.

The P008 release gate is now defined at spec/post-roadmap-release-gate.md (registered as
a P008 owned surface): evidence classes (DEMONSTRATED-LIVE / AUTOMATED-TEST-ONLY / OPEN /
BLOCKED / WAIVED), five hard gates (commercial boundary, tenant isolation/fail-closed,
deployed-artifact-SHA linkage, branch protection, checklist completeness), the minimum
evidence bundle mapping the handoff's material limitations, GO/NO-GO criteria and release
artifacts.

Frontier advanced on live main: P001 AUTHORIZED (wave 0 — architecture-question closure
over PRs #129-#150 and the C-series harvest in spec/PROJECT-STATE.md; owned surfaces
docs/architecture-review/* and docs/decisions/post-roadmap/*). Dependencies revalidated
from live main post-merge per the work-items rule. P002/P004/P005 dispatch waits on
P001's blocking decisions; maximum three concurrent workers on disjoint surfaces.

Release boundary preserved: roadmap completion is not production readiness. In-memory
reference fabrics, incomplete direct Neon proof, the empty-bucket R2 state,
PING-only Upstash evidence, the three unnamed unmounted web surfaces, the /tasks UX
finding, the 7/69 launch checklist, the 2026-10-07-dated hosted probes, the unverified
branch protection and the unsettled commercial payment responsibilities all remain open
and are tracked by the P-series. No live-money claim before the hard gates clear.

## P001 ACCEPTANCE AND WAVE-1 AUTHORIZATION (2026-10-09, TL)

PR #161 (P001 architecture-question closure, head e5821b0) was merged by the TL at main
d2f364f after the normal merge gate: CI Battery success on the exact head SHA
(install/governance/boundary/typecheck/lint/test/build), mergeable state clean against
5067356, and TL content review of the delivery — an 85-row architecture-question register
(docs/architecture-review/register.md: 83 PR questions from #129-#150, 11 material
limitations, the three unmounted web surfaces named) plus nine ADRs (ADR-P001-01..09)
covering the shared durable job runner, the Demo/customer truth lens, proposal-envelope
lineage, the fourth SLA clock, C005 read-surface ownership, host-side learning projection,
the host/provider responsibility split, the public transport lifecycle, and the
three-surface naming. Issue #153 closed by the merge. Honest lineage: the original P001
worker session died after ADR batch 1 (last activity 01:53:57Z); a finisher session of the
same worker identity completed ADR batch 2 per the sprint-cycle reap protocol — disclosed
in the PR body and the issue record. The ADRs bind downstream dispatch as of this merge
(Status: Proposed → ratified by TL acceptance in this harvest).

Wave 1 AUTHORIZED on live main d2f364f per spec/post-roadmap-production-dependency-graph.md
(scopes frozen, disjoint; maximum three concurrent workers):

- **P002** (issue #154) — durable host runtime, persistence and jobs. Surfaces:
  services/runtime-host/*, packages/runtime-host/*, adapters/hosted/neon-postgres/*,
  deploy/runtime/*, tests/runtime-host/*. Bound decisions: ADR-P001-01 (shared durable
  job runner over services/job-orchestrator + @arena/job-protocol), ADR-P001-06
  (host-side learning-candidate projection), ADR-P001-07 (host owns composition/
  persistence/jobs/secrets/tenant policy), plus register Part 5 rows.
- **P004** (issue #156) — real hosted-provider lifecycle and capacity. Surfaces:
  adapters/hosted/r2-object-store/*, adapters/hosted/upstash-redis/*,
  tests/hosted-provider-e2e/*, docs/evidence/production/providers/*. Bound decision:
  ADR-P001-07 (providers own only primitives behind adapters/hosted/*; fail-closed,
  never a silent paid fallback). No Neon code edits (P002 owns those).
- **P005** (issue #157) — route inventory, mount completion and /tasks UX finding.
  Surfaces: apps/web/src/app/* (route mounts), docs/evidence/production/ux/*. Bound
  decisions: ADR-P001-09 (the three named surfaces: competitions S-01, body-marketplace
  S-02, developer-portal interactive writes S-03; route/nested/non-UI disposition belongs
  to this WO), ADR-P001-02 (Demo/customer truth lens on read surfaces).

Dependencies were revalidated from live main post-merge per the dependency-graph law.
P003 (wave 2) waits on P002 freezing the host/runtime interface. The release boundary
stands: no live-money claim before the P008 hard gates clear.

## WAVE-1 HARVEST: P004 AND P005 ACCEPTED (2026-10-09, TL)

PR #162 (P004 hosted-provider lifecycle, head d4649c0) merged at main 9d2c9bc and PR #163
(P005 route inventory, head 8b5ec8d) merged at main 81dbb0e, both after the normal merge
gate: CI Battery success on the exact head SHAs, mergeable state clean, and TL content
review. Issues #156 and #157 closed by the merges.

P004 delivered: the hosted-provider E2E battery (tests/hosted-provider-e2e — live R2
object lifecycle, R2 failure/capacity matrix, live Upstash coordination semantics, Upstash
failure matrix, zero-credential fail-closed boot; 43 tests, 0 skipped, all live suites
active at harvest time) plus five evidence transcripts under docs/evidence/production/
providers/* classified per the release-gate vocabulary — R2 write/head/read+download/
digest/delete and Upstash lease/lock/idempotency/rate-limit/cache/isolation are
DEMONSTRATED-LIVE; adapter retry postures, SDK retry stubs and EXHAUSTED gates are
AUTOMATED-TEST-ONLY; live quota exhaustion, R2 retention, Upstash queue and true
cross-account access are honestly NOT claimed with recorded reasons. PING is recorded as
context only, closing L-005's "PING is not coordination proof" gap for the operations the
runtime uses. Honest lineage disclosed in the PR: the original worker died after the
battery commit; a finisher session committed the evidence and opened the PR.

P005 delivered: the reconciled route inventory (docs/evidence/production/ux/
route-inventory.md — 83 build-table rows reconciled against the UXM1.0 matrix and C-series
PR bodies), the three ADR-P001-09 surface dispositions (S-01 competitions MOUNTED at
/competitions + /competitions/[id]; S-02 body-marketplace MOUNTED at /body-marketplace +
/listings/[listingId] + /request-pretraining + /my-listings; S-03 developer-portal writes
RESOLVED with real POST API routes under /developers/api/* carrying fail-closed typed-401
auth, demo read-only 403, strict same-origin CSRF and the C001 idempotency law), and the
/tasks fix (L-007 — distinct honest signpost index, 5-test evidence). R-084 recorded
intentionally non-UI. Battery all green (8,039 tests passed / 0 failed). Honest lineage
disclosed: the original worker died after pushing M1/M2; a finisher delivered the
inventory + PR. Disclosed follow-ups: console UI wiring to the S-03 endpoints (C017
feature surface frozen for P005), durable idempotency + developer-platform runtime (P002),
and a TL-owned spec naming divergence (/runs/:id matrix name vs served /replay/[runKey]).

P002 remains in flight (worker lineage session 3): the frozen host-runtime interface
package (packages/runtime-host, M1 commit 426a764) is pushed; the neon-postgres durable
extension (M2) is in progress. TL lockfile intake is expected at P002 harvest (new
workspace package — the A017 reconcile precedent). P003 (wave 2) waits on P002 freezing
the host/runtime interface. The release boundary stands.

## P002 ACCEPTANCE AND WAVE-2 AUTHORIZATION (2026-10-09, TL)

PR #164 (P002 durable host runtime, head 23c8760 after TL lockfile intake) was merged by
the TL at main 377e4fe after the normal merge gate: CI Battery success on the exact head
SHA, mergeable state clean, and TL content review. Issue #154 closed by the merge.

P002 delivered (five-session worker lineage, each death + continuation disclosed in the
PR body): packages/runtime-host (the frozen host runtime interface — ports as pure data
per A015, lifecycle, health/readiness, registered job kinds per ADR-P001-01/06, truth lens
per ADR-P001-02); the neon-postgres durable extension (migrations 0003-0005: runtime
escalation/event/job/idempotency records; durable JobStore/EventSink; the multi-command
DDL split fix for the Neon HTTP driver with 12 credential-free transport tests);
services/runtime-host (the composition root: REAL escalation + routing + job-orchestrator
wiring); tests/runtime-host (the five acceptance proofs on BOTH embedded Postgres and live
Neon); deploy/runtime (the production composition + release-gate evidence summary). Live
Neon evidence: dedicated project arena-p002-evidence (square-glitter-02449657), PostgreSQL
18.6, migration ledger versions 1-5, restart-resume with verbatim history + digest-linked
audit chain, idempotent replay byte-stable, cross-tenant fail-closed typed errors. TL
lockfile intake 23c8760 registered the two new workspace packages after a green station
battery (governance/boundary clean, typecheck/lint/test/build 122/122; 8105 tests passed,
0 failed). Wave 1 is now COMPLETE: P002 + P004 + P005 all merged.

Wave 2 AUTHORIZED on live main 377e4fe per the dependency graph:

- **P003** (issue #155) — real HTTP/MCP/webhook transport over the NOW-FROZEN host
  runtime interface (packages/runtime-host is the binding seam). Surfaces:
  apps/api/*, services/escalation-api/src/http-host/*, services/escalation-api/src/
  mcp-host/*, services/webhook-delivery/*, tests/api-host/*. Bound decisions: ADR-P001-08
  (public transport lifecycle: scoped API-key auth, idempotent replay with typed conflict,
  at-least-once signed webhooks deduped per event id, shared error taxonomy, no
  Epoch-specific API) + ADR-P001-07 (host owns transport mounting).
- **P007 threat-model register** (issue #159, PARALLEL, read-only docs-only scope per the
  dependency graph's wave-2 note) — docs/security/post-roadmap/* only: the threat model
  from ADR-P001-07/08 attack classes + R-008 BLOCKED-COMMERCIAL in the threat model +
  register Part 5 P007 rows. NO test code, NO production code — the integrated P007 pass
  waits for P006.

The resident TL watch loop continues: monitor → harvest → review → approve/require-changes
→ dispatch next. The release boundary stands: no live-money claim before the P008 hard
gates clear.
