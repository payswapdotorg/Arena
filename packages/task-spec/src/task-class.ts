/**
 * The CLOSED task-class vocabulary (Work Order A008; spec/task-spec.md
 * TS1.0 "Task classes" — the eleven-class vocabulary, verbatim in
 * kebab-case: the spec's "recovery/failure" becomes `recovery-failure`
 * because the id charset is lowercase kebab; documented here as the single
 * mapping decision).
 *
 * Task class is a CLOSED vocabulary: unknown classes are rejected at every
 * construction boundary (spec guards, compilation policy class-selection
 * rules, contract parity). The vocabulary is data about the SHAPE of work
 * a task demands — it grants nothing.
 *
 * Long-horizon discipline (TS1.0 "Long-horizon work"): for the
 * `long-horizon-execution` class, intermediate-state evidence criteria are
 * REQUIRED (see guards.ts); the `recovery-failure` class MAY carry them
 * (recoveries are first-class evidence for failure-recovery work too);
 * every other class MUST NOT.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';

/** The CLOSED eleven-class task vocabulary (TS1.0, verbatim order). */
export const TASK_CLASSES = Object.freeze([
  'demonstration',
  'correction',
  'critique',
  'preference',
  'diagnosis',
  'long-horizon-execution',
  'tool-use',
  'environment-exploration',
  'adversarial',
  'benchmark',
  'recovery-failure',
] as const);

export type TaskClass = (typeof TASK_CLASSES)[number];

export function isTaskClass(value: unknown): value is TaskClass {
  return (
    typeof value === 'string' &&
    (TASK_CLASSES as readonly string[]).includes(value)
  );
}

/** Validate a task class; throws INVALID_CLASS otherwise. */
export function toTaskClass(value: string): TaskClass {
  if (!isTaskClass(value)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_CLASS, {
      message: `unknown task class: ${JSON.stringify(value)} (known: ${TASK_CLASSES.join(', ')})`,
      details: { known: [...TASK_CLASSES] },
    });
  }
  return value;
}

/** Classes for which long-horizon evidence is REQUIRED. */
export const LONG_HORIZON_REQUIRED_CLASSES: readonly TaskClass[] = Object.freeze([
  'long-horizon-execution',
] as const);

/** Classes for which long-horizon evidence is PERMITTED (optional). */
export const LONG_HORIZON_PERMITTED_CLASSES: readonly TaskClass[] = Object.freeze([
  'recovery-failure',
] as const);

/** True iff the class REQUIRES long-horizon evidence (intermediate state + recoveries). */
export function requiresLongHorizonEvidence(taskClass: TaskClass): boolean {
  return LONG_HORIZON_REQUIRED_CLASSES.includes(taskClass);
}

/** True iff the class MAY carry long-horizon evidence. */
export function permitsLongHorizonEvidence(taskClass: TaskClass): boolean {
  return (
    requiresLongHorizonEvidence(taskClass) ||
    LONG_HORIZON_PERMITTED_CLASSES.includes(taskClass)
  );
}
