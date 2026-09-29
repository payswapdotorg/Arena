# @arena/certification-fabric

The Arena **reference certification fabric** (Work Order A023; requirements R21, R22, R43) — the in-process suite registry, evidence stores, certification runner and append-only record ledger for the `@arena/certification` protocol. It mirrors the A013 reference fabric structurally, and is deliberately different where the protocols differ: it issues **composition-scoped** certification statements only (the README design law; architecture-lock rule 4).

## Surface

| Piece | What it does |
| --- | --- |
| `CertificationSuiteRegistry` | In-process suite registry: `registerSuite` is idempotent by suite digest; a different digest under the same `(suiteId, version)` identity is an `IDENTITY_CONFLICT` (changing a suite requires a new version). Lookups by digest (the "revision X" address). |
| `CertificationFabric` | Suite registry + guard-validated evidence stores (A012 `EvaluationRecord`s, A013 `VerificationRecord`s, A022 `CompatibilityRecord`s, A014 `DatasetManifest`s) + the runner + the ledger. `certify(suiteRef, subject, evidenceRefs, {correlationId, idempotencyKey})` resolves the suite and EVERY evidence ref (a missing ref is REJECTED — fail-closed), evaluates every stage through the domain engine, and appends the derived record. Same idempotency key + same command tuple ⇒ no-op replay; different tuple ⇒ `IDEMPOTENCY_CONFLICT`. `revoke(digest, grounds, …)` appends a revocation record. Supersession + revocation are PROJECTED (`effectiveStatus`: `active \| superseded \| revoked`) — stored records are never mutated. Queries: by digest, subject, suite, tenant, verdict; `currentCertification(subject)`. |
| `CertificationService` | The envelope-wired facade: `handleRunCertificationCommand(raw)` strict-parses a `run-certification-command` (REQUIRED idempotency key), runs the fabric and returns the `certification-recorded-event`; `readRecordedEvent(raw)` consumer side; `assertAuthoritative(record)` fail-closed ledger check. Injected deps; no network layer (the A023 reference slice). |

## The design law in the fabric

Every record the fabric appends carries a DERIVED `CertificationStatement` of the exact scoped form — "Agent Body B, version V, possessed by Cognitive Substrate M, under Environment E and Runtime Profile R, satisfied Certification Suite S at revision X" — with the mandated professional-limitations notice. A failed or indeterminate run grants NO level. Cross-tenant compatibility evidence can never certify (tenant-mismatch). Missing or mismatched evidence can never certify (fail-closed unknown).

## Dependencies

`@arena/protocol-core` (envelopes, correlation ids / idempotency keys), `@arena/certification` (the protocol) and the consumed sibling packages `@arena/verification` (A013), `@arena/evaluation` (A012), `@arena/compatibility` (A022), `@arena/datasets` (A014) — their REAL public guards validate every stored evidence record. Zero external runtime dependencies (frozen catalog). In-process only — no network, no database.

## Demo

```bash
cd services/certification && pnpm demo    # or: node main.mjs
```

Drives one deterministic end-to-end scenario: register a suite (verification + evaluation + compatibility stages) → build the composition under test → put A013/A012/A022 evidence → wire the envelope round trip (`run-certification-command` → `fabric.certify` → `certification-recorded-event`) → replay idempotently → supersede (recertify) → revoke → negative probes (unknown suite, unresolvable evidence, idempotency conflict, cross-tenant evidence) → observability dump.

## Development

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm test        # vitest run
pnpm build       # tsc -p tsconfig.build.json
```
