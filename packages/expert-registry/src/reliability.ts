/**
 * Expert reliability measurement data (Work Order A006; docs/architecture.md
 * §8 "reliability"; requirement R32 "Measure expert and capability quality";
 * architecture-lock rule 6: historical evidence is append-only).
 *
 * Reliability is EVENT-SOURCED pure data:
 *   - the profile carries an append-only LEDGER of typed outcome events
 *     (`task-completed`, `task-failed`, `no-response`), each with an
 *     injected timestamp, a recorded-by principal, an optional task record
 *     ref and optional evidence;
 *   - the completed/failed/no-response COUNTERS are a DERIVED view:
 *     `recomputeReliabilityMetrics` folds the ledger. There is NO API that
 *     sets counters directly, NO API that mutates a ledger entry, and NO
 *     profile input field that declares metrics — a profile whose input
 *     carries hand-crafted counters is rejected (negative tests). The
 *     counters can therefore never disagree with the recorded history;
 *   - `appendReliabilityEntry` is the only way a ledger grows: it assigns
 *     the next sequence number itself (the caller cannot choose one), and
 *   - ReliabilityMetrics is exported as typed pure data (the contract the
 *     A007 qualification/matching engines and R32 quality measurement
 *     consume), never as mutable state.
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import type { TaskRecordRefInput, TaskRecordRefView } from './task-history.js';
import { isTaskRecordRefView, toTaskRecordRefView } from './task-history.js';
import {
  assertNoDuplicateEvidence,
  deepFreeze,
  isPrincipalRefView,
  toEvidenceRef,
  toPrincipalRefView,
} from './shared.js';
import type { EvidenceRef, PrincipalRefLike, PrincipalRefView } from './shared.js';
import { isExpertRegistryTimestamp, toExpertRegistryTimestamp } from './timestamp.js';
import type { ExpertRegistryTimestamp } from './timestamp.js';

/** Wire version of the reliability ledger entry shape. */
export const RELIABILITY_ENTRY_VERSION = 1 as const;

/** Wire version of the derived reliability metrics shape. */
export const RELIABILITY_METRICS_VERSION = 1 as const;

/**
 * The closed reliability outcome vocabulary — exactly the three counter
 * families §8 requires: completed, failed, no-response.
 */
export const RELIABILITY_EVENT_KINDS = [
  'task-completed',
  'task-failed',
  'no-response',
] as const;

export type ReliabilityEventKind = (typeof RELIABILITY_EVENT_KINDS)[number];

export function isReliabilityEventKind(value: unknown): value is ReliabilityEventKind {
  return (
    typeof value === 'string' &&
    (RELIABILITY_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * One append-only reliability outcome event. Sequences are 1-based and
 * strictly increasing within a profile's ledger, assigned by
 * `appendReliabilityEntry` — never chosen by the caller.
 */
export interface ReliabilityLedgerEntry {
  readonly entryVersion: typeof RELIABILITY_ENTRY_VERSION;
  readonly sequence: number;
  readonly kind: ReliabilityEventKind;
  readonly occurredAt: ExpertRegistryTimestamp;
  readonly recordedBy: PrincipalRefView;
  /** The task record this outcome refers to (absent for pure no-response events). */
  readonly taskRecord?: TaskRecordRefView;
  readonly note?: string;
  /** Optional digest-addressed evidence backing the outcome claim. */
  readonly evidence?: readonly EvidenceRef[];
}

export function isReliabilityLedgerEntry(
  value: unknown,
): value is ReliabilityLedgerEntry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['entryVersion'] === RELIABILITY_ENTRY_VERSION &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isReliabilityEventKind(candidate['kind']) &&
    isExpertRegistryTimestamp(candidate['occurredAt']) &&
    isPrincipalRefView(candidate['recordedBy']) &&
    (candidate['taskRecord'] === undefined ||
      isTaskRecordRefView(candidate['taskRecord'])) &&
    (candidate['note'] === undefined ||
      (typeof candidate['note'] === 'string' && candidate['note'].length > 0)) &&
    (candidate['evidence'] === undefined ||
      (Array.isArray(candidate['evidence']) &&
        candidate['evidence'].every((ref) => {
          if (typeof ref !== 'object' || ref === null) return false;
          const digest = (ref as Record<string, unknown>)['digest'];
          return typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest);
        })))
  );
}

/**
 * Validate and freeze one ledger entry at an EXPLICIT sequence position
 * (used by reconstruction/rehydration paths). New entries are normally
 * produced by `appendReliabilityEntry`, which assigns the sequence itself.
 */
