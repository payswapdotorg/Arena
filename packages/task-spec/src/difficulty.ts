/**
 * Task difficulty (Work Order A008; spec/task-spec.md TS1.0 "difficulty";
 * the guards requirement: "difficulty in a declared scale").
 *
 * Difficulty is NEVER a bare string: a TaskSpec declares its difficulty as
 * (scale, class) where the scale is a CLOSED one-member vocabulary —
 * `arena:task-difficulty@1` — whose classes are the A005
 * capability-case task-difficulty vocabulary (exploratory | standard |
 * routine; packages/capability-case/src/requirements.ts
 * TASK_DIFFICULTY_LEVELS). Keeping the class vocabulary identical to the
 * case-level requirement vocabulary is what lets the compiler derive task
 * difficulty from case difficulty deterministically, and the declared
 * scale is what lets any consumer reject difficulty expressed in a scale
 * it does not understand.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';

/** The CLOSED difficulty-scale vocabulary (one member at TS1.0). */
export const TASK_DIFFICULTY_SCALES = Object.freeze([
  'arena:task-difficulty@1',
] as const);

export type TaskDifficultyScale = (typeof TASK_DIFFICULTY_SCALES)[number];

/** The difficulty classes of the arena:task-difficulty@1 scale (A005 vocabulary). */
export const TASK_DIFFICULTY_CLASSES = Object.freeze([
  'exploratory',
  'standard',
  'routine',
] as const);

export type TaskDifficultyClass = (typeof TASK_DIFFICULTY_CLASSES)[number];

export function isTaskDifficultyScale(value: unknown): value is TaskDifficultyScale {
  return (
    typeof value === 'string' &&
    (TASK_DIFFICULTY_SCALES as readonly string[]).includes(value)
  );
}

export function isTaskDifficultyClass(value: unknown): value is TaskDifficultyClass {
  return (
    typeof value === 'string' &&
    (TASK_DIFFICULTY_CLASSES as readonly string[]).includes(value)
  );
}

/** A declared difficulty: a scale + a class IN that scale. */
export interface TaskDifficultyDeclaration {
  readonly scale: TaskDifficultyScale;
  readonly class: TaskDifficultyClass;
}

export function isTaskDifficultyDeclaration(
  value: unknown,
): value is TaskDifficultyDeclaration {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isTaskDifficultyScale(candidate['scale']) && isTaskDifficultyClass(candidate['class']);
}

/** Validate a difficulty declaration; throws INVALID_DIFFICULTY otherwise. */
export function toTaskDifficultyDeclaration(value: {
  scale: string;
  class: string;
}): TaskDifficultyDeclaration {
  if (!isTaskDifficultyScale(value.scale)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY, {
      message: `unknown difficulty scale: ${JSON.stringify(value.scale)} (known: ${TASK_DIFFICULTY_SCALES.join(', ')}) — difficulty must be declared in a known scale`,
      details: { known: [...TASK_DIFFICULTY_SCALES] },
    });
  }
  if (!isTaskDifficultyClass(value.class)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY, {
      message: `unknown difficulty class for scale ${value.scale}: ${JSON.stringify(value.class)} (known: ${TASK_DIFFICULTY_CLASSES.join(', ')})`,
      details: { scale: value.scale, known: [...TASK_DIFFICULTY_CLASSES] },
    });
  }
  return Object.freeze({ scale: value.scale, class: value.class });
}
