/**
 * Audit stream for consequential mutations (Work Order A015 gate 7;
 * requirement R28; architecture-lock rule 17).
 *
 * Every consequential state mutation (job submit / claim / progress /
 * complete / fail / cancel / timeout) emits a `mutation-audited` event
 * carrying the actor (principal ref), the mutation, the job id, the
 * correlation id and the envelope id of the domain event it audits. The
 * audit stream is APPEND-ONLY and TAMPER-EVIDENT:
 *
 *   - audit records are sequenced 1..n (contiguous; gaps/duplicates are
 *     rejected at append);
 *   - each record's `previousDigest` carries the chain digest of the
 *     record before it ('0' * 64 for the genesis record);
 *   - each record's `digest` is the sha256 over the canonical JSON of
 *     {payload, previousDigest, sequence} — computed with
 *     @arena/protocol-core's digestCanonical, NEVER reimplemented;
 *   - `verifyAuditChain` recomputes every digest and linkage; a broken
 *     chain (tampered payload, tampered digest, removed record, reordered
 *     records, sequence gap) FAILS CLOSED with JOB_AUDIT_CHAIN_BROKEN.
 */

import { digestCanonical } from '@arena/protocol-core';
import { JOB_ERROR_CODES, JobError } from './errors.js';
import type { MutationAuditedEvent } from './events.js';
import { isJobEvent } from './events.js';

/** Chain digest carried by the record BEFORE the first one (genesis). */
export const AUDIT_GENESIS_DIGEST = '0000000000000000000000000000000000000000000000000000000000000000' as const;

// ---------------------------------------------------------------------------
// Audit log shape
// ---------------------------------------------------------------------------

/** One tamper-evident entry in the append-only audit stream. */
export interface AuditRecord {
  /** 1-based contiguous position in the audit stream. */
  readonly sequence: number;
  /** Chain digest of the previous audit record (genesis value for #1). */
  readonly previousDigest: string;
  /** The consequential-mutation audit event payload. */
  readonly payload: MutationAuditedEvent;
  /**
   * sha256 over the canonical JSON of {payload, previousDigest, sequence}.
   * Each audit digest therefore INCLUDES the previous event's digest.
   */
  readonly digest: string;
}

/** Append-only audit stream. */
export interface AuditLog {
  readonly records: readonly AuditRecord[];
}

export const EMPTY_AUDIT_LOG: AuditLog = Object.freeze({ records: [] });

// ---------------------------------------------------------------------------
// Construction / append (pure, deterministic)
// ---------------------------------------------------------------------------

function chainFailure(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new JobError(JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** sha256 chain digest over {payload, previousDigest, sequence}. */
async function computeAuditDigest(
  payload: MutationAuditedEvent,
  previousDigest: string,
  sequence: number,
): Promise<string> {
  return digestCanonical({ payload, previousDigest, sequence });
}

/**
 * Build the next audit record after `previous` (null for the genesis
 * record). Validates the payload, checks sequence contiguity against the
 * previous record, and computes the chain digest — which INCLUDES the
 * previous record's digest. Pure and deterministic.
 */
export async function buildAuditRecord(
  previous: AuditRecord | null,
  payload: MutationAuditedEvent,
): Promise<AuditRecord> {
  if (!isJobEvent(payload)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: 'audit payloads must be structurally valid mutation-audited events',
    });
  }
  if (payload.kind !== 'mutation-audited') {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: `audit payloads must be of kind mutation-audited, got ${String(payload.kind)}`,
    });
  }
  const expectedSequence = (previous?.sequence ?? 0) + 1;
  if (payload.sequence !== expectedSequence) {
    chainFailure(
      `audit payload sequence ${String(payload.sequence)} does not continue the chain (expected ${String(expectedSequence)})`,
      { expected: expectedSequence, actual: payload.sequence },
    );
  }
  const previousDigest = previous?.digest ?? AUDIT_GENESIS_DIGEST;
  const digest = await computeAuditDigest(payload, previousDigest, payload.sequence);
  return Object.freeze({
    sequence: payload.sequence,
    previousDigest,
    payload,
    digest,
  });
}

/**
 * Append an audit record to a log (pure + async): returns a NEW log; the
 * input log is never modified. Enforces append-only invariants (sequence
 * contiguity; each digest includes the previous record's digest).
 */
export async function appendAuditRecord(
  log: AuditLog,
  payload: MutationAuditedEvent,
): Promise<AuditLog> {
  const last = log.records.at(-1);
  const previous = last === undefined ? null : last;
  const record = await buildAuditRecord(previous, payload);
  return Object.freeze({ records: Object.freeze([...log.records, record]) });
}

// ---------------------------------------------------------------------------
// Verification (fail-closed)
// ---------------------------------------------------------------------------

/**
 * Verify the whole audit chain: every record's sequence is contiguous,
 * every `previousDigest` links to the record before it (genesis for #1),
 * and every `digest` matches the recomputed sha256 over
 * {payload, previousDigest, sequence}. ANY inconsistency — a tampered
 * payload, a tampered digest, a removed or reordered record — throws
 * JOB_AUDIT_CHAIN_BROKEN. Returns the head digest on success.
 */
export async function verifyAuditChain(log: AuditLog): Promise<string> {
  if (log.records.length === 0) return AUDIT_GENESIS_DIGEST;
  let previousDigest: string = AUDIT_GENESIS_DIGEST;
  for (let index = 0; index < log.records.length; index += 1) {
    const record = log.records[index];
    if (record === undefined) {
      chainFailure(`audit record at position ${String(index + 1)} is missing`);
    }
    if (record.sequence !== index + 1) {
      chainFailure(
        `audit sequence must be contiguous from 1 (position ${String(index + 1)} carries sequence ${String(record.sequence)})`,
        { expected: index + 1, actual: record.sequence },
      );
    }
    if (record.previousDigest !== previousDigest) {
      chainFailure(
        `audit record ${String(record.sequence)} does not chain to its predecessor (previousDigest ${record.previousDigest}, expected ${previousDigest}) — the chain is broken`,
        { sequence: record.sequence, expected: previousDigest, actual: record.previousDigest },
      );
    }
    if (!isJobEvent(record.payload) || record.payload.kind !== 'mutation-audited') {
      chainFailure(
        `audit record ${String(record.sequence)} does not carry a valid mutation-audited payload`,
      );
    }
    const recomputed = await computeAuditDigest(
      record.payload,
      record.previousDigest,
      record.sequence,
    );
    if (recomputed !== record.digest) {
      chainFailure(
        `audit record ${String(record.sequence)} digest mismatch: expected ${record.digest}, recomputed ${recomputed} — the payload or digest was tampered with`,
        { sequence: record.sequence, expected: record.digest, actual: recomputed },
      );
    }
    previousDigest = record.digest;
  }
  return previousDigest;
}

/** Head digest of the chain (the last record's digest, or the genesis). */
export function auditChainHead(log: AuditLog): string {
  const last = log.records.length > 0 ? log.records[log.records.length - 1] : undefined;
  return last?.digest ?? AUDIT_GENESIS_DIGEST;
}

/** The most recent audit record, or null when the stream is empty. */
export function lastAuditRecord(log: AuditLog): AuditRecord | null {
  const last = log.records.length > 0 ? log.records[log.records.length - 1] : undefined;
  return last ?? null;
}
