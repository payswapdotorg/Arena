# Arena Project State

Architecture: A1.0
Work Order schema: AWO1.0
Default branch: main
Maximum concurrent workers: 3

## Bootstrap status

Repository architecture, governance, requirements, implementation plan, core object specifications, security/data governance, service boundaries, dependency graph and Work Orders are committed.

A001 MERGED via PR #2 (merge SHA d07a9beec762aceeaad1b010047f1eb804b7416a, head ca8355d982b10ffadca790a1f90842e5ee7ca358). CI green on GitHub runners (run 36257651225). Bootstrap foundation is executable: governance/boundary checkers, CI battery, package boundaries and protocol-core primitives are live on main.

Live wave (Phase 1): A002/A003/A004 — Issues #3/#4/#5. A015 is READY (dependency-satisfied, held by the 3-worker concurrency cap).

Use live GitHub branch state for the exact latest main SHA. This file records product/workflow state; it must never be treated as a substitute for Git ancestry.

## Current frontier

- A001 MERGED
- A002 ACTIVE
- A003 ACTIVE
- A004 ACTIVE
- A005 WAITING_ON_DEPENDENCIES
- A006 WAITING_ON_DEPENDENCIES
- A007 WAITING_ON_DEPENDENCIES
- A008 WAITING_ON_DEPENDENCIES
- A009 WAITING_ON_DEPENDENCIES
- A010 WAITING_ON_DEPENDENCIES
- A011 WAITING_ON_DEPENDENCIES
- A012 WAITING_ON_DEPENDENCIES
- A013 WAITING_ON_DEPENDENCIES
- A014 WAITING_ON_DEPENDENCIES
- A015 READY
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

Wave (Phase 1 — canonical capability objects), dispatched by the Tech Lead from main tip dcf0cb74ed702297929ed2999fe71b7f6bb19fe2:

- A002 — Artifact identity, versioning, provenance and lineage protocol (packages/artifact-protocol, packages/provenance, contracts/artifacts) — Issue #3
- A003 — Agent Body, BodyVersion, Cognitive Substrate, Possession, Agent Instance protocol (packages/agent-body, contracts/agent-body) — Issue #4
- A004 — Capability Graph and skill taxonomy (packages/capability-graph, contracts/capability) — Issue #5

Wave rules: pairwise-disjoint surfaces; zero new external runtime dependencies (existing pnpm catalog only); no root manifest/lockfile edits (Tech Lead serializes reconciliation); Envelope<T>/canonical-JSON primitives reused from @arena/protocol-core; generated contracts + drift checks per the A001 convention.

A015 remains READY and is dispatched when a concurrency slot frees.

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
