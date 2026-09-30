# @arena/security-service

The Arena **reference security service** (Work Order A034; spec/security.md S1.0) — the in-process policy-bundle registry, envelope-wired authorization/learning-gate facade, and the append-only tamper-evident audit trail sealing for the `@arena/security` protocol. It mirrors the A013/A023 reference fabrics structurally.

## Surface

| Piece | What it does |
| --- | --- |
| `SecurityPolicyRegistry` | In-process policy-bundle registry: `registerBundle` validates (digest verification — tampered digests fail closed), content-addresses by statement-set digest and registers idempotently; a different statement set under the same `(bundleId, version)` identity is an `IDENTITY_CONFLICT`. Lookups by identity and by digest. |
| `SecurityService` | The envelope-wired facade. `handleRegisterPolicyBundleCommand` → registry + `policy-registered` audit append + `policy-bundle-registered-event`. `handleEvaluateAuthorizationCommand` → `AuthorizationEngine.evaluate` + the HARD tenancy check (tenancy OVERRIDES policy — an allow statement in the principal's tenant can never authorize another tenant's resource; the effective decision fails closed to `deny/tenant-mismatch`) + audit append (BOTH outcomes) + `authorization-decided-event` carrying the decision AND the sealed audit record. `handleAuthorizeLearningCommand` → the explicit-consent cross-tenant learning gate + audit + `learning-authorization-decided-event`. Fail-closed error normalization; injected deps; NO ambient policy (no addressed bundle ⇒ typed error). |
| Audit trail | Every handled command seals exactly one record into the append-only, tamper-evident `SecurityAuditLog` (sha256 chain via `@arena/protocol-core`, replay rejection, no deletion surface). `auditSnapshot()` verifies the whole chain before returning it. |

## The security law in the service

Denials are normal outcomes: a denied evaluation returns a closed decision, appends an auditable record, and still emits the wire event. Failures (malformed envelopes, unknown bundles, tampered digests) throw typed `SecurityError`s — never partial results. Cross-tenant data flow needs BOTH an explicit, unexpired, unrevoked grant AND per-dataset `permittedUse: cross-tenant-learning` rights records.

## Dependencies

`@arena/protocol-core` (envelopes, canonical JSON + sha256 digests, correlation ids / idempotency keys) and `@arena/security` (the protocol). Zero external runtime dependencies (frozen catalog). In-process only — no network, no database.

## Demo

```bash
cd services/security && pnpm demo    # or: node main.mjs
```

Drives one deterministic end-to-end scenario: register a bundle → allowed read → denied export → cross-tenant read (tenancy overrides) → learning gate with/without an explicit grant → negative probes (unknown bundle, tampered digest, replayed audit event) → audit chain verification.

## Adversarial battery

The cross-cutting adversarial battery lives in `tests/security/` (the A034-owned test surface). Run it from this package:

```bash
cd services/security
pnpm run battery:test        # vitest run --root ../../tests/security
pnpm run battery:typecheck   # tsc --noEmit -p ../../tests/security/tsconfig.json
```

## Development

```bash
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
```
