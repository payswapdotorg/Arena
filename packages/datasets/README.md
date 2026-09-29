# @arena/datasets

Dataset **packaging** for Arena (Work Order A014; requirements R14, R23;
architecture-lock rules 5, 12, 18, 23; docs/architecture.md §15). Pure
TypeScript, zero external runtime dependencies — the only imports are the
REUSED A002 primitives: `@arena/artifact-protocol` (identity, content
addressing, verification, principals, rights, timestamps),
`@arena/provenance` (the lineage relation + verification-kind vocabularies)
and `@arena/protocol-core` (canonical JSON + sha256). This package never
reimplements canonicalization, hashing, artifact validation or publication
semantics.

**What it is NOT:** object storage. `DatasetBundle` resolution takes a
caller-supplied resolver (the A014 artifact service's tenant-scoped
resolver, or any A002 `ArtifactResolver`); nothing here touches a backend.
Durable persistence is a deployment-tier concern.

## Surface

| Member | Semantics |
| --- | --- |
| `DATASET_ENTRY_ROLES` / `toDatasetEntry` / `toDatasetEntries` | Closed entry-role vocabulary (`input`/`output`/`eval`/`split`); entries are A002 artifact refs, validated by the REUSED A002 guard, frozen; the same artifact may appear under multiple roles, each `(role, artifact)` pair once. |
| `createDatasetManifest(input)` | Versioned, content-addressed packaging of a dataset: A002 `ArtifactIdentity`, declared entries, §15 provenance (creator, timestamps, parent refs with lineage relations, mandatory rights, verification/evaluation refs), an `entriesChecksum` (sha256 over the canonically sorted entry list) and the manifest digest (sha256 over the canonical digest-free view). Deep-frozen; no mutation API. |
| `verifyDatasetManifest(manifest, expected?)` | Fail-closed tamper detection: recomputes BOTH the entries checksum and the digest; any mismatch throws `DATASET_TAMPERED`. |
| `computeDatasetEntriesChecksum` / `computeDatasetManifestDigest` / `datasetManifestView` | The digest primitives, exposed for tooling/tests. |
| `resolveDatasetBundle(manifest, resolver)` | Resolves a manifest into a verifiable bundle: verifies the manifest digest chain, resolves EVERY entry, checks identity + digest and re-verifies content through A002 `verifyArtifact`. Fail-closed on any missing (`DATASET_UNRESOLVED_ENTRY`) or unverifiable entry. Deterministic: the bundle digest is computed over `{bundleVersion, manifestDigest, sorted entry keys}` — same manifest ⇒ same bundle digest, independent of resolver order. |
| `verifyDatasetBundle(bundle, resolver)` | Re-runs the whole chain (bundle digest, manifest, every entry). |
| `toDatasetVersion` / `DatasetVersionRegistry` | Identity-based version pins: a dataset version (A002 identity incl. semver) pins exactly one manifest digest; binding permanence — re-pinning a bound version to a different digest throws `DATASET_IDENTITY_CONFLICT` (never overwritten), identical re-pins are idempotent; `listVersions` orders by semver precedence. |
| `deriveDatasetManifest(input)` | Split/subset derivations as LINEAGE-RECORDED transformations: the child manifest carries the parent manifest's content-addressed ref with relation `extracted-from` (default), `derived-from` or `composed-of`. Derivations stay inside the parent's tenant namespace (R24). |

## Tenant scoping (R24 / lock rule 11)

Every referenced namespace — entries, parent refs, verification evidence —
must be the dataset's own namespace or the reserved `public` namespace. A
manifest cannot silently reference another tenant's artifacts; violations
throw `DATASET_INVALID_PROVENANCE` / are rejected at construction.

## Contracts

Generated contracts: `contracts/dataset/*.json` at the repository root, via
`scripts/generate-contracts.mjs` (the A001/A002 generator convention:
deterministic sorted-key serialization, versioned SchemaRef `$id`,
`--check` drift detection auto-discovered by the governance G9 check).

```
pnpm contracts:generate   # regenerate in place
pnpm contracts:check      # drift check against the committed copies
```

Parity with the TS surface is asserted by `src/contracts.parity.test.ts`
(two independent tripwires together with `src/drift.test.ts`, exactly like
the A001/A009/A011/A012/A013 convention).

## Tests

```
pnpm test        # vitest run — unit, negative/adversarial, property, parity, drift, hygiene
```

Coverage map: `manifest.test.ts` (construction + tamper detection),
`bundle.test.ts` (resolution, fail-closed, determinism),
`versioning.test.ts` (pins, binding permanence, derivations),
`errors.test.ts` (taxonomy), `property.test.ts` (seeded-LCG invariants),
`contracts.parity.test.ts`, `drift.test.ts` (governance-style G9),
`hygiene.test.ts` (purity: no storage/IO vocabulary; no `any`; frozen
exports; test-support not exported).

## Layering

Domain package (docs/architecture.md §18): imports flow strictly downward
into `@arena/artifact-protocol` + `@arena/provenance` (same-layer domain
composition, allowed by the boundary checker) and
`@arena/protocol-core`. Boundary checker green.

## Dependency posture (disclosure)

Runtime dependencies: `@arena/protocol-core`, `@arena/artifact-protocol`,
`@arena/provenance` — the last is a GENUINE import: the dataset lineage
edges and verification refs reuse `@arena/provenance`'s closed
`LINEAGE_RELATIONS` / `VERIFICATION_KINDS` vocabularies verbatim (never
redefined, so the vocabulary cannot drift). devDependencies are all
`catalog:` — zero new external runtime dependencies.
