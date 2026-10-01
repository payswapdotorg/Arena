-- B002 migration 0002 (neon-postgres): versioned-migration applied-record
-- ledger. The migration runner's bootstrap statement uses the same
-- idempotent DDL so a fresh store always has a ledger before migrations
-- record into it.
CREATE TABLE IF NOT EXISTS arena_migration_ledger (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at BIGINT NOT NULL
);
