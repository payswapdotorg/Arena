# @arena/evaluation

The Arena **evaluation protocol** — judgment against explicit criteria
(Work Order A012; requirements R12, R23; spec EV1.0; spec/quality-model.md
"Evaluation quality"; architecture-lock rules 7, 12, 18; docs/
architecture.md §5, §18).

Evaluation is a score or judgment about how a capability performed —
**never** an evidence claim. Establishing whether required evidence
exists and supports required claims is a separate protocol's
responsibility (architecture-lock rule 7); this package carries
scores/judgments ONLY, enforced by the hygiene suite (grep-style
separation negatives over sources, contracts, README and the canonical
object forms).

## Objects

| Object | What it commits to |
| --- | --- |
| `EvaluationCriteria` | The **explicit, versioned, content-addressed** criteria set: ordered criterion entries (id, strictly positive weight, description, digest-addressed target ref), a **closed** aggregation-policy enum (`weighted-sum \| pass-threshold \| rubric-level`) and thresholds. Criterion ids unique; same criteria ⇒ same digest; any content change ⇒ a different digest. |
| `EvaluatorDescriptor` | The **content-addressed, versioned** declaration of an evaluator: id, version, kind (the **closed EV1.0 enum**: `deterministic-test \| model-based \| expert \| rubric \| simulation \| comparative \| adversarial` — unknown kinds rejected), input contract (digest refs to the judged A005 `CapabilityCase` + A011 `TrajectoryRecord` plus optional A003 body / A016 substrate pins), criteria ref, output schema ref, reproducibility characteristics (`deterministic? seeded? requires-human?` — deterministic ∧ requires-human rejected), confidence/limitations, provenance. Any change ⇒ a different digest; same id+version with different bytes is a registry conflict (the quality model's "changing an evaluator requires a new version"). |
| `EvaluationRecord` | The **append-once** result record: evaluator descriptor digest, case ref, trajectory digest ref, criteria digest ref, seed, one verdict per criterion (id, score, judgment, notes), the aggregate outcome **computed purely** per the aggregation policy (weighted-sum → normalized weighted mean; pass-threshold → passing fraction; rubric-level → minimum level) with the judgment label `meets-criteria \| below-criteria`, confidence, limitations, started/finished-at, provenance. Frozen on creation (no mutation API); pure replayable construction; same inputs + same seed ⇒ the identical record digest (score stability under rerun). |

Aggregation score domains are validated per policy: `[0,1]` for
weighted-sum, `{0,1}` for pass-threshold, integer `[1,5]` for
rubric-level.

## Envelope wiring

Wire shapes travel inside `@arena/protocol-core`'s `Envelope<T>`:
`run-evaluation-command` / `evaluation-recorded-event`. Commands carry a
**required non-null idempotency key** (lock rule 17); the recorded event
carries the fabric's authoritative, content-addressed record and the
run command's idempotency key when provided (mirroring
artifact-protocol / job-protocol / trajectory exactly).

## Dependencies

The ONLY runtime dependency is `@arena/protocol-core` (canonical JSON +
sha256 digests, envelopes, branded identifiers, SchemaRef, ProtocolError)
— reused throughout, never reimplemented. The sibling objects evaluation
judges (A005 `CapabilityCase`, A011 `TrajectoryRecord`) are bound
strictly **by digest refs**, never redefined here — exactly like
`@arena/trajectory` binds A003's BodyVersion and A016's substrate by
digest.

## Contracts

Generated contracts live in `contracts/evaluation/` (repo root):
`evaluator-descriptor`, `evaluation-criteria`, `evaluation-record`,
`evaluation-error`, `run-evaluation-command`,
`evaluation-recorded-event`, `evaluation-schema-registry` (all
`.v1.json`). Regenerate with `pnpm contracts:generate`; drift is checked
by `pnpm contracts:check`, the drift suite (`src/drift.test.ts`) and
governance G9 (which auto-discovers package-level generators). Parity
with this TS surface is asserted by `src/contracts.parity.test.ts`.

## Reference fabric

The in-process reference fabric — evaluator registry, evaluation runner
and the two reference evaluator implementations (deterministic-test,
rubric) — lives in `services/evaluation`
(`@arena/evaluation-fabric`). The other five EV1.0 kinds
(model-based, expert, simulation, comparative, adversarial) are declared
descriptor types with pluggable hook interfaces and no implementations
(A012 scope).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate   # regenerate contracts/evaluation/*
pnpm contracts:check      # drift check against the committed copies
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
