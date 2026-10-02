/**
 * Jobs view-models (Work Order B014; apps/web/src/operations).
 * Pure projection layer — no React, no I/O.
 *
 * Projects A015 job records (`JobRecord`, read server-side through the
 * package's PUBLIC API) into the renderable job views. The B014 job
 * truths enforced HERE, by construction:
 *
 *   - a job renders its ACTUAL lifecycle state — the closed A015
 *     vocabulary (queued / running / succeeded / failed / cancelled)
 *     projected verbatim, plus this surface's own `unknown` state for
 *     records that cannot be read — never an optimistic completion and
 *     never a guessed terminal state;
 *   - attempts and timestamps render from the record's own append-only
 *     history (1-based attempt numbers, attempt outcomes, event kinds);
 *   - a running job's outcome is PENDING — rendered as in-flight, never
 *     assumed; a re-queued job renders its backoff gate (`nextRetryAt`);
 *   - malformed payloads degrade TRUTHFULLY: every unreadable piece
 *     renders as an unknown field with its name listed — nothing is
 *     fabricated to fill the space and nothing throws.
 *
 * The record guard is structural (`recordVersion`, closed status
 * vocabulary, timestamp pattern) — the same discipline the package's own
 * `parseJobRecord` applies at the wire boundary; here it degrades the view
 * instead of throwing, because a render must never crash on bad data.
 */

import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  JOB_RECORD_VERSION,
  JOB_STATES,
  JOB_TIMESTAMP_PATTERN_SOURCE,
  isJobState,
} from '../../../../packages/job-protocol/src/index.js';
import type { JobState } from '../../../../packages/job-protocol/src/index.js';

/** Version of the jobs view surface (bump on breaking changes). */
export const JOBS_VIEW_VERSION = 1 as const;

/** The lifecycle state of one job view: the closed A015 vocabulary plus this surface's honest `unknown`. */
export type JobLifecycleView = JobState | 'unknown';

const JOB_TIMESTAMP_PATTERN = new RegExp(JOB_TIMESTAMP_PATTERN_SOURCE);
const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);

/** One attempt row (append-only history entry, projected verbatim). */
export interface JobAttemptView {
  readonly attempt: number | undefined;
  readonly startedAt: string | undefined;
  readonly outcome: string | undefined;
  readonly endedAt: string | undefined;
  readonly errorClass: string | undefined;
}

/** One lifecycle event row (append-only history entry, projected verbatim). */
export interface JobEventView {
  readonly kind: string | undefined;
  readonly sequence: number | undefined;
  readonly occurredAt: string | undefined;
}

/** The honest outcome note carried per lifecycle state (never optimistic). */
const OUTCOME_NOTES: Readonly<Record<JobState, string>> = Object.freeze({
  queued: 'Queued — awaiting claim; the outcome is pending, never assumed.',
  running: 'Running — in flight; the outcome is pending, never assumed.',
  succeeded: 'Succeeded — terminal; the recorded result stands.',
  failed: 'Failed — terminal; the recorded attempt history stands.',
  cancelled: 'Cancelled — terminal; the recorded cancellation stands.',
} as const);

/** The summary view of one job (list row). */
export interface JobSummaryView {
  readonly viewVersion: typeof JOBS_VIEW_VERSION;
  readonly jobId: string | undefined;
  /** Kind identity key `namespace/name@version` (self-describing snapshot). */
  readonly kindKey: string | undefined;
  readonly correlationId: string | undefined;
  readonly state: JobLifecycleView;
  readonly attempts: number | undefined;
  readonly submittedAt: string | undefined;
  readonly updatedAt: string | undefined;
  /** Truth class: a readable record's state is a verified fact; anything else is unknown. */
  readonly truthClass: 'verified-fact' | 'unknown';
  readonly outcomeNote: string | undefined;
  readonly unknownFields: readonly string[];
  /** True iff the record was structurally readable (state included). */
  readonly readable: boolean;
}

