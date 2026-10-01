/**
 * Reference projections for the RC1.0 same-object / different-lens rule:
 * ONE canonical Capability Case, FIVE role lenses (Owner, Expert, Builder,
 * Researcher, Operator — RC1.0 "Same-object / different-lens rule").
 *
 *   Owner view:      "Why is my agent struggling?"
 *   Expert view:     "What work am I being asked to perform?"
 *   Builder view:    "What capability is missing from the Body?"
 *   Researcher view: "What evidence supports the capability hypothesis?"
 *   Operator view:   "Is the workflow/job healthy?"
 *
 * The object is shared; the projection is role-specific.
 *
 * DISCLOSURE (B003 design choice, per the work-order brief): the canonical
 * input here is CapabilityCaseView — a NARROW structural VIEW type owned by
 * this package, NOT the @arena/capability-case domain model. The projection
 * layer is about the LENS, not the domain internals; the read model (B005)
 * is expected to map canonical case records into this view. Field semantics
 * deliberately mirror the public case vocabulary (target capability,
 * observed failure, desired outcome, evidence, uncertainty, current body
 * version, substrate, expert assignment, task progress, job health) without
 * importing the domain package.
 *
 * Every lens is a PURE selector over the view: deterministic, no clock, no
 * I/O. All five lenses carry the SAME canonical object identity — the
 * same-object rule made structural.
 */

import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import { countStateKinds } from '../states/canonical-state.js';
import { toTenantId } from '../shared.js';
import type { CanonicalStateKind } from '../shared.js';
import {
  applyRoleProjection,
  defineRoleProjection,
  roleProjectionRecord,
} from './projection.js';
import type {
  CanonicalObjectIdentity,
  RoleProjection,
  RoleProjectionDefinition,
} from './projection.js';

// ---------------------------------------------------------------------------
// The canonical input view (narrow structural VIEW, see disclosure above)
// ---------------------------------------------------------------------------

/** One evidence item attached to the case, classified by product truth. */
export interface CaseEvidenceItemView {
  readonly evidenceId: string;
  readonly stateKind: CanonicalStateKind;
}

/** Job/workflow health of the case's execution (Operator concern). */
export type CaseJobHealth = 'healthy' | 'degraded' | 'incident';

/** Case uncertainty band (Researcher concern). */
export type CaseUncertainty = 'low' | 'medium' | 'high';

/**
 * A narrow view of ONE canonical Capability Case — everything the five
 * reference lenses select from. `kind` is the closed canonical kind
 * discriminator ('capability-case').
 */
export interface CapabilityCaseView {
  readonly kind: 'capability-case';
  readonly tenant: string;
  /** The case id in canonical object identity form (same-object anchor). */
  readonly objectId: string;
  readonly version: string;
  /** Lifecycle status label (opaque to this package — owned by the case domain). */
  readonly status: string;
  readonly targetCapability: string;
  readonly domain?: string;
  readonly observedFailure: string;
  readonly desiredOutcome: string;
  readonly uncertainty: CaseUncertainty;
  readonly evidence: readonly CaseEvidenceItemView[];
  readonly currentBodyVersion?: string;
  readonly substrate?: string;
  readonly missingCapabilities: readonly string[];
  readonly assignedExpertId?: string;
  readonly openTaskCount: number;
  readonly resolvedTaskCount: number;
  readonly jobHealth: CaseJobHealth;
  readonly lastEvaluation?: {
    readonly result: 'pass' | 'fail';
    readonly score?: number;
    readonly stateKind: CanonicalStateKind;
  };
}

function caseIdentity(view: CapabilityCaseView): CanonicalObjectIdentity {
  // applyRoleProjection validated this identity BEFORE the lens runs; the
  // toTenantId call re-asserts the tenant scope (cheap, pure, fail-closed).
  return {
    kind: 'capability-case',
    tenant: toTenantId(view.tenant),
    objectId: view.objectId,
    version: view.version,
  };
}

function evidenceKinds(view: CapabilityCaseView): readonly CanonicalStateKind[] {
  return view.evidence.map((item) => item.stateKind);
}

// ---------------------------------------------------------------------------
// The five reference lenses (RC1.0 verbatim lens questions)
// ---------------------------------------------------------------------------

