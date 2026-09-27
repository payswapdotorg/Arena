/**
 * Case requirement objects (Work Order A005; docs/architecture.md §5;
 * spec CC1.0 required fields "observed failure/opportunity", "expert
 * requirement", "environment requirement", "task requirement", "evaluator
 * requirement", "verifier requirement", "unknowns", "desired outcome").
 *
 * A Capability Case is the BRIDGE from observed failure to capability
 * development: every requirement object below is the case-level REQUIREMENT
 * the future TaskSpec compiler (A008) flattens into reproducible task
 * specifications. This package defines the typed data contract ONLY — no
 * compiler logic lives here (gate 7 of the A005 dispatch).
 *
 * Distinctness rules encoded in types:
 *   - evaluation and verification are SEPARATE, separately-required objects
 *     (architecture-lock rule 7);
 *   - expert requirements reference expert-competency graph nodes; evaluator
 *     and verifier requirements reference their dedicated graph node kinds;
 *   - environment requirements reference content-addressed environment
 *     declarations (A009 views) plus explicit constraint statements;
 *   - task requirements carry the TaskSpec §6 vocabulary (objectives,
 *     constraints, allowed tools, forbidden shortcuts, success conditions,
 *     evidence criteria, difficulty) as case-level requirements.
 *
 * All objects are pure data: creation validates and DEEP-FREEZES; no
 * mutation API exists.
 */

import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';
import { isCapabilityCaseTimestamp, toCapabilityCaseTimestamp } from './timestamp.js';
import type { CapabilityCaseTimestamp } from './timestamp.js';
import {
  deepFreeze,
  isCapabilityNodeRefView,
  isVersionedArtifactRefView,
  toCapabilityNodeRefView,
  toVersionedArtifactRefView,
} from './shared.js';
import type {
  CapabilityNodeRefView,
  VersionedArtifactRefView,
} from './shared.js';

/** Fail with a structured INVALID_REQUIREMENTS error naming the field group. */
function invalid(field: string, message: string): never {
  throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_REQUIREMENTS, {
    message,
    details: { field },
  });
}

// ---------------------------------------------------------------------------
// Observed failure record (spec CC1.0: "observed failure/opportunity")
// ---------------------------------------------------------------------------

/**
 * The recorded observation that motivated the case: what was observed, when,
 * how it can be reproduced, and (once clustered) the capability-graph
 * observed-failure node it maps to (spec CC1.0 "Failure clusters": multiple
 * observations may map to a FailureCluster; changing a hypothesis never
 * deletes the original observations — lock rule 6).
 */
export interface ObservedFailureRecord {
  /** What was observed (non-empty prose). */
  readonly summary: string;
  /** When the failure/opportunity was observed (UTC, ms precision). */
  readonly observedAt: CapabilityCaseTimestamp;
  /** How to reproduce the observation (optional prose). */
  readonly reproduction?: string;
  /**
   * The capability-graph observed-failure node (the FailureCluster) this
   * observation maps to, when the mapping has been made.
   */
  readonly failureNode?: CapabilityNodeRefView;
}

export function isObservedFailureRecord(
  value: unknown,
): value is ObservedFailureRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['summary'] !== 'string' ||
    candidate['summary'].length === 0 ||
    !isCapabilityCaseTimestamp(candidate['observedAt'])
  ) {
    return false;
  }
  if (
    candidate['reproduction'] !== undefined &&
    (typeof candidate['reproduction'] !== 'string' ||
      candidate['reproduction'].length === 0)
  ) {
    return false;
  }
  if (
    candidate['failureNode'] !== undefined &&
    !isCapabilityNodeRefView(candidate['failureNode'])
  ) {
    return false;
  }
  return true;
}

/** Validate and freeze an observed failure record; throws INVALID_REQUIREMENTS otherwise. */
export function toObservedFailureRecord(value: {
  summary: string;
  observedAt: string;
  reproduction?: string;
  failureNode?: {
    kind: string;
    id: string;
    version: string;
    digest: string;
  };
}): ObservedFailureRecord {
  if (typeof value.summary !== 'string' || value.summary.length === 0) {
    invalid(
      'observedFailure',
      `observed failure record requires a non-empty summary: ${JSON.stringify(value.summary)}`,
    );
  }
  const observedAt = toCapabilityCaseTimestamp(value.observedAt);
  if (
    value.reproduction !== undefined &&
    (typeof value.reproduction !== 'string' || value.reproduction.length === 0)
  ) {
    invalid(
      'observedFailure',
      'observed failure reproduction, when present, must be a non-empty statement',
    );
  }
  const failureNode =
    value.failureNode === undefined
      ? undefined
      : toCapabilityNodeRefView(value.failureNode, ['observed-failure']);
  const record: ObservedFailureRecord = deepFreeze({
    summary: value.summary,
    observedAt,
    ...(value.reproduction !== undefined ? { reproduction: value.reproduction } : {}),
    ...(failureNode !== undefined ? { failureNode } : {}),
  });
  return record;
}

