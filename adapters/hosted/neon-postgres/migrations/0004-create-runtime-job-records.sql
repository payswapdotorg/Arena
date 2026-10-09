-- P002 migration 0004 (neon-postgres): durable job records with claim/lease
-- columns and the dead-letter lot (ADR-P001-01 — one shared durable job
-- runner: job-table migrations, claiming semantics, poison/dead-letter
-- handling), plus the durable job-event envelopes and the tamper-evident
-- audit chain the A015 protocol defines.
-- Reproducible: CREATE IF NOT EXISTS guards make re-runs idempotent.
CREATE TABLE IF NOT EXISTS arena_job_record (
  job_id            TEXT PRIMARY KEY,
  kind_namespace    TEXT NOT NULL,
  kind_name         TEXT NOT NULL,
  kind_version      TEXT NOT NULL,
  definition_digest TEXT NOT NULL,
  correlation_id    TEXT NOT NULL,
  idempotency_scope TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  lens              TEXT,
  status            TEXT NOT NULL,
  attempts          INTEGER NOT NULL,
  events_length     INTEGER NOT NULL,
  record            JSONB NOT NULL,
  lease_owner       TEXT,
  lease_expires_at  BIGINT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS arena_job_submission_idx
  ON arena_job_record (idempotency_scope, idempotency_key, correlation_id);

CREATE INDEX IF NOT EXISTS arena_job_correlation_idx
  ON arena_job_record (correlation_id);

CREATE INDEX IF NOT EXISTS arena_job_status_idx
  ON arena_job_record (status);

-- Durable job-event envelopes (per-job append-only sequence 1..n).
CREATE TABLE IF NOT EXISTS arena_job_event (
  job_id      TEXT NOT NULL,
  sequence    INTEGER NOT NULL,
  envelope    JSONB NOT NULL,
  appended_at BIGINT NOT NULL,
  PRIMARY KEY (job_id, sequence)
);

-- The tamper-evident audit chain (A015): every consequential job mutation
-- appends exactly one record; each digest includes the previous digest.
CREATE TABLE IF NOT EXISTS arena_audit_record (
  sequence        INTEGER PRIMARY KEY,
  previous_digest TEXT NOT NULL,
  digest          TEXT NOT NULL,
  payload         JSONB NOT NULL,
  appended_at     BIGINT NOT NULL
);

-- The dead-letter lot: poison jobs (terminal-failed / unrecoverable) are
-- parked here with the reason and the terminal snapshot. The main record
-- stays queryable; the lot is the operator surface (ADR-P001-01).
CREATE TABLE IF NOT EXISTS arena_job_dead_letter (
  job_id   TEXT PRIMARY KEY,
  reason   TEXT NOT NULL,
  record   JSONB NOT NULL,
  moved_at BIGINT NOT NULL
);
