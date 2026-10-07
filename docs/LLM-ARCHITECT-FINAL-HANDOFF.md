# Arena — FINAL TECH LEAD / ORCHESTRATOR HANDOFF
## Authoritative implementation directive — 2026-10-07

Repository state is the sole source of truth. Chat is not an authority source.

## 1. Current state

V1: A001-A036 MERGED.
B-series: B001-B019 MERGED.
Latest known main acceptance: d94c0a4af210dbcfe8937d71270cd1a06cd4c905.
CI on that main head is green.
The repository records a hosted preview at https://arena-preview-five.vercel.app.

Important status distinction:
- B-series implementation is complete.
- B019 deployment wiring is implemented and has recorded successful launch-day probes.
- launch evidence closure is COMPLETE: G001 (PR #108), G002 (PR #107), G003 (PR #109) merged 2026-10-07.
- Arena is installable, usable and publicly previewable (evidence-backed).
- C001-C022 have not yet been implemented; C001 is the first dispatch of the active roadmap.

## 2. Mission

Drive the remaining roadmap to a demonstrated product and then to the complete Human Expert Escalation infrastructure.

North star:

Arena is the Stripe of human expert escalation for AI automation.

Any AI application should be able to call Arena when an agent reaches a capability boundary. Arena acquires the appropriate human capability, provides a safe task environment, validates the intervention, returns a machine-readable result, handles the commercial transaction, and optionally turns the intervention into reusable tools, knowledge, skills, evaluation assets or Agent Body improvements.

Epoch is one customer/integrator. It is not Arena's semantic center.

## 3. Locked architecture

- Agent Body is a first-class persistent object.
- Body Version is immutable and content-addressed.
- Cognitive Substrate is distinct from Agent Body.
- Possession binds Body Version to Substrate and runtime/environment/policy.
- Certification applies to the tested composition, not the raw model.
- Evaluation and Verification remain distinct.
- Historical evidence is append-only.
- Expert qualification is distinct from authorization.
- Host application remains authoritative for its live world.
- Arena never directly mutates an external application's authoritative World Model or Action state.
- Providers remain behind adapters.
- Long-running jobs are durable and idempotent/correlation-addressable.
- Customer/tenant data remains isolated.

Any violation requires an Architecture Change Request.

## 4. Human escalation contract

Supported modes:
- SOLVE
- CORRECT
- UNBLOCK
- REVIEW
- TEACH
- TOOL_GAP
- KNOWLEDGE
- EVALUATE

Primary external lifecycle:

AI application → Escalation Request → Capability Demand → Expert Match → Expert Session → Intervention → Validation → Result → Payment → optional Learning.

Immediate operational result is distinct from reusable learning.

Reusable learning requires explicit rights, provenance, validation and scope.

## 5. Same-environment expert session

When supported, Arena creates a bounded Expert Session Capsule from the agent's execution state.

The expert accesses it through a secure session link.

The session must preserve relevant task context while enforcing:
- tenant isolation;
- privacy and data minimization;
- secret exclusion;
- action/tool allowlists;
- retention policy;
- time limits;
- separation from the application's live authoritative world.

The originating agent/application may observe approved events such as human actions, tool calls, artifact changes, annotations, checkpoints and final results.

Do not require or expose private chain-of-thought. Capture observable work and explicit evidence.

## 6. Tool and knowledge improvement

An intervention may produce:
- immediate correction;
- scoped knowledge patch;
- ToolGapSignal;
- tool specification;
- skill candidate;
- evaluator;
- benchmark;
- Agent Body improvement;
- reusable marketplace artifact.

Nothing becomes globally reusable automatically.

A tool-gap signal must record what was needed, why it was needed, what capability it provided, relevant evidence, access requirements and whether substitution was possible.

Task-specific advice must not silently become universal knowledge.

## 7. Competition evaluation

Alternative evaluator route:

Problem → independent expert solutions → challenge → evidence/proof → response → qualified voting → adjudication → verification.

Upvote/downvote ratio is a community/discovery signal only.

Guardrails include:
- no self-voting;
- evidence requirements;
- conflict-of-interest handling;
- minimum sample thresholds;
- rate limiting/anti-brigading;
- qualification-aware aggregation;
- explicit tie/unknown states.

Competition cannot bypass Verification or certification authority.

## 8. Commercial model

The originating application may provide:
- budget;
- currency;
- urgency;
- deadline;
- validation condition.

Arena handles:
- offer/acceptance;
- validation condition;
- expert payout;
- Arena platform fee;
- revision/refund states;
- commercial audit.

Payment providers are adapters. Merchant-of-record, payout, tax and jurisdiction responsibilities must be explicit before production commercial rollout.

## 9. Immediate stage — G001-G003

These are the post-B019 Launch Integrity Closure work orders.

G001 — issue #104
Fresh-machine/local proof and reconciliation.
Owned: docs/evidence/local/* and release/evidence/local/*.

Prove on a genuinely clean environment:
- install;
- build;
- start;
- landing;
- Demo;
- Demo reset;
- representative lifecycle;
- reference Bodies;
- role switching;
- replay;
- evaluation/certification;
- documented persistence behavior.

G002 — issue #105
Current hosted proof and provider/quota reconciliation.
Owned: docs/evidence/hosted/* and release/evidence/hosted/*.

Reconcile CURRENT state, not only historical October 4 records:
- public URL;
- current HTTP reachability;
- Vercel deployment;
- Neon connectivity and migrations;
- R2 lifecycle;
- Upstash coordination;
- capacity state;
- fail-closed quota behavior;
- absence of paid fallback;
- server-side secret posture.

A current Vercel authorization/access failure is a blocker for independently claiming current hosted availability until resolved or explicitly documented.

G003 — issue #106
Fresh-browser UX/product audit.
Owned: docs/evidence/ux/* and release/evidence/ux/*.

Inspect:
- landing;
- Demo;
- role switch;
- cases;
- expert workbench;
- Body Studio;
- replay;
- evaluation/certification;
- marketplace;
- operations;
- mobile/responsive;
- keyboard accessibility;
- loading/empty/error/denied states.

Judge actual comprehension, CTA clarity, truth labels, role safety, responsive quality and usability.

G001/G002/G003 are disjoint and may run concurrently.

## 10. C-series roadmap

The complete roadmap is defined in spec/human-escalation-work-items.md.

C001 — Expert Escalation API, MCP, webhooks and durable lifecycle.
C002 — Capability-demand compiler and expert routing.
C003 — AI Expert Intake and adaptive capability interview.
C004 — Expert calibration, pre-training and continuous requalification.
C005 — Longitudinal expert performance evidence profile.
C006 — Expert environment capsule and privacy-safe session replication.
C007 — Human intervention modes.
C008 — Tool-gap and domain-knowledge capture.
C009 — Escalation validation, adjudication, revision and replacement.
C010 — Payments, escrow/hold, platform fees and payouts.
C011 — Expert engagement, availability, scheduling and SLAs.
C012 — Human-data production studio.
C013 — Adversarial Expert Evaluation / Expert Arena.
C014 — On-demand Agent Body pretraining and capability-body marketplace.
C015 — Capability-demand routing across experts, Bodies, tools, knowledge and artifacts.
C016 — Capability economics.
C017 — Developer portal, API keys, sandbox, SDK quickstarts and escalation observability.
C018 — Enterprise privacy, retention and session policy packs.
C019 — Epoch and generic AI application integrations.
C020 — Network quality, disputes, conflicts, anti-gaming and fraud.
C021 — Human escalation operations and SLA observability.
C022 — Capability learning compiler from intervention to tool/knowledge/skill/Body/evaluator improvements.

## 11. Correct C-series dependency schedule

Do not dispatch C002 with C001; C002 depends on C001.

Wave C1:
- C001

Wave C2 after C001:
- C002
- C006
- C010

Wave C3:
- C003
- C007
- C017

Wave C4:
- C004
- C008
- C009

Wave C5:
- C005
- C011
- C012

Wave C6:
- C013
- C014
- C015

Wave C7:
- C016
- C018
- C020

Wave C8:
- C019
- C021
- C022

The authoritative graph is spec/human-escalation-dependency-graph.md.
The TL may pull an independently-ready item forward if dependencies are satisfied and write surfaces remain disjoint.

## 12. Three-worker orchestration law

Maximum concurrent workers: 3.

One Work Order = one branch = one PR.

Before dispatch:
1. inspect live GitHub;
2. confirm dependencies are merged;
3. record exact base SHA;
4. freeze write surfaces;
5. confirm no overlapping active worker;
6. provide explicit acceptance criteria.

Worker rules:
- stay within owned surfaces;
- no self-merge;
- no hidden scope expansion;
- no root lockfile/manifest edits unless TL-authorized;
- include positive and negative tests;
- provide exact commands/results;
- disclose limitations.

TL rules:
- independently inspect changed paths;
- run the station battery;
- reconcile lockfiles centrally;
- require remediation on the same PR;
- record merge SHA and evidence;
- update project state and continuation documents;
- recompute the frontier from live state.

## 13. Root-file discipline

Root manifests, lockfiles, generated top-level contracts and governance files are serialized TL-owned surfaces.

Never let concurrent workers edit them independently.

## 14. C-series developer API

The first public boundary should be simple.

Conceptual call:

POST /v1/escalations

Input includes:
- capability need;
- source workflow/run/task references;
- budget;
- urgency/deadline;
- desired result schema;
- expert requirements;
- environment-session policy;
- privacy policy;
- permitted intervention modes;
- learning permissions;
- retention;
- idempotency key;
- correlation ID.

Return includes:
- durable request_id;
- status;
- session reference where allowed;
- validated result;
- evidence;
- validation status;
- cost;
- expert payout state;
- Arena fee;
- reusable artifact references where allowed.

Support REST, webhooks, SDKs and MCP while preserving one canonical lifecycle.

## 15. C-series reference proof

Do not declare C-series complete until an unrelated third-party AI application can perform the complete flow.

Required proof:

Third-party AI Application
→ Arena API
→ capability demand
→ qualified expert
→ bounded expert session
→ intervention
→ validation
→ structured result
→ payment
→ Arena fee
→ optional learning/tool/knowledge/body artifacts.

Epoch and one independent generic client must both prove the public contract.

## 16. Canonical BOQ demonstration

Use the Accra-house BOQ scenario as one reference vertical.

The agent encounters uncertainty.
Arena receives an escalation.
A qualified expert receives the task-state replica.
The expert solves, corrects or unblocks.
The expert can signal a missing tool or scoped domain rule.
Arena validates the result.
The application receives a structured result.
The expert is paid and Arena records its fee.
Approved reusable artifacts may be produced.
The external application resumes its own authoritative workflow.

## 17. Product UX requirements

The existing B-series shell remains the UX foundation.

Important role lenses include:
- Owner/Customer;
- Agent Builder;
- Expert;
- Evaluator;
- Researcher;
- Operator;
- Marketplace Participant;
- Administrator;
- future Application Developer / Capability Program Manager.

Role context changes presentation, not authority.

UX should make escalation feel immediate and understandable:

Agent stuck → Human help → What is missing → Budget/urgency → Expert found → Expert working → Watch/inspect → Validated result → Resume automation.

Workers may be creative in visual composition, replay, expert-session presentation, capability maps, evidence graphs and competition views.

Workers may not alter canonical semantics, tenancy, permissions, verification, certification or host-application authority.

## 18. Testing requirements

Each C work order requires the relevant combination of:
- unit tests;
- contract tests;
- integration tests;
- adversarial/security tests;
- product E2E;
- external-client E2E where relevant;
- commercial E2E where relevant.

Important adversarial cases:
- cross-tenant escalation;
- role escalation;
- session escape;
- secret leakage;
- live-world mutation attempt;
- duplicate payout;
- duplicate webhook;
- idempotency conflict;
- expired/revoked commercial state;
- expert impersonation;
- voting abuse;
- provenance tampering;
- knowledge overgeneralization.

## 19. Launch truth

Use precise status language.

Acceptable:
- B-series implementation complete.
- hosted preview deployed.
- launch evidence G001-G003 complete.
- C-series items implemented.

Do not claim without direct evidence:
- fully production ready;
- unlimited free usage;
- globally available expert coverage;
- correctness guaranteed;
- certification equals professional licensure;
- replay changes the live world.

## 20. Repository synchronization

After every accepted work order update:
- spec/PROJECT-STATE.md;
- AI_CONTINUATION.md;
- docs/LLM-ARCHITECT-HANDOFF.md;
- relevant dependency graph;
- evidence indexes;
- exact merge SHA;
- verification evidence.

If the actual GitHub state conflicts with repository prose, live GitHub state wins and the prose must be corrected.

## 21. Immediate execution directive

1. Read this document and every linked source-of-truth file.
2. Inspect live main, branches, PRs, issues, CI and deployment access.
3. Confirm main is still at or beyond the recorded B019 acceptance state.
4. Dispatch G001, G002 and G003 concurrently.
5. Reconcile their results and close the launch-evidence discrepancy.
6. Do not reopen B-series unless a concrete defect requires it.
7. After launch integrity closure, dispatch C001.
8. After C001, dispatch C002 + C006 + C010 concurrently.
9. Continue through C022 using the corrected dependency graph and three-worker concurrency law.
10. Do not wait for additional chat instructions between ordinary roadmap steps.

## 22. Final definition of done

Arena is complete when an external AI application can:

- escalate a capability boundary to Arena;
- obtain a qualified human expert;
- give that expert a privacy-safe replica of the agent environment;
- allow solve/correct/unblock/review/teach work;
- expose approved observable intervention data;
- validate the intervention;
- return a machine-readable result;
- settle expert payment and Arena's platform fee;
- optionally produce approved tool, knowledge, skill, evaluation or Agent Body improvement artifacts;
- replay the intervention where permitted;
- recover from rejection/revision/replacement;
- observe the durable lifecycle through API/webhooks;
- work through the same generic contract for Epoch and an unrelated application.

That is the product boundary the TL must implement and prove.