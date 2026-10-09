-- P002 migration 0003 (neon-postgres): durable escalation lifecycle records,
-- append-only lifecycle event records and the durable at-least-once webhook
-- outbox for the host runtime (ADR-P001-07 §2 persistence; ADR-P001-02 lens
-- stamping on lifecycle records).
-- Reproducible: CREATE IF NOT EXISTS guards make re-runs idempotent.
CREATE TABLE IF NOT EXISTS arena_escalation_record (
  request_id        TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  lens              TEXT NOT NULL,
  state             TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  idempotency_scope TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  history_length    INTEGER NOT NULL,
  record            JSONB NOT NULL,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS arena_escalation_submission_idx
  ON arena_escalation_record (idempotency_scope, idempotency_key, correlation_id);

CREATE INDEX IF NOT EXISTS arena_escalation_tenant_idx
  ON arena_escalation_record (tenant_id);

CREATE INDEX IF NOT EXISTS arena_escalation_correlation_idx
  ON arena_escalation_record (correlation_id);

-- Append-only lifecycle event records: one row per history entry the
-- escalation record carries (UNIQUE (request_id, sequence) makes re-append
-- idempotent — a restarted host never duplicates a transition record).
CREATE TABLE IF NOT EXISTS arena_escalation_event (
  request_id  TEXT NOT NULL,
  sequence    INTEGER NOT NULL,
  tenant_id   TEXT NOT NULL,
  event       JSONB NOT NULL,
  appended_at BIGINT NOT NULL,
  PRIMARY KEY (request_id, sequence)
);

-- The durable at-least-once webhook outbox (C001's WebhookOutbox port).
-- event_id IS the idempotent consumer key (dedupe on the consumer side).
CREATE TABLE IF NOT EXISTS arena_webhook_outbox (
  event_id     TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL,
  tenant_id    TEXT NOT NULL,
  sequence     INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  delivered_at BIGINT
);

CREATE INDEX IF NOT EXISTS arena_webhook_outbox_pending_idx
  ON arena_webhook_outbox (created_at) WHERE delivered_at IS NULL;
