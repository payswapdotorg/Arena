/**
 * Replay run-list view model (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * The RUN LIST of the replay viewer: deterministic (runId) ordering over
 * run-summary payloads, BOUNDED pages, and OPAQUE continuation tokens —
 * the same pagination discipline as the B005 read path (tokens are
 * base64url-encoded JSON carrying a version + scope + offset, strictly
 * validated at parse time, deterministic functions of their inputs so
 * pagination is reproducible; they are ADDRESSES into the deterministic
 * ordering, never cached state — every page re-reads the authority).
 *
 * This surface does NOT extend the B005 read-model kind vocabulary: the
 * run list is projected inside THIS package from run-summary payloads
 * the runtime layer supplies (protocol objects read through the
 * trajectory/environment public APIs in the session posture, the
 * deterministic corpus in the demo posture).
 *
 * Every row carries its truth class: a replayable run summary is
 * SIMULATION-REPLAY (never "result"); an unreadable summary is UNKNOWN;
 * an in-flight run is PENDING. Total and never-throwing over any input.
 */

import {
  PENDING_TRUTH_CLASS,
  REPLAY_STEP_TRUTH_CLASS,
  UNKNOWN_TRUTH_CLASS,
} from './truth.js';
import type { ReplayTruthClass } from './truth.js';

// ---------------------------------------------------------------------------
// Bounded pages (the house "no unbounded read" discipline)
// ---------------------------------------------------------------------------

export const REPLAY_RUN_MAX_PAGE_SIZE = 100 as const;
export const REPLAY_RUN_DEFAULT_PAGE_SIZE = 50 as const;

/** The run-list query grammar version (carried by continuation tokens). */
export const REPLAY_RUN_QUERY_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Error codes of the replay run-list surface (closed vocabulary). */
export const REPLAY_UI_ERROR_CODES = Object.freeze({
  INVALID_CONTINUATION: 'REPLAY_UI_INVALID_CONTINUATION',
  INVALID_QUERY: 'REPLAY_UI_INVALID_QUERY',
} as const);

/** Fail-closed typed error of the replay run-list surface. */
export class ReplayUiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReplayUiError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Run summaries
// ---------------------------------------------------------------------------

/** The honest outcome vocabulary of a listed run. */
export type ReplayRunOutcome = 'completed' | 'failed' | 'timed-out' | 'in-flight' | 'unknown';

/** One run-list row. */
export interface ReplayRunSummary {
  /** Tenant-scoped run id (`<tenant>/<run-key>`). */
  readonly runId: string;
  /** The tenant-local run key (the evidence-address half). */
  readonly runKey: string;
  readonly submittedAt: string | null;
  readonly outcome: ReplayRunOutcome;
  readonly truthClass: ReplayTruthClass;
  readonly stepCount: number | null;
  readonly trajectoryDigest: string | null;
  readonly note: string;
}

const RUN_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}\/[a-z][a-z0-9-]{0,63}$/;
const CONTENT_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const OUTCOMES: readonly string[] = ['completed', 'failed', 'timed-out', 'in-flight'];

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Project ANY payload into one run-summary row. Total,
 * never-throwing: an invalid run id (or a non-object payload) renders
 * as the honest UNKNOWN row — the malformed row keeps its declared id
 * string for observability but never claims tenant scoping it does not
 * have.
 */
export function toReplayRunSummary(payload: unknown): ReplayRunSummary {
  if (!isPlainRecord(payload)) {
    return Object.freeze({
      runId: 'unreadable-run',
      runKey: 'unreadable-run',
      submittedAt: null,
      outcome: 'unknown',
      truthClass: UNKNOWN_TRUTH_CLASS,
      stepCount: null,
      trajectoryDigest: null,
      note: 'run summary payload was not an object — rendered as unknown, never guessed',
    } satisfies ReplayRunSummary);
  }
  const runIdRaw = payload['runId'];
  const runId = typeof runIdRaw === 'string' ? runIdRaw : null;
  if (runId === null || !RUN_ID_PATTERN.test(runId)) {
    return Object.freeze({
      runId: runId ?? 'unreadable-run',
      runKey: runId ?? 'unreadable-run',
      submittedAt: null,
      outcome: 'unknown',
      truthClass: UNKNOWN_TRUTH_CLASS,
      stepCount: null,
      trajectoryDigest: null,
      note: 'run id is not a tenant-scoped run id (<tenant>/<run-key>) — rendered as unknown, never guessed',
    } satisfies ReplayRunSummary);
  }
  const submittedAtRaw = payload['submittedAt'];
  const submittedAt = typeof submittedAtRaw === 'string' ? submittedAtRaw : null;
  const outcomeRaw = payload['outcome'];
  const outcome: ReplayRunOutcome =
    typeof outcomeRaw === 'string' && OUTCOMES.includes(outcomeRaw)
      ? (outcomeRaw as ReplayRunOutcome)
      : 'unknown';
  const stepCountRaw = payload['stepCount'];
  const stepCount =
    typeof stepCountRaw === 'number' && Number.isInteger(stepCountRaw) && stepCountRaw >= 0
      ? stepCountRaw
      : null;
  const trajectoryDigestRaw = payload['trajectoryDigest'];
  const trajectoryDigest =
    typeof trajectoryDigestRaw === 'string' && CONTENT_DIGEST_PATTERN.test(trajectoryDigestRaw)
      ? trajectoryDigestRaw
      : null;
  const truthClass =
    outcome === 'unknown'
      ? UNKNOWN_TRUTH_CLASS
      : outcome === 'in-flight'
        ? PENDING_TRUTH_CLASS
        : REPLAY_STEP_TRUTH_CLASS;
  const note =
    outcome === 'in-flight'
      ? 'run in flight — final outcome pending, never guessed'
      : outcome === 'unknown'
        ? 'run outcome unknown — rendered as unknown, never guessed'
        : 'replayable run — simulation-replay truth class (the record of what happened, never a result)';
  return Object.freeze({
    runId,
    runKey: runId.slice(runId.indexOf('/') + 1),
    submittedAt,
    outcome,
    truthClass,
    stepCount,
    trajectoryDigest,
    note,
  } satisfies ReplayRunSummary);
}

