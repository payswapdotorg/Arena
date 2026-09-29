# @arena/learning-fabric

The Arena in-process reference **learning experiment fabric** (Work
Order A020; requirements R15, R16; spec LE1.0; spec/quality-model.md
Q1.0).

## What it is

| Object | What it commits to |
| --- | --- |
| `ExperimentRegistry` | Content-addressed experiment-descriptor registration: idempotent by digest (bit-identical re-registration is a no-op); a DIFFERENT digest under the same (experimentId, version) identity is an `IDENTITY_CONFLICT` — changing an experiment requires a new version. Tampered descriptors (digest recomputation mismatch) are rejected. |
| `ExperimentEngine` | The reference experiment runner (R15/R16): resolve the descriptor by digest (NOT_FOUND when absent) → enforce the arm contracts (REAL A011/A012/A013 guards; evaluations must judge this arm's trajectories; verifications must address them through their evidence bundles; every trajectory belongs to the PINNED task population + environment versions; the baseline arm matches the declared baseline body/substrate pins) → freeze the historical inputs (learning boundary layer 1, lock rule 6) → compute comparison / protected checks / uncertainty / attribution / verdict with the package's PURE functions → emit the append-only, content-addressed `ExperimentRunRecord`. Deterministic given the same inputs (no hidden state). Idempotent by experiment key (same key + same command tuple ⇒ the STORED record; different tuple ⇒ `IDEMPOTENCY_CONFLICT`). `proposeArtifact` turns a completed run into a boundary-checked `LearningProposal` — rewrite attempts are rejected with `LEARNING_REWRITE_ATTEMPT`. |

In-process only: no network, no database (mirrors the A012/A013/A019
reference fabrics). The pure protocol lives in `@arena/learning`.

## What it deliberately is NOT

- It never rewrites history: run inputs stay bit-identical and frozen
  (hygiene suite); proposals are new content-addressed objects only.
- It never bypasses the R15/R16 gates: unpinned populations,
  misbound evidence, undeclared metrics and confounded verdicts are
  refused or surfaced loudly.
- It is not a store: the ledger is in-memory, append-only,
  content-addressed; persistence is a future adapter's concern.

## Dependencies

Runtime: `@arena/protocol-core` (idempotency keys, correlation ids,
canonical digests), `@arena/learning` (the pure protocol) and the
three sibling record guards the engine re-validates against —
`@arena/trajectory`, `@arena/evaluation`, `@arena/verification`
(consumers supply the records; the guards anchor the engine to the
REAL protocols). DevDependencies add `@arena/skill-extraction`
(test-only, for REAL SkillDraft proposal fixtures). Zero external
runtime dependencies.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative + property + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```
