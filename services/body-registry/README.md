# @arena/body-registry-fabric

The **in-process reference Body Registry fabric** and the
envelope-wired service facade (Work Order A024; the RELEASE stage of
the Arena loop; architecture-lock rules 5, 6, 12, 16, 17, 18, 23).

## What is in the box

| Surface | Purpose |
|---|---|
| `BodyRegistryService` | The reference registry fabric: `register` (gate → idempotency → identity binding → append-only ledger), `supersede` / `retire` (append-only lineage), `publish` / `retract` (idempotent, reproducible publication), plus pure ledger projections (`projectLifecycle`, `resolveReleaseStatus`, `resolveActiveRelease`). |
| `BodyRegistryEnvelopeService` | The envelope-wired facade: `register-release-command` → `release-registered-event`, `publish-release-command` → `release-published-event` (commands carry REQUIRED idempotency keys — lock rule 17). |

## Discipline

- **Injected evidence stores, fail-closed**: the gate resolves A023
  certification records, A022 compatibility records, A003 body
  versions and (optionally) A021 forge records through
  constructor-injected, digest-addressed lookups. A store that throws
  fails registration closed (`BODY_REGISTRY_EVIDENCE_UNRESOLVABLE`);
  nothing is ever admitted partially. No network, no database.
- **Gate rejections are typed + structured**: a refused candidate
  throws `BODY_REGISTRY_REGISTRATION_REJECTED` carrying the closed
  -vocabulary structured rejections in `details` (reason + source +
  implicated ref + detail).
- **Idempotent registration** (lock rule 17): the same idempotency
  key + the same candidate tuple replays the stored record
  byte-identically; the same key + a different tuple is an
  `IDEMPOTENCY_CONFLICT`.
- **Release identity immutability** (A002 publication law): a release
  identity (`namespace/name@version`) bound to a digest can never be
  re-bound to different content — `IDENTITY_CONFLICT`.
- **Append-only lineage**: supersession/retirement append records and
  never mutate history; the lifecycle is a pure projection
  (`registered` → `superseded` / `retired`, terminal states never
  rewritten).
- **Publication is idempotent + reproducible**: identical publication
  inputs replay the identical content-addressed record (caller-supplied
  timestamps, no hidden clock reads).

## Dependencies (disclosed)

Runtime: `@arena/body-registry` (the pure release protocol), `@arena/protocol-core` (idempotency keys, envelope serialization), `@arena/agent-body` (principal/rights types), plus the sibling protocol packages whose record types the injected evidence stores carry (`@arena/certification`, `@arena/compatibility`, `@arena/body-forge`). Zero external runtime dependencies.

## Contracts disclosure (A024)

This service owns no `contracts/` surface (A024 owns only
`services/body-registry/*`), following the A019/A021/A022 precedent —
schemas live in the domain package as in-package SchemaRef data.

## Testing

Positive, negative/adversarial (gate rejections surfaced typed and
structured, malformed envelopes, failing stores, conflicts), property
(determinism, replay, publication reproducibility) and hygiene
(append-only discipline, closed surface) suites. Run:
`pnpm vitest run`.
