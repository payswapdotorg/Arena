# @arena/body-forge-fabric

The in-process **reference forge fabric** for the Arena Agent Body
Forge (Work Order A021; requirement R18; architecture-lock rules 5, 6,
17, 18). Companion service of `packages/body-forge`
(`@arena/body-forge`).

## What it is

| Object | What it commits to |
| --- | --- |
| `ForgeService` | **submit(manifest, policy) → validate → compose → record**: enforces the input contracts (structural validity + fail-closed tamper verification of both manifest and policy), composes through the package's deterministic core under the caller-supplied recipe (no hidden clock reads), and emits the `ForgeRecord` + the BodyVersion proposal. Holds a **digest-addressed, append-only registry of ForgeRecords** with pure projections (`getRecord`, `listRecords`, `listRecordsByBody`, `listRecordsByManifest`). **Deterministic replay** (lock rule 17): the same forge key + the same (manifest, policy) tuple returns the STORED result byte-identically, never duplicated; the same key + a different tuple is an `IDEMPOTENCY_CONFLICT`. |
| version-consistency mirror | The registry refuses to record **two different digests for the same (body identity, version number)** — mirroring the A003 registry semantics (lock rule 5: a version number addresses immutable content). The A003 body-version registry remains the single append authority; this guard keeps the forge's own history consistent with it. Re-forging identical content under a new key records a new execution with the same emitted digest. |
| `composeFromLearning` | The **A020→A019→A021 demo path**: validates a REAL A020 `ExperimentRunRecord` (through `@arena/learning`'s own guard) and a REAL A019 `SkillDraft` (through `@arena/skill-extraction`'s own guard), derives a NEW manifest from a base manifest that cites both as **EXPLICIT provenance refs**, and composes a new BodyVersion proposal with the requested parent/supersession lineage. Optionally accepts a shared `ForgeService` so the demo path participates in the caller's idempotent replay. |
| `skillRefOfDraft` | The deterministic derivation of the skill ref an A019 draft's A004 skill node contributes to a manifest: `{namespace (default arena-skills), name: node.id, version: node.version, digest: node.digest}` — the A003 `VersionedArtifactRef` shape (a disclosed demo-path default the caller may override). |

## What it deliberately is NOT

- **It never mutates BodyVersions** (lock rule 5) and **never appends
  them into an AgentBody's version registry** — the A003
  body-version registry append stays the single authority; this
  fabric only EMITS proposals plus its own append-only execution
  records. The hygiene suite proves the sources never call the A003
  registry/history write APIs and that no mutation API exists on the
  public surface.
- **The learning→forge boundary is PROPOSAL-only** (lock rule 6):
  `composeFromLearning` READS the experiment record and skill draft,
  cites them by digest, and composes a NEW content-addressed version;
  the source records stay bit-identical and frozen (proven by the
  learning-demo suite). History is never rewritten.
- **No network, no database** — the in-process reference slice,
  mirroring the A019/A020 reference fabrics.

## Dependencies (disclosed)

Runtime (zero external): `@arena/body-forge` (the pure forge
protocol), `@arena/protocol-core` (idempotency keys),
`@arena/learning` (the REAL `isExperimentRunRecord` guard for the
demo path), `@arena/skill-extraction` (the REAL `isSkillDraft` guard
for the demo path).

Test-only: `@arena/agent-body`, `@arena/capability-graph`,
`@arena/evaluation`, `@arena/trajectory`, `@arena/verification` —
used to build REAL sibling fixtures (nothing is stubbed) and to prove
the forged proposals are accepted by the REAL A003 registry.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (service + negative + learning-demo + property + hygiene; 36 tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```

See docs/repo-layout.md for the layering rules this service must obey
(enforced by `pnpm boundary`).
