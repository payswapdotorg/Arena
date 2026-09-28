/**
 * Expert task history (Work Order A006; docs/architecture.md §8 "task
 * history"; architecture-lock rule 6).
 *
 * The task history is an append-only list of content-addressed RECORD
 * REFS — references to task specs, assignments, outcomes and trajectories
 * produced by the task/trajectory protocols (A008/A011). The profile never
 * inlines task content; it references it by (kind, tenant, taskId,
 * version, digest) exactly like the sibling view types reference their
 * owning packages' objects.
 *
 * Discipline (machine-enforced):
 *   - every record ref's tenant MUST equal the profile's tenant (lock
 *     rule 11 — customer data cannot be silently cross-reused);
 *   - the history only grows: `toTaskHistory` validates a list,
 *     `assertTaskHistoryAppendOnly` enforces the prefix discipline, and
 *     NO removal API exists anywhere in the package (hygiene suite
 *     asserts the export surface).
 */

import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  deepFreeze,
  isContentDigest,
  isExpertVersion,
  isTenantScope,
} from './shared.js';
import type { ContentDigest, ExpertVersion, TenantScope } from './shared.js';
import { isExpertRegistryTimestamp, toExpertRegistryTimestamp } from './timestamp.js';
import type { ExpertRegistryTimestamp } from './timestamp.js';

/** Wire version of the task record ref shape. */
export const TASK_RECORD_REF_VERSION = 1 as const;

/**
 * Closed task record kinds: the object families the task/trajectory
 * protocols produce that an expert's history may reference.
 */
export const TASK_RECORD_TYPES = [
  'task-spec',
  'task-assignment',
  'task-outcome',
  'trajectory',
] as const;

export type TaskRecordType = (typeof TASK_RECORD_TYPES)[number];

export function isTaskRecordType(value: unknown): value is TaskRecordType {
  return (
    typeof value === 'string' &&
    (TASK_RECORD_TYPES as readonly string[]).includes(value)
  );
}

/** Neutral task record id pattern (mirrors the sibling slug conventions). */
export const TASK_RECORD_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';

const TASK_RECORD_ID_PATTERN = new RegExp(TASK_RECORD_ID_PATTERN_SOURCE);

/**
 * A content-addressed reference to one task-history record, scoped to the
 * profile's tenant. `occurredAt` anchors the record's position in the
 * expert's history.
 */
export interface TaskRecordRefView {
  readonly refVersion: typeof TASK_RECORD_REF_VERSION;
  readonly kind: TaskRecordType;
  readonly tenant: TenantScope;
  readonly taskId: string;
  readonly version: ExpertVersion;
  readonly digest: ContentDigest;
  readonly occurredAt: ExpertRegistryTimestamp;
}

export function isTaskRecordRefView(value: unknown): value is TaskRecordRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['refVersion'] === TASK_RECORD_REF_VERSION &&
    isTaskRecordType(candidate['kind']) &&
    isTenantScope(candidate['tenant']) &&
    typeof candidate['taskId'] === 'string' &&
    TASK_RECORD_ID_PATTERN.test(candidate['taskId']) &&
    isExpertVersion(candidate['version']) &&
    isContentDigest(candidate['digest']) &&
    isExpertRegistryTimestamp(candidate['occurredAt'])
  );
}

/** Structural input form of a task record ref. */
export interface TaskRecordRefInput {
  readonly kind: string;
  readonly tenant: string;
  readonly taskId: string;
  readonly version: string;
  readonly digest: string;
  readonly occurredAt: string;
}

/** A task-record-ref VALUE: validated view or its plain structural form. */
export type TaskRecordRefLike = TaskRecordRefView | TaskRecordRefInput;

/** Validate and freeze a task record ref; throws INVALID_TASK_HISTORY otherwise. */
export function toTaskRecordRefView(value: TaskRecordRefLike): TaskRecordRefView {
  if (!isTaskRecordType(value.kind)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: `unknown task record kind: ${JSON.stringify(value.kind)} (known: ${TASK_RECORD_TYPES.join(', ')})`,
      details: { known: [...TASK_RECORD_TYPES] },
    });
  }
  if (!isTenantScope(value.tenant)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: `invalid task record tenant scope: ${JSON.stringify(value.tenant)}`,
    });
  }
  if (
    typeof value.taskId !== 'string' ||
    !TASK_RECORD_ID_PATTERN.test(value.taskId)
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: `invalid task record id: ${JSON.stringify(value.taskId)}`,
      details: { pattern: TASK_RECORD_ID_PATTERN_SOURCE },
    });
  }
  if (!isExpertVersion(value.version)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: `invalid task record version: ${JSON.stringify(value.version)}`,
    });
  }
  if (!isContentDigest(value.digest)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: `invalid task record digest: ${JSON.stringify(value.digest)}`,
    });
  }
  const occurredAt = toExpertRegistryTimestamp(value.occurredAt);
  return deepFreeze({
    refVersion: TASK_RECORD_REF_VERSION,
    kind: value.kind,
    tenant: value.tenant,
    taskId: value.taskId,
    version: value.version,
    digest: value.digest,
    occurredAt,
  });
}

/** Stable key of a task record ref: `<kind>:<taskId>@<version>#<digest>`. */
export function taskRecordRefKey(ref: TaskRecordRefView): string {
  return `${ref.kind}:${ref.taskId}@${ref.version}#${ref.digest}`;
}

/**
 * Validate a task-history list (possibly empty — a new expert has no
 * history yet) with duplicate detection.
 */
export function toTaskHistory(
  values: readonly TaskRecordRefLike[],
): readonly TaskRecordRefView[] {
  if (!Array.isArray(values)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
      message: 'task history must be an array of record refs',
      details: { field: 'taskHistory' },
    });
  }
  const history = values.map((value) => toTaskRecordRefView(value));
  const seen = new Set<string>();
  for (const ref of history) {
    const key = taskRecordRefKey(ref);
    if (seen.has(key)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
        message: `duplicate task record ref: ${key} (task history entries are unique by content address)`,
        details: { record: key },
      });
    }
    seen.add(key);
  }
  return Object.freeze(history);
}

/**
 * Assert task-history append-only discipline: `previous` must be a strict
 * prefix of `next` (same refs in the same order). Throws
 * TASK_HISTORY_REMOVAL on shrink and INVALID_TASK_HISTORY on rewrite.
 * Used by the registry and by auditors.
 */
export function assertTaskHistoryAppendOnly(
  previous: readonly TaskRecordRefView[],
  next: readonly TaskRecordRefView[],
): void {
  if (next.length < previous.length) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.TASK_HISTORY_REMOVAL, {
      message: `task history removal detected: ${previous.length} → ${next.length} record ref(s) (task history is append-only — architecture-lock rule 6)`,
      details: { previousCount: previous.length, nextCount: next.length },
    });
  }
  for (let i = 0; i < previous.length; i += 1) {
    const before = previous[i];
    const after = next[i];
    if (
      before === undefined ||
      after === undefined ||
      taskRecordRefKey(before) !== taskRecordRefKey(after) ||
      before.occurredAt !== after.occurredAt
    ) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_TASK_HISTORY, {
        message: `task history rewrite detected at position ${i} (task history is append-only and never rewritten)`,
        details: { position: i },
      });
    }
  }
}
