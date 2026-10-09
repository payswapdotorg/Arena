-- P002 migration 0005 (neon-postgres): durable idempotency outcomes and
-- projection state for the host runtime (P002 acceptance: retries return
-- the deterministic recorded outcome; ADR-P001-01 feeding model —
-- projection backstop sweeps checkpoint their position).
-- Reproducible: CREATE IF NOT EXISTS guards make re-runs idempotent.
CREATE TABLE IF NOT EXISTS arena_runtime_idempotency (
  idempotency_scope TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  outcome           JSONB NOT NULL,
  recorded_at       BIGINT NOT NULL,
  PRIMARY KEY (idempotency_scope, idempotency_key, correlation_id)
);

CREATE TABLE IF NOT EXISTS arena_projection_state (
  projection  TEXT NOT NULL,
  tenant_id   TEXT NOT NULL,
  position    BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (projection, tenant_id)
);
