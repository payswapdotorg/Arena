# @arena/capability-case

Arena workspace package (layer: domain), implementing the **Capability Case
protocol** (Work Order A005; docs/architecture.md §5; spec CC1.0;
requirements R5, R6-bridge, R3-style addressability; architecture-lock
rules 6, 11, 24).

The Capability Case is the bridge from observed failure to capability
development. This package owns:

- **CapabilityCase** — versioned, content-addressed (sha256 canonical digest
  via `@arena/protocol-core`), immutable + deep-frozen, carrying EVERY §5
  field (target capability, domain, context, observed failure, evidence,
  current body/substrate — both optional —, uncertainty, desired outcome,
  expert/environment/task/evaluation/verification requirements) plus the
  spec CC1.0 required fields (source, problem statement, priority, risk,
  provenance, status).
- **Append-only lifecycle** — `DRAFT → SUBMITTED → TRIAGED → ACTIVE →
  RESOLVED/SUPERSEDED` with terminal finality (terminal mutation throws)
  and a deep-frozen, never-rewritten event history.
- **Supersession** — new case versions supersede old ones
  (`supersedes`/`supersededBy` refs); superseded versions stay immutable and
  addressable forever.
- **Tenant scoping** (lock rule 11) — every case carries a tenant scope (the
  reserved `public` namespace for explicitly published global cases);
  cross-tenant reads fail closed at the `CaseRegistry` query API.
- **Evidence discipline** (lock rule 6) — digest-addressed evidence refs;
  attachment appends; NO removal or rewrite API exists (asserted by the
  hygiene suite and `assertAppendOnly`).
- **TaskCompilationTarget** — the typed data contract the A008 TaskSpec
  compiler consumes (pure types + `deriveCompilationTarget` validator; no
  compiler logic here).
- **Envelope wiring** — commands and events travel inside
  `@arena/protocol-core`'s `Envelope<T>` with REQUIRED idempotency keys on
  commands (lock rule 17).

Generated contracts: `contracts/capability-case/*.v1.json` (29 schemas),
produced by `scripts/generate-contracts.mjs`, drift-checked by the drift
suite and governance G9, parity-checked by `contracts.parity.test.ts`.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run (positive + negative tests)
pnpm build       # tsc -p tsconfig.build.json -> dist/
pnpm contracts:generate  # regenerate contracts/capability-case/*
pnpm contracts:check     # drift check against the committed contracts
```

See docs/repo-layout.md for the layering rules this package must obey
(enforced by `pnpm boundary`): the ONLY runtime dependency is
`@arena/protocol-core`.