// ---------------------------------------------------------------------------
// Expert requirements (spec CC1.0: "expert requirement")
// ---------------------------------------------------------------------------

/**
 * What kind of expert the case needs: the competency graph nodes required
 * (at least one), the qualification expectations (prose; qualification is a
 * separate concern from system authority — lock rule 9), and an optional
 * statement of availability/jurisdiction needs.
 */
export interface ExpertRequirements {
  /** Required expert competencies (capability-graph expert-competency nodes, >= 1). */
  readonly competencies: readonly CapabilityNodeRefView[];
  /** Qualification expectations (prose statements, may be empty). */
  readonly qualifications: readonly string[];
  /** Availability / domain / jurisdiction expectations, when relevant. */
  readonly availability?: string;
}

export function isExpertRequirements(value: unknown): value is ExpertRequirements {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate['competencies']) ||
    candidate['competencies'].length === 0 ||
    !candidate['competencies'].every((ref) => isCapabilityNodeRefView(ref))
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['qualifications']) ||
    !candidate['qualifications'].every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  ) {
    return false;
  }
  if (
    candidate['availability'] !== undefined &&
    (typeof candidate['availability'] !== 'string' ||
      candidate['availability'].length === 0)
  ) {
    return false;
  }
  return true;
}

/** Validate and freeze expert requirements; throws INVALID_REQUIREMENTS otherwise. */
export function toExpertRequirements(value: {
  competencies: readonly {
    kind: string;
    id: string;
    version: string;
    digest: string;
  }[];
  qualifications?: readonly string[];
  availability?: string;
}): ExpertRequirements {
  if (!Array.isArray(value.competencies) || value.competencies.length === 0) {
    invalid(
      'expertRequirements',
      'expert requirements require at least one competency reference',
    );
  }
  const competencies = Object.freeze(
    value.competencies.map((ref) =>
      toCapabilityNodeRefView(ref, ['expert-competency']),
    ),
  );
  const qualifications = Object.freeze(
    (value.qualifications ?? []).map((entry) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        invalid(
          'expertRequirements',
          `expert qualification statements must be non-empty strings: ${JSON.stringify(entry)}`,
        );
      }
      return entry;
    }),
  );
  if (
    value.availability !== undefined &&
    (typeof value.availability !== 'string' || value.availability.length === 0)
  ) {
    invalid(
      'expertRequirements',
      'expert availability, when present, must be a non-empty statement',
    );
  }
  const requirements: ExpertRequirements = deepFreeze({
    competencies,
    qualifications,
    ...(value.availability !== undefined ? { availability: value.availability } : {}),
  });
  return requirements;
}

// ---------------------------------------------------------------------------
// Environment requirements (spec CC1.0: "environment requirement")
// ---------------------------------------------------------------------------

/**
 * What the case needs from an execution environment: content-addressed
 * environment declarations (ENV1.0 references — A009 views) plus explicit
 * constraint statements. The environment protocol owns declaration
 * semantics; this package only references (lock rule 16: one
 * responsibility, one authority).
 */
export interface EnvironmentRequirements {
  /** Required environment declarations (content-addressed refs, >= 1). */
  readonly environments: readonly VersionedArtifactRefView[];
  /** Environment constraint statements (may be empty). */
  readonly constraints: readonly string[];
}

export function isEnvironmentRequirements(
  value: unknown,
): value is EnvironmentRequirements {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate['environments']) ||
    candidate['environments'].length === 0 ||
    !candidate['environments'].every((ref) => isVersionedArtifactRefView(ref))
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['constraints']) ||
    !candidate['constraints'].every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  ) {
    return false;
  }
  return true;
}

/** Validate and freeze environment requirements; throws INVALID_REQUIREMENTS otherwise. */
export function toEnvironmentRequirements(value: {
  environments: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  constraints?: readonly string[];
}): EnvironmentRequirements {
  if (!Array.isArray(value.environments) || value.environments.length === 0) {
    invalid(
      'environmentRequirements',
      'environment requirements require at least one content-addressed environment declaration reference',
    );
  }
  const environments = Object.freeze(
    value.environments.map((ref) => toVersionedArtifactRefView(ref)),
  );
  const constraints = Object.freeze(
    (value.constraints ?? []).map((entry) => {
      if (typeof entry !== 'string' || entry.length === 0) {
        invalid(
          'environmentRequirements',
          `environment constraint statements must be non-empty strings: ${JSON.stringify(entry)}`,
        );
      }
      return entry;
    }),
  );
  const requirements: EnvironmentRequirements = deepFreeze({
    environments,
    constraints,
  });
  return requirements;
}

