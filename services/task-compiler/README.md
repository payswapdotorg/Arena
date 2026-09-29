# @arena/task-compiler-fabric

Arena workspace service (layer: service), implementing the **TaskCompiler
reference fabric** (Work Order A008; requirement R6 "Compile Capability
Cases into reproducible TaskSpecs"; architecture-lock rules 6, 17, 18).

The R6 bridge: compile a CapabilityCase (via A005's
`TaskCompilationTarget`) under a versioned, content-addressed
`CompilationPolicy` into reproducible TaskSpec PROPOSALS.

- **TaskCompiler** (`compiler.ts`) — the PURE engine:
  `compileTarget(target, policy)` is deterministic (same case state + same
  policy ⇒ byte-identical specs — the spec view carries no timestamps and
  no randomness; a different target DERIVATION time does not change the
  specs), fail-closed on tampered inputs (both digests are recomputed
  before anything is emitted), and maps the case requirement surface into
  every TS1.0 task field under the policy's declared rules (class
  selection, difficulty derivation, field mapping, environment selection,
  expert-qualification posture, quality posture, long-horizon evidence,
  data rights).
- **TaskSpecRegistry** (`registry.ts`) — the in-process, append-only spec
  PINNING store: content-deduplicated (re-pinning identical content is a
  no-op); pinning different content for an occupied version slot NEVER
  overwrites — it appends the next minor version with `supersedes` pointing
  at the current head (new version = new content-addressed object).
- **TaskCompilerFabric** (`fabric.ts`) — command orchestration: register
  verified cases + policies (identity conflicts fail closed), run
  `runCompilation` (idempotency key REQUIRED — lock rule 17: the same key +
  command replays the stored record; the same key + a different command is
  an `IDEMPOTENCY_CONFLICT`), and pure queries over records, events and
  pinned specs.

## What this fabric deliberately is NOT

- **Compilation never mutates a case** (lock rule 6): the case is read,
  the target derived, specs emitted as PROPOSALS — the append-only case
  lifecycle is untouched (asserted by the hygiene + fabric suites).
- **Specs are proposals until pinned**: pinning is an explicit registry
  act; nothing here marks a task "active" or schedules execution (job
  orchestration is A015's concern).
- **No network, no database** — an in-process reference implementation
  (house style); REST/HTTP layers are deliberately NOT part of this
  surface.
- **Cross-tenant reuse is never a compilation default** (R24): every
  compiled spec carries `dataRights.crossTenantReuse: false`.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative/adversarial + property + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm demo        # node main.mjs — deterministic end-to-end scenario
```

Runtime dependencies (all workspace, zero external):
`@arena/task-spec` (the A008 protocol objects),
`@arena/capability-case` (the A005 case/target constructors + digest
verification — the primary input seam), `@arena/protocol-core`
(correlation/idempotency identifiers, envelopes).