// ---------------------------------------------------------------------------
// Opaque continuation tokens (base64url JSON: version + scope + offset)
// ---------------------------------------------------------------------------

function toBase64Url(utf8: string): string {
  return Buffer.from(utf8, 'utf8').toString('base64url');
}

function fromBase64Url(encoded: string): string {
  return Buffer.from(encoded, 'base64url').toString('utf8');
}

/** Encode a continuation token (deterministic: same offset → same token). */
export function encodeReplayRunContinuation(offset: number): string {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
      `continuation offset must be a non-negative integer, got ${String(offset)}`,
    );
  }
  return toBase64Url(
    JSON.stringify({ v: REPLAY_RUN_QUERY_VERSION, scope: 'replay-runs', offset }),
  );
}

/**
 * Strictly decode + validate a continuation token (fail closed:
 * `REPLAY_UI_INVALID_CONTINUATION` for malformed encodings, unsupported
 * versions and scope mismatches). Returns the offset.
 */
export function decodeReplayRunContinuation(token: unknown): number {
  if (typeof token !== 'string' || token.length === 0) {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
      'a continuation token must be a non-empty string',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(token));
  } catch {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
      'the continuation token is not a valid encoded payload',
    );
  }
  if (!isPlainRecord(parsed)) {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
      'the continuation payload must be a plain object',
    );
  }
  if (parsed['v'] !== REPLAY_RUN_QUERY_VERSION) {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
      `unsupported continuation token version ${String(parsed['v'])}`,
    );
  }
  if (parsed['scope'] !== 'replay-runs') {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
      `continuation token scope ${JSON.stringify(String(parsed['scope']))} does not match the run-list scope 'replay-runs'`,
    );
  }
  const offset = parsed['offset'];
  if (!Number.isInteger(offset) || (offset as number) < 0) {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
      `continuation offset must be a non-negative integer, got ${String(offset)}`,
    );
  }
  return offset as number;
}

// ---------------------------------------------------------------------------
// The scroll
// ---------------------------------------------------------------------------

/** One run-list page. */
export interface ReplayRunPage {
  readonly rows: readonly ReplayRunSummary[];
  /** The continuation token for the next page — null when this page is the last. */
  readonly nextContinuation: string | null;
  /** Total run summaries known to the input list (the scroll's authority). */
  readonly totalKnown: number;
  /** The offset this page started from. */
  readonly offset: number;
  /** The effective (bounded) page size. */
  readonly limit: number;
}

function effectiveLimit(limit: unknown): number {
  if (limit === undefined || limit === null) return REPLAY_RUN_DEFAULT_PAGE_SIZE;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_QUERY,
      `limit must be a positive integer, got ${String(limit)}`,
    );
  }
  if (limit > REPLAY_RUN_MAX_PAGE_SIZE) {
    throw new ReplayUiError(
      REPLAY_UI_ERROR_CODES.INVALID_QUERY,
      `limit ${String(limit)} exceeds the bounded page size ${String(REPLAY_RUN_MAX_PAGE_SIZE)}`,
    );
  }
  return limit;
}

/**
 * Scroll the run list: deterministic (runId ascending) ordering over the
 * supplied run-summary payloads, one bounded page at a time. Every page
 * re-projects the input (tokens address the deterministic ordering,
 * never cached state). Invalid continuation tokens throw the typed
 * `ReplayUiError` (fail closed — the routes render the honest degraded
 * state, never a silently-reset page).
 */
export function scrollReplayRuns(
  runs: readonly unknown[],
  query: { readonly limit?: number; readonly continuation?: string } = {},
): ReplayRunPage {
  const limit = effectiveLimit(query.limit);
  const offset =
    query.continuation !== undefined ? decodeReplayRunContinuation(query.continuation) : 0;
  const projected = runs.map((payload) => toReplayRunSummary(payload));
  const ordered = [...projected].sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  const totalKnown = ordered.length;
  const clampedOffset = Math.min(offset, totalKnown);
  const rows = ordered.slice(clampedOffset, clampedOffset + limit);
  const end = clampedOffset + rows.length;
  return Object.freeze({
    rows: Object.freeze(rows),
    nextContinuation: end < totalKnown ? encodeReplayRunContinuation(end) : null,
    totalKnown,
    offset: clampedOffset,
    limit,
  } satisfies ReplayRunPage);
}
