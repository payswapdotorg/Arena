-- B002 migration 0001 (neon-postgres): authoritative control-plane record store.
-- Reproducible: CREATE IF NOT EXISTS guards make re-runs idempotent.
CREATE TABLE IF NOT EXISTS arena_control_record (
  record_id   TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  version     INTEGER NOT NULL,
  revision    INTEGER NOT NULL,
  data        JSONB NOT NULL,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS arena_control_record_tenant_kind_idx
  ON arena_control_record (tenant_id, kind);