// ---------------------------------------------------------------------------
// Task requirements (spec CC1.0: "task requirement"; TaskSpec §6 vocabulary)
// ---------------------------------------------------------------------------

/** Task difficulty classes (case-level requirement; classification only). */
export const TASK_DIFFICULTY_LEVELS = [
  'exploratory',
  'standard',
  'routine',
] as const;

export type TaskDifficulty = (typeof TASK_DIFFICULTY_LEVELS)[number];

export function isTaskDifficulty(value: unknown): value is TaskDifficulty {
  return (
    typeof value === 'string' &&
    (TASK_DIFFICULTY_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * What the case requires of the TASKS compiled from it, in the TaskSpec §6
 * vocabulary: objectives, constraints, allowed tools, forbidden shortcuts,
 * success conditions, evidence criteria and difficulty. The A008 compiler
 * flattens these into TaskSpecs; this object is the requirement SOURCE, not
 * a compiled task.
 */
export interface TaskRequirements {
  /** What the compiled tasks must achieve (>= 1 statement). */
  readonly objectives: readonly string[];
  /** Hard constraints on task design (may be empty). */
  readonly constraints: readonly string[];
  /** Tools the tasks may use (content-addressed tool refs; may be empty). */
  readonly allowedTools: readonly VersionedArtifactRefView[];
  /** Shortcuts the tasks must forbid (may be empty). */
  readonly forbiddenShortcuts: readonly string[];
  /** Conditions under which a task attempt counts as successful (>= 1). */
  readonly successConditions: readonly string[];
  /** What counts as task evidence (>= 1 statement). */
  readonly evidenceCriteria: readonly string[];
  /** Required difficulty class of the compiled tasks. */
  readonly difficulty: TaskDifficulty;
}

export function isTaskRequirements(value: unknown): value is TaskRequirements {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const everyNonEmptyString = (entry: unknown): boolean =>
    typeof entry === 'string' && entry.length > 0;
  if (
    !Array.isArray(candidate['objectives']) ||
    candidate['objectives'].length === 0 ||
    !candidate['objectives'].every(everyNonEmptyString)
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['constraints']) ||
    !candidate['constraints'].every(everyNonEmptyString)
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['allowedTools']) ||
    !candidate['allowedTools'].every((ref) => isVersionedArtifactRefView(ref))
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['forbiddenShortcuts']) ||
    !candidate['forbiddenShortcuts'].every(everyNonEmptyString)
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['successConditions']) ||
    candidate['successConditions'].length === 0 ||
    !candidate['successConditions'].every(everyNonEmptyString)
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['evidenceCriteria']) ||
    candidate['evidenceCriteria'].length === 0 ||
    !candidate['evidenceCriteria'].every(everyNonEmptyString)
  ) {
    return false;
  }
  return isTaskDifficulty(candidate['difficulty']);
}

/** Validate and freeze task requirements; throws INVALID_REQUIREMENTS otherwise. */
export function toTaskRequirements(value: {
  objectives: readonly string[];
  constraints?: readonly string[];
  allowedTools?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  forbiddenShortcuts?: readonly string[];
  successConditions: readonly string[];
  evidenceCriteria: readonly string[];
  difficulty: string;
}): TaskRequirements {
  const strings = (
    entries: readonly string[] | undefined,
    field: string,
    minCount: 0 | 1,
  ): readonly string[] => {
    const list = entries ?? [];
    if (list.length < minCount) {
      invalid(
        'taskRequirements',
        `task requirements field ${JSON.stringify(field)} requires at least ${minCount} statement(s)`,
      );
    }
    return Object.freeze(
      list.map((entry) => {
        if (typeof entry !== 'string' || entry.length === 0) {
          invalid(
            'taskRequirements',
            `task requirements field ${JSON.stringify(field)} must contain non-empty statements: ${JSON.stringify(entry)}`,
          );
        }
        return entry;
      }),
    );
  };
  const objectives = strings(value.objectives, 'objectives', 1);
  const constraints = strings(value.constraints, 'constraints', 0);
  const forbiddenShortcuts = strings(value.forbiddenShortcuts, 'forbiddenShortcuts', 0);
  const successConditions = strings(value.successConditions, 'successConditions', 1);
  const evidenceCriteria = strings(value.evidenceCriteria, 'evidenceCriteria', 1);
  const allowedTools = Object.freeze(
    (value.allowedTools ?? []).map((ref) => toVersionedArtifactRefView(ref)),
  );
  if (!isTaskDifficulty(value.difficulty)) {
    invalid(
      'taskRequirements',
      `unknown task difficulty: ${JSON.stringify(value.difficulty)} (known: ${TASK_DIFFICULTY_LEVELS.join(', ')})`,
    );
  }
  const requirements: TaskRequirements = deepFreeze({
    objectives,
    constraints,
    allowedTools,
    forbiddenShortcuts,
    successConditions,
    evidenceCriteria,
    difficulty: value.difficulty,
  });
  return requirements;
}

