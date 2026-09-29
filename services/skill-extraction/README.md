# @arena/skill-extraction-fabric

The Arena **reference extraction fabric** (Work Order A019; requirement
R17 — *"Extract reusable Skills from validated trajectories"*) — the
in-process policy registry, extraction runner, run-record ledger and
draft store for the `@arena/skill-extraction` protocol. It mirrors the
A012/A013 reference fabrics structurally and is deliberately READ-ONLY
over the evidence tier (architecture-lock rule 6 — learning never
rewrites historical evidence).

## Surface

| Piece | What it does |
| --- | --- |
| `ExtractionPolicyRegistry` | In-process, content-addressed policy registry: `registerPolicy` is idempotent by digest; a different digest under the same `(policyId, version)` identity is an `IDENTITY_CONFLICT` (changing a policy requires a new version). Lookups by digest; queries by policy id. |
| `ExtractionService` | The runner + ledger + draft store. `extract(policyRef, refs, options)` = resolve policy → re-enforce the validated-input contract through the package's own guard (the R17 gate NEVER bypasses — unvalidated trajectories are refused) → run the pure mining core (validation gates → eligibility → signatures → thresholds) → build A004-ready `SkillDraft`s (supersession by APPEND via `options.supersessions`) → build and append the `ExtractionRunRecord`. **Idempotent by run key** (lock rule 17): same key + same command tuple (policy + input digests) replays the STORED record — byte-identical, never duplicated; same key + different tuple is an `IDEMPOTENCY_CONFLICT`. Queries: run record by digest, runs by policy / correlation id / time range, full ledger; drafts by digest / by candidate. |
| `ExtractionRunRecord` | The append-only, digest-addressed record of one extraction run: policy digest, input ref digests (in order), the FULL decision log (per-trajectory + per-pattern accept/reject with closed reason codes), accepted candidate digests, emitted draft digests, correlation id + run key, timestamps + provenance. Pure construction: identical inputs ⇒ identical digest; frozen on creation; `verifyExtractionRunRecord` is the tamper tripwire. |

## Deterministic replay

The A019 contract: the same run key returns the recorded result, never
a duplicate — and with fixed `startedAt`/`finishedAt` options, two
fresh services fed the same policy + refs produce **byte-identical run
records** (property P4). The mining core is pure (same inputs + policy
⇒ byte-identical candidates).

## What it deliberately is NOT

- **No writes to the evidence tier**: the fabric never calls
  trajectory/evaluation/verification write APIs; the hygiene suite
  proves source records stay bit-identical and frozen through a full
  run.
- **No graph admission**: drafts are A004-ready PROPOSALS; the
  capability graph's own append-only admission stays the single
  authority (A004).
- **No network, no database**: in-process, pure TypeScript, zero
  external runtime dependencies — the A019 reference slice.

## Dependencies

Runtime: `@arena/protocol-core` (correlation ids / idempotency keys,
canonical digests) + `@arena/skill-extraction` (the protocol — pure
mining core, guards, candidate/draft constructors). Test-only
devDependencies: the A011/A012/A013/A004 packages (REAL fixtures).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative + property + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```
