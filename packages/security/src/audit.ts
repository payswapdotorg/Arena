/**
 * Append-only, tamper-evident security audit trail (Work Order A034;
 * spec/security.md S1.0; requirement R28; AGENTS.md Provenance).
 *
 * Mirrors @arena/job-protocol's audit discipline (A015) exactly:
 *
 *   - audit records are sequenced 1..n (contiguous; gaps, duplicates and
 *     out-of-order appends are REJECTED at append time);
 *   - each record's `previousDigest` carries the chain digest of the
 *     record before it ('0' * 64 for the genesis record);
 *   - each record's `digest` is the sha256 over the canonical JSON of
 *     {payload, previousDigest, sequence} — computed with
 *     @arena/protocol-core's digestCanonical, NEVER reimplemented;
 *   - verifySecurityAuditChain recomputes every digest and linkage; a
 *     broken chain (tampered payload, tampered digest, removed record,
 *     reordered records, sequence gap) FAILS CLOSED with
 *     SECURITY_AUDIT_CHAIN_BROKEN.
 *
 * A015 discipline additions for the security layer:
 *
 *   - every audit event carries a REQUIRED correlation id and an
 *     optional causation id (the envelope id of the command that caused
 *     the audited consequence) — causation/correlation addressability;
 *   - the SecurityAuditLog class exposes ONLY append/verify/snapshot —
 *     there is NO deletion or rewrite surface, and the appended records
 *     are deep-frozen (mutation attempts throw in strict mode — tested);
 *   - replayed appends (the same event id appended twice) are rejected
 *     with SECURITY_AUDIT_REPLAY — the adversarial battery replays and
 *     reorders events to prove it.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId } from '@arena/protocol-core';
import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember } from './shared.js';
import { toSecurityTimestamp } from './shared.js';
import type { SecurityTimestamp } from './shared.js';

/** Chain digest carried by the record BEFORE the first one (genesis). */
export const SECURITY_AUDIT_GENESIS_DIGEST =
  '0000000000000000000000000000000000000000000000000000000000000000' as const;

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

/** Wire version of the audit event shape. */
export const SECURITY_AUDIT_EVENT_VERSION = 1 as const;

/**
 * The closed audit-event kind vocabulary — every consequential security
 * consequence is auditable: authorization decisions (allow AND deny),
 * tenancy outcomes, data-rights violations, learning-gate decisions,
 * expert withdrawals, secret detections and policy registrations.
 */
export const SECURITY_AUDIT_EVENT_KINDS = Object.freeze([
  'authorization-decision',
  'tenant-access-denied',
  'tenant-access-allowed',
  'data-rights-violation',
  'learning-authorization',
  'expert-withdrawal',
  'secret-detected',
  'policy-registered',
  'grant-revoked',
] as const);

export type SecurityAuditEventKind = (typeof SECURITY_AUDIT_EVENT_KINDS)[number];

/**
 * One security audit event. `correlationId` is REQUIRED (A015
 * discipline); `causationId` carries the envelope id of the command that
 * caused this consequence (null for spontaneously recorded events).
 * `outcome` is a closed effect+reason pair (never free text).
 */
export interface SecurityAuditEvent {
  readonly recordVersion: typeof SECURITY_AUDIT_EVENT_VERSION;
  readonly eventId: string;
  readonly kind: SecurityAuditEventKind;
  readonly tenantId: string | null;
  readonly principalId: string | null;
  readonly action: string | null;
  readonly boundaryClass: string | null;
  readonly outcome: {
    readonly effect: 'allow' | 'deny' | 'recorded';
    readonly reason: string;
  } | null;
  readonly correlationId: CorrelationId;
  readonly causationId: string | null;
  readonly occurredAt: SecurityTimestamp;
}

const EVENT_CONTEXT = 'SecurityAuditEvent';

