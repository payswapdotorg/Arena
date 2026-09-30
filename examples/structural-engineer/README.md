# A029 — Reference Structural Engineer End-to-End Example

This is the SECOND COMPLETE REFERENCE VERTICAL SLICE of Arena
(following the A028 software-engineer precedent): one deterministic
function (`runReferenceScenario`) that walks the entire protocol chain
for the Structural Engineer Agent Body — **no live model calls, no
network, no wall-clock reads**.

## The chain

```
Agent Body            bodies/structural-engineer    (A021 BodyManifest → forge → ForgeRecord)
  ↓ register append-only lineage (A003 v1.0.0 → v1.1.0)
Cognitive Substrate   @arena/model-substrate        (A016, neutral reference reasoner)
  ↓ Possession        @arena/agent-body             (A003 body × substrate × runtime × environment × policies)
Capability Case       @arena/capability-case        (A005, cites body + substrate + environment)
  ↓ Task compilation  @arena/task-spec + task-compiler-fabric (A008 TaskSpec + CompilationRecord)
Environment           environments/structural-engineer (A009 ENV1.0 definitions)
  ↓ Run               @arena/environment-runtime + environment-runner (A010 lifecycle, admission, checkpoints)
Trajectory            @arena/trajectory             (A011 hash-chained entries)
  ↓ Evaluation        @arena/evaluation-fabric      (A012 criteria + semantic evaluator hook)
  ↓ Verification      @arena/verification-fabric    (A013 digest-pinned artifacts + verifier hook)
Compatibility         @arena/compatibility          (A022 body profile × substrate)
  ↓ Certification     @arena/certification-fabric   (A023 scoped statement: BodyVersion × Substrate × Environment × Runtime × Suite)
  ↓ Release           @arena/body-registry-fabric   (A024 admission gate + registration + publication)
SDK reads             @arena/arena-sdk + api-fabric (A025 loopback queries)
```

The result is a `ScenarioReceipt` carrying every content-addressed
record of the chain (see `receiptDigests`).

## The reference scenario

A failing gravity ULS check on transfer beam B-1 (utilization 1.12 >
1.00 under load combination 1.4D+1.6L) is reported against the pinned
structural model. The body reproduces the failing check, traces the
load path, corrects the load-model tributary width to match drawing
S-201, re-runs the solver, and records a green compliance report
(`run-structural-analysis` → `update-load-model` →
`run-structural-analysis` → completion). The evaluator replays that
analysis-correction loop; the verifier checks the digest-pinned
compliance report (every check passed, maximum utilization within the
limit state) and the trajectory-chain proof.

## Notable design points

- **Determinism**: every timestamp, seed, correlation id and
  idempotency key is a fixed scenario input; two runs produce
  byte-identical digests (asserted in `walkthrough.test.ts`).
- **Semantic reference hooks**: the evaluator replays the trajectory
  chain (failing check → parameter correction → green check set) and
  the verifier checks digest-pinned artifacts — they are deterministic
  *and* meaningful, not random-score stubs. Neither is licensure: the
  body declares "not a licensed engineering authority; no sign-off or
  stamping authority".
- **Parity**: TaskSpec environment refs, manifest projections,
  certification stage pins and SDK loopback reads are asserted
  byte-identical across packages (`parity.test.ts`).
- **Adversarial**: failed trajectories, falsified compliance reports,
  forged trajectory proofs, incompatible substrates, missing
  certification evidence and release-gate rejections
  (`adversarial.test.ts`).

## Running

`examples/*` is deliberately NOT a pnpm workspace member (the root
`pnpm-workspace.yaml` — owned by the Tech Lead — does not glob it), so
this package is self-contained and resolves `@arena/*` packages via
TypeScript paths / vitest aliases to their in-repo TypeScript sources
(every workspace package exports its `src/index.ts` directly).

```bash
# from the repository root, after `pnpm install`:
cd examples/structural-engineer
pnpm install --ignore-workspace   # local devDeps only (vitest/typescript, exact pins)
pnpm test                         # vitest run (uses vitest.config.ts aliases)
pnpm typecheck                    # tsc --noEmit (uses tsconfig.json paths)
pnpm lint                         # eslint (flat config, typescript-eslint)
pnpm build                        # no-emit typecheck (consumer by design)
```
