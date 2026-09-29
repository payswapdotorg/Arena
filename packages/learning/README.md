# @arena/learning

The Arena **learning experiment protocol** (Work Order A020;
requirements R15 — *"Run learning experiments with
baseline/intervention/comparison"* — R16 — *"Measure whether
interventions change target capability"* — and R14 provenance; spec
LE1.0 "Learning and Experiment"; spec/quality-model.md Q1.0
"Capability lift"; docs/architecture.md §11 Learning;
architecture-lock rules 5, 6, 16, 17, 18).

Learning experiments compare baseline and intervention and attribute
observed change. Learning can update skills, body composition,
retrieval/knowledge bindings, policies, evaluator/verifier assets or
model-specific adaptations — and it **never rewrites historical facts
or evidence** (lock rule 6).

## What it is

| Object | What it commits to |
| --- | --- |
| `ExperimentDescriptor` | The **content-addressed, versioned, deep-frozen** declaration carrying EVERY LE1.0 minimum field: experiment id/version; target capability (REAL A004 `CapabilityNodeRef`); baseline Body/Model/Runtime digest pins; intervention artifacts — each a typed A002-shaped ref plus an **EXPLICIT changed surface from the LE1.0 nine** (an intervention with an undeclared/ambiguous surface is REJECTED at construction); the pinned task population (A009-shaped task/version refs); A012 evaluation-suite digests; A013 verification-suite digests; pinned environment versions; outcome-metric declarations with CLOSED directions; the uncertainty/statistical method; protected capabilities (Q1.0 condition 4); provenance. Same descriptor ⇒ same digest; any change ⇒ a new version. |
| Pure comparison | `compareOutcomeMetrics` / `checkProtectedCapabilities` / `computeUncertaintyReport` — the deterministic baseline/intervention/comparison core: per-metric deltas per declared direction, protected-capability regression checks (unmeasured ⇒ `measured: false`, never silently skipped), and the reported variance per metric. Arm measurements must match the declared metric set EXACTLY (undeclared/missing/duplicate ⇒ `LEARNING_METRIC_MISMATCH`). |
| `AttributionResult` | The structured attribution per LE1.0: **one finding per each of the six distinguishable improvement sources** (substrate \| body \| environment \| evaluator-change \| verifier-change \| sampling-measurement-variance), classified from the DECLARED intervention surfaces + the evaluator/verifier/substrate/body/environment version digests the arm records carry. KEY RULE: when evaluator or verifier digests differ between arms, `confounds` carries `evaluator-version-confound` / `verifier-version-confound` — **surfaced, never silently absorbed** — and the verdict must be `inconclusive-unless-controlled`. |
| `CapabilityLiftVerdict` | The Q1.0 five-condition verdict: `lift-demonstrated` ONLY when (1) every declared metric improves on the pinned population, (2) the improvement survives a verification audit, (3) evaluator/verifier version changes are accounted (no confounds), (4) protected-capability regression is measured, and (5) uncertainty/variance is reported. Otherwise `not-demonstrated` / `inconclusive-unless-controlled` / `regression-detected`. **CLOSED VOCABULARY, NEVER A SCORE.** |
| `ExperimentRunRecord` | The **append-only, content-addressed** result record: the experiment key (idempotency) + correlation id, the descriptor digest, both arms' run refs (A011 trajectory digests / A012 evaluation-record digests / A013 verification-record digests), the collected metrics, the computed comparison, the reported uncertainty, the protected-capability checks, the attribution and the verdict. No update/delete path exists; a construction invariant REJECTS a confounded attribution paired with a non-inconclusive verdict. |
| Learning boundary | `freezeHistoricalInputs` (read-only frozen view of the evidence tier), `LearningProposal` (a NEW content-addressed artifact proposal — e.g. an A019 `SkillDraft` bound by digest — with an explicit surface and append-only `supersedes`), and `checkLearningBoundary` / `proposeLearningArtifact`, which REJECT any proposal whose artifact digest collides with a historical digest the experiment consumed (`LEARNING_REWRITE_ATTEMPT` — lock rule 6). |
| `CalibrationRecord` | LE1.0 Calibration: predicted confidence vs later-observed outcome (closed vocabulary: improved \| not-improved \| regressed \| inconclusive) with the **applicability context preserved** (target capability ref, pinned task population, pinned environment versions). `summarizeCalibration` computes counts, mean confidences and a Brier score over decided records — a calibration diagnostic, never a capability claim. |
| Envelopes | `run-experiment-command` / `experiment-completed-event` inside `@arena/protocol-core`'s `Envelope<T>`; commands carry a **required non-null idempotency key** (lock rule 17). |

## What it deliberately is NOT

- **It never rewrites evidence** (lock rule 6): learning is READ-ONLY
  over trajectories, evaluation/verification records and descriptors —
  the hygiene suite proves source records stay bit-identical, and
  rewrite-attempt proposals are rejected with `LEARNING_REWRITE_ATTEMPT`.
- **It never scores capability**: the verdict is a closed vocabulary,
  never a number. A changed evaluator score is not automatically a
  capability improvement — confounds force
  `inconclusive-unless-controlled`.
- **It never silently absorbs confounds**: evaluator/verifier version
  differences between arms are flagged in the attribution, reflected in
  the verdict, and cross-checked at record construction.
- **It never admits proposals into any graph**: proposals are new
  content-addressed objects; admission belongs to the consuming
  domains (e.g. A004 capability-graph append-only admission, A021
  body-forge).
- **It never measures an unpinned population**: the engine enforces
  the declared task population + environment versions before any
  comparison runs.

## Contracts

This package owns the A020 contracts surface
(`contracts/learning/`, nine schemas: experiment-descriptor,
intervention, experiment-run-record, attribution-result,
capability-lift-verdict, calibration-record, run-experiment-command,
experiment-completed-event, learning-schema-registry), emitted by
`scripts/generate-contracts.mjs` per the A001/A002 generator
convention (deterministic, sorted keys, versioned SchemaRef `$id`,
`--check` drift mode). Governance G9 auto-discovers the generator; the
drift and parity suites are the in-package tripwires.

## Dependencies

Runtime: `@arena/protocol-core` (canonical JSON + sha256, envelopes,
branded identifiers, SchemaRef, ProtocolError) plus five genuinely
composed sibling domains — `@arena/trajectory` (REAL A011 record
completion guard + the A009 `TaskVersionRef` guard),
`@arena/evaluation` (REAL A012 record guard + evaluator digests),
`@arena/verification` (REAL A013 record guard + verifier digests and
outcomes), `@arena/capability-graph` (REAL A004 `CapabilityNodeRef`
guard) and `@arena/environment-protocol` (type-only `TaskVersionRef`
import, mirroring A011's usage). Every sibling object is bound BY
DIGEST, never redefined here. `@arena/skill-extraction` is a
devDependency (test-only: REAL SkillDraft proposals in the boundary
suite). Zero external runtime dependencies.

## Reference fabric

The in-process reference fabric — experiment registry (idempotent by
digest, identity conflicts rejected) + experiment engine (deterministic,
idempotent by experiment key, arm-contract enforcing, boundary-checked
proposals) — lives in `services/learning`
(`@arena/learning-fabric`).

## Development

```bash
pnpm install
pnpm typecheck          # tsc --noEmit
pnpm lint               # eslint .
pnpm test               # vitest run (positive + negative + property + parity + drift + hygiene)
pnpm build              # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate # regenerate contracts/learning/
pnpm contracts:check    # drift-check the committed contracts
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
