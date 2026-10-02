/**
 * Audit view-models (Work Order B014; apps/web/src/operations).
 * Pure projection layer — no React, no I/O.
 *
 * Projects A034 security audit records (`SecurityAuditRecord`, read
 * server-side through the package's PUBLIC API) into the renderable audit
 * stream. The B014 audit truths enforced HERE, by construction:
 *
 *   - audit records are APPEND-ONLY EVIDENCE: the stream projects the
 *     record sequence verbatim, in the order the chain carries it — never
 *     re-sorted, never filtered, never rewritten; there is no
 *     editable-history affordance anywhere on this surface;
 *   - every event renders its actor identity (tenant + principal), its
 *     closed kind, its closed outcome (allow / deny / recorded + reason),
 *     its REQUIRED correlation id, and its position + digests in the
 *     tamper-evident chain;
 *   - the truth class is EVIDENCE — an audit record supports what
 *     happened without deciding anything else; it never renders as a
 *     verified fact about the audited subject;
 *   - malformed payloads degrade TRUTHFULLY: named unknown fields, an
 *     unknown truth class for the unreadable event — no thrown render,
 *     no dropped rows (the count always matches the input).
 */

import {
  isSecurityAuditEvent,
  isSecurityAuditRecord,
} from '../../../../packages/security/src/index.js';
import type { SecurityAuditRecord } from '../../../../packages/security/src/index.js';

/** Version of the audit view surface (bump on breaking changes). */
export const AUDIT_VIEW_VERSION = 1 as const;

/** One audit event row: the append-only evidence, projected verbatim. */
export interface AuditEventView {
  readonly viewVersion: typeof AUDIT_VIEW_VERSION;
  /** 1-based contiguous position in the stream (undefined when unreadable). */
  readonly sequence: number | undefined;
  readonly eventId: string | undefined;
  /** The closed A034 audit kind (rendered verbatim). */
  readonly kind: string | undefined;
  readonly occurredAt: string | undefined;
  readonly actorTenantId: string | undefined;
  readonly actorPrincipalId: string | undefined;
  readonly action: string | undefined;
  readonly boundaryClass: string | undefined;
  /** The closed outcome effect (allow / deny / recorded). */
  readonly effect: 'allow' | 'deny' | 'recorded' | undefined;
  readonly reason: string | undefined;
  readonly correlationId: string | undefined;
  readonly causationId: string | undefined;
  readonly digest: string | undefined;
  readonly previousDigest: string | undefined;
  /** Truth class: a readable record is evidence; an unreadable one is unknown. */
  readonly truthClass: 'evidence' | 'unknown';
  readonly readable: boolean;
  readonly unknownFields: readonly string[];
}

/** The audit stream view: the append-only event rows plus chain posture. */
export interface AuditStreamView {
  readonly viewVersion: typeof AUDIT_VIEW_VERSION;
  /** The events in chain order — projected verbatim, never re-sorted. */
  readonly events: readonly AuditEventView[];
  readonly count: number;
  /** Head digest of the chain (undefined when no readable record). */
  readonly headDigest: string | undefined;
  /** Chain verification outcome, when the caller verified it (async, at composition). */
  readonly chainVerified?: boolean;
  readonly appendOnlyNote: string;
  readonly emptyNote: string;
  /** Truth class of the stream: evidence when any readable event exists, else unknown. */
  readonly truthClass: 'evidence' | 'unknown';
  readonly unknownFields: readonly string[];
}

const AUDIT_EFFECTS = Object.freeze(['allow', 'deny', 'recorded'] as const);

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/**
 * Project one audit record into its event row. The record is guarded
 * structurally (`isSecurityAuditRecord` + `isSecurityAuditEvent`): a
 * malformed payload yields a DEGRADED but present row (every unreadable
 * field rendered as a named unknown) — the row is never dropped, because
 * a gap in the rendered stream would misrepresent the append-only record.
 */