/** The detail view of one job (attempts, events, policy, failure/cancellation/progress). */
export interface JobDetailView extends JobSummaryView {
  readonly definitionDigest: string | undefined;
  readonly idempotencyScope: string | undefined;
  readonly policy: {
    readonly timeoutMs: number | undefined;
    readonly maxAttempts: number | undefined;
    readonly retryableErrorClasses: readonly string[];
  };
  readonly attemptHistory: readonly JobAttemptView[];
  readonly events: readonly JobEventView[];
  readonly failure?: { readonly kind: string; readonly errorClass: string; readonly message: string };
  readonly cancellation?: { readonly reason: string; readonly cancelledAt: string };
  readonly progress?: {
    readonly attempt: number;
    readonly percent: number | undefined;
    readonly note: string | undefined;
    readonly at: string;
  };
  readonly resultNote: string | undefined;
  readonly nextRetryAt: string | undefined;
  readonly timeoutAt: string | undefined;
}

// ---------------------------------------------------------------------------
// Structural guards (degrade, never throw)
// ---------------------------------------------------------------------------

function readRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== JOB_RECORD_VERSION) return undefined;
  return record;
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' && JOB_TIMESTAMP_PATTERN.test(value) ? value : undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function readContentDigest(value: unknown): string | undefined {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value) ? value : undefined;
}

function readKindKey(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const kind = value as Record<string, unknown>;
  const namespace = readNonEmptyString(kind['namespace']);
  const name = readNonEmptyString(kind['name']);
  const version = readNonEmptyString(kind['version']);
  if (namespace === undefined || name === undefined || version === undefined) return undefined;
  return `${namespace}/${name}@${version}`;
}

function unknownIf(condition: boolean, field: string, sink: string[]): void {
  if (condition) sink.push(field);
}

/** Deterministic dedup (preserves first-seen order) for the unknown-field lists. */
function dedup(items: readonly string[]): string[] {
  return [...new Set(items)];
}

// ---------------------------------------------------------------------------
// Summary projection
// ---------------------------------------------------------------------------

/**
 * Project one job record into the summary view. The record is guarded
 * structurally: a malformed payload yields a DEGRADED but complete view
 * (state `unknown`, every field it cannot read rendered as a named unknown
 * field) — never a fabricated job and never a thrown render.
 */
export function toJobSummaryView(record: unknown): JobSummaryView {
  const unknownFields: string[] = [];
  const raw = readRecord(record);
  if (raw === undefined) {
    unknownFields.push('job record (structurally unreadable)');
    return Object.freeze({
      viewVersion: JOBS_VIEW_VERSION,
      jobId: undefined,
      kindKey: undefined,
      correlationId: undefined,
      state: 'unknown' as const,
      attempts: undefined,
      submittedAt: undefined,
      updatedAt: undefined,
      truthClass: 'unknown' as const,
      outcomeNote: 'Unknown — the record state cannot be read; nothing is guessed.',
      unknownFields: Object.freeze(dedup(unknownFields)),
      readable: false,
    } satisfies JobSummaryView);
  }

  const jobId = readNonEmptyString(raw['jobId']);
  unknownIf(jobId === undefined, 'jobId', unknownFields);
  const kindKey = readKindKey(raw['kind']);
  unknownIf(kindKey === undefined, 'kind identity', unknownFields);
  const status = raw['status'];
  const state: JobLifecycleView = isJobState(status) ? status : 'unknown';
  unknownIf(!isJobState(status), `job status ${JSON.stringify(status)}`, unknownFields);
  const correlationId = readNonEmptyString(raw['correlationId']);
  unknownIf(correlationId === undefined, 'correlationId', unknownFields);
  const attempts = readNonNegativeInt(raw['attempts']);
  unknownIf(attempts === undefined, 'attempts', unknownFields);
  const submittedAt = readTimestamp(raw['submittedAt']);
  unknownIf(submittedAt === undefined, 'submittedAt', unknownFields);
  const updatedAt = readTimestamp(raw['updatedAt']);
  unknownIf(updatedAt === undefined, 'updatedAt', unknownFields);

  const readable = state !== 'unknown';
  return Object.freeze({
    viewVersion: JOBS_VIEW_VERSION,
    jobId,
    kindKey,
    correlationId,
    state,
    attempts,
    submittedAt,
    updatedAt,
    truthClass: readable ? ('verified-fact' as const) : ('unknown' as const),
    outcomeNote: readable ? OUTCOME_NOTES[state as JobState] : undefined,
    unknownFields: Object.freeze(dedup(unknownFields)),
    readable,
  } satisfies JobSummaryView);
}