// ---------------------------------------------------------------------------
// Evaluation and verification requirements (lock rule 7: distinct)
// ---------------------------------------------------------------------------

/**
 * What the case requires of EVALUATION (judging performance against
 * criteria): the evaluator bindings (capability-graph evaluator nodes) and
 * the evaluation criteria. Evaluation and verification are distinct
 * responsibilities — one cannot substitute for the other (lock rule 7).
 */
export interface EvaluationRequirements {
  /** Evaluator bindings (capability-graph evaluator nodes, >= 1). */
  readonly evaluators: readonly CapabilityNodeRefView[];
  /** Evaluation criteria statements (>= 1). */
  readonly criteria: readonly string[];
}

export function isEvaluationRequirements(
  value: unknown,
): value is EvaluationRequirements {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate['evaluators']) ||
    candidate['evaluators'].length === 0 ||
    !candidate['evaluators'].every((ref) => isCapabilityNodeRefView(ref))
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['criteria']) ||
    candidate['criteria'].length === 0 ||
    !candidate['criteria'].every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  ) {
    return false;
  }
  return true;
}

/** Validate and freeze evaluation requirements; throws INVALID_REQUIREMENTS otherwise. */
export function toEvaluationRequirements(value: {
  evaluators: readonly {
    kind: string;
    id: string;
    version: string;
    digest: string;
  }[];
  criteria: readonly string[];
}): EvaluationRequirements {
  if (!Array.isArray(value.evaluators) || value.evaluators.length === 0) {
    invalid(
      'evaluationRequirements',
      'evaluation requirements require at least one evaluator binding',
    );
  }
  const evaluators = Object.freeze(
    value.evaluators.map((ref) => toCapabilityNodeRefView(ref, ['evaluator'])),
  );
  if (
    !Array.isArray(value.criteria) ||
    value.criteria.length === 0 ||
    !value.criteria.every((entry) => typeof entry === 'string' && entry.length > 0)
  ) {
    invalid(
      'evaluationRequirements',
      'evaluation requirements require at least one criterion statement',
    );
  }
  const requirements: EvaluationRequirements = deepFreeze({
    evaluators,
    criteria: Object.freeze([...value.criteria]),
  });
  return requirements;
}

/**
 * What the case requires of VERIFICATION (establishing evidence/proof): the
 * verifier bindings (capability-graph verifier nodes) and the evidence
 * standards the proof must meet.
 */
export interface VerificationRequirements {
  /** Verifier bindings (capability-graph verifier nodes, >= 1). */
  readonly verifiers: readonly CapabilityNodeRefView[];
  /** Evidence standards the verification must establish (>= 1 statement). */
  readonly evidenceStandards: readonly string[];
}

export function isVerificationRequirements(
  value: unknown,
): value is VerificationRequirements {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate['verifiers']) ||
    candidate['verifiers'].length === 0 ||
    !candidate['verifiers'].every((ref) => isCapabilityNodeRefView(ref))
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['evidenceStandards']) ||
    candidate['evidenceStandards'].length === 0 ||
    !candidate['evidenceStandards'].every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  ) {
    return false;
  }
  return true;
}

/** Validate and freeze verification requirements; throws INVALID_REQUIREMENTS otherwise. */
export function toVerificationRequirements(value: {
  verifiers: readonly {
    kind: string;
    id: string;
    version: string;
    digest: string;
  }[];
  evidenceStandards: readonly string[];
}): VerificationRequirements {
  if (!Array.isArray(value.verifiers) || value.verifiers.length === 0) {
    invalid(
      'verificationRequirements',
      'verification requirements require at least one verifier binding',
    );
  }
  const verifiers = Object.freeze(
    value.verifiers.map((ref) => toCapabilityNodeRefView(ref, ['verifier'])),
  );
  if (
    !Array.isArray(value.evidenceStandards) ||
    value.evidenceStandards.length === 0 ||
    !value.evidenceStandards.every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  ) {
    invalid(
      'verificationRequirements',
      'verification requirements require at least one evidence-standard statement',
    );
  }
  const requirements: VerificationRequirements = deepFreeze({
    verifiers,
    evidenceStandards: Object.freeze([...value.evidenceStandards]),
  });
  return requirements;
}
