-- P002-F1 migration 0006 (neon-postgres): the durable payment escrow ledger,
-- its append-only per-operation entry rows and the durable at-least-once
-- payment event outbox (findings-register F-09 remediation; issue #169;
-- threat-model §AC-09 / §AC-13).
--
-- The payments service previously rode the in-process
-- InMemoryPaymentLedgerStore / InMemoryPaymentEventOutbox reference fabric:
-- check-then-act with NO atomic uniqueness, so N concurrent SAME-operation-key
-- settlement operations ALL applied (the charge-succeeded/record-failed
-- double-act — reproduced 6/6 applied in the P007 integrated pass, pinned by
-- tests/security/production/ac09-partial-payment-state.test.ts). The durable
-- uniqueness that resolves the race exactly-once lives here:
--
--   - arena_payment_ledger       — one escrow ledger snapshot per escalation
--                                  request (request_id PRIMARY KEY; the
--                                  snapshot carries the full domain document,
--                                  replaced append-only via the
--                                  entries_length guard);
--   - arena_payment_ledger_entry — one row per ledger entry. UNIQUE
--                                  (request_id, operation_key) is THE
--                                  exactly-once gate: a second application of
--                                  the same operation key — any sequence, any
--                                  interleaving — can never insert; the racing
--                                  loser resolves as a typed conflict and the
--                                  service layer replays the recorded outcome
--                                  (the C001 law under contention);
--   - arena_payment_outbox       — the durable at-least-once
--                                  escalation.payment.updated outbox
--                                  (event_id PRIMARY KEY; the same shape the
--                                  webhook outbox established in 0003).
--
-- Reproducible: CREATE IF NOT EXISTS guards make re-runs idempotent.
CREATE TABLE IF NOT EXISTS arena_payment_ledger (
  request_id     TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  currency       TEXT NOT NULL,
  truth          TEXT NOT NULL,
  state          TEXT NOT NULL,
  entries_length INTEGER NOT NULL,
  ledger         JSONB NOT NULL,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS arena_payment_ledger_tenant_idx
  ON arena_payment_ledger (tenant_id);

CREATE INDEX IF NOT EXISTS arena_payment_ledger_correlation_idx
  ON arena_payment_ledger (correlation_id);

-- Append-only ledger entry records: one row per entry the ledger document
-- carries ((request_id, sequence) addressing; a replayed snapshot append is a
-- no-op). The UNIQUE index on (request_id, operation_key) is the durable
-- per-operation-key uniqueness the F-09 remediation mandates: concurrent
-- SAME-operation-key settlement operations resolve exactly-once at the
-- storage layer — the loser's insert conflicts and surfaces the typed
-- conflict the service converts into the recorded-outcome replay.
CREATE TABLE IF NOT EXISTS arena_payment_ledger_entry (
  request_id    TEXT NOT NULL,
  sequence      INTEGER NOT NULL,
  operation_key TEXT NOT NULL,
  tenant_id     TEXT NOT NULL,
  entry         JSONB NOT NULL,
  appended_at   BIGINT NOT NULL,
  PRIMARY KEY (request_id, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS arena_payment_ledger_operation_idx
  ON arena_payment_ledger_entry (request_id, operation_key);

-- The durable at-least-once payment event outbox (C010's PaymentEventOutbox
-- port; event_id IS the idempotent consumer key, exactly like the webhook
-- outbox's dedupe contract).
CREATE TABLE IF NOT EXISTS arena_payment_outbox (
  event_id     TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL,
  tenant_id    TEXT NOT NULL,
  sequence     INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  created_at   BIGINT NOT NULL,
  delivered_at BIGINT
);

CREATE INDEX IF NOT EXISTS arena_payment_outbox_pending_idx
  ON arena_payment_outbox (created_at) WHERE delivered_at IS NULL;
