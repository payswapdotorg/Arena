# A030 — Executable Benchmark Suites (benchmarks/)

`@arena/benchmarks` is the EXECUTABLE half of Work Order A030 (the
definitions live in `../research`). One deterministic function —
`runSeRepairBenchmark()` — exercises the merged dependency fabrics
end-to-end:

```
A028 reference scenario        runReferenceScenario()      (example-software-engineer)
  → independent A012 scoring   EvaluationFabric + criteria suites (weighted-sum + pass-threshold)
  → A013-checked evidence      the receipt's digest-pinned verification record
  → @arena/research objects     ScoringMethodology + BenchmarkDescriptor + BenchmarkResultRecord
  → leaderboard                 LeaderboardLedger (append-only, supersession, deterministic ranking)
  → A014 publication            public definition dataset + public results dataset (verifyDatasetBundle)
```

No live model calls, no network, no wall-clock reads: every timestamp,
seed, correlation id and idempotency key is a fixed suite input
(`src/shared.ts`). Two full runs produce byte-identical digests —
descriptor, result, leaderboard snapshot and both public datasets
(asserted by `src/reproducibility.test.ts`).

## Contents

| File | What it carries |
|---|---|
| `src/shared.ts` | the fixed suite inputs (BENCH constants, contamination policy, stated limitations) |
| `src/criteria.ts` | the A012 EvaluationCriteria suites bound to the run's case + trajectory digests (weighted-sum and pass-threshold variants) |
| `src/suite.ts` | the published scoring methodologies (weighted-sum + rubric-level) and the public definition/results dataset packaging |
| `src/runner.ts` | `runSeRepairBenchmark()` + `verifySeRepairBenchmarkRun()` |

## Tests

- `src/reproducibility.test.ts` — deterministic runs, derived
  aggregates, leaderboard records/supersession, A014 dataset
  verification;
- `src/adversarial.test.ts` — tampered results/descriptors/datasets
  rejected, non-reproducible run records rejected, published-without-
  dataset rejected;
- `src/parity.test.ts` — descriptor pins byte-identical to the objects
  the run actually used (A012 criteria/evaluator, A013 verifier, A028
  body version), A012 enum reuse, dataset digest stability.

## Running

`benchmarks/*` is deliberately NOT a pnpm workspace member (the root
`pnpm-workspace.yaml` — owned by the Tech Lead — does not glob it; the
same self-contained pattern as `examples/software-engineer` from A028):

```bash
# from the repository root, after `pnpm install`:
cd benchmarks
pnpm install --ignore-workspace   # local devDeps only (exact pins)
pnpm test                         # vitest run (15 tests)
pnpm typecheck                    # tsc --noEmit
```