export function toReliabilityLedgerEntry(
  value: {
    sequence: number;
    kind: string;
    occurredAt: string;
    recordedBy: PrincipalRefLike;
    taskRecord?: TaskRecordRefInput;
    note?: string;
    evidence?: readonly { digest: string; description: string }[];
  },
): ReliabilityLedgerEntry {
  if (
    typeof value.sequence !== 'number' ||
    !Number.isInteger(value.sequence) ||
    value.sequence < 1
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
      message: `reliability entry sequence must be a positive integer: ${JSON.stringify(value.sequence)}`,
      details: { field: 'sequence' },
    });
  }
  if (!isReliabilityEventKind(value.kind)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
      message: `unknown reliability event kind: ${JSON.stringify(value.kind)} (known: ${RELIABILITY_EVENT_KINDS.join(', ')})`,
      details: { known: [...RELIABILITY_EVENT_KINDS] },
    });
  }
  const occurredAt = toExpertRegistryTimestamp(value.occurredAt);
  const recordedBy = toPrincipalRefView(value.recordedBy as PrincipalRefLike);
  if (value.note !== undefined && value.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
      message: 'reliability entry notes, when present, must be non-empty',
    });
  }
  let evidence: readonly EvidenceRef[] | undefined;
  if (value.evidence !== undefined) {
    if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
        message: 'reliability entry evidence, when present, must be a non-empty list of refs',
      });
    }
    evidence = Object.freeze(value.evidence.map((ref) => toEvidenceRef(ref)));
    assertNoDuplicateEvidence(evidence);
  }
  const taskRecord =
    value.taskRecord === undefined ? undefined : toTaskRecordRefView(value.taskRecord);
  return deepFreeze({
    entryVersion: RELIABILITY_ENTRY_VERSION,
    sequence: value.sequence,
    kind: value.kind,
    occurredAt,
    recordedBy,
    ...(taskRecord !== undefined ? { taskRecord } : {}),
    ...(value.note !== undefined ? { note: value.note } : {}),
    ...(evidence !== undefined ? { evidence } : {}),
  });
}

/**
 * Append one outcome event to a ledger: the entry's sequence is assigned
 * HERE (previous length + 1) and must not be pre-set — a caller-supplied
 * sequence is rejected (the ledger's order is protocol-controlled, not
 * caller-controlled). Returns a NEW frozen ledger; the input ledger is
 * untouched (pure append, lock rule 6).
 */
export function appendReliabilityEntry(
  ledger: readonly ReliabilityLedgerEntry[],
  entry: {
    kind: string;
    occurredAt: string;
    recordedBy: PrincipalRefLike;
    taskRecord?: TaskRecordRefInput;
    note?: string;
    evidence?: readonly { digest: string; description: string }[];
  },
): readonly ReliabilityLedgerEntry[] {
  if ((entry as { sequence?: unknown }).sequence !== undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.RELIABILITY_MUTATION, {
      message: 'reliability entries cannot carry a caller-chosen sequence: the ledger assigns sequence positions itself (event-sourced counters are recomputed from history, never directly positioned)',
      details: { field: 'sequence' },
    });
  }
  const nextSequence = ledger.length + 1;
  const validated = toReliabilityLedgerEntry({
    ...entry,
    sequence: nextSequence,
  });
  return Object.freeze([...ledger, validated]);
}

/**
 * The derived reliability metrics (typed pure data — the R32 measurement
 * contract): completed/failed/no-response counters folded from the ledger,
 * plus the total and the last event's timestamp. Deep-frozen: counters are
 * a VIEW of history, not state.
 */
export interface ReliabilityMetrics {
  readonly metricsVersion: typeof RELIABILITY_METRICS_VERSION;
  readonly tasksCompleted: number;
  readonly tasksFailed: number;
  readonly noResponse: number;
  readonly totalEvents: number;
  readonly lastEventAt?: ExpertRegistryTimestamp;
}

export function isReliabilityMetrics(value: unknown): value is ReliabilityMetrics {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['metricsVersion'] === RELIABILITY_METRICS_VERSION &&
    typeof candidate['tasksCompleted'] === 'number' &&
    Number.isInteger(candidate['tasksCompleted']) &&
    candidate['tasksCompleted'] >= 0 &&
    typeof candidate['tasksFailed'] === 'number' &&
    Number.isInteger(candidate['tasksFailed']) &&
    candidate['tasksFailed'] >= 0 &&
    typeof candidate['noResponse'] === 'number' &&
    Number.isInteger(candidate['noResponse']) &&
    candidate['noResponse'] >= 0 &&
    typeof candidate['totalEvents'] === 'number' &&
    Number.isInteger(candidate['totalEvents']) &&
    candidate['totalEvents'] >= 0 &&
    (candidate['lastEventAt'] === undefined ||
      isExpertRegistryTimestamp(candidate['lastEventAt']))
  );
}

