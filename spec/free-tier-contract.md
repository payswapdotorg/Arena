# Free-Tier Runtime Contract FT2.0

## Provider neutrality

Vercel, Neon, R2, Upstash and Apify are infrastructure adapters only. No domain package imports a provider.

## Capacity state

Every hosted adapter returns one of:

- AVAILABLE
- DEGRADED
- EXHAUSTED
- DISABLED

Adapters never silently switch to a paid path.

## Storage

R2 is the default preview blob store. Artifact metadata remains in PostgreSQL.

## Redis

Redis stores only bounded/rebuildable state:

- short-lived cache;
- idempotency windows;
- rate-limit counters;
- ephemeral locks/leases;
- bounded job coordination.

Authoritative facts remain in PostgreSQL or immutable artifact storage.

## Database

Neon PostgreSQL is authoritative for Arena control-plane records.

Migrations are versioned and reproducible.

## Acquisition

Apify is optional and must never be required for the primary capability-development lifecycle.

## Local parity

Every hosted adapter has a local fake/in-memory implementation exercising the same contract.

## Cost safety

Quota behavior is tested in CI using fake meters. Tests never require live provider credentials.
