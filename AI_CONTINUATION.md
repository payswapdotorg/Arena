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