/** Owner lens — "Why is my agent struggling?" (outcome/capability-gap view). */
export const CAPABILITY_CASE_OWNER_LENS: RoleProjectionDefinition<CapabilityCaseView, RoleProjection> =
  defineRoleProjection({
    projectionId: 'capability-case.owner-lens',
    roleId: 'owner',
    canonicalKind: 'capability-case',
    projectionKind: 'owner-lens',
    lensQuestion: 'Why is my agent struggling?',
    description:
      'Owner / Customer view of a Capability Case: capability gaps, outcome tracking, body adoption and progress.',
    project: (view: CapabilityCaseView) =>
      roleProjectionRecord({
        projectionId: 'capability-case.owner-lens',
        roleId: 'owner',
        canonical: caseIdentity(view),
        lensQuestion: 'Why is my agent struggling?',
        emphasis: ['capability-inbox', 'active-cases', 'progress-outcomes', 'body-library'],
        recommendedActions: [
          view.currentBodyVersion === undefined
            ? 'Match a Body Version to this case to start capability development.'
            : `Inspect adopted body ${view.currentBodyVersion} in the body library.`,
          view.openTaskCount > 0
            ? `Review progress: ${String(view.openTaskCount)} open task(s), ${String(view.resolvedTaskCount)} resolved.`
            : 'No open tasks — review the outcome against the desired result.',
          view.uncertainty === 'high'
            ? 'Uncertainty is high: consider procuring expert support.'
            : 'Track outcome against the desired capability.',
        ],
        payload: {
          capabilityGap: {
            target: view.targetCapability,
            missing: [...view.missingCapabilities],
          },
          outcome: view.desiredOutcome,
          struggle: {
            observedFailure: view.observedFailure,
            uncertainty: view.uncertainty,
          },
          bodyAdoption: view.currentBodyVersion ?? 'none',
          progress: {
            openTasks: view.openTaskCount,
            resolvedTasks: view.resolvedTaskCount,
            status: view.status,
          },
        },
      }),
  });

/** Expert lens — "What work am I being asked to perform?" (work view). */
export const CAPABILITY_CASE_EXPERT_LENS: RoleProjectionDefinition<CapabilityCaseView, RoleProjection> =
  defineRoleProjection({
    projectionId: 'capability-case.expert-lens',
    roleId: 'expert',
    canonicalKind: 'capability-case',
    projectionKind: 'expert-lens',
    lensQuestion: 'What work am I being asked to perform?',
    description:
      'Expert view of a Capability Case: requested work, workbench environment, evidence to produce and review.',
    project: (view: CapabilityCaseView) =>
      roleProjectionRecord({
        projectionId: 'capability-case.expert-lens',
        roleId: 'expert',
        canonical: caseIdentity(view),
        lensQuestion: 'What work am I being asked to perform?',
        emphasis: ['assigned-work', 'workbench', 'evidence', 'review'],
        recommendedActions: [
          view.assignedExpertId === undefined
            ? 'This case is unassigned: express availability to take the work.'
            : 'Open the workbench and start the assigned work.',
          `Produce evidence addressing the observed failure: ${view.observedFailure}`,
          view.evidence.length === 0
            ? 'No evidence attached yet: yours may be the first.'
            : `Review ${String(view.evidence.length)} attached evidence item(s) before submitting yours.`,
        ],
        payload: {
          requestedWork: {
            problem: view.observedFailure,
            target: view.targetCapability,
            desiredOutcome: view.desiredOutcome,
          },
          environment: view.substrate ?? 'not-yet-provisioned',
          assignment: view.assignedExpertId ?? 'unassigned',
          reviewQueue: view.evidence.map((item) => item.evidenceId),
          evidenceStateKinds: [...evidenceKinds(view)],
        },
      }),
  });

/** Builder lens — "What capability is missing from the Body?" (composition view). */
export const CAPABILITY_CASE_BUILDER_LENS: RoleProjectionDefinition<CapabilityCaseView, RoleProjection> =
  defineRoleProjection({
    projectionId: 'capability-case.builder-lens',
    roleId: 'agent-builder',
    canonicalKind: 'capability-case',
    projectionKind: 'builder-lens',
    lensQuestion: 'What capability is missing from the Body?',
    description:
      'Agent Builder view of a Capability Case: missing capabilities, body composition, compatibility and certification state.',
    project: (view: CapabilityCaseView) =>
      roleProjectionRecord({
        projectionId: 'capability-case.builder-lens',
        roleId: 'agent-builder',
        canonical: caseIdentity(view),
        lensQuestion: 'What capability is missing from the Body?',
        emphasis: ['body-studio', 'skills', 'compatibility', 'certification'],
        recommendedActions: [
          view.missingCapabilities.length === 0
            ? 'No missing capabilities recorded: verify the case against the current body.'
            : `Compose the missing capability into the body: ${view.missingCapabilities.join(', ')}.`,
          view.currentBodyVersion === undefined
            ? 'No body version bound yet: create one in the Body Studio.'
            : `Fork body ${view.currentBodyVersion} for improvement work.`,
          view.lastEvaluation === undefined
            ? 'No evaluation yet: design one to close the loop.'
            : `Re-run the evaluation (${view.lastEvaluation.result}) after composing the fix.`,
        ],
        payload: {
          bodyVersion: view.currentBodyVersion ?? 'none',
          substrate: view.substrate ?? 'unbound',
          missingCapabilities: [...view.missingCapabilities],
          targetCapability: view.targetCapability,
          certificationState:
            view.lastEvaluation === undefined
              ? 'unevaluated'
              : view.lastEvaluation.result === 'pass'
                ? 'evaluation-passed'
                : 'evaluation-failed',
        },
      }),
  });