const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isSecurityAuditEvent(value: unknown): value is SecurityAuditEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== SECURITY_AUDIT_EVENT_VERSION) return false;
  if (!isEnumMember(record['kind'], SECURITY_AUDIT_EVENT_KINDS)) return false;
  if (typeof record['eventId'] !== 'string') return false;
  if (typeof record['correlationId'] !== 'string') return false;
  if (typeof record['occurredAt'] !== 'string') return false;
  return true;
}

export function toSecurityAuditEvent(value: unknown): SecurityAuditEvent {
  const record = expectFields(
    value,
    [
      'recordVersion',
      'eventId',
      'kind',
      'tenantId',
      'principalId',
      'action',
      'boundaryClass',
      'outcome',
      'correlationId',
      'causationId',
      'occurredAt',
    ],
    [],
    SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT,
    EVENT_CONTEXT,
  );
  if (record['recordVersion'] !== SECURITY_AUDIT_EVENT_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${EVENT_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const eventId = String(record['eventId']);
  if (!UUID_PATTERN.test(eventId)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT, {
      message: `${EVENT_CONTEXT}.eventId: must be a lowercase UUIDv4 (the audit event's dedup identity)`,
      details: { received: eventId },
    });
  }
  const kind = expectEnumMember(
    record['kind'],
    SECURITY_AUDIT_EVENT_KINDS,
    'kind',
    SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT,
    EVENT_CONTEXT,
  );
  const correlationId = String(record['correlationId']);
  if (!CORRELATION_PATTERN.test(correlationId)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT, {
      message: `${EVENT_CONTEXT}.correlationId: required (A015 discipline — every audit event is correlation-addressable)`,
      details: { received: correlationId },
    });
  }
  const causationId =
    record['causationId'] === null || record['causationId'] === undefined
      ? null
      : String(record['causationId']);
  if (causationId !== null && !UUID_PATTERN.test(causationId)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT, {
      message: `${EVENT_CONTEXT}.causationId: must be a lowercase UUIDv4 or null`,
      details: { received: causationId },
    });
  }
  const occurredAt = toSecurityTimestamp(
    String(record['occurredAt']),
    `${EVENT_CONTEXT}.occurredAt`,
  );

  const rawOutcome = record['outcome'];
  let outcome: SecurityAuditEvent['outcome'] = null;
  if (rawOutcome !== null && rawOutcome !== undefined) {
    if (typeof rawOutcome !== 'object') {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT, {
        message: `${EVENT_CONTEXT}.outcome: must be an object or null`,
      });
    }
    const outcomeRecord = expectFields(
      rawOutcome,
      ['effect', 'reason'],
      [],
      SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT,
      `${EVENT_CONTEXT}.outcome`,
    );
    const effect = expectEnumMember(
      outcomeRecord['effect'],
      ['allow', 'deny', 'recorded'] as const,
      'effect',
      SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT,
      `${EVENT_CONTEXT}.outcome`,
    );
    const reason = String(outcomeRecord['reason']);
    if (reason.length === 0 || reason.length > 128) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT, {
        message: `${EVENT_CONTEXT}.outcome.reason: must be 1..128 characters (closed reason token)`,
      });
    }
    outcome = Object.freeze({ effect, reason });
  }

  return deepFreeze({
    recordVersion: SECURITY_AUDIT_EVENT_VERSION,
    eventId,
    kind,
    tenantId: record['tenantId'] === null || record['tenantId'] === undefined ? null : String(record['tenantId']),
    principalId:
      record['principalId'] === null || record['principalId'] === undefined
        ? null
        : String(record['principalId']),
    action: record['action'] === null || record['action'] === undefined ? null : String(record['action']),
    boundaryClass:
      record['boundaryClass'] === null || record['boundaryClass'] === undefined
        ? null
        : String(record['boundaryClass']),
    outcome,
    correlationId: correlationId as CorrelationId,
    causationId,
    occurredAt,
  });
}

