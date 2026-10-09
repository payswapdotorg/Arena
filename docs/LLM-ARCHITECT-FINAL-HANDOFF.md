# Arena — FINAL TECH LEAD / ORCHESTRATOR HANDOFF
## Post-roadmap productionization directive — 2026-10-09

**This document supersedes the historical handoff text and is the authoritative starting point for the next TL.** Repository state is the sole source of truth. Chat history is not an implementation dependency.

## 1. Current status — read first

Repository: https://github.com/payswapdotorg/Arena  
Reviewed main head: 07a6b72d0fd82e087e159176a999b19adf8ced05  
Latest integrated-main battery reported by the repo: 120/120 tasks green at fcc9215a548f8caa9b13d88858e07a31eca9c11f.  
Latest GitHub Actions on main head 07a6b72: CI succeeded; Deploy preview succeeded.  
Open PRs/issues at the review snapshot: none. Architecture lock: A2.0.

### Roadmap status

- A001–A036: COMPLETE / MERGED (36).
- B001–B019: COMPLETE / MERGED (19).
- G001–G003: COMPLETE / MERGED (3); launch-integrity evidence is committed.
- C001–C022: COMPLETE / MERGED (22).

**80/80 roadmap work orders are merged. Do not re-open or re-dispatch A, B, G, or C work orders as roadmap tasks.** Reopen a completed work order only for a reproducible, targeted defect, with an explicit issue and evidence.

This is roadmap completion, not a declaration that every service is production-integrated. The project-state record and individual PRs disclose that multiple C-series reference services use in-memory fabrics and injected/fake ports. Durable host wiring, production transport, full provider lifecycle verification and integrated acceptance are the next program.

### What has been demonstrated

- Fresh-machine local install/build/start and deterministic Demo behavior (G001).
- Local product E2E 28/28, UX 46/46 and product subtests 66/66 in the G001 run.
- Hosted preview HTTP probes and a live acceptance harness 5/5 on 2026-10-07 (G002).
- Capacity visibility, fail-closed quota behavior, no hidden paid fallback and a sampled served-bundle secret scan (G002).
- Fresh-browser UX audit across core surfaces, role lens, mobile viewport and keyboard navigation (G003).
- Final integrated-main task battery 120/120 at fcc9215, plus green CI and Deploy preview workflows on 07a6b72.

### Material limitations that must remain visible

1. **Reference fabrics are not the production host.** Several services use in-memory stores/fabrics, fake dependency ports, collecting proposal sinks or direct in-process composition. Replace these at the host boundary with real adapters; do not replace domain contracts or rebuild the domain modules.
2. **C019 is a reference integration, not a deployed external runtime.** The generic AI client walks public contract shapes over an in-process reference fabric. Its PR says the MCP escalation surface is not exercised by that example and a real HTTP deployment is outside C019's scope.
3. **Neon proof is incomplete.** G002 could list the Neon project but could not directly derive database connectivity and applied migration status without production connection-string access. App readiness was indirect evidence only.
4. **R2 lifecycle is not proven by bucket existence.** G002 recorded the configured bucket as empty at the time. A real create/read/list/delete or equivalent lifecycle test is still required.
5. **Upstash PING is connectivity, not end-to-end coordination proof.** Demonstrate the actual lock, idempotency, lease or queue path used by the hosted app.
6. **Three feature surfaces/mounts were reported as unmounted or not host-integrated in project-state/PR disclosures.** Identify their exact names from the live app route tree and source PR bodies; do not guess, silently omit or duplicate them.
7. **Minor UX finding:** /tasks was observed to render the generic landing shell rather than a distinct tasks-specific page. Triage under P005.
8. **Launch checklist is stale as a current readiness summary.** docs/launch-checklist.md has only 7/69 checkboxes checked while G-series evidence exists separately. Treat the matrix as unreconciled until P008 maps every item to evidence/status.
9. **Current hosted availability was not independently re-probed during the 2026-10-09 review.** The committed live probes are dated 2026-10-07; Deploy preview passed on 2026-10-08. Do not claim a successful 2026-10-09 browser probe from this review.
10. **Branch protection could not be verified through the current GitHub integration** (the endpoint returned 403). A previous review reported protection disabled. A repository administrator must confirm current rules and enable required CI/review gates if absent.
11. **Commercial release is not authorized merely by deterministic payment tests.** Real payment-provider integration, merchant-of-record, payouts, tax, refunds/disputes and jurisdiction responsibility must be decided before real funds are moved.

