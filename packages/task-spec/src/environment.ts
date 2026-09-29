/**
 * TaskSpec environment requirements + initial state reference (Work Order
 * A008; spec/task-spec.md TS1.0 "environment requirements; initial state
 * reference"; docs/architecture.md §7 — a versioned executable world).
 *
 * ENV1.0-shaped declarations (A009): the required environments are
 * content-addressed ENVIRONMENT DECLARATION refs (the A009
 * EnvironmentVersionRef / A005 VersionedArtifactRefView shape:
 * namespace/name/version/digest — see shared.ts ArtifactRefView), plus
 * explicit constraint statements. The INITIAL STATE REFERENCE pins the
 * ONE environment version the task starts in, its seed (when the
 * environment is seeded — reproducibility) and an optional note.
 *
 * Cross-field consistency (enforced by guards.ts): the pinned
 * initial-state environment MUST be one of the required environment
 * declarations — a task cannot start in a world it does not require.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isArtifactRefView,
  toArtifactRefView,
  toStatementList,
} from './shared.js';
import type { ArtifactRefView } from './shared.js';

/** Stable field list for task environment requirements. */
export const TASK_ENVIRONMENT_REQUIREMENTS_FIELDS = Object.freeze([
  'environments',
  'constraints',
] as const) as readonly string[];

/** What the task requires of its execution environment (ENV1.0-shaped). */
export interface TaskEnvironmentRequirements {
  /** Required environment declarations (content-addressed refs; >= 1). */
  readonly environments: readonly ArtifactRefView[];
  /** Environment constraint statements (may be empty). */
  readonly constraints: readonly string[];
}

export function isTaskEnvironmentRequirements(
  value: unknown,
): value is TaskEnvironmentRequirements {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['environments']) &&
    candidate['environments'].length > 0 &&
    candidate['environments'].every((ref) => isArtifactRefView(ref)) &&
    Array.isArray(candidate['constraints']) &&
    candidate['constraints'].every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  );
}

/** Validate and freeze task environment requirements; typed error otherwise. */
export function toTaskEnvironmentRequirements(value: {
  environments: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  constraints?: readonly string[];
}): TaskEnvironmentRequirements {
  if (!Array.isArray(value.environments) || value.environments.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT, {
      message:
        'task environment requirements need at least one content-addressed ENV1.0 environment declaration ref',
    });
  }
  const environments = Object.freeze(value.environments.map((ref) => toArtifactRefView(ref)));
  const constraints = toStatementList(
    value.constraints ?? [],
    'constraints',
    0,
    TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT,
    'task environment requirements',
  );
  return deepFreeze({ environments, constraints });
}

// ---------------------------------------------------------------------------
// Initial state reference (TS1.0 "initial state reference")
// ---------------------------------------------------------------------------

/** Stable field list for the initial state reference. */
export const TASK_INITIAL_STATE_FIELDS = Object.freeze([
  'environment',
  'seed',
  'note',
] as const) as readonly string[];

/**
 * The pinned initial state of a task attempt: the ONE environment
 * declaration version the attempt starts in, the seed pinned for
 * reproducibility (null when the environment's own seed policy applies),
 * and an optional note (e.g. snapshot semantics).
 */
export interface TaskInitialStateRef {
  readonly environment: ArtifactRefView;
  readonly seed: string | null;
  readonly note: string | null;
}

export function isTaskInitialStateRef(value: unknown): value is TaskInitialStateRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isArtifactRefView(candidate['environment']) &&
    (candidate['seed'] === null || typeof candidate['seed'] === 'string') &&
    (candidate['note'] === null ||
      (typeof candidate['note'] === 'string' && candidate['note'].length > 0))
  );
}

/** Validate and freeze an initial state reference; typed error otherwise. */
export function toTaskInitialStateRef(value: {
  environment: { namespace: string; name: string; version: string; digest: string };
  seed?: string | null;
  note?: string | null;
}): TaskInitialStateRef {
  const record = expectFields(
    value,
    ['environment'],
    ['seed', 'note'],
    TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT,
    'task initial state reference',
  );
  const environment = record['environment'];
  const seed = record['seed'] ?? null;
  const note = record['note'] ?? null;
  if (seed !== null && (typeof seed !== 'string' || seed.length === 0)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT, {
      message: 'initial state seed, when present, must be a non-empty string (the pinned reproducibility seed)',
    });
  }
  if (note !== null && (typeof note !== 'string' || note.length === 0)) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT, {
      message: 'initial state note, when present, must be a non-empty statement',
    });
  }
  return deepFreeze({
    environment: toArtifactRefView(
      environment as { namespace: string; name: string; version: string; digest: string },
    ),
    seed,
    note,
  });
}
