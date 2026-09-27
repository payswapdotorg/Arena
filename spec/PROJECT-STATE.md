# Arena Project State

Architecture: A1.0
Work Order schema: AWO1.0
Default branch: main
Maximum concurrent workers: 3

## Bootstrap status

Repository architecture, governance, requirements, implementation plan, core object specifications, security/data governance, service boundaries, dependency graph and Work Orders are committed.

A001 MERGED via PR #2 (merge SHA d07a9beec762aceeaad1b010047f1eb804b7416a). A002 MERGED via PR #6 (merge SHA 21dfdbda27d68bb706b31f642e92c8817c63aa5b, worker head ea8081c6 + Tech Lead reconciliation d21b4fe). A003 MERGED via PR #8 (merge SHA e14b9fff9df0f37bc3982f5724401c55d1410813, worker head 26fdd9ef + Tech Lead reconciliation b2a0f0dd; CI run 36311438667 green on the PR head; post-merge run 36311670948).

Live wave: A004 (Issue #5, worker queued — first session lost to a sandbox reset before delivery; re-dispatched 2026-09-27 from base 0b8443e), A009 (Issue #7, worker queued — same re-dispatch). A015 is READY and dispatches now that the A003 slot freed (base = current main tip bd3bd19, i.e. the A003 merge plus its governance commit). A016 is READY (A002+A003 merged) and dispatches when the next slot frees.

Use live GitHub branch state for the exact latest main SHA. This file records product/workflow state; it must never be treated as a substitute for Git ancestry.

## Current frontier

- A001 MERGED
- A002 MERGED
- A003 MERGED
- A004 ACTIVE
- A005 WAITING_ON_DEPENDENCIES
- A006 WAITING_ON_DEPENDENCIES
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

- A004 — Capability Graph and skill taxonomy (packages/capability-graph, contracts/capability) — Issue #5 — base 0b8443e6e5b214d88fe1111a528675e45cb6f1d9 (re-dispatched 2026-09-27; first session lost to a sandbox reset before delivery)
- A009 — Environment protocol (packages/environment-protocol, contracts/environment) — Issue #7 — base 0b8443e6e5b214d88fe1111a528675e45cb6f1d9 (re-dispatched 2026-09-27)
- A015 — Durable jobs/events/orchestration (packages/job-protocol, services/job-orchestrator, contracts/events) — base bd3bd19e7058d758c2c8eb047a67888d032a2e81 (current main tip after the A003 governance commit; slot freed by the A003 merge)

Wave rules: pairwise-disjoint surfaces; zero new external runtime dependencies (existing pnpm catalog only); no root manifest/lockfile edits (Tech Lead serializes reconciliation — see d21b4fe for the A002 pattern: lockfile intake + G9 package-generator wiring); Envelope<T>/canonical-JSON primitives reused from @arena/protocol-core; generated contracts + drift checks per the A001 convention, package-level generators wired into G9.

A016 remains READY (A002+A003 merged) and dispatches when the next concurrency slot frees. The A003 verification baseline: battery green on 5 packages (governance/boundary/typecheck/lint/test/build), pristine frozen-lockfile clone green, PR CI run 36311438667 success; 45 delivered files, package-level generator auto-wired into G9 (packages/ glob).

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