The historical deadline miss of about 1.25 hours and the worker gateway outage are recorded in the commit/PR history. They are not reasons to restart the roadmap or hide the technical limitations above.

## 2. Mission and locked architecture

Arena is the Stripe of human expert escalation for AI automation. Any AI application should be able to call Arena when its agent reaches a capability boundary. Arena interprets capability demand, discovers and qualifies an expert, provides a safe bounded work environment, captures observable work, validates the intervention, returns a machine-readable result, handles the commercial workflow, and may convert the intervention into a rights-cleared and validated reusable capability artifact.

Epoch is one client/integrator, not Arena's semantic center. A generic unrelated third-party AI application must use the same public contract without depending on Epoch domain types.

Architecture Lock A2.0 and the existing contracts remain authoritative:

- Agent Body is distinct from Cognitive Substrate/model. BodyVersion is immutable and content-addressed.
- Possession binds BodyVersion + CognitiveSubstrate + RuntimeProfile + EnvironmentProfile + PolicyBundle + optional artifacts.
- Certification belongs to a tested composition, not a raw model or role label. Evaluation, verification, certification and licensure remain distinct.
- Arena never mutates an external application's authoritative live world, World Model or Action state.
- Expert session capsules are bounded, tenant-scoped, secret-excluding and constrained by policy, allowed actions/tools, time and retention. They are isolated from the host application's live authority.
- Capture observable actions, tool calls/results, artifacts, annotations, checkpoints, evidence and corrections. Never require or expose private chain-of-thought.
- Immediate task results and reusable learning are separate. Reuse requires rights, scope, provenance, validation and appropriate consent.
- Expert qualification is not authorization. Role/lens context is not authorization.
- History/evidence/BodyVersions remain append-only or immutable where their contracts require.
- Async operations need durable identity, correlation, idempotency and defined retry/failure behavior.
- Tenant isolation and fail-closed behavior belong at service boundaries, not only in UI.
- Provider-specific types stay in adapter/host packages.
- Payment is provider-neutral in domain contracts; no live-money claim without approved production/compliance ownership.
- Upvote/downvote ratios are discovery signals, not verification/certification authority.
- Demo state is not customer state. Replay is observational unless a separately authorized action is explicitly issued.

Escalation modes: SOLVE, CORRECT, UNBLOCK, REVIEW, TEACH, TOOL_GAP, KNOWLEDGE and EVALUATE.

Canonical loop: AI app/agent → Escalation Request → Capability Demand → Expert Match → bounded Expert Session → Intervention → Validation/Adjudication → typed Result → settlement → optional rights-gated Learning.

## 3. Repository source of truth

Read in this order:

1. spec/PROJECT-STATE.md — current progress and known limitations.
2. AI_CONTINUATION.md — current frontier; its final section supersedes historical entries.
3. spec/architecture-lock.md and docs/architecture-lock.md — locked architecture.
4. spec/post-roadmap-production-work-items.md — P001–P008 work-order definitions.
5. spec/post-roadmap-production-dependency-graph.md — sequencing/concurrency.
6. spec/human-escalation-work-items.md and spec/human-escalation-dependency-graph.md — completed C-series record/semantics.
7. docs/launch/evidence-index.md and docs/evidence/* — committed local, hosted and UX proof.
8. docs/launch-checklist.md — historical matrix until P008 reconciles it.
9. Merged PRs #129–#150 — C-series implementation details, limitations and architecture questions.

This handoff supersedes the old state in docs/LLM-ARCHITECT-HANDOFF.md and corrects the prior final handoff's obsolete instructions to start G001–G003 and then C001.

## 4. Productionization work program

P001–P008 are a new productionization/integration program, not additions to the completed 80-order roadmap. The TL must track each as one issue, one branch and one PR. Use live main for every dispatch and record acceptance evidence.

### P001 — Architecture-question closure and host-boundary decisions

**First.** Inventory every architecture question/limitation in C-series PRs #129–#150 and the C-series harvest record in spec/PROJECT-STATE.md. Create a register with source PR, question, alternatives, decision, owner, impacted contracts/surfaces and blocking/non-blocking status. Resolve semantic questions through ADRs before code changes.

At minimum review: shared durable job-runner vs per-service persistence; canonical demo/customer truth-lens convention; C022 A021/A022/A023 proposal lineage and sink compatibility; C021 fourth SLA clock vs C011's three clocks; C021 declared-but-unconsumed C005 dependency; host-side projectors for C008/C009/C013/C014 candidates; provider/host responsibilities; public HTTP/MCP/webhook lifecycle/auth/retry/idempotency/error shapes; and the exact three unmounted/unintegrated feature surfaces. No worker may silently normalize an open semantic question.

### P002 — Durable production runtime, persistence and jobs

Depends on P001 decisions affecting lifecycle/job/persistence semantics. Integrate existing services with the existing Neon/Postgres adapter and versioned migrations rather than inventing a second domain store. Define the composition root, durable lifecycle/event records, job scheduling/recovery, idempotency/correlation, tenant-scoped access, retention and replay rules. Prove a process restart does not lose accepted work or duplicate a completed job. In-memory fabrics remain test fixtures, not the only production persistence path.

### P003 — Real application transport for escalation lifecycle

Depends on P002's accepted host/runtime contract. Expose existing public C001/ES1.0 operations on a runnable HTTP host. Bind real auth/API-key and tenant policy; create/read/list/status; idempotency replay/conflict; correlation/causation; signed webhooks with at-least-once retry/dedupe; documented errors and health/readiness; and MCP with the same authority/schema rules. No Epoch-specific core API. The generic AI client must use a real local/hosted URL, not only an in-process object.

### P004 — Real hosted-provider lifecycle and fail-closed capacity

Adapter-only surfaces; may run alongside P002/P005 after P001 if paths remain disjoint. Use existing Neon, R2 and Upstash adapters. Demonstrate versioned Neon migrations/connectivity; R2 artifact write/read/download/list-or-digest/delete/retention as applicable; the actual Upstash coordination operation used by the runtime, not just PING; visible fail-closed quota exhaustion without paid fallback; server-only credentials and secret-leak negatives; truthful recoverable outage/misconfiguration states. Coordinate Neon code ownership with P002. Record resource IDs and redacted variable names only.

### P005 — Route inventory, missing web mounts and UX finding

Inventory apps/web/src/app against the route matrix and C-series PRs. Name the three reported unmounted/unintegrated surfaces exactly; decide whether each should be a first-class route, a nested existing surface or intentionally non-UI. Mount intended routes through shared shell/session/tenant policy; preserve truth/state vocabulary, persistent role lens and Demo/customer distinction. Fix or formally accept /tasks. Check loading, empty, error, denied, mobile and keyboard states. Reuse existing feature components.

### P006 — Full integrated generic-app and Epoch acceptance

Depends on P002–P005. Build an integration suite against the real host and durable adapters. Prove the same public flow for a generic non-Epoch app and Epoch: authenticated request; capability demand/routing; expert offer/acceptance; bounded session and tenant/action/secret isolation; observable intervention/artifact capture; validation/adjudication; typed result; webhook retry/dedupe and status polling; payment test/sandbox lifecycle with no real money in CI; consent/rights-gated learning and Q1.0; observational replay and external live-world writeback denial; restart, duplicate, concurrency, timeout, outage and recovery.

Both clients must call public transport contracts. The in-process C019 walkthrough remains a reference/unit test, not production host-connectivity proof.

### P007 — Security, privacy and resilience audit

Threat-model/read-only work can begin after P001; integrated acceptance depends on P002–P006. Attack tenant isolation, session capsule secrets/expiry, unauthorized tools/actions, webhook forgery/replay, API-key leakage, object-store cross-tenant access, idempotency races, job restarts, partial payment state, learning rights/scope, digest mismatch, policy drift and external live-world writeback. Verify fail-closed behavior, audit, rate limits, retry/dead-letter and that task-specific advice cannot silently become global knowledge. Add regression tests and classify findings; no checklist-only signoff.

### P008 — Release evidence, checklist and governance

After P006 and required P007 fixes. Reconcile every row of docs/launch-checklist.md to a committed evidence artifact and label it demonstrated, automated-test-only, open, blocked or not applicable. Do not infer current status from 7/69. Refresh local proof; current hosted URL/deployment commit identity and E2E flow; Neon migrations/connectivity; R2 lifecycle; Upstash operation; quotas/secrets; UX/routes/accessibility; generic/Epoch integration; known limitations and recovery notes. A repository administrator must verify main branch protection and required checks. Decide production payment/legal/jurisdiction responsibilities. P008 owns the release-gate decision.

## 5. Dependency graph and concurrency

Use spec/post-roadmap-production-dependency-graph.md.

- P001 first.
- After P001, P002 + P004 + P005 may run concurrently on frozen, disjoint surfaces.
- P003 depends on P002.
- P006 depends on P002/P003/P004/P005.
- P007 threat model may start earlier; its integrated acceptance depends on P002–P006.
- P008 final acceptance depends on P006 and disposition of P007 blockers.

Maximum three concurrent workers. One WO = one branch = one PR. Workers get exact base SHA, frozen owned paths, prohibited paths and verification gates. TL owns root manifests/lockfiles/workspace globs/contract generation, final integration, frontier docs and merges. Recompute readiness from main before each dispatch. No broad rebase or overlapping edits.

## 6. Evidence and merge law

For every P work order record exact base/head SHAs, owned/excluded paths, issue/branch/PR, commands at pushed SHA, governance/boundary check, contract-generation diff, typecheck, lint, tests and build, owned test counts, post-merge integrated battery, real provider evidence with secrets redacted, limitations and architecture questions. Never claim live-host execution when only an in-memory test ran. Re-run owned suites at the pushed SHA; record cache/resource-related retries and final results. Root lockfile/manifests are TL-serialized. Maximum three active workers.

## 7. Definition of done

- P001 decisions register exists and semantic blockers are closed.
- Durable lifecycle/job state survives restart, retries and concurrent duplicate requests.
- Real HTTP and MCP operate over public contracts; webhooks are signed/retried/deduplicated.
- Neon migration/connectivity and R2/Upstash lifecycle are directly demonstrated.
- Intended feature routes are mounted and /tasks is fixed or explicitly accepted.
- Generic app and Epoch complete the same end-to-end flow against the actual host.
- Session privacy, tenant isolation and external live-world boundary pass adversarial tests.
- Payments remain explicitly sandbox/test-only or have approved provider/legal ownership.
- P007 blockers are fixed or formally accepted by the release owner.
- CI and deploy preview pass at final integrated SHA, linked to current hosted evidence.
- Each launch checklist row has truthful status and direct evidence.
- Branch protection and required checks are confirmed.
- PROJECT-STATE, AI_CONTINUATION, checklist, graph and handoff agree.

## 8. Immediate TL actions

1. Verify live main and this handoff's base/frontier.
2. Dispatch P001 and create the architecture-question register.
3. After its decision gate, dispatch no more than three disjoint P002/P004/P005 branches.
4. Continue in dependency order; do not restart A/B/G/C.
5. Distinguish implemented code, automated-test pass, local proof, hosted proof and production/commercial approval in every status statement.

Arena's source tree and evidence artifacts—not chat—are the continuation contract.
