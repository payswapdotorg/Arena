/**
 * Append-only, tamper-evident policy audit trail (Work Order C018) —
 * mirrors @arena/security's audit discipline (A034/A015) exactly:
 *
 *   - records are sequenced 1..n (contiguous; gaps, duplicates and
 *     out-of-order appends are REJECTED);
 *   - each record's digest is the sha256 over the canonical JSON of
 *     {payload, previousDigest, sequence} — computed with
 *     @arena/protocol-core's digestCanonical, NEVER reimplemented;
 *   - replayed event ids are rejected (the trail is append-only);
 *   - verifyPolicyAuditChain recomputes every digest and linkage and
 *     fails closed on any tampering.
 *
 * The closed kind vocabulary covers every consequential policy decision:
 * pack registration AND rejection (conflicting/infeasible packs are
 * audited, not silently dropped), effective-policy resolutions and
 * denials, cross-tenant authorization outcomes, and every retention
 * disposition transition (audit history retained after deletion).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId } from '@arena/protocol-core';
import { ExpertSessionPolicyError } from './errors.js';
import { deepFreeze, expectPolicyTimestamp } from './shared.js';

/** Chain digest carried by the record BEFORE the first one (genesis). */
export const POLICY_AUDIT_GENESIS_DIGEST =
  '0000000000000000000000000000000000000000000000000000000000000000' as const;

/** Wire version of the audit event shape. */
export const POLICY_AUDIT_EVENT_VERSION = 1 as const;

/**
 * The closed audit-event kind vocabulary — every apply/redact/mask/deny
 * policy decision is auditable.
 */
export const POLICY_AUDIT_EVENT_KINDS = Object.freeze([
  'pack-registered',
  'pack-rejected',
  'policy-resolved',
  'resolution-denied',
  'cross-tenant-pack-authorized',
  'cross-tenant-policy-denied',
  'retention-transition',
  'retention-duplicate',
  'retention-rejected',
] as const);
export type PolicyAuditEventKind = (typeof POLICY_AUDIT_EVENT_KINDS)[number];

export function isPolicyAuditEventKind(value: unknown): value is PolicyAuditEventKind {
  return typeof value === 'string' && (POLICY_AUDIT_EVENT_KINDS as readonly string[]).includes(value);
}

/** One policy audit event (correlationId REQUIRED — A015 discipline). */
export interface PolicyAuditEvent {
  readonly recordVersion: typeof POLICY_AUDIT_EVENT_VERSION;
  readonly eventId: string;
  readonly kind: PolicyAuditEventKind;
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
  readonly occurredAt: string;
}

const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isPolicyAuditEvent(value: unknown): value is PolicyAuditEvent {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== POLICY_AUDIT_EVENT_VERSION) return false;
  if (!isPolicyAuditEventKind(record['kind'])) return false;
  if (typeof record['eventId'] !== 'string') return false;
  if (typeof record['correlationId'] !== 'string') return false;
  if (typeof record['occurredAt'] !== 'string') return false;
  return true;
}

