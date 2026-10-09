# Arena Post-Roadmap Productionization Work Items P1.0

**Snapshot:** 2026-10-09. A001–A036, B001–B019, G001–G003 and C001–C022 are complete/merged (80 work orders). P001–P008 are a follow-on productionization program, not a reopening of the original roadmap.


| ID | Scope | Depends | Owned surfaces |
|---|---|---|---|
| P000 | Post-roadmap handoff and governance registration | roadmap complete | governance handoff/docs and P-series registry/checker intake |
| P001 | Architecture-question closure and host-boundary decisions | P000 | docs/architecture-review/*; docs/decisions/post-roadmap/* |
| P002 | Durable host runtime, Neon persistence and jobs | P001 | services/runtime-host/*; packages/runtime-host/*; adapters/hosted/neon-postgres/*; deploy/runtime/*; tests/runtime-host/* |
| P003 | Real HTTP/MCP/webhook transport | P002 | apps/api/*; services/escalation-api/src/http-host/*; services/escalation-api/src/mcp-host/*; services/webhook-delivery/*; tests/api-host/* |
| P004 | Real hosted-provider lifecycle | P001 | adapters/hosted/r2-object-store/*; adapters/hosted/upstash-redis/*; tests/hosted-provider-e2e/*; docs/evidence/production/providers/* |
| P005 | Web route inventory and mount completion | P001 | apps/web/src/app/*; docs/evidence/production/ux/* |
| P006 | Integrated generic-app + Epoch E2E | P002,P003,P004,P005 | tests/integration/production/*; docs/evidence/production/integration/*; examples/generic-ai-client/deployment-tests/*; adapters/epoch-escalation/host-integration-tests/* |
| P007 | Integrated security/privacy/resilience acceptance | P001,P002,P003,P004,P005,P006 | docs/security/post-roadmap/*; tests/security/production/*; tests/resilience/production/*; docs/evidence/production/security/* |
| P008 | Release evidence, checklist and governance | P006,P007 | docs/launch-checklist.md; docs/evidence/production/*; release/evidence/production/*; final handoff/frontier docs |

## Rules

One WO = one issue, one branch, one PR with frozen write surfaces. Maximum three concurrent workers. TL owns root manifests, lockfiles, workspace globs, contract generation and release-state reconciliation. Every WO records exact base/head SHA, tests, limitations, architecture questions and evidence. Reference-fabric tests and real host/provider proof are different evidence classes. Architecture Lock A2.0 remains binding unless an approved ACR changes it.

## P001 — Architecture-question closure and host-boundary decisions
**Order:** first. **Owned surfaces:** docs/architecture-review/* and a single chosen canonical ADR directory under docs/decisions/post-roadmap/* (link it from other indexes rather than duplicating decisions).

Inventory every architecture question/limitation in PRs #129–#150 and the C-series harvest in spec/PROJECT-STATE.md. Record source PR, question, options, affected contracts/seams, risk, decision/owner and blocking status. Resolve blockers with ADRs before implementation. Explicit topics: shared job runner vs per-service persistence; canonical Demo/customer truth-lens; C022 A021/A022/A023 proposal-envelope lineage; C021 fourth SLA clock vs C011 three-clock contract; C021 declared-but-unconsumed C005 dependency; projectors for C008/C009/C013/C014 learning candidates; host/provider responsibilities; HTTP/MCP/webhook/auth/retry/idempotency/error semantics; exact three unmounted/unintegrated feature surfaces. Silent semantic normalization is prohibited.

**Acceptance:** every recorded question has a decision or explicit non-blocking follow-up; downstream work orders list required decisions; no Architecture Lock change without an ACR.

## P002 — Durable host runtime, persistence and jobs
**Depends on:** P001's blocking persistence/lifecycle decisions. **Initial owned surfaces:** services/runtime-host/*; packages/runtime-host/*; adapters/hosted/neon-postgres/*; deploy/runtime/*; tests/runtime-host/*. Freeze scope after tree inventory; TL serializes root manifests.

Compose existing services behind a host composition root; use the existing Neon/Postgres adapter and versioned migrations; persist lifecycle/event records, idempotency outcomes and durable jobs; preserve correlation, tenant isolation, append-only history and retention semantics; recover safely after process restart. In-memory reference fabrics must remain test-only, not the only runtime path.

**Acceptance:** clean database migrates from zero; real adapter persists and reads accepted escalations; restart resumes without loss or duplicate transition; retries return deterministic recorded outcomes; cross-tenant access fails closed; evidence includes exact environment, commands and redacted configuration.

## P003 — Real HTTP/MCP/webhook application transport
**Depends on:** P002's accepted host/runtime interface. **Initial owned surfaces:** apps/api/*; services/escalation-api/src/http-host/*; services/escalation-api/src/mcp-host/*; services/webhook-delivery/*; tests/api-host/*. No edits to P002 runtime core; adjust paths once before dispatch to match existing tree.

Expose existing C001/ES1.0 contracts on a runnable HTTP listener; bind API-key/auth and tenant policy; support creation and status/result retrieval, idempotency replay/conflict, correlation/causation, documented errors/health, signed webhook retries and event-ID dedupe, plus MCP with the same authority/schema. Do not create an Epoch-specific API.

**Acceptance:** generic client uses an actual local/deployed URL; end-to-end result and signed webhook verify; MCP operates against the same boundary; auth/tenant mismatch, duplicate delivery, forgery, collision, timeout and retry tests pass. No private chain-of-thought capture.

## P004 — Real hosted-provider lifecycle and capacity
**Depends on:** P001; may parallelize with P002/P005 on disjoint adapter surfaces. **Owned surfaces:** adapters/hosted/r2-object-store/*; adapters/hosted/upstash-redis/*; tests/hosted-provider-e2e/*; docs/evidence/production/providers/*.

Use existing adapters. Demonstrate R2 authorized write/read/download/list-or-digest/delete/retention path as applicable, and actual Upstash coordination semantics used by the runtime—not only PING. Coordinate Neon code ownership with P002. Verify server-side secrets, wrong credentials, cross-tenant object access, retries, quota exhaustion and fail-closed/no-paid-fallback behavior.

**Acceptance:** redacted live-provider evidence proves each critical operation/failure/recovery; configured resource, PING or empty bucket alone is not proof. Demo still runs with zero provider credentials.

## P005 — Route inventory, mount completion and UX finding
**Depends on:** P001 route/ownership decisions; may parallelize with P002/P004 on distinct surfaces. **Owned surfaces:** apps/web/src/app/* for route mounts; feature code only for isolated defects in a surface not owned by another WO; docs/evidence/production/ux/*.

Compare the App Router with route matrix and C-series PR bodies. Identify the exact three surfaces previously reported as unmounted/unintegrated and decide route, nested route or intentionally non-UI status. Mount intended surfaces using shared shell/session/tenant protection. Fix or formally accept /tasks rendering the landing shell. Preserve honest loading/empty/error/denied/demo/customer truth states, persistent role lenses, mobile and keyboard behavior.

**Acceptance:** route inventory is reconciled; served-route tests cover every intended public feature; auth/tenant and state suites pass; /tasks is fixed with evidence or explicitly accepted by release owner.

## P006 — Integrated generic-AI-app + Epoch end-to-end acceptance
**Depends on:** P002–P005. **Owned surfaces:** tests/integration/production/*; docs/evidence/production/integration/*; examples/generic-ai-client/deployment-tests/*; adapters/epoch-escalation/host-integration-tests/*.

Run both generic client and Epoch adapter through the real host and durable stores. Prove request → capability demand/routing → offer/acceptance → bounded expert session → observable intervention/artifacts → validation/adjudication → typed result → webhook retry/dedupe and polling → payment test/sandbox → consent/rights-gated learning candidate and Q1.0 → observational replay with external live-world writeback denied. Include restart, duplicate, concurrency, timeout, provider outage and recovery. Both clients must use public transport, not direct in-process service references.

**Acceptance:** evidence names transport/environment and deployed source SHA; both clients pass identical public flow; CI moves no real money; no historical evidence is rewritten and no rights-free global learning occurs.

## P007 — Security, privacy and resilience
**Depends on:** P001 for threat model; integrated pass depends on P002–P006. **Owned surfaces:** docs/security/post-roadmap/*; tests/security/production/*; tests/resilience/production/*; docs/evidence/production/security/*.

Attack tenant isolation, capsule secrets/expiry, unauthorized tool/action use, webhook forgery/replay, API-key leakage, object-store cross-tenant access, idempotency races, worker restart, partial payment state, learning rights/scope, digest mismatch, policy drift and live-world writeback. Verify fail-closed defaults, audit, rate limits, retries/dead-letter and no silent promotion of task-specific advice to global knowledge.

**Acceptance:** critical/high findings fixed or explicitly block release; regression tests reproduce findings; lower-severity findings have owners/dispositions; no authority/privacy/rights/evidence bypass remains unreported.

## P008 — Release evidence, checklist and governance
**Depends on:** P006 and disposition of P007 blockers. A read-only branch protection check can start sooner. **Owned surfaces:** docs/launch-checklist.md; docs/evidence/production/*; release/evidence/production/*; docs/LLM-ARCHITECT-FINAL-HANDOFF.md; AI_CONTINUATION.md; spec/PROJECT-STATE.md. Serialize changes to these frontier docs.

Map each checklist row to direct evidence and classify demonstrated, automated-test-only, open, blocked or not applicable. Refresh current hosted URL/deployment SHA, local proof, Neon migration/connectivity, R2 lifecycle, Upstash operation, quota/secrets, UX/routes/accessibility, generic/Epoch integration and recovery/limitations. A repo administrator must confirm branch protection and required checks. State payment/legal/jurisdiction responsibility before commercial claims.

**Acceptance:** no checked item lacks evidence; every open/blocked item has owner and next step; CI/deploy pass on final integrated SHA; deployed artifact is linked to source SHA; release claims match evidence; branch protection is recorded.

