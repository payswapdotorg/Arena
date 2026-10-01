# @arena/entitlements

The entitlement core for the Arena epoch-consumption stage (Work Order A033;
requirements R31, R34, R48; architecture-lock rules 11, 16, 17, 18).

`@arena/entitlements` is a DOMAIN package whose only workspace import is
`@arena/protocol-core` (protocol layer) — never a sibling domain package and
never a service. It owns:

- typed **EntitlementGrant** records (feature flags, quotas, rate limits) with
  append-only lineage (`granted → amended* → revoked?`) and expiry semantics
  (`validFrom`, optional `expiresAt`; a grant is inactive at `expiresAt`);
- **usage-meter event types** riding the A015 envelope discipline: every event
  travels inside `@arena/protocol-core`'s `Envelope<T>` with a correlation id,
  an idempotency key on commands, and a versioned `arena:schema/entitlements/*`
  SchemaRef;
- **tenant-scoped grant resolution with fail-closed defaults**: no matching
  grant, a tenant mismatch, a revoked / expired / not-yet-active grant, or a
  disabled feature flag can never produce an allow.

Everything is pure TypeScript with zero external runtime dependencies; all
records are deep-frozen, lineage is append-only (mutations return new frozen
records), and digests/canonical JSON are reused from `@arena/protocol-core`
(never reimplemented).