/** Researcher lens — "What evidence supports the capability hypothesis?" (evidence view). */
export const CAPABILITY_CASE_RESEARCHER_LENS: RoleProjectionDefinition<CapabilityCaseView, RoleProjection> =
  defineRoleProjection({
    projectionId: 'capability-case.researcher-lens',
    roleId: 'researcher',
    canonicalKind: 'capability-case',
    projectionKind: 'researcher-lens',
    lensQuestion: 'What evidence supports the capability hypothesis?',
    description:
      'Researcher view of a Capability Case: hypothesis, evidence quality by product-truth kind, uncertainty and measurable improvement.',
    project: (view: CapabilityCaseView) =>
      roleProjectionRecord({
        projectionId: 'capability-case.researcher-lens',
        roleId: 'researcher',
        canonical: caseIdentity(view),
        lensQuestion: 'What evidence supports the capability hypothesis?',
        emphasis: ['benchmark-lab', 'experiments', 'datasets', 'research-reports'],
        recommendedActions: [
          `Design an experiment for the hypothesis: ${view.targetCapability} closes ${view.observedFailure}`,
          view.uncertainty === 'high'
            ? 'High uncertainty: gather discriminating evidence before modeling improvement.'
            : 'Quantify improvement with a body × substrate comparison.',
          view.evidence.length === 0
            ? 'Evidence-free hypothesis: attach the first dataset or run.'
            : 'Audit evidence kinds before trusting the improvement signal.',
        ],
        payload: {
          hypothesis: view.targetCapability,
          uncertainty: view.uncertainty,
          evidenceCounts: countStateKinds(view.evidence.map((item) => ({ stateKind: item.stateKind }))),
          evidenceIds: view.evidence.map((item) => item.evidenceId),
          lastEvaluation: view.lastEvaluation ?? null,
          domain: view.domain ?? 'unspecified',
        },
      }),
  });

/** Operator lens — "Is the workflow/job healthy?" (operations view). */
export const CAPABILITY_CASE_OPERATOR_LENS: RoleProjectionDefinition<CapabilityCaseView, RoleProjection> =
  defineRoleProjection({
    projectionId: 'capability-case.operator-lens',
    roleId: 'operator',
    canonicalKind: 'capability-case',
    projectionKind: 'operator-lens',
    lensQuestion: 'Is the workflow/job healthy?',
    description:
      'Operator view of a Capability Case: workflow/job health, environment status, telemetry and quota pressure.',
    project: (view: CapabilityCaseView) =>
      roleProjectionRecord({
        projectionId: 'capability-case.operator-lens',
        roleId: 'operator',
        canonical: caseIdentity(view),
        lensQuestion: 'Is the workflow/job healthy?',
        emphasis: ['jobs', 'environments', 'telemetry', 'incidents'],
        recommendedActions: [
          view.jobHealth === 'incident'
            ? 'Open an incident: the case workflow is unhealthy.'
            : view.jobHealth === 'degraded'
              ? 'Inspect telemetry: the case workflow is degraded.'
              : 'Workflow healthy: monitor SLOs.',
          view.substrate === undefined
            ? 'No substrate bound: environments are not yet provisioned for this case.'
            : `Check environment ${view.substrate} capacity and quotas.`,
          view.openTaskCount > 0
            ? `Watch the ${String(view.openTaskCount)} in-flight task(s) for stalls.`
            : 'No in-flight tasks.',
        ],
        payload: {
          jobHealth: view.jobHealth,
          openTasks: view.openTaskCount,
          resolvedTasks: view.resolvedTaskCount,
          environment: view.substrate ?? 'unbound',
          caseStatus: view.status,
        },
      }),
  });

// ---------------------------------------------------------------------------
// The lens registry + convenience apply
// ---------------------------------------------------------------------------

/**
 * The five RC1.0 reference lenses for capability-case, deterministically
 * ordered by roleId. ONE canonical input, FIVE role-specific outputs.
 */
export const CAPABILITY_CASE_LENSES: readonly RoleProjectionDefinition<CapabilityCaseView, RoleProjection>[] =
  Object.freeze([CAPABILITY_CASE_OWNER_LENS, CAPABILITY_CASE_EXPERT_LENS, CAPABILITY_CASE_BUILDER_LENS, CAPABILITY_CASE_RESEARCHER_LENS, CAPABILITY_CASE_OPERATOR_LENS]);

/**
 * Project a canonical Capability Case through one role's lens. Unknown role
 * → ROLE_NOT_FOUND; a role with no v1 case lens → ROLE_NOT_GRANTED-style
 * typed rejection (INVALID_PROJECTION); wrong canonical kind → rejections
 * raised by applyRoleProjection (CANONICAL_KIND_MISMATCH).
 */
export function projectCapabilityCase(
  view: CapabilityCaseView,
  roleId: string,
): RoleProjection {
  const lens = CAPABILITY_CASE_LENSES.find((entry) => entry.roleId === roleId);
  if (lens === undefined) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `no capability-case lens for role ${JSON.stringify(roleId)} in v1 (lenses: owner, expert, agent-builder, researcher, operator)`,
      details: { roleId, lensRoleIds: CAPABILITY_CASE_LENSES.map((entry) => entry.roleId) },
    });
  }
  return applyRoleProjection(lens, view);
}