// ---------------------------------------------------------------------------
// Audit records (the chain)
// ---------------------------------------------------------------------------

/** Wire version of the audit record shape. */
export const SECURITY_AUDIT_RECORD_VERSION = 1 as const;

/** One tamper-evident entry in the append-only security audit stream. */
export interface SecurityAuditRecord {
  readonly recordVersion: typeof SECURITY_AUDIT_RECORD_VERSION;
  /** 1-based contiguous position in the audit stream. */
  readonly sequence: number;
  /** Chain digest of the previous audit record (genesis value for #1). */
  readonly previousDigest: string;
  /** The audited consequence payload. */
  readonly payload: SecurityAuditEvent;
  /**
   * sha256 over the canonical JSON of {payload, previousDigest,
   * sequence} — each audit digest INCLUDES the previous record's digest.
   */
  readonly digest: string;
}

export function isSecurityAuditRecord(value: unknown): value is SecurityAuditRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== SECURITY_AUDIT_RECORD_VERSION) return false;
  if (typeof record['sequence'] !== 'number') return false;
  if (typeof record['previousDigest'] !== 'string') return false;
  if (typeof record['digest'] !== 'string') return false;
  return true;
}

function chainFailure(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new SecurityError(SECURITY_ERROR_CODES.AUDIT_CHAIN_BROKEN, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** sha256 chain digest over {payload, previousDigest, sequence}. */
async function computeSecurityAuditDigest(
  payload: SecurityAuditEvent,
  previousDigest: string,
  sequence: number,
): Promise<string> {
  return digestCanonical({ payload, previousDigest, sequence });
}

/**
 * Build the next audit record after `previous` (null for the genesis
 * record). Validates the payload, checks sequence contiguity against
 * the previous record, and computes the chain digest — which INCLUDES
 * the previous record's digest. Pure and deterministic.
 */
export async function buildSecurityAuditRecord(
  previous: SecurityAuditRecord | null,
  payload: SecurityAuditEvent,
  sequence: number,
): Promise<SecurityAuditRecord> {
  if (!isSecurityAuditEvent(payload)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT, {
      message: 'audit payloads must be structurally valid security audit events',
    });
  }
  const expectedSequence = (previous?.sequence ?? 0) + 1;
  if (sequence !== expectedSequence) {
    throw new SecurityError(SECURITY_ERROR_CODES.AUDIT_SEQUENCE_CONFLICT, {
      message: `audit sequence ${String(sequence)} does not continue the chain (expected ${String(expectedSequence)})`,
      details: { expected: expectedSequence, received: sequence },
    });
  }
  const previousDigest = previous?.digest ?? SECURITY_AUDIT_GENESIS_DIGEST;
  const digest = await computeSecurityAuditDigest(payload, previousDigest, sequence);
  return deepFreeze({
    recordVersion: SECURITY_AUDIT_RECORD_VERSION,
    sequence,
    previousDigest,
    payload,
    digest,
  });
}

// ---------------------------------------------------------------------------
// The audit log (append-only, no deletion/rewrite surface)
// ---------------------------------------------------------------------------

/** Immutable snapshot view of an audit stream. */
export interface SecurityAuditSnapshot {
  readonly records: readonly SecurityAuditRecord[];
  readonly verified: boolean;
}

/**
 * The append-only security audit log. The ONLY mutation surface is
 * `append` (which validates contiguity and REJECTS replayed event ids);
 * `verify` recomputes the whole chain; `snapshot` returns a frozen
 * deep copy. There is deliberately NO remove/update/rewrite method —
 * the class IS the no-deletion guarantee (hygiene tests assert the
 * method surface).
 */
export class SecurityAuditLog {
  private readonly records: SecurityAuditRecord[] = [];
  private readonly seenEventIds = new Set<string>();

  /** Append one audited consequence; returns the sealed record. */
  async append(payload: SecurityAuditEvent): Promise<SecurityAuditRecord> {
    if (!isSecurityAuditEvent(payload)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_AUDIT_EVENT, {
        message: 'audit payloads must be structurally valid security audit events',
      });
    }
    if (this.seenEventIds.has(payload.eventId)) {
      throw new SecurityError(SECURITY_ERROR_CODES.AUDIT_REPLAY, {
        message: `audit event ${payload.eventId} was already appended (replayed audit events are rejected — the trail is append-only)`,
        details: { eventId: payload.eventId },
      });
    }
    const previous = this.records.length > 0 ? this.records[this.records.length - 1]! : null;
    const record = await buildSecurityAuditRecord(
      previous,
      payload,
      this.records.length + 1,
    );
    this.records.push(record);
    this.seenEventIds.add(payload.eventId);
    return record;
  }

  /** Number of sealed records. */
  get length(): number {
    return this.records.length;
  }

  /** Frozen deep-copy snapshot (the query surface). */
  snapshot(): SecurityAuditSnapshot {
    return deepFreeze({
      records: Object.freeze(this.records.map((record) => deepFreeze({ ...record }))),
      verified: true,
    });
  }

  /** Records-by-sequence query (0-based index; null when out of range). */
  at(index: number): SecurityAuditRecord | null {
    return this.records[index] ?? null;
  }

  /**
   * Recompute and verify the WHOLE chain: linkage, contiguity and every
   * digest. Any tampering, removal or reordering fails closed with
   * SECURITY_AUDIT_CHAIN_BROKEN.
   */
  async verify(): Promise<SecurityAuditSnapshot> {
    let previousDigest: string = SECURITY_AUDIT_GENESIS_DIGEST;
    let index = 0;
    for (const record of this.records) {
      index += 1;
      if (record.sequence !== index) {
        chainFailure(`sequence discontinuity at position ${String(index)}`, {
          expected: index,
          received: record.sequence,
        });
      }
      if (record.previousDigest !== previousDigest) {
        chainFailure(`previousDigest linkage broken at sequence ${String(record.sequence)}`, {
          expected: previousDigest,
          received: record.previousDigest,
        });
      }
      const recomputed = await computeSecurityAuditDigest(
        record.payload,
        record.previousDigest,
        record.sequence,
      );
      if (recomputed !== record.digest) {
        chainFailure(`digest mismatch at sequence ${String(record.sequence)} (tampered payload or digest)`, {
          expected: recomputed,
          received: record.digest,
        });
      }
      previousDigest = record.digest;
    }
    return this.snapshot();
  }
}

