# Arena Stateless Continuation

Fresh-session rule: recover Arena entirely from repository state and live GitHub state.

## Status

Arena V1 A001-A036 is complete and merged.

The active implementation program is the B-series productization program, governed by:
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

Next: B007 (role-aware Home/Capability Cockpit + global navigation) is
AUTHORIZED with deps satisfied (B001+B003+B004+B005+B006). B008-B014 all
gate on B007. C-series governance roster extension (checker C-id parsing)
is required before any C-series dispatch.

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

After B019, the C-series in spec/human-escalation-work-items.md becomes the next roadmap.
