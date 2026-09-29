# @arena/task-spec

Arena workspace package (layer: domain), implementing the **TaskSpec
protocol** (Work Order A008; docs/architecture.md §6 "Task — the
reproducible unit of work"; spec/task-spec.md TS1.0; requirement R6;
architecture-lock rules 5, 6, 11, 17, 18, 22, 24).

TaskSpec is the reproducible unit of capability-development work. This
package owns:

- **TaskSpec** — versioned, content-addressed (sha256 canonical digest via
  `@arena/protocol-core`), immutable + deep-frozen, carrying EVERY TS1.0
  structure field: identity/version, capability labels, difficulty
  (declared scale), domain, initial state reference, instructions,
  objectives, constraints, permitted tools, **prohibited shortcuts
  (first-class — shortcut resistance is a TS1.0 quality dimension)**,
  expected outputs, completion criteria, evidence criteria, environment
  requirements (A009 ENV1.0-shaped declarations), evaluator bindings
  (A012 descriptor-digest triples), verifier bindings (A013
  descriptor-digest triples), expert qualification requirements (A007
  shapes) and **mandatory data-rights metadata** (R24 posture:
  private-tenant by default; private-tenant forbids cross-tenant reuse —
  guard-enforced).
- **Long-horizon evidence** — intermediate state + recoveries as
  FIRST-CLASS evidence: REQUIRED for the `long-horizon-execution` class
  ("final output alone is insufficient"), permitted for `recovery-failure`,
  forbidden for every other class.
- **TaskSpec guards** — the pure validation layer: field completeness per
  TS1.0, closed vocabularies (the eleven-class task vocabulary, difficulty
  scale + classes, seven quality dimensions, data-rights classifications),
  and cross-field consistency (long-horizon ⇒ intermediate-state evidence;
  binding digests well-formed; difficulty in a declared scale; the pinned
  initial-state environment is among the required declarations;
  supersession targets the same logical task at strictly lower semver
  precedence).
- **Leakage/quality declarations** — all seven TS1.0 Quality dimensions
  (realistic-context, discriminative-difficulty, observable-success,
  reproducible-evaluation, low-leakage, clear-provenance,
  declared-limitations) as EXPLICIT declared fields with structured
  provenance; `satisfied: false` is a valid honest declaration of a gap,
  never an error; exactly one declaration per dimension is required.
- **TaskDiff + task versioning** — new version = new content-addressed
  object; supersession by append (`supersedes`; the superseded version
  stays immutable and addressable forever); a PURE `taskIdentity`
  (id + semver) resolution (`resolveTaskIdentity`) with identity-conflict
  detection.
- **CompilationPolicy** — the versioned, content-addressed rule set the
  compiler runs under: eligibility (a non-empty subset of A005's compilable
  statuses {triaged, active} — narrow-only — plus a minimum-evidence
  floor), ordered first-match-wins class selection (closed matcher
  vocabulary; the last rule must be `always` — a total function),
  difficulty derivation, field mapping (including the instruction template
  with a closed placeholder vocabulary), environment selection, task-id
  derivation, expert-qualification posture, the seven-dimension quality
  posture, long-horizon evidence (REQUIRED when the rules can select
  `long-horizon-execution`) and data rights.
- **CompilationRecord** — the append-only, idempotency-keyed run record
  (lock rule 17): case digest + target digest + policy digest + emitted
  spec digests + correlation id.
- **Envelope wiring** — `run-compilation-command` (REQUIRED idempotency
  key) / `compilation-recorded-event` travel inside
  `@arena/protocol-core`'s `Envelope<T>`.

## What this package deliberately is NOT

- It contains **NO compilation logic** — the R6 bridge (compiling
  Capability Cases into TaskSpecs) lives in `services/task-compiler`.
- **Compiling never mutates a case** (lock rule 6): a TaskSpec is a
  PROPOSAL derived from an exact case state; pinning is a separate,
  consumer-side act.
- It is **not a task registry/store**: `resolveTaskIdentity` is a pure
  function over a provided spec set; no I/O, no clock, no storage.

Generated contracts: `contracts/task/*.v1.json` (8 schemas:
task-spec, task-class, compilation-policy, compilation-record,
run-compilation-command, compilation-recorded-event, error,
schema-registry), produced by `scripts/generate-contracts.mjs`,
drift-checked by the drift suite and governance G9, parity-checked by
`contracts.parity.test.ts`.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative/adversarial + property + parity + drift + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate  # regenerate contracts/task/*
pnpm contracts:check     # drift check against the committed contracts
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`): the ONLY runtime dependency is
`@arena/protocol-core`; every cross-protocol reference (capability-graph
node refs, A005 case refs, A009 environment declaration refs, A007
qualification-policy refs, A012/A013 descriptor-digest triples) is a
validated plain-string VIEW type — the sibling-domain convention — so the
owning packages stay the single authority for their semantics.