export function toAuditEventView(record: unknown): AuditEventView {
  const unknownFields: string[] = [];
  const recordOk = isSecurityAuditRecord(record);
  if (!recordOk) unknownFields.push('audit record (structurally unreadable)');
  const raw: Record<string, unknown> =
    typeof record === 'object' && record !== null && !Array.isArray(record)
      ? (record as Record<string, unknown>)
      : {};
  const payloadRaw = raw['payload'];
  const payloadOk = recordOk && isSecurityAuditEvent(payloadRaw);
  if (recordOk && !payloadOk) unknownFields.push('audit event payload (structurally unreadable)');
  const payload: Record<string, unknown> =
    typeof payloadRaw === 'object' && payloadRaw !== null && !Array.isArray(payloadRaw)
      ? (payloadRaw as Record<string, unknown>)
      : {};

  const sequence = readNonNegativeInt(raw['sequence']);
  const outcomeRaw = payload['outcome'];
  const outcome =
    typeof outcomeRaw === 'object' && outcomeRaw !== null && !Array.isArray(outcomeRaw)
      ? (outcomeRaw as Record<string, unknown>)
      : {};
  const effectRaw = outcome['effect'];
  const effect =
    typeof effectRaw === 'string' && (AUDIT_EFFECTS as readonly string[]).includes(effectRaw)
      ? (effectRaw as AuditEventView['effect'])
      : undefined;

  return Object.freeze({
    viewVersion: AUDIT_VIEW_VERSION,
    sequence: sequence !== undefined && sequence >= 1 ? sequence : undefined,
    eventId: readNonEmptyString(payload['eventId']),
    kind: readNonEmptyString(payload['kind']),
    occurredAt: readNonEmptyString(payload['occurredAt']),
    actorTenantId: readNonEmptyString(payload['tenantId']),
    actorPrincipalId: readNonEmptyString(payload['principalId']),
    action: readNonEmptyString(payload['action']),
    boundaryClass: readNonEmptyString(payload['boundaryClass']),
    effect,
    reason: readNonEmptyString(outcome['reason']),
    correlationId: readNonEmptyString(payload['correlationId']),
    causationId: readNonEmptyString(payload['causationId']),
    digest: readNonEmptyString(raw['digest']),
    previousDigest: readNonEmptyString(raw['previousDigest']),
    truthClass: recordOk && payloadOk ? ('evidence' as const) : ('unknown' as const),
    readable: recordOk && payloadOk,
    unknownFields: Object.freeze([...new Set(unknownFields)]),
  } satisfies AuditEventView);
}

/** Options for the stream projection (chain posture comes from the async verifier at composition). */
export interface AuditStreamProjectionOptions {
  /** Result of the package's `verifySecurityAuditChain`, when the caller ran it. */
  readonly chainVerified?: boolean;
  /** The honest empty note override (default: the no-records-in-this-posture copy). */
  readonly emptyNote?: string;
}

/**
 * Project the audit record sequence into the stream view. ORDER IS
 * PRESERVED VERBATIM: the events render in exactly the order given (the
 * chain's append order) — re-sorting or gap-filling here would misstate
 * the append-only evidence, so neither exists.
 */
export function toAuditStreamView(
  records: readonly unknown[],
  options: AuditStreamProjectionOptions = {},
): AuditStreamView {
  const unknownFields: string[] = [];
  const events: AuditEventView[] = [];
  let headDigest: string | undefined;
  let anyReadable = false;
  records.forEach((record) => {
    const view = toAuditEventView(record);
    if (view.readable) {
      anyReadable = true;
      headDigest = view.digest;
    } else {
      unknownFields.push(`audit record #${String(events.length + 1)} (unreadable)`);
    }
    events.push(view);
  });
  return Object.freeze({
    viewVersion: AUDIT_VIEW_VERSION,
    events: Object.freeze(events),
    count: events.length,
    headDigest,
    ...(options.chainVerified !== undefined ? { chainVerified: options.chainVerified } : {}),
    appendOnlyNote:
      'Audit records are append-only evidence: sequenced, digest-chained and tamper-evident, attributed to their actor and correlation id. This stream projects the chain verbatim — history is never edited, removed or re-sorted here.',
    emptyNote:
      options.emptyNote ??
      'No audit events are recorded in this posture — the stream renders the record store as it is, never a fabricated trail.',
    truthClass: anyReadable ? ('evidence' as const) : ('unknown' as const),
    unknownFields: Object.freeze([...new Set(unknownFields)]),
  } satisfies AuditStreamView);
}

/** Re-export the record type the stream projects (kept for view-layer typing). */
export type { SecurityAuditRecord };
