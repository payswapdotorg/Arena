# @arena/artifact-service

The in-process **artifact storage/lineage reference service** for Arena
(Work Order A014; requirements R14, R23, R24; architecture-lock rules 5, 6,
11, 12, 18, 23). Pure TypeScript, zero external runtime dependencies — the
only imports are the REUSED A002 primitives: `@arena/artifact-protocol`
(identity, content addressing, verification, publication) and
`@arena/provenance` (§15 provenance records, lineage vocabulary) over
`@arena/protocol-core`. This service never reimplements artifact
validation, canonicalization, hashing or publication semantics.

**What it is NOT:** object storage itself. Everything lives in Maps inside
the service objects — the protocol-faithful in-process reference
implementation (the A011 trajectory-store house pattern). Durable
persistence (databases, object storage) is a deployment-tier concern and
is deliberately NOT modeled here. `@arena/datasets` is a devDependency
used only by the interop test that proves the store's resolver feeds
dataset bundle resolution.

## API

### ArtifactStore — PUT/GET by artifact digest + identity

| Operation | Semantics |
| --- | --- |
| `put(artifact, caller)` | Verifies content through the REUSED A002 `verifyArtifact` (the store never trusts caller-side digests) and indexes by digest + identity. **Identity↔digest binding permanence:** a second artifact under a bound identity+version with a DIFFERENT digest is REJECTED with `ARTIFACT_IDENTITY_CONFLICT` — never overwritten; the bit-identical artifact re-puts idempotently. The caller's tenant must be the artifact's namespace (or `public`). |
| `getByDigest(digest, caller)` / `getByIdentity(identity, caller)` | Tenant-scope isolation: cross-tenant reads are REJECTED with `ARTIFACTS_TENANT_FORBIDDEN` (own namespace or the reserved `public` namespace only). **Content verification ON READ:** every get re-verifies the digest — an in-process adversary who corrupts a stored entry is detected before the artifact is returned (fail-closed `ARTIFACT_TAMPERED`). |
| `listByNamespace(namespace, caller)` | The tenant's own scope listing (cross-tenant listing rejected). |
| `resolverFor(caller)` | An A002 `ArtifactResolver` bound to the caller's read scope — feeds `verifyArtifactTree`, lineage validation and dataset bundle resolution. |
| — | **NO update/delete APIs** — artifacts are immutable; negative tests assert the absence of any mutation method. |

### LineageService — record + query transformation lineage

| Operation | Semantics |
| --- | --- |
| `record(input)` | Append-only §15 provenance recording through the REUSED `@arena/provenance` constructor. **Closed-world parent validation:** every parent ref must resolve in the store (reading as the artifact's namespace, so cross-tenant parents are unresolvable) and be digest-verified. **Cycle rejection reports the offending path** (`details.path` carries the full loop). A bit-identical record replays idempotently; a contradictory record for the same artifact is rejected. Verification/evaluation refs (A013 verification-record digests / A012 evaluation-record digests) ride the closed kind vocabulary (`verification`/`attestation`/`evaluation`) as open-world refs. |
| `ancestryOf(ref)` / `descendantsOf(ref)` / `isAncestorOf(a, b)` | DEEP lineage queries — deterministic transitive walks with a defensive cycle guard reporting the offending path (diamonds are NOT cycles). |
| `validateProvenance(ref)` | Re-runs parent resolution + digest verification (fail closed). |
| `getRecord(ref)` / `listRecords()` | Pure projections (insertion order, frozen). |

### PublicationService — the A002 PublicationLedger as service operations

| Operation | Semantics |
| --- | --- |
| `publish(artifact, publisher, rights)` | Explicit, immutable publication record. Requires the artifact to be ingested in the store (read THROUGH the store under the publisher's tenant scope: cross-tenant publication fails closed; tampered content fails at the on-read verification). **Publication NEVER silently changes tenant visibility** — the artifact's namespace is untouched; only the ledger grows. Idempotent for the bit-identical record. |
| `retract(publication, publisher)` | Appends a NEW record whose `supersedes` carries the original record digest — the original is never edited; only publish records, only once (A002 invariants). |
| `status(identity)` | Private by default (lock rule 12); public exactly while an un-superseded publish record exists. |
| `listPublic({ namespace? })` | The actively-published records, optionally scoped by namespace. |
| `listPrivate(caller, { namespace? })` | Stored artifacts of a namespace with NO active publication — the tenant's own view (cross-tenant private listing rejected). |
| `ledger()` | The frozen, append-only ledger projection. |

### Facade

`createArtifactService()` → `{ store, lineage, publication }` sharing ONE
store.

## Demo

```
cd services/artifacts && pnpm demo    # (or: node main.mjs)
```

The demo self-bootstraps `node --experimental-strip-types` with a
`.js`→`.ts` resolve hook (ts-source-hooks.mjs) so the REAL workspace
packages run straight from their TypeScript sources — no build step, zero
new dependencies. It drives one deterministic end-to-end scenario: ingest
→ lineage chain → publication → retraction → dataset bundle resolution
(through the store resolver) with negative probes.

## Contracts

This service ships **no contract generator** — the A014 dataset contracts
are owned and emitted by `packages/datasets` into `contracts/dataset/` at
the repository root (the governance G9 check auto-discovers generators
under `packages/*/scripts` only, exactly like the A011 trajectory-store
arrangement).

## Tests

```
pnpm test        # vitest run — unit, negative/adversarial, interop, property, hygiene
```

Coverage map: `store.test.ts` (binding permanence, tenant isolation,
tamper-on-read, no mutation surface), `lineage.test.ts` (append-only
edges, closed-world validation, cycle-with-path, deep queries),
`publication.test.ts` (publish/retract/status/listings, tenant guards,
never-silent-visibility), `interop.test.ts` (dataset bundles through the
store resolver), `property.test.ts` (seeded-LCG invariants),
`errors.test.ts` (service taxonomy), `hygiene.test.ts` (purity: no
storage/IO vocabulary; no `any`; frozen exports; test-support not
exported).

## Layering

Service layer (docs/architecture.md §18): imports flow strictly downward
into the domain packages (`@arena/artifact-protocol`,
`@arena/provenance`) and the protocol package (`@arena/protocol-core`).
No service-to-service imports. Boundary checker green.