// ---------------------------------------------------------------------------
// Detail projection
// ---------------------------------------------------------------------------

function readAttemptViews(
  value: unknown,
  unknownFields: string[],
): JobAttemptView[] {
  if (!Array.isArray(value)) {
    unknownFields.push('attempt history');
    return [];
  }
  const views: JobAttemptView[] = [];
  value.forEach((entry, index) => {
    const attempt = readRecord(entry) ?? (typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>) : undefined);
    if (attempt === undefined) {
      unknownFields.push(`attempt history entry #${String(index + 1)}`);
      views.push(
        Object.freeze({
          attempt: undefined,
          startedAt: undefined,
          outcome: undefined,
          endedAt: undefined,
          errorClass: undefined,
        } satisfies JobAttemptView),
      );
      return;
    }
    const number = readNonNegativeInt(attempt['attempt']);
    views.push(
      Object.freeze({
        attempt: number !== undefined && number >= 1 ? number : undefined,
        startedAt: readTimestamp(attempt['startedAt']),
        outcome: readNonEmptyString(attempt['outcome']),
        endedAt: readTimestamp(attempt['endedAt']),
        errorClass: readNonEmptyString(attempt['errorClass']),
      } satisfies JobAttemptView),
    );
  });
  return views;
}

function readEventViews(value: unknown, unknownFields: string[]): JobEventView[] {
  if (!Array.isArray(value)) {
    unknownFields.push('event history');
    return [];
  }
  const views: JobEventView[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      unknownFields.push(`event history entry #${String(index + 1)}`);
      views.push(
        Object.freeze({ kind: undefined, sequence: undefined, occurredAt: undefined } satisfies JobEventView),
      );
      return;
    }
    const event = entry as Record<string, unknown>;
    const sequence = readNonNegativeInt(event['sequence']);
    views.push(
      Object.freeze({
        kind: readNonEmptyString(event['kind']),
        sequence: sequence !== undefined && sequence >= 1 ? sequence : undefined,
        occurredAt: readTimestamp(event['occurredAt']),
      } satisfies JobEventView),
    );
  });
  return views;
}

function readFailure(value: unknown): JobDetailView['failure'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const failure = value as Record<string, unknown>;
  const kind = readNonEmptyString(failure['kind']);
  const errorClass = readNonEmptyString(failure['errorClass']);
  const message = readNonEmptyString(failure['message']);
  if (kind === undefined || errorClass === undefined || message === undefined) return undefined;
  return Object.freeze({ kind, errorClass, message });
}

function readCancellation(value: unknown): JobDetailView['cancellation'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const cancellation = value as Record<string, unknown>;
  const reason = readNonEmptyString(cancellation['reason']);
  const cancelledAt = readTimestamp(cancellation['cancelledAt']);
  if (reason === undefined || cancelledAt === undefined) return undefined;
  return Object.freeze({ reason, cancelledAt });
}

function readProgress(value: unknown): JobDetailView['progress'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const progress = value as Record<string, unknown>;
  const attempt = readNonNegativeInt(progress['attempt']);
  const at = readTimestamp(progress['at']);
  if (attempt === undefined || attempt < 1 || at === undefined) return undefined;
  const percent =
    typeof progress['percent'] === 'number' &&
    Number.isFinite(progress['percent']) &&
    progress['percent'] >= 0 &&
    progress['percent'] <= 100
      ? progress['percent']
      : undefined;
  return Object.freeze({
    attempt,
    percent,
    note: readNonEmptyString(progress['note']),
    at,
  });
}

function readResultNote(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized.slice(0, 160) : undefined;
  } catch {
    return undefined;
  }
}

