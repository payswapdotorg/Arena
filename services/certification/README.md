# @arena/certification-fabric

The Arena **certification reference fabric** — in-process suite registry +
certification engine + record ledger (Work Order A023; spec AB1.0 design
law; architecture-lock rules 4, 6, 17, 18).

Pure TypeScript, ZERO external runtime dependencies (only
`@arena/protocol-core` + `@arena/certification` workspace packages).

## Public surface

- `CertificationRegistry` / `createCertificationRegistry` — content-addressed
  registry of `CertificationSuiteDescriptor`s. Registering the SAME
  descriptor is idempotent; registering a DIFFERENT descriptor under the
  same `(suiteId, version)` identity is an `IDENTITY_CONFLICT` (the
  assessor-versioning rule: changing a suite requires a new version).
- `CertificationFabric` / `createCertificationFabric` — the reference
  engine + ledger. `certify(suiteRef, possessionRef, scopeRefs,
  componentVerdicts, options)` resolves the suite by digest, validates
  set-equality between the supplied summary and the suite declaration,
  builds the `CertificationRecord` through the domain constructor (which
  derives the verdict / unknown cause / constraints / scoped statement,
  computes the input digest, freezes the record), appends it to the
  content-addressed ledger, and returns it. Idempotent by idempotency
  key + command tuple (lock rule 17): same key + same command replays as
  a no-op returning the stored record; same key + different command is an
  `IDEMPOTENCY_CONFLICT`.

## Queries (pure projections)

`getRecord(ref)`, `listRecordsBySuite(suiteRef)`,
`listRecordsByCorrelation(correlationId)`, `listRecordsByVerdict(verdict)`,
`listRecordsByTimeRange({ from?, to? })`, `listRecords()`.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (registry + fabric + property + hygiene)
pnpm build       # tsc -p tsconfig.build.json -> dist/
```
