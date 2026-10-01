# @arena/billing-service

The reference billing service for the Arena epoch-consumption stage (Work
Order A033; requirements R31, R34, R48; architecture-lock rules 11, 16, 17,
18, 19; spec/service-boundaries.md "Marketplace/Billing": publication,
listing, entitlement, usage/accounting records).

`@arena/billing-service` is a pure reference billing fabric with injected
dependencies and no network/HTTP layer: usage ingestion from job events
(A015 envelopes, closed unit-cost metering table), metered aggregation
windows over the entitlements vocabulary (day / month, UTC buckets),
fail-closed quota enforcement against `@arena/entitlements` grants (no
active grant, an expired/revoked grant, a disabled flag, a quota or a rate
limit can never be bypassed), and immutable usage statements (draft →
issued, append-only lineage, canonical sha256 digests, locked windows —
usage can never be appended into an already-stated window).

Dependency injection: `Clock`, `GrantSource`, `PriceBook`, `UsageLedger`
and `StatementStore` are ports; in-memory reference implementations are
provided for tests and demos. The service communicates with versioned
commands/events over `@arena/protocol-core` envelopes and never mutates
another service's authoritative state. No web surface is owned here — the
A018 console consumes these contracts read-only.
