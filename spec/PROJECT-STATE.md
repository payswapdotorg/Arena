# Arena Project State

Architecture: A1.0
Work Order schema: AWO1.0
Default branch: main
Maximum concurrent workers: 3

## Bootstrap status

Repository architecture, governance, requirements, implementation plan, core object specifications, security/data governance, service boundaries, dependency graph and Work Orders are committed.

A001 MERGED via PR #2 (merge SHA d07a9beec762aceeaad1b010047f1eb804b7416a). A002 MERGED via PR #6 (merge SHA 21dfdbda27d68bb706b31f642e92c8817c63aa5b, worker head ea8081c6 + Tech Lead reconciliation d21b4fe). A003 MERGED via PR #8 (merge SHA e14b9fff9df0f37bc3982f5724401c55d1410813, worker head 26fdd9ef + Tech Lead reconciliation b2a0f0dd; CI run 36311438667 green on the PR head; post-merge run 36311670948). A004 MERGED via PR #10 (merge SHA cff162b96a7dcc0758b509f666993ca557c4fddb, worker head 422613fe + Tech Lead intake d9e7689 + merge-of-main 6ad2415; PR CI green; acceptance via branch-oracle — worker chat died in a platform generation-window outage after pushing the delivery branch). A009 MERGED via PR #14 (merge SHA 480dd06563269b29c68b365d13a716009a5d4f87, worker head b887803 + intake baf07db; PR CI green). A015 MERGED via PR #15 (merge SHA 40defadbb56f8727e9540d929b6194e903daff55, worker head 01684ca + intake 14a029c + merge-of-main 959c0c5; PR CI green). A016 MERGED via PR #16 (merge SHA 8a834ad1ba59886bc58e897b8b6abb949ed677c5, worker head 01feb38 + intake 7da9488 + merge-of-main c38544e; PR CI green). A005 MERGED via PR #20 (merge SHA d0052965d79ae48a4dab5d4b38b699d5c1ed14d0, worker head f900d2e + intake 9752c62; PR CI green; acceptance via branch-oracle — the worker chat was retired post-delivery). A018 MERGED via PR #21 (merge SHA 13af7c27e27a61d1704e3d4a5f261ca8433b957b, worker head 2cc08aa + intake b8c3c71; PR CI green; dispatched from d005296 and delivered in a 68-minute end-to-end cycle). A006 MERGED via PR #22 (merge SHA 603050fe549e8f4c10e1f08692abeb2b2d8cb7e8, worker head a878a77 + intake b65e6f3; PR CI green; delivered @arena/expert-registry with 276 tests, full battery green; a 65-minute dispatch-to-merge cycle after the sandbox-cap incident was fixed). A010 MERGED via PR #23 (merge SHA 6b8352c5256c19b4f997aba0dac3dc9435178ac9, worker head b1997c1 + intake 95989c7 + merge-of-main lockfile regeneration 38868ff; PR CI green on 38868ff; delivered services/environment-runner + packages/environment-runtime — isolated environment runner and lifecycle; a 107-minute dispatch-to-merge cycle after the 05:35 re-dispatch). A011 MERGED via PR #24 (merge SHA ee5753283b2fd8b6a4a1e4ce367184e0f3215e74, worker head 15620f8 + intake b5f7f46; PR CI green on b5f7f46; delivered @arena/trajectory + services/trajectory-store + contracts/trajectory — TrajectoryHeader, chained append-only entries, TrajectoryRecord, replay views, reference store; an 84-minute dispatch-to-push cycle, acceptance via branch-oracle).

A012 MERGED via PR #26 (merge SHA 0cb1b90611a093858f5e3101cda189fd530de5b4, worker head 6b05363 + intake ed05333; PR CI green on ed05333; delivered @arena/evaluation + services/evaluation + contracts/evaluation — EvaluatorDescriptor, EvaluationCriteria, EvaluationRecord, evaluator registry + reference fabric; a 35-minute dispatch-to-push cycle, 76-minute dispatch-to-merge; acceptance via branch-oracle, worker chat retired post-merge).

A013 MERGED via PR #28 (merge SHA 02c71552ef, worker head 4388033 + intake 9238836; PR CI green on 9238836; battery all-green at the TL station; worker chat 5397113a). A019 MERGED via PR #32 (merge SHA 95f8e3cc6a, worker head b56cef7 + intake 7d3f2c9; station battery all-green; worker chat e6f03d58; a 35-minute dispatch-to-push cycle). A014 MERGED via PR #34 (merge SHA d3cf60af62, worker head d7e2d1e + remediation 084377e + intake; station battery all-green after one ARCHITECT REQUIRE-CHANGES round: typecheck TS7053 in contracts.parity.test.ts fixed on the same branch with full battery re-run; 48 files +7703 lines, @arena/datasets 89 tests + @arena/artifact-service 75 tests, all existing suites green; worker chat 776d1b01). A007 MERGED via PR #36 (merge SHA eaebedd853, worker head 178e4ca + intake; station battery all-green: ownership clean, 63 files +13750 lines, @arena/expert-qualification 127 tests + @arena/expert-matching 46 tests; a branch-collision with a recovered prior attempt (334a03e) was honestly disclosed and resolved via force-with-lease; worker chat 1820bed0). A020 MERGED via PR #35 (merge SHA 871c29c, worker head 6b1847c + intake; station battery all-green: ownership clean, 57 files +12538 lines, @arena/learning 145 tests + @arena/learning-fabric 46 tests; ExperimentDescriptor with every LE1.0 field, evaluator/verifier-version-confound attribution, five-condition CapabilityLiftVerdict, read-only learning boundary; the worker session recovered server-side after a premature TL void — UI-freeze is NOT death; worker chat 60a7943c). Live wave: A007 + A014 in flight (from 6a8abdc) + A020 dispatched from the post-A019-governance tip (A020 needs A011+A012+A013+A019 — all merged). Next unlocks: A008 on the A007 merge; A021 after A019+A020 (needs A003+A004 MERGED too); A023 needs A013+A022+A014.

