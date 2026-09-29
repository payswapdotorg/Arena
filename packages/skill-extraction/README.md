# @arena/skill-extraction

The Arena **skill-extraction protocol** (Work Order A019; requirement
R17 — *"Extract reusable Skills from validated trajectories"*;
docs/architecture.md §3 Capability model, §9 Trajectory, §11 Learning;
architecture-lock rules 5, 6, 12, 17, 18, 23).

Skill extraction is the READ-ONLY bridge from Arena's evidence tier to
its capability tier: it mines reusable `Skill` proposals from
trajectories that carry VALIDATION evidence, and packages the accepted
proposals as **A004-ready skill-node drafts**.

## What it is

| Object | What it commits to |
| --- | --- |
| `ValidatedTrajectoryRef` | The R17 **'validated' gate**: a completed A011 `TrajectoryRecord` + the A012 `EvaluationRecord`s + the A013 `VerificationRecord`s that validate it, each digest-bound to the trajectory chain head (evaluations by their `trajectoryRef`; verifications by an evidence-bundle artifact digest equal to the chain head). A trajectory **without verification evidence is NOT an extraction input** — the guard refuses it (`UNVALIDATED_TRAJECTORY`); so are still-open trajectories, misbound records and structurally invalid records (REAL sibling guards). |
| `ExtractionPolicy` | The **versioned, content-addressed** rule set: minimum validation evidence (required verification outcome — default `pass`; minimum distinct passing verifications ≥ 1, non-negotiable; evaluation presence + judgment gate), eligible trajectory entry kinds (default **actions + completions** — Arena records observable work and never hidden chain-of-thought; observations are environment outputs, not agent skill), dedup/threshold rules (distinct trajectories + total occurrences per pattern) and the A004 taxonomy target node. Deterministic: same inputs + policy ⇒ same candidates. |
| `SkillCandidate` | The **content-addressed, immutable** proposition mined from one or more validated trajectories: the signature (ordered action ids + completion outcome), the A004-shaped taxonomy ref, the proposed skill-node identity, declared inputs/outputs (mined deterministically from the signature), prerequisites (explicitly empty — relational prerequisites are `requires` edges in A004, not mining outputs), the evidence set (trajectory + evaluation + verification digests) and the extraction provenance (extractor version, policy digest, correlation id, extracted-at). |
| `SkillDraft` | The **A004-ready packaging, compatible BY CONSTRUCTION**: a REAL `@arena/capability-graph` skill node (§3 payload shape: inputs, outputs, prerequisites, evidence, tests, professionalLimitations, customerData; provenance `{recordDigest: <candidate digest>}`) plus REAL provenance-bearing `decomposes-into` edges from the policy's taxonomy target. Supersession is **APPEND-ONLY** (A004 supersession-by-append; extraction never edits graph history). |
| `mineSkillCandidates` | The **pure, deterministic** mining core: per-trajectory validation gate → eligibility projection → signature grouping + thresholds → candidate packaging, with every accept/reject recorded under closed reason vocabularies (`accepted`, `verification-outcome-not-met`, `insufficient-verification-evidence`, `missing-evaluation-evidence`, `evaluation-outcome-not-met`, `outcome-not-completed`, `no-eligible-entries`, `pattern-below-threshold`). |
| Envelopes | `run-extraction-command` / `extraction-completed-event` inside `@arena/protocol-core`'s `Envelope<T>`; commands carry a **required non-null idempotency key** (lock rule 17). |

## What it deliberately is NOT

- **It never rewrites evidence** (lock rule 6): extraction is READ-ONLY
  over trajectories and their evaluation/verification records — the
  hygiene suite proves source records stay bit-identical and frozen,
  and that the sources never call the evidence tier's write APIs.
- **It never extracts from unvalidated trajectories** (R17): no
  verification evidence ⇒ refusal, always (property P4).
- **It does not read hidden chain-of-thought** — there is none by
  design (§9); only observable entries are eligible, and the default
  policy reads actions + completions only.
- **It does not admit drafts into the capability graph** — the graph's
  own append-only admission (A004) stays the single authority; drafts
  are proposals ready to be appended there.
- **It mints no test artifacts**: draft payloads carry `tests: []`
  explicitly (tests are a Forge/testing-tier concern — see
  limitations).

## Contracts disclosure (A019)

This package owns **NO `contracts/` surface** (per spec/work-items.md,
A019's surfaces are `packages/skill-extraction/*` and
`services/skill-extraction/*` only). Its schemas live **inside the
package as SchemaRef-referenced data** (`SKILL_EXTRACTION_SCHEMAS`,
namespace `arena:schema/skill-extraction/...`); existing contracts are
not redeclared. No generator ships, so governance G9 has nothing to
drift-check for this package.

## Dependencies

Runtime: `@arena/protocol-core` (canonical JSON + sha256, envelopes,
branded identifiers, SchemaRef, ProtocolError) plus four genuinely
composed sibling domains — `@arena/trajectory` (REAL A011 structural
guards + entry-kind vocabulary), `@arena/evaluation` (REAL A012 record
guard), `@arena/verification` (REAL A013 record guard) and
`@arena/capability-graph` (REAL node/edge constructors so drafts are
A004-ready by construction). Zero external runtime dependencies.

## Reference fabric

The in-process reference fabric — policy registry, extraction runner
(idempotent by run key), ExtractionRunRecord ledger and draft store —
lives in `services/skill-extraction`
(`@arena/skill-extraction-fabric`).

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative + property + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`).
