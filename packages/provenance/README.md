# @arena/provenance

Provenance records and lineage queries for Arena material artifacts (Work
Order A002; docs/architecture.md §15; architecture-lock rules 18, 23;
requirement R14).

- **ProvenanceRecord** — per architecture.md §15: stable identity + version +
  digest, source/creator (tenant-scoped principal, never a raw provider
  identity), UTC millisecond-precision timestamps, parent refs (lineage
  edges), mandatory rights metadata, transformation lineage and verification
  refs. Construction validates everything and rejects missing rights,
  unknown principal types, malformed timestamps, self-references, duplicate
  parents and transform inputs that are not declared parents. Records are
  deep-frozen.
- **LineageGraph / queries** — pure functions over provenance records:
  `ancestors`, `descendants`, `isAncestorOf`, deterministic
  `topologicalOrder`, with cycle and identity-conflict detection at graph
  construction (fail closed).
- **Envelope wiring** — commands and events travel inside
  `@arena/protocol-core`'s `Envelope<T>`.

Purity: the only runtime dependency is `@arena/protocol-core`. The record's
structural components are validated plain-string views
(`src/shared.ts`) kept structurally compatible with
`@arena/artifact-protocol` by `src/cross-parity.test.ts`; that package is a
devDependency used only by tests.

Generated contracts: `contracts/artifacts/*.json` via
`packages/artifact-protocol/scripts/generate-contracts.mjs` (the A002
generator owns the whole `contracts/artifacts/` surface).