/**
 * Standalone chain verification over a RECORD LIST (the adversarial
 * consumer form — verifies any presented stream, e.g. one received over
 * the wire, without owning it). Reordered/removed/tampered streams fail
 * closed.
 */
export async function verifySecurityAuditChain(
  records: readonly SecurityAuditRecord[],
): Promise<SecurityAuditSnapshot> {
  let previousDigest: string = SECURITY_AUDIT_GENESIS_DIGEST;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) {
      chainFailure(`missing record at position ${String(index + 1)}`);
    }
    if (record.sequence !== index + 1) {
      chainFailure(`sequence discontinuity at position ${String(index + 1)}`, {
        expected: index + 1,
        received: record.sequence,
      });
    }
    if (record.previousDigest !== previousDigest) {
      chainFailure(`previousDigest linkage broken at sequence ${String(record.sequence)}`, {
        expected: previousDigest,
        received: record.previousDigest,
      });
    }
    const recomputed = await computeSecurityAuditDigest(
      record.payload,
      record.previousDigest,
      record.sequence,
    );
    if (recomputed !== record.digest) {
      chainFailure(`digest mismatch at sequence ${String(record.sequence)}`, {
        expected: recomputed,
        received: record.digest,
      });
    }
    previousDigest = record.digest;
  }
  return deepFreeze({
    records: Object.freeze(records.map((record) => deepFreeze({ ...record }))),
    verified: true,
  });
}
