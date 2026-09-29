/**
 * TaskSpec expert-qualification requirements (Work Order A008;
 * spec/task-spec.md TS1.0 "expert qualification requirements").
 *
 * The shape references the A007 expert-qualification protocol
 * (packages/expert-qualification): the required COMPETENCIES are
 * capability-graph node refs (the same node kinds A007 CompetencyClaims
 * claim on — capability/sub-capability/skill), the OPTIONAL qualification
 * policy ref is the A007 QualificationPolicy identity triple
 * (policyId/version/digest — see shared.ts QualificationPolicyRefView),
 * and the EXPECTATIONS are prose statements of what qualification the
 * task's experts must show. Qualification remains DATA about evidence,
 * never an access grant (lock rule 9) — this field states what a task
 * needs from experts; it grants nothing.
 */

import { TASK_SPEC_ERROR_CODES, TaskSpecError } from './errors.js';
import {
  isNodeRefView,
  isQualificationPolicyRefView,
  toNodeRefView,
  toQualificationPolicyRefView,
  toStatementList,
} from './shared.js';
import type {
  NodeRefView,
  QualificationPolicyRefView,
} from './shared.js';

/** The node kinds a required competency may reference (A007 claim targets). */
export const COMPETENCY_NODE_KINDS = Object.freeze([
  'capability',
  'sub-capability',
  'skill',
] as const);

/** Stable field list (tests + contracts mirror it). */
export const TASK_EXPERT_QUALIFICATION_FIELDS = Object.freeze([
  'competencies',
  'qualificationPolicy',
  'expectations',
] as const) as readonly string[];

/** What a task requires from experts (A007-shaped; data, never a grant). */
export interface TaskExpertQualificationRequirements {
  /** Required expert competencies (graph nodes; >= 1). */
  readonly competencies: readonly NodeRefView[];
  /** The A007 qualification policy the experts are qualified under (optional). */
  readonly qualificationPolicy: QualificationPolicyRefView | null;
  /** Qualification expectation statements (>= 1). */
  readonly expectations: readonly string[];
}

export function isTaskExpertQualificationRequirements(
  value: unknown,
): value is TaskExpertQualificationRequirements {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Array.isArray(candidate['competencies']) ||
    candidate['competencies'].length === 0 ||
    !candidate['competencies'].every((ref) => isNodeRefView(ref))
  ) {
    return false;
  }
  if (
    candidate['qualificationPolicy'] !== null &&
    !isQualificationPolicyRefView(candidate['qualificationPolicy'])
  ) {
    return false;
  }
  return (
    Array.isArray(candidate['expectations']) &&
    candidate['expectations'].length > 0 &&
    candidate['expectations'].every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  );
}

/** Validate and freeze expert-qualification requirements; typed error otherwise. */
export function toTaskExpertQualificationRequirements(value: {
  competencies: readonly {
    kind: string;
    id: string;
    version: string;
    digest: string;
  }[];
  qualificationPolicy?: { policyId: string; version: string; digest: string } | null;
  expectations: readonly string[];
}): TaskExpertQualificationRequirements {
  if (!Array.isArray(value.competencies) || value.competencies.length === 0) {
    throw new TaskSpecError(TASK_SPEC_ERROR_CODES.INVALID_REQUIREMENTS, {
      message:
        'task expert-qualification requirements need at least one competency reference (capability/sub-capability/skill node)',
      details: { kinds: [...COMPETENCY_NODE_KINDS] },
    });
  }
  const competencies = Object.freeze(
    value.competencies.map((ref) => toNodeRefView(ref, [...COMPETENCY_NODE_KINDS])),
  );
  const qualificationPolicy =
    value.qualificationPolicy === undefined || value.qualificationPolicy === null
      ? null
      : toQualificationPolicyRefView(value.qualificationPolicy);
  const expectations = toStatementList(
    value.expectations,
    'expectations',
    1,
    TASK_SPEC_ERROR_CODES.INVALID_REQUIREMENTS,
    'task expert-qualification requirements',
  );
  return Object.freeze({ competencies, qualificationPolicy, expectations });
}