Use live GitHub branch state for the exact latest main SHA. This file records product/workflow state; it must never be treated as a substitute for Git ancestry.

## Current frontier

- A001 MERGED
- A002 MERGED
- A003 MERGED
- A004 MERGED
- A005 MERGED (PR #20, d005296)
- A006 MERGED (PR #22, 603050f)
- A007 MERGED (PR #36, eaebedd; worker head 178e4ca)
- A008 WAITING_ON_DEPENDENCIES
- A009 MERGED
- A010 MERGED (PR #23, 6b8352c; worker head b1997c1 + intake 95989c7 + lockfile regen 38868ff)
- A011 MERGED (PR #24, ee57532; worker head 15620f8 + intake b5f7f46)
- A012 MERGED (PR #26, 0cb1b906; worker head 6b05363 + intake ed05333)
- A013 MERGED (PR #28, 02c7155; worker head 4388033 + intake 9238836)
- A014 MERGED (PR #34, d3cf60a; worker head d7e2d1e + remediation 084377e)
- A015 MERGED
- A016 MERGED
- A017 WAITING_ON_DEPENDENCIES
- A018 MERGED (PR #21, 13af7c2)
- A019 MERGED (PR #32, 95f8e3c; worker head b56cef7 + intake 7d3f2c9)
- A020 MERGED (PR #35, 871c29c; worker head 6b1847c)
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
- A034 WAITING_ON_DEPENDENCIES (needs A018/A021/A023/A025)
- A035 WAITING_ON_DEPENDENCIES
- A036 WAITING_ON_DEPENDENCIES

## Current authorized assignment

Wave in flight, bases recorded at dispatch:

- A009 — MERGED via PR #14 (480dd06). Delivered @arena/environment-protocol (ENV1.0: environment declarations with image/build digests, initial state snapshots, seed policy, action/tool surface, observation surface, resource limits, network policy; checkpoint semantics; workload admission) + contracts/environment/*.v1.json. 61 files.
- A015 — MERGED via PR #15 (40defad). Delivered @arena/job-protocol + services/job-orchestrator (durable jobs, event log, orchestration; envelope wiring with idempotency keys; G9 services/* generator wiring exercised) + contracts/events/*.v1.json. 53 files.
- A016 — MERGED via PR #16 (8a834ad). Delivered @arena/model-substrate + adapters/models reference adapters (SubstrateAdapter protocol, content-addressed AdapterDescriptor, append-only SubstrateRegistry, compatibility test descriptors, upgrade path types) + contracts/model-substrate/*.v1.json. 61 files.

Next wave (dispatched from the post-triple-merge governance tip):
- A005 — Capability Case protocol (packages/capability-case, contracts/capability-case) — Issue #12
- A006 — Expert registry protocol (packages/expert-registry, contracts/expert) — Issue #13
- A010 — Environment runner service (services/environment-runner, packages/environment-runtime) — Issue #17 — unlocked by A009+A015

Wave rules: pairwise-disjoint surfaces; zero new external runtime dependencies (existing pnpm catalog only); no root manifest/lockfile edits (Tech Lead serializes reconciliation — see d21b4fe for the A002 pattern: lockfile intake + G9 package-generator wiring); Envelope<T>/canonical-JSON primitives reused from @arena/protocol-core; generated contracts + drift checks per the A001 convention, package-level generators wired into G9.

Queue after the current wave (dependency-verified against spec/work-items.md): A013 IN FLIGHT (dispatched ~10:55 UTC from 0cb1b906), then the A007/A014/A019 fan-out (all need A013; A007 also needs A006 MERGED), then A008 (needs A005+A006+A007 — unlocks on the A007 merge) and A020 (needs A011+A012+A013+A019 — unlocks on the A019 merge); A021 follows (needs A003+A004+A019+A020). Dependency note (correction 2026-09-27 20:05): A034 requires A018/A021/A023/A025 — it is NOT ready on A015 alone (an earlier one-directional graph read was wrong; spec/work-items.md is authoritative). The triple-merge verification baseline: battery green on all workspace projects after each merge-of-main lockfile regeneration (A009 intake baf07db; A015 14a029c+959c0c5; A016 7da9488+c38544e), pristine frozen-lockfile clones green, PR CI green on all three.

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