function readPolicy(value: unknown, unknownFields: string[]): JobDetailView['policy'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    unknownFields.push('policy snapshot');
    return Object.freeze({ timeoutMs: undefined, maxAttempts: undefined, retryableErrorClasses: [] });
  }
  const policy = value as Record<string, unknown>;
  const timeoutMs =
    typeof policy['timeoutMs'] === 'number' && Number.isSafeInteger(policy['timeoutMs']) && policy['timeoutMs'] >= 1
      ? policy['timeoutMs']
      : undefined;
  unknownIf(timeoutMs === undefined, 'policy.timeoutMs', unknownFields);
  const retryRaw = policy['retry'];
  let maxAttempts: number | undefined;
  let retryable: readonly string[] = [];
  if (typeof retryRaw === 'object' && retryRaw !== null && !Array.isArray(retryRaw)) {
    const retry = retryRaw as Record<string, unknown>;
    maxAttempts =
      typeof retry['maxAttempts'] === 'number' &&
      Number.isSafeInteger(retry['maxAttempts']) &&
      retry['maxAttempts'] >= 1
        ? retry['maxAttempts']
        : undefined;
    unknownIf(maxAttempts === undefined, 'policy.retry.maxAttempts', unknownFields);
    if (Array.isArray(retry['retryableErrorClasses'])) {
      retryable = (retry['retryableErrorClasses'] as readonly unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      );
    } else {
      unknownFields.push('policy.retry.retryableErrorClasses');
    }
  } else {
    unknownFields.push('policy.retry');
  }
  return Object.freeze({ timeoutMs, maxAttempts, retryableErrorClasses: Object.freeze([...retryable]) });
}

/**
 * Project one job record into the detail view: attempts, event history,
 * policy snapshot, failure/cancellation/progress — every piece degrading
 * truthfully (named unknown fields) when unreadable. Nothing is fabricated
 * and nothing throws.
 */
export function toJobDetailView(record: unknown): JobDetailView {
  const summary = toJobSummaryView(record);
  const raw = readRecord(record);
  const unknownFields = [...summary.unknownFields];
  if (raw === undefined) {
    return Object.freeze({
      ...summary,
      definitionDigest: undefined,
      idempotencyScope: undefined,
      policy: Object.freeze({ timeoutMs: undefined, maxAttempts: undefined, retryableErrorClasses: Object.freeze([]) }),
      attemptHistory: Object.freeze([]),
      events: Object.freeze([]),
      resultNote: undefined,
      nextRetryAt: undefined,
      timeoutAt: undefined,
      unknownFields: Object.freeze(dedup(unknownFields)),
    } satisfies JobDetailView);
  }

  const definitionDigest = readContentDigest(raw['definitionDigest']);
  unknownIf(definitionDigest === undefined, 'definitionDigest', unknownFields);
  const idempotencyScope = readNonEmptyString(raw['idempotencyScope']);
  unknownIf(idempotencyScope === undefined, 'idempotencyScope', unknownFields);
  const policy = readPolicy(raw['policy'], unknownFields);
  const attemptHistory = readAttemptViews(raw['attemptHistory'], unknownFields);
  const events = readEventViews(raw['events'], unknownFields);
  const failure = readFailure(raw['failure']);
  const cancellation = readCancellation(raw['cancellation']);
  const progress = readProgress(raw['progress']);
  const resultNote = readResultNote(raw['result']);
  const nextRetryAt = readTimestamp(raw['nextRetryAt']);
  const timeoutAt = readTimestamp(raw['timeoutAt']);

  return Object.freeze({
    ...summary,
    definitionDigest,
    idempotencyScope,
    policy,
    attemptHistory: Object.freeze(attemptHistory),
    events: Object.freeze(events),
    ...(failure !== undefined ? { failure } : {}),
    ...(cancellation !== undefined ? { cancellation } : {}),
    ...(progress !== undefined ? { progress } : {}),
    resultNote,
    nextRetryAt,
    timeoutAt,
    unknownFields: Object.freeze(dedup(unknownFields)),
  } satisfies JobDetailView);
}

/**
 * The closed set of job lifecycle states this surface renders (the A015
 * vocabulary plus `unknown`) — exported for the view layer and tests so
 * the vocabulary can never drift from the projection.
 */
export const JOB_LIFECYCLE_VIEW_STATES: readonly JobLifecycleView[] = Object.freeze([
  ...JOB_STATES,
  'unknown',
]);
