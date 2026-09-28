# @arena/evaluation-fabric

The Arena **reference evaluator fabric** — the in-process registry,
runner and record ledger for evaluation (Work Order A012 gate 6;
requirements R12, R23; spec EV1.0; docs/architecture.md §5, §18).

Pure TypeScript, **zero external runtime dependencies**: only
`@arena/protocol-core`, `@arena/evaluation` and the two judged-object
domain packages (`@arena/capability-case`, `@arena/trajectory`) —
whose REAL structural guards anchor the fabric's input contract to
the REAL packages.

## Surface

| Surface | What it does |
| --- | --- |
| `EvaluatorRegistry` | Registers evaluators (descriptor + hook) and criteria, **idempotent by digest**; a different digest under the same id+version is an **identity conflict** (the quality model's "changing an evaluator requires a new version"); lookups by digest; queries by kind / pinned case. |
| `EvaluationFabric` | The reference **runner** + record ledger: `evaluate(evaluatorRef, caseRecord, trajectoryRecord, options)` = resolve refs → enforce the input contract (REAL A005/A011 guards + digest bindings + optional body/substrate pins against the trajectory header) → enforce the seed contract (seeded evaluators require a seed) → invoke the hook → build the frozen, content-addressed `EvaluationRecord` through the domain constructor. **Idempotent by run key** (lock rule 17). Queries: by digest, by case, by trajectory, by time range. |
| `makeDeterministicTestEvaluator()` | Reference implementation of the `deterministic-test` kind: seeded, reproducible per-criterion outcomes (boolean/numeric per the criteria's aggregation domain) derived from sha256 over the run material. |
| `makeRubricEvaluator()` | Reference implementation of the `rubric` kind: seeded levels 1-5 per criterion with judgment labels and deterministic notes. |

**Scope NOTE (A012)**: only `deterministic-test` and `rubric` have
reference implementations. The other five EV1.0 kinds (`model-based`,
`expert`, `simulation`, `comparative`, `adversarial`) are declared
descriptor types with the pluggable `EvaluatorHook` interface available
for future implementations — nothing ships here.

## Evaluation ≠ evidence

Evaluation is judgment against explicit criteria; the fabric produces
scores/judgments ONLY. Establishing whether required evidence exists
and supports required claims is a separate protocol's responsibility
(architecture-lock rule 7) — enforced in the domain package
(`@arena/evaluation`) by its hygiene suite.

## Demo

```bash
cd services/evaluation && pnpm demo     # node main.mjs
```

Runs one deterministic end-to-end scenario against the REAL packages:
build a real `CapabilityCase` + `TrajectoryRecord` → register criteria
+ the two reference evaluators → wire the gate-5 envelope round trip
(`run-evaluation-command` → `evaluate` → `evaluation-recorded-event`)
→ run seeded evaluations → replay idempotently → fail-closed negative
probes → queries + an observability dump. The entry self-bootstraps
`node --experimental-strip-types` plus a `.js→.ts` resolve hook so the
REAL workspace packages run straight from their TypeScript sources.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative + property tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See docs/repo-layout.md for the layering rules this service must obey
(enforced by `pnpm boundary`).