/**
 * Fold a reliability ledger into its metrics. This is the ONLY producer of
 * ReliabilityMetrics from history: counters are recomputed, never stored
 * and never directly mutable (lock rule 6 discipline).
 */
export function recomputeReliabilityMetrics(
  ledger: readonly ReliabilityLedgerEntry[],
): ReliabilityMetrics {
  let tasksCompleted = 0;
  let tasksFailed = 0;
  let noResponse = 0;
  let lastEventAt: ExpertRegistryTimestamp | undefined;
  for (const entry of ledger) {
    if (!isReliabilityLedgerEntry(entry)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
        message: `reliability ledger contains an invalid entry at sequence ${JSON.stringify(entry?.['sequence' as keyof typeof entry] ?? 'unknown')}`,
      });
    }
    switch (entry.kind) {
      case 'task-completed':
        tasksCompleted += 1;
        break;
      case 'task-failed':
        tasksFailed += 1;
        break;
      case 'no-response':
        noResponse += 1;
        break;
    }
    lastEventAt = entry.occurredAt;
  }
  return deepFreeze({
    metricsVersion: RELIABILITY_METRICS_VERSION,
    tasksCompleted,
    tasksFailed,
    noResponse,
    totalEvents: ledger.length,
    ...(lastEventAt !== undefined ? { lastEventAt } : {}),
  });
}

/**
 * Fail closed when a value claims to BE metrics for a ledger but does not
 * match the history (an auditor tripwire: any hand-crafted metrics object
 * that disagrees with the recorded ledger is rejected). Used by tests and
 * available to downstream auditors.
 */
export function assertMetricsMatchLedger(
  metrics: ReliabilityMetrics,
  ledger: readonly ReliabilityLedgerEntry[],
): void {
  const recomputed = recomputeReliabilityMetrics(ledger);
  if (
    metrics.tasksCompleted !== recomputed.tasksCompleted ||
    metrics.tasksFailed !== recomputed.tasksFailed ||
    metrics.noResponse !== recomputed.noResponse ||
    metrics.totalEvents !== recomputed.totalEvents ||
    metrics.lastEventAt !== recomputed.lastEventAt
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.RELIABILITY_MUTATION, {
      message: 'reliability metrics do not match the recorded ledger (counters are recomputed from history — architecture-lock rule 6)',
      details: {
        claimed: {
          tasksCompleted: metrics.tasksCompleted,
          tasksFailed: metrics.tasksFailed,
          noResponse: metrics.noResponse,
          totalEvents: metrics.totalEvents,
        },
        recomputed: {
          tasksCompleted: recomputed.tasksCompleted,
          tasksFailed: recomputed.tasksFailed,
          noResponse: recomputed.noResponse,
          totalEvents: recomputed.totalEvents,
        },
      },
    });
  }
}

/**
 * Assert ledger append-only discipline between an older and a newer
 * ledger: the older must be a strict PREFIX of the newer (same entries in
 * the same order), and sequences must stay strictly increasing. Throws
 * RELIABILITY_MUTATION otherwise. Used by the registry and by auditors.
 */
export function assertReliabilityAppendOnly(
  previous: readonly ReliabilityLedgerEntry[],
  next: readonly ReliabilityLedgerEntry[],
): void {
  if (next.length < previous.length) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.RELIABILITY_MUTATION, {
      message: `reliability ledger shrink detected: ${previous.length} → ${next.length} entries (outcome history is append-only — architecture-lock rule 6)`,
      details: { previousCount: previous.length, nextCount: next.length },
    });
  }
  for (let i = 0; i < previous.length; i += 1) {
    const before = previous[i];
    const after = next[i];
    if (before !== after) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.RELIABILITY_MUTATION, {
        message: `reliability ledger rewrite detected at position ${i} (outcome history is append-only and never rewritten)`,
        details: { position: i },
      });
    }
  }
  for (let i = 0; i < next.length; i += 1) {
    const entry = next[i];
    if (entry === undefined || entry.sequence !== i + 1) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.RELIABILITY_MUTATION, {
        message: `reliability ledger sequence broken at position ${i} (expected sequence ${i + 1})`,
        details: { position: i },
      });
    }
  }
}

/** Validate a ledger list (each entry validated; possibly empty). */
export function toReliabilityLedger(
  values: readonly Parameters<typeof toReliabilityLedgerEntry>[0][],
): readonly ReliabilityLedgerEntry[] {
  if (!Array.isArray(values)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_RELIABILITY, {
      message: 'reliability must be an array of ledger entries',
      details: { field: 'reliability' },
    });
  }
  const ledger = values.map((value) => toReliabilityLedgerEntry(value));
  assertReliabilityAppendOnly([], ledger);
  return Object.freeze(ledger);
}
