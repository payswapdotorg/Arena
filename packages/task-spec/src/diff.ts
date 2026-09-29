/**
 * TaskDiff — structured, deterministic version-to-version diffing of
 * TaskSpecs (Work Order A008; the versioning requirement: "new version =
 * new content-addressed object; supersession by append (never
 * rewrite)").
 *
 * A diff is between two versions of the SAME logical task (same tenant +
 * task id — diffing different tasks is a typed error). The result carries
 * the two content-addressed refs and the SORTED list of changed field
 * paths (dot-paths into nested objects; arrays diff ATOMICALLY —
 * 'objectives' is one path, not per-element paths — a documented,
 * deliberate limitation that keeps diffs stable and reviewable).
 *
 * Pure: no I/O, no clock. Deterministic: same pair ⇒ same diff bytes.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import { taskVersionRefOf } from './identity.js';
import type { TaskVersionRef } from './identity.js';
import type { TaskSpec } from './spec.js';

/** Wire version of the task-diff shape. */
export const TASK_DIFF_VERSION = 1 as const;

/** The structured diff between two versions of one logical task. */
export interface TaskDiff {
  readonly diffVersion: typeof TASK_DIFF_VERSION;
  readonly from: TaskVersionRef;
  readonly to: TaskVersionRef;
  /** Sorted (lexicographic) dot-paths of every changed field. */
  readonly changedFields: readonly string[];
}

/** Stable field list (tests + contracts mirror it). */
export const TASK_DIFF_FIELDS = Object.freeze([
  'diffVersion',
  'from',
  'to',
  'changedFields',
] as const) as readonly string[];

/** True iff both values are structurally equal (JSON-shaped values only). */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((entry, index) => deepEquals(entry, b[index]));
  }
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (
      !deepEquals(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      )
    ) {
      return false;
    }
  }
  return true;
}

/** Collect sorted dot-paths where `from` and `to` differ. */
function collectChangedPaths(from: unknown, to: unknown, prefix: string, out: string[]): void {
  const fromIsObject =
    typeof from === 'object' && from !== null && !Array.isArray(from);
  const toIsObject = typeof to === 'object' && to !== null && !Array.isArray(to);
  if (fromIsObject && toIsObject) {
    const keys = new Set([
      ...Object.keys(from as Record<string, unknown>),
      ...Object.keys(to as Record<string, unknown>),
    ]);
    for (const key of keys) {
      collectChangedPaths(
        (from as Record<string, unknown>)[key],
        (to as Record<string, unknown>)[key],
        prefix === '' ? key : `${prefix}.${key}`,
        out,
      );
    }
    return;
  }
  if (!deepEquals(from, to)) {
    out.push(prefix);
  }
}

/**
 * Diff two versions of the SAME logical task. Throws INVALID_DIFF when the
 * specs belong to different logical tasks, or when they are the same
 * version with the same digest (nothing to diff — a diff is between two
 * DISTINCT versions; equal content under different versions still diffs as
 * an empty change set only when versions differ).
 */
export function diffTaskSpecs(from: TaskSpec, to: TaskSpec): TaskDiff {
  if (
    from.identity.tenant !== to.identity.tenant ||
    from.identity.taskId !== to.identity.taskId
  ) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIFF, {
      message: `cannot diff different logical tasks: ${from.identity.tenant}/${from.identity.taskId} vs ${to.identity.tenant}/${to.identity.taskId}`,
      details: {
        from: `${from.identity.tenant}/${from.identity.taskId}@${from.version}`,
        to: `${to.identity.tenant}/${to.identity.taskId}@${to.version}`,
      },
    });
  }
  if (from.version === to.version && from.digest === to.digest) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIFF, {
      message: 'cannot diff a task version with itself (identical version + digest)',
      details: { version: from.version, digest: from.digest },
    });
  }
  const changed: string[] = [];
  const { digest: _fromDigest, ...fromView } = from;
  const { digest: _toDigest, ...toView } = to;
  collectChangedPaths(fromView, toView, '', changed);
  changed.sort();
  return Object.freeze({
    diffVersion: TASK_DIFF_VERSION,
    from: taskVersionRefOf(from),
    to: taskVersionRefOf(to),
    changedFields: Object.freeze([...changed]),
  });
}

/** True iff the diff changed NOTHING except identity/version/supersedes. */
export function isIdentityOnlyDiff(diff: TaskDiff): boolean {
  return diff.changedFields.every((path) =>
    path === 'version' ||
    path === 'supersedes' ||
    path.startsWith('supersedes.'),
  );
}