export function toPolicyAuditEvent(value: unknown): PolicyAuditEvent {
  if (typeof value !== 'object' || value === null) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
      message: 'policy audit event must be an object',
    });
  }
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== POLICY_AUDIT_EVENT_VERSION) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
      message: `unsupported policy audit event recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const eventId = String(record['eventId'] ?? '');
  if (!UUID_PATTERN.test(eventId)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
      message: 'policy audit event eventId must be a lowercase UUIDv4 (the dedup identity)',
      details: { received: eventId },
    });
  }
  const kind = record['kind'];
  if (!isPolicyAuditEventKind(kind)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
      message: `unknown policy audit event kind: ${JSON.stringify(kind)}`,
      details: { approved: POLICY_AUDIT_EVENT_KINDS },
    });
  }
  const correlationId = String(record['correlationId'] ?? '');
  if (!CORRELATION_PATTERN.test(correlationId)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
      message: 'policy audit event correlationId is required (A015 discipline)',
      details: { received: correlationId },
    });
  }
  const causationId =
    record['causationId'] === null || record['causationId'] === undefined ? null : String(record['causationId']);
  if (causationId !== null && !UUID_PATTERN.test(causationId)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
      message: 'policy audit event causationId must be a lowercase UUIDv4 or null',
      details: { received: causationId },
    });
  }
  const occurredAt = expectPolicyTimestamp(record['occurredAt'], 'PolicyAuditEvent.occurredAt');
  let outcome: PolicyAuditEvent['outcome'] = null;
  const rawOutcome = record['outcome'];
  if (rawOutcome !== null && rawOutcome !== undefined) {
    if (typeof rawOutcome !== 'object') {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
        message: 'policy audit event outcome must be an object or null',
      });
    }
    const outcomeRecord = rawOutcome as Record<string, unknown>;
    const effect = outcomeRecord['effect'];
    if (effect !== 'allow' && effect !== 'deny' && effect !== 'recorded') {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
        message: `unknown policy audit outcome effect: ${JSON.stringify(effect)}`,
      });
    }
    const reason = String(outcomeRecord['reason'] ?? '');
    if (reason.length === 0 || reason.length > 128) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
        message: 'policy audit outcome reason must be 1..128 characters (closed reason token)',
      });
    }
    outcome = Object.freeze({ effect, reason });
  }
  return deepFreeze({
    recordVersion: POLICY_AUDIT_EVENT_VERSION,
    eventId,
    kind,
    tenantId: record['tenantId'] === null || record['tenantId'] === undefined ? null : String(record['tenantId']),
    principalId:
      record['principalId'] === null || record['principalId'] === undefined ? null : String(record['principalId']),
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
// The chain
// ---------------------------------------------------------------------------

/** Wire version of the audit record shape. */
export const POLICY_AUDIT_RECORD_VERSION = 1 as const;

/** One tamper-evident entry in the append-only policy audit stream. */
export interface PolicyAuditRecord {
  readonly recordVersion: typeof POLICY_AUDIT_RECORD_VERSION;
  readonly sequence: number;
  readonly previousDigest: string;
  readonly payload: PolicyAuditEvent;
  readonly digest: string;
}

async function computePolicyAuditDigest(
  payload: PolicyAuditEvent,
  previousDigest: string,
  sequence: number,
): Promise<string> {
  return digestCanonical({ payload, previousDigest, sequence });
}

function chainFailure(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_AUDIT_CHAIN_BROKEN', {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** Immutable snapshot view of an audit stream. */
export interface PolicyAuditSnapshot {
  readonly records: readonly PolicyAuditRecord[];
  readonly verified: boolean;
}

/**
 * The append-only policy audit log. The ONLY mutation surface is `append`
 * (validates contiguity and REJECTS replayed event ids); there is
 * deliberately NO remove/update/rewrite method — the class IS the
 * no-deletion guarantee (audit history retained after deletion).
 */
export class PolicyAuditLog {
  private readonly records: PolicyAuditRecord[] = [];
  private readonly seenEventIds = new Set<string>();

  /** Append one audited policy decision; returns the sealed record. */
  async append(payload: PolicyAuditEvent): Promise<PolicyAuditRecord> {
    if (!isPolicyAuditEvent(payload)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT', {
        message: 'audit payloads must be structurally valid policy audit events',
      });
    }
    if (this.seenEventIds.has(payload.eventId)) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_AUDIT_REPLAY', {
        message: `audit event ${payload.eventId} was already appended (replayed audit events are rejected — the trail is append-only)`,
        details: { eventId: payload.eventId },
      });
    }
    const previous = this.records.length > 0 ? this.records[this.records.length - 1] ?? null : null;
    const sequence = this.records.length + 1;
    const previousDigest = previous?.digest ?? POLICY_AUDIT_GENESIS_DIGEST;
    const digest = await computePolicyAuditDigest(payload, previousDigest, sequence);
    const record: PolicyAuditRecord = deepFreeze({
      recordVersion: POLICY_AUDIT_RECORD_VERSION,
      sequence,
      previousDigest,
      payload,
      digest,
    });
    this.records.push(record);
    this.seenEventIds.add(payload.eventId);
    return record;
  }

  /** Number of sealed records. */
  get length(): number {
    return this.records.length;
  }

  /** Frozen deep-copy snapshot (the query surface). */
  snapshot(): PolicyAuditSnapshot {
    return deepFreeze({
      records: Object.freeze(this.records.map((record) => deepFreeze({ ...record }))),
      verified: true,
    });
  }

  /** Records-by-sequence query (0-based index; null when out of range). */
  at(index: number): PolicyAuditRecord | null {
    return this.records[index] ?? null;
  }

  /** Recompute and verify the WHOLE chain; tampering fails closed. */
  async verify(): Promise<PolicyAuditSnapshot> {
    let previousDigest: string = POLICY_AUDIT_GENESIS_DIGEST;
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
      const recomputed = await computePolicyAuditDigest(record.payload, record.previousDigest, record.sequence);
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

/** Standalone chain verification over any presented record list. */
export async function verifyPolicyAuditChain(
  records: readonly PolicyAuditRecord[],
): Promise<PolicyAuditSnapshot> {
  let previousDigest: string = POLICY_AUDIT_GENESIS_DIGEST;
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
    const recomputed = await computePolicyAuditDigest(record.payload, record.previousDigest, record.sequence);
    if (recomputed !== record.digest) {
      chainFailure(`digest mismatch at sequence ${String(record.sequence)} (tampered payload or digest)`, {
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
