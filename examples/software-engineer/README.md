# A028 — Reference Software Engineer End-to-End Example

This is the FIRST COMPLETE REFERENCE VERTICAL SLICE of Arena: one
deterministic function (`runReferenceScenario`) that walks the entire
protocol chain for the Software Engineer Agent Body — **no live model
calls, no network, no wall-clock reads**.

## The chain

```
Agent Body            bodies/software-engineer   (A021 BodyManifest → forge → A021 ForgeRecord)
  ↓ register append-only lineage (A003 v1.0.0 → v1.1.0)
Cognitive Substrate   @arena/model-substrate     (A016, neutral reference reasoner)
  ↓ Possession        @arena/agent-body          (A003 body × substrate × runtime × environment × policies)
Capability Case       @arena/capability-case     (A005, cites body + substrate + environment)
  ↓ Task compilation  @arena/task-spec + task-compiler-fabric (A008 TaskSpec + CompilationRecord)
Environment           environments/software-engineer (A009 ENV1.0 definitions)
  ↓ Run               @arena/environment-runtime + environment-runner (A010 lifecycle, admission, checkpoints)
Trajectory            @arena/trajectory          (A011 hash-chained entries)
  ↓ Evaluation        @arena/evaluation-fabric   (A012 criteria + semantic evaluator hook)
  ↓ Verification      @arena/verification-fabric (A013 digest-pinned artifacts + verifier hook)
Compatibility         @arena/compatibility       (A022 body profile × substrate)
  ↓ Certification     @arena/certification-fabric (A23 scoped statement: BodyVersion × Substrate × Environment × Runtime × Suite)
  ↓ Release           @arena/body-registry-fabric (A024 admission gate + registration + publication)
SDK reads             @arena/arena-sdk + api-fabric (A025 loopback queries)
```

The result is a `ScenarioReceipt` carrying every content-addressed
record of the chain (see `receiptDigests`).

## Notable design points

- **Determinism**: every timestamp, seed, correlation id and
  idempotency key is a fixed scenario input; two runs produce
  byte-identical digests (asserted in `walkthrough.test.ts`).
- **Semantic reference hooks**: the evaluator replays the trajectory
  chain (failing suite → edit → green suite) and the verifier checks
  digest-pinned artifacts — they are deterministic *and* meaningful,
  not random-score stubs.
- **Parity**: TaskSpec environment refs, manifest projections,
  certification stage pins and SDK loopback reads are asserted
  byte-identical across packages (`parity.test.ts`).
- **Adversarial**: failed trajectories, falsified test reports,
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
cd examples/software-engineer
pnpm install --ignore-workspace   # local devDeps only (vitest/typescript, exact pins)
pnpm test                         # vitest run (uses vitest.config.ts aliases)
pnpm typecheck                    # tsc --noEmit (uses tsconfig.json paths)
pnpm lint                         # resolves the root flat eslint config by walking up
pnpm build                        # tsc --noEmit — this package is a pure consumer of
                                  # in-repo TypeScript sources, not an emit target
```

The same battery commands the repo root uses (`check`, `contracts:generate`,
`typecheck`, `lint`, `test`, `build`) do not cover this directory
automatically — that wiring would require a root-manifest change, which
is outside this Work Order's frozen surfaces. Disclosed as a limitation
in the A028 PR.
