/**
 * Append-only validation history per escalation (Work Order C009;
 * issue #116; architecture-lock rule 6 — historical evidence is
 * append-only and never rewritten; the supersession house pattern of
 * @arena/escalation's EscalationRecord history).
 *
 * The validation record of ONE escalation:
 *   - declared condition + derived plan (immutable once routed);
 *   - the append-only entry log (plan-declared · handoff-routed ·
 *     adjudication-recorded · revision-requested · evidence-requested ·
 *     replacement-requested) with contiguous 1..n sequences and
 *     monotonically non-decreasing timestamps;
 *   - the revision-loop accounting (attempt number / max attempts);
 *   - the selected validator (COI-excluded ledger retained).
 *
 * Entries are NEVER rewritten: a re-adjudication APPENDS a new
 * adjudication entry; a re-route after revision APPENDS a new
 * handoff-routed entry. Supersession is expressed by append order,
 * never by mutation.
 */

import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';
import type { AdjudicationOutcome } from './adjudication.js';
import type { ValidationPlan } from './plan.js';
import type { ReplacementRequest } from './replacement.js';
import type { RevisionRequest } from './revision.js';
import type { ValidatorSelectionResult } from './validator-selection.js';
import { deepFreeze, rejectUnknownFields } from './shared.js';
import type { ValidationEntryId } from './shared.js';
import { isValidationEntryId, requireBoundedString } from './shared.js';

/** Wire version of the validation-record shape. */
export const VALIDATION_RECORD_VERSION = 1 as const;

/** The closed entry-kind vocabulary. */
export const VALIDATION_ENTRY_KINDS = Object.freeze([
  'plan-declared',
  'handoff-routed',
  'adjudication-recorded',
  'revision-requested',
  'evidence-requested',
  'replacement-requested',
] as const);
export type ValidationEntryKind = (typeof VALIDATION_ENTRY_KINDS)[number];

export function isValidationEntryKind(value: unknown): value is ValidationEntryKind {
  return (
    typeof value === 'string' && (VALIDATION_ENTRY_KINDS as readonly string[]).includes(value)
  );
}

/** One append-only validation-history entry. */
export interface ValidationHistoryEntry {
  readonly entryVersion: 1;
  readonly entryId: ValidationEntryId;
  readonly requestId: string;
  readonly tenantId: string;
  /** 1-based monotonic sequence within this escalation's history. */
  readonly sequence: number;
  readonly kind: ValidationEntryKind;
  readonly occurredAt: string;
  readonly actor?: string;
  /** Kind-dependent structured data (plain JSON, deep-frozen). */
  readonly payload: Readonly<Record<string, unknown>>;
}

export const VALIDATION_HISTORY_ENTRY_FIELDS = Object.freeze([
  'entryVersion',
  'entryId',
  'requestId',
  'tenantId',
  'sequence',
  'kind',
  'occurredAt',
  'actor',
  'payload',
] as const);

export interface CreateValidationHistoryEntryInput {
  readonly entryId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly kind: string;
  readonly occurredAt: string;
  readonly actor?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** Create and freeze one validation-history entry (strict, fail-closed). */
export function createValidationHistoryEntry(
  input: CreateValidationHistoryEntryInput,
): ValidationHistoryEntry {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_ENTRY, {
      message: 'validation history entry input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    [
      'entryId',
      'requestId',
      'tenantId',
      'sequence',
      'kind',
      'occurredAt',
      'actor',
      'payload',
    ],
    'ValidationHistoryEntry',
  );
  if (!isValidationEntryId(input.entryId)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_ENTRY, {
      message: `validation entry id is invalid: ${JSON.stringify(input.entryId)}`,
    });
  }
  requireBoundedString(input.requestId, 'requestId');
  requireBoundedString(input.tenantId, 'tenantId');
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_ENTRY, {
      message: 'sequence must be an integer >= 1',
    });
  }
  if (!isValidationEntryKind(input.kind)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_ENTRY, {
      message: `validation entry kind is not in the closed vocabulary: ${JSON.stringify(input.kind)}`,
      details: { vocabulary: VALIDATION_ENTRY_KINDS },
    });
  }
  requireBoundedString(input.occurredAt, 'occurredAt');
  if (typeof input.payload !== 'object' || input.payload === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_ENTRY, {
      message: 'payload must be an object',
    });
  }
  return deepFreeze({
    entryVersion: 1 as const,
    entryId: input.entryId,
    requestId: input.requestId,
    tenantId: input.tenantId,
    sequence: input.sequence,
    kind: input.kind,
    occurredAt: input.occurredAt,
    ...(input.actor !== undefined ? { actor: requireBoundedString(input.actor, 'actor') } : {}),
    payload: deepFreeze({ ...input.payload }),
  });
}

// ---------------------------------------------------------------------------
// The per-escalation validation record
// ---------------------------------------------------------------------------

export interface ValidationRecord {
  readonly recordVersion: typeof VALIDATION_RECORD_VERSION;
  readonly requestId: string;
  readonly tenantId: string;
  readonly plan?: ValidationPlan;
  /** Append-only, contiguous 1..n. */
  readonly entries: readonly ValidationHistoryEntry[];
  /** The revision-loop accounting (attempt when last adjudicated). */
  readonly revisionAttempts: number;
  /** The selected validator (with the COI exclusion ledger). */
  readonly validator?: ValidatorSelectionResult;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const VALIDATION_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'requestId',
  'tenantId',
  'plan',
  'entries',
  'revisionAttempts',
  'validator',
  'createdAt',
  'updatedAt',
] as const);

