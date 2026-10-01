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

Next: B005 (persisted control-plane read model) is AUTHORIZED with deps
satisfied (B002+B004+A025). B006 (demo/preview mode) follows B005.

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
