# @arena/artifact-protocol

Artifact identity, versioning, content addressing, publication and lineage
envelope wiring for Arena (Work Order A002; architecture-lock rules 5, 6, 12,
18, 22, 23).

- **ArtifactIdentity** — stable, provider-neutral `(namespace, name, semver
  version)` identity; `public` is the reserved global namespace, everything
  else is a tenant scope. Identities are pure data and immutable.
- **MaterialArtifact** — the immutable, content-addressed artifact unit:
  identity + embedded refs + plain-JSON content + sha256 digest over the
  canonical JSON of the digest-free view (canonicalization and hashing are
  reused from `@arena/protocol-core`, never reimplemented). Artifacts are
  deep-frozen at creation; no mutation API exists.
- **verifyArtifact / verifyArtifactTree** — fail-closed tamper detection,
  including nested/embedded artifact references resolved through a pure
  resolver.
- **PublicationRecord / PublicationLedger** — artifacts are private-tenant by
  default; an explicit immutable publication record makes them public.
  Retraction appends a NEW record (never edits); identity↔digest binding is
  permanent across the ledger.
- **Envelope wiring** — commands and events travel inside
  `@arena/protocol-core`'s `Envelope<T>` (idempotency-keyed commands,
  correlation ids, canonical serialization, digest verification).

Generated contracts: `contracts/artifacts/*.json` via
`scripts/generate-contracts.mjs` (`pnpm contracts:generate`,
`pnpm contracts:check`). Parity with the TS surface is asserted by
`src/contracts.parity.test.ts`; drift is asserted by `src/drift.test.ts`.

Purity: the only runtime dependency is `@arena/protocol-core` (protocol-layer
discipline enforced by the package manifest; the layer machine-classification
in `scripts/boundary-check.mjs` treats this package as a domain package
because its name lacks the `protocol-` prefix — all import edges remain
legal; see the A002 final report).