/** Create the initial validation record for an escalation (no plan yet). */
export function createValidationRecord(
  requestId: string,
  tenantId: string,
  now: number | string | Date,
): ValidationRecord {
  requireBoundedString(requestId, 'requestId');
  requireBoundedString(tenantId, 'tenantId');
  const occurredAt = new Date(
    now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now),
  ).toISOString();
  return deepFreeze({
    recordVersion: VALIDATION_RECORD_VERSION,
    requestId,
    tenantId,
    entries: Object.freeze([]),
    revisionAttempts: 0,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
}

/**
 * Append one entry (APPEND-ONLY): returns a NEW frozen record with one
 * more history entry; sequence contiguity, timestamp monotonicity and
 * tenant identity are guarded — a tampered or out-of-order append fails
 * closed.
 */
export function appendValidationEntry(
  record: ValidationRecord,
  entry: ValidationHistoryEntry,
): ValidationRecord {
  if (entry.requestId !== record.requestId || entry.tenantId !== record.tenantId) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `validation entry ${entry.entryId} does not belong to escalation ${record.requestId} of tenant ${record.tenantId}`,
      details: { entryRequestId: entry.requestId, recordRequestId: record.requestId },
    });
  }
  const expected = record.entries.length + 1;
  if (entry.sequence !== expected) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_ENTRY, {
      message: `validation entry sequence must be contiguous: expected ${expected}, got ${entry.sequence}`,
      details: { expected, actual: entry.sequence },
    });
  }
  const last = record.entries[record.entries.length - 1];
  if (last !== undefined && Date.parse(entry.occurredAt) < Date.parse(last.occurredAt)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_ENTRY, {
      message: 'validation history timestamps must be monotonically non-decreasing',
    });
  }
  return deepFreeze({
    ...record,
    entries: Object.freeze([...record.entries, entry]),
    updatedAt: entry.occurredAt,
  });
}

/** Bind the derived plan (once — a second bind fails closed). */
export function bindPlan(record: ValidationRecord, plan: ValidationPlan, occurredAt: string): ValidationRecord {
  if (record.plan !== undefined) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_PLAN, {
      message: `validation plan already bound to escalation ${record.requestId} (plans are immutable once routed; append a new entry instead)`,
      details: { planId: record.plan.planId },
    });
  }
  if (plan.requestId !== record.requestId || plan.tenantId !== record.tenantId) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `plan ${plan.planId} does not belong to escalation ${record.requestId}`,
    });
  }
  return deepFreeze({ ...record, plan, updatedAt: occurredAt });
}

/** Bind the selected validator (each adjudication round re-binds). */
export function bindValidator(
  record: ValidationRecord,
  selection: ValidatorSelectionResult,
  occurredAt: string,
): ValidationRecord {
  return deepFreeze({ ...record, validator: selection, updatedAt: occurredAt });
}

/** Advance the revision-loop accounting after one adjudication round. */
export function recordAdjudicationRound(
  record: ValidationRecord,
  outcome: AdjudicationOutcome,
  occurredAt: string,
): ValidationRecord {
  return deepFreeze({
    ...record,
    revisionAttempts: outcome.attemptNumber,
    updatedAt: occurredAt,
  });
}

/** The current revision state (the bounded loop's accounting). */
export function revisionStateOf(record: ValidationRecord): {
  readonly attemptNumber: number;
  readonly maxRevisionAttempts: number;
} {
  const maxRevisionAttempts =
    record.plan?.revisionPolicy.maxRevisionAttempts ?? Number.MAX_SAFE_INTEGER;
  // The next adjudication round number (attempts consumed + 1).
  return deepFreeze({
    attemptNumber: Math.max(1, record.revisionAttempts + 1),
    maxRevisionAttempts,
  });
}

/** The latest revision request recorded (null when none). */
export function latestRevisionRequestOf(
  record: ValidationRecord,
): RevisionRequest | null {
  const entry = [...record.entries]
    .reverse()
    .find((candidate) => candidate.kind === 'revision-requested');
  if (entry === undefined) return null;
  const payload = entry.payload['revision'] as RevisionRequest | undefined;
  return payload === undefined ? null : payload;
}

/** The latest adjudication outcome recorded (null when none). */
export function latestAdjudicationOf(record: ValidationRecord): AdjudicationOutcome | null {
  const entry = [...record.entries]
    .reverse()
    .find((candidate) => candidate.kind === 'adjudication-recorded');
  if (entry === undefined) return null;
  const payload = entry.payload['adjudication'] as AdjudicationOutcome | undefined;
  return payload === undefined ? null : payload;
}

/** The replacement requests recorded (retained replaced-expert history). */
export function replacementRequestsOf(record: ValidationRecord): readonly ReplacementRequest[] {
  return record.entries
    .filter((entry) => entry.kind === 'replacement-requested')
    .map((entry) => entry.payload['replacement'] as ReplacementRequest);
}

/** Structural guard for wire values claiming to be validation records. */
export function isValidationRecord(value: unknown): value is ValidationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== VALIDATION_RECORD_VERSION) return false;
  if (typeof candidate['requestId'] !== 'string') return false;
  if (typeof candidate['revisionAttempts'] !== 'number') return false;
  const entries = candidate['entries'];
  if (!Array.isArray(entries)) return false;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as Record<string, unknown> | null;
    if (typeof entry !== 'object' || entry === null) return false;
    if (entry['sequence'] !== index + 1) return false;
    if (!isValidationEntryId(entry['entryId'])) return false;
    if (!isValidationEntryKind(entry['kind'])) return false;
  }
  return true;
}
