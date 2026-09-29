/**
 * Vendored deep-freeze for @arena/workbench view-models (Work Order
 * A017), replicating the control-ui (A018) vendored copy, which itself
 * follows the repo convention: every package vendors the tiny structural
 * helpers it needs (see the `deepFreeze` copies in capability-case,
 * agent-body, job-protocol, environment-protocol and capability-graph);
 * cross-package runtime imports are reserved for protocol primitives.
 *
 * Like the control-ui copy, this version walks the children of
 * ALREADY-FROZEN containers, because a workbench corpus aggregates
 * domain records whose constructors freeze some containers before their
 * elements — the read-only guarantee requires every reachable object
 * frozen.
 */

/** Recursively freeze a value (arrays and plain objects); return it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    // Walk children even when the array itself is already frozen: a frozen
    // container may still hold unfrozen elements (domain constructors
    // freeze containers first in places).
    for (const item of value) deepFreeze(item);
    return Object.freeze(value);
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

/** True iff a value is deep-frozen (every reachable object is frozen). */
export function isDeepFrozen(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (typeof value !== 'object' || value === null) return true;
  if (seen.has(value)) return true; // reference cycles: assume frozen
  if (!Object.isFrozen(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.every((item) => isDeepFrozen(item, seen));
  }
  return Object.values(value as Record<string, unknown>).every(
    (item) => isDeepFrozen(item, seen),
  );
}
