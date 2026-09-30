# A030 — Research Benchmark and Public Evaluation Suite (research layer)

`@arena/research` is the RESEARCH / PUBLIC-EVALUATION protocol layer of
Arena (Work Order A030; depends on the merged A012 evaluation, A013
verification, A014 datasets, A023 certification and A028 reference-body
fabrics). It defines the citable research objects:

| Object | What it is |
|---|---|
| `ScoringMethodology` | versioned, content-addressed statement of HOW per-criterion verdicts become one benchmark score (A012 aggregation enum reused by import; pass bar; tie-breaking; stated limitations + contamination policy) |
| `BenchmarkDescriptor` | versioned, content-addressed, citable definition of a public benchmark: A012 criteria/evaluator identity pins, A013 verifier pins (verification-checked scoring is mandatory), methodology ref, A014 public dataset ref, pinned body population (R43), task population + seed policy, publication lifecycle (draft/published/retired) |
| `BenchmarkResultRecord` | append-once scored result of one deterministic run: composition-scoped subject (body + substrate + possession + environment — R44), fixed run inputs (seed, timestamps, correlation/idempotency keys), per-criterion scores, DERIVED aggregate, and the verification-checked evidence chain (A012 + A013 + optional A023 refs) |
| `LeaderboardLedger` | append-only, supersession-aware ledger with a byte-deterministic ranking projection and a content-addressed citable snapshot |
| `createResearchDataset` | public-namespace dataset packaging through the REUSED A014 discipline (manifest + bundle + fail-closed verification) |

Design law: a benchmark result states that a **composition** (Agent
Body version × substrate × environment × runtime) scored S on
benchmark X — never that a model alone is a software engineer (R43).
Model/body/environment/runtime versions are recorded in every result
(R44). Benchmark performance is never a license to practice.

`research/*` is deliberately NOT a pnpm workspace member (the root
`pnpm-workspace.yaml` — owned by the Tech Lead — does not glob it; the
same self-contained pattern as `examples/software-engineer` from A028):
`@arena/*` sources resolve via tsconfig paths / vitest aliases.

## Running

```bash
# from the repository root, after `pnpm install`:
cd research
pnpm install --ignore-workspace   # local devDeps only (exact pins)
pnpm test                         # vitest run (positive + adversarial + parity)
pnpm typecheck                    # tsc --noEmit
```

The executable benchmark suites (the A028-body runs that produce
result records through this layer) live in `../benchmarks`.
