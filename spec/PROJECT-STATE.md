# Arena Project State

Architecture: A1.0
Work Order schema: AWO1.0
Default branch: main
Maximum concurrent workers: 3

## Bootstrap status

Repository architecture, governance, requirements, implementation plan, core object specifications, security/data governance, service boundaries, dependency graph and Work Orders are committed.

A001 MERGED via PR #2 (merge SHA d07a9beec762aceeaad1b010047f1eb804b7416a). A002 MERGED via PR #6 (merge SHA 21dfdbda27d68bb706b31f642e92c8817c63aa5b, worker head ea8081c6 + Tech Lead reconciliation d21b4fe). A003 MERGED via PR #8 (merge SHA e14b9fff9df0f37bc3982f5724401c55d1410813, worker head 26fdd9ef + Tech Lead reconciliation b2a0f0dd; CI run 36311438667 green on the PR head; post-merge run 36311670948). A004 MERGED via PR #10 (merge SHA cff162b96a7dcc0758b509f666993ca557c4fddb, worker head 422613fe + Tech Lead intake d9e7689 + merge-of-main 6ad2415; PR CI green; acceptance via branch-oracle — worker chat died in a platform generation-window outage after pushing the delivery branch).

Live wave: A009 (Issue #7, re-dispatched fresh 2026-09-27 evening from the post-A004-governance tip after two sessions lost to the platform generation-window outage — dead pending turns never picked up by the scheduler), A015 (re-dispatched fresh, same base), A016 (READY since A002+A003; dispatched into the slot freed by the A004 merge). A005 and A006 became READY with the A004 merge (dependency graph: A003+A004 → A005, A002+A004 → A006) and dispatch as slots free.

Use live GitHub branch state for the exact latest main SHA. This file records product/workflow state; it must never be treated as a substitute for Git ancestry.

## Current frontier

- A001 MERGED
- A002 MERGED
- A003 MERGED
- A004 MERGED
- A005 READY (A003+A004 merged)
- A006 READY (A002+A004 merged)
- A007 WAITING_ON_DEPENDENCIES
- A008 WAITING_ON_DEPENDENCIES
- A009 ACTIVE
- A010 WAITING_ON_DEPENDENCIES
- A011 WAITING_ON_DEPENDENCIES
- A012 WAITING_ON_DEPENDENCIES
- A013 WAITING_ON_DEPENDENCIES
- A014 WAITING_ON_DEPENDENCIES
- A015 READY
- A016 READY
- A016 WAITING_ON_DEPENDENCIES
- A017 WAITING_ON_DEPENDENCIES
- A018 WAITING_ON_DEPENDENCIES
- A019 WAITING_ON_DEPENDENCIES
- A020 WAITING_ON_DEPENDENCIES
- A021 WAITING_ON_DEPENDENCIES
- A022 WAITING_ON_DEPENDENCIES
- A023 WAITING_ON_DEPENDENCIES
- A024 WAITING_ON_DEPENDENCIES
- A025 WAITING_ON_DEPENDENCIES
- A026 WAITING_ON_DEPENDENCIES
- A027 WAITING_ON_DEPENDENCIES
- A028 WAITING_ON_DEPENDENCIES
- A029 WAITING_ON_DEPENDENCIES
- A030 WAITING_ON_DEPENDENCIES
- A031 WAITING_ON_DEPENDENCIES
- A032 WAITING_ON_DEPENDENCIES
- A033 WAITING_ON_DEPENDENCIES
- A034 WAITING_ON_DEPENDENCIES
- A035 WAITING_ON_DEPENDENCIES
- A036 WAITING_ON_DEPENDENCIES

## Current authorized assignment

Wave in flight, bases recorded at dispatch:

- A004 — MERGED via PR #10 (cff162b). Delivered the @arena/capability-graph package (11 digest-addressed versioned node kinds, typed provenance-bearing edges with a closed kind enum + endpoint matrix, skill-taxonomy DAG with cycle rejection reporting the offending path, pure graph queries, deep-freeze append-only guard, supersession-by-append, DomainPack extension point) + 19 generated contracts under contracts/capability/*.v1.json.
- A009 — Environment protocol (packages/environment-protocol, contracts/environment) — Issue #7 — re-dispatched fresh from the post-A004-governance main tip (previous pending tasks dropped silently during the generation-window outage)
- A015 — Durable jobs/events/orchestration (packages/job-protocol, services/job-orchestrator, contracts/events) — re-dispatched fresh, same base
- A016 — Model substrate registry (packages/model-substrate, adapters/models, contracts/model-substrate) — dispatched into the A004 slot, same base

Wave rules: pairwise-disjoint surfaces; zero new external runtime dependencies (existing pnpm catalog only); no root manifest/lockfile edits (Tech Lead serializes reconciliation — see d21b4fe for the A002 pattern: lockfile intake + G9 package-generator wiring); Envelope<T>/canonical-JSON primitives reused from @arena/protocol-core; generated contracts + drift checks per the A001 convention, package-level generators wired into G9.

Next in queue as slots free: A005 (capability case), A006 (expert registry) — both READY after the A004 merge. The A004 verification baseline: battery green on 7 workspace projects (governance/boundary/typecheck/lint/test/build), pristine frozen-lockfile clone green, PR #10 CI green; 49 delivered files (+12,910 lines), package-level generator auto-wired into G9 (packages/ glob).

## Verification baseline

A001 baseline (see docs/verification-baseline.md for the full record):
- node v22.23.3, pnpm 10.34.5, python 3.12.14 (runner image ubuntu-latest, actions checkout@v7.0.1 / setup-node@v7.0.0, fetch-depth: 0);
- battery: install --frozen-lockfile, governance, boundary, typecheck, lint, test, build — all exit 0;
- pass counts: governance self-test 24/24, boundary self-test 11/11, tests 108/108 (105 protocol-core + 3 web), typecheck 2/2, build 2/2;
- CI: GitHub Actions run 36257651225 (pull_request, head ca8355d) — success;
- merge SHA: d07a9beec762aceeaad1b010047f1eb804b7416a (PR #2);
- known limitations: regex-based import scanning; canonical JSON defined post-parse; conservative overlap heuristic; src-resolved internal packages (publishConfig reserved); engine-strict rejects non-Node-22 hosts; LICENSE placeholder pending Architect decision.

## Review lessons

Record durable lessons from worker failures, connector/platform failures, test gaps and architecture reviews here.

A002 review (2026-09-26):
- Worker sessions created outside the normal dispatch flow can have ephemeral per-turn sandboxes: anything on disk is lost when the turn ends. Delivery protocol must emit through the transcript (base64 chunks / heredocs) in the finishing turn, not rely on staging alone. Normal-flow sessions have persistent workspaces and stage via the files API.
- Serial reconciliation pattern that works: worker commits everything except the root lockfile; Tech Lead runs pnpm install, commits lockfile intake + integration patches (G9 package generators), verifies pristine-clone frozen install, pushes, PR, CI, merge.

A001 review (2026-09-26):
- Local-green is not runner-green: governance resolve_diff_base failed on PR checkouts because default fetch-depth omits origin/main. Fix: fetch-depth: 0 in ci.yml (commit ca8355d). Lesson: any check that depends on ref shape must be exercised on the runner before merge.
- Delivery extraction: worker sandboxes expose only the project directory to the files API; $HOME trees are invisible. Workers must stage deliveries into the project root (STAGING-<WO>/) before reporting completion.
- Platform peak-hour capacity popups eat follow-up messages (client-side echo then loss). Cancel + resend (never switch models) until processing starts.

## Successor rule

After every accepted merge:
1. reconcile GitHub ground truth;
2. update this file with exact merge SHA and verification baseline;
3. update AI_CONTINUATION.md and docs/LLM-ARCHITECT-HANDOFF.md;
4. derive READY items from spec/dependency-graph.md;
5. dispatch at most three disjoint items;
6. record base SHA/ownership;
7. serialize dependency and lockfile reconciliation.

Never dispatch from stale status text when live GitHub state disagrees.
