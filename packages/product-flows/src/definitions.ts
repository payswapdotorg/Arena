/**
 * Guided-flow DEFINITIONS (Work Order B008; issue #80).
 *
 * The capability-development guided flow: ordered, versioned, FROZEN data.
 * Seven steps, exactly as dispatched:
 *
 *   start case → frame capability gap → compose task → run → observe →
 *   evaluate → decide
 *
 * Each step is BOUND to the canonical A005 Capability Case lifecycle
 * states it is valid from/to. The mapping onto the canonical state
 * machine is total and uses every canonical transition exactly once:
 *
 *   guided step      canonical operation        valid from   valid to
 *   ───────────────  ─────────────────────────  ───────────  ─────────
 *   start-case       createCapabilityCase       (new)        draft
 *   frame-gap        submitCase                 draft        submitted
 *   compose-task     triageCase                 submitted    triaged
 *   run              activateCase               triaged      active
 *   observe          attachEvidence             active       active
 *   evaluate         attachEvidence             active       active
 *   decide           resolveCase                active       resolved
 *
 * The A005 lifecycle doc states the protocol-level ACTIVE status covers
 * the delivery phases between triage and resolution (task design, expert
 * work, evaluation, learning) — which is exactly where compose/run/
 * observe/evaluate sit — and RESOLVED covers VALIDATED→CLOSED (the
 * decide step). `deriveCompilationTarget` eligibility (triaged|active)
 * is what makes compose-task the honest gate for task composition.
 *
 * Supersession is deliberately NOT a guided step (the dispatched step
 * list has none); the canonical supersede/follow-up paths are disclosed
 * as `FLOW_SUPPLEMENT` so surfaces can render honest dead-end guidance
 * without inventing UI-only lifecycle.
 */

import type { CaseStatus } from '@arena/capability-case';
import { PRODUCT_FLOW_ERROR_CODES, ProductFlowError } from './errors.js';

/** Wire version of the guided-flow definition contract. */
export const PRODUCT_FLOW_VERSION = 1 as const;

/** The id of the (single) guided capability-development flow. */
export const GUIDED_FLOW_ID = 'capability-development/v1' as const;

/** The canonical lifecycle operations a guided step may drive. */
export const FLOW_STEP_TRANSITIONS = Object.freeze([
  'create',
  'submit',
  'triage',
  'activate',
  'attach-evidence',
  'resolve',
] as const);

export type FlowStepTransition = (typeof FLOW_STEP_TRANSITIONS)[number];

/** The status a step starts from; 'new' = the case does not exist yet. */
export type FlowStepOrigin = CaseStatus | 'new';

/** One ordered, versioned guided-flow step (frozen data; no behavior). */
export interface FlowStepDefinition {
  readonly stepId: string;
  /** 1-based position in the guided flow. */
  readonly order: number;
  /** Short human title (what a new user reads). */
  readonly title: string;
  /** One calm paragraph of guidance for a first-time user. */
  readonly guidance: string;
  /** The canonical A005 operation the step drives. */
  readonly transition: FlowStepTransition;
  /** The canonical case status the step is valid FROM. */
  readonly validFrom: FlowStepOrigin;
  /** The canonical case status the step lands IN. */
  readonly validTo: CaseStatus;
  /** Step-specific input notes the surface should collect. */
  readonly inputNote: string;
}

/**
 * The seven guided steps, frozen. The order is the guided order — the
 * canonical state machine is the authority on validity.
 */
export const GUIDED_FLOW_STEPS: readonly FlowStepDefinition[] = Object.freeze([
  {
    stepId: 'start-case',
    order: 1,
    title: 'Start the case',
    guidance:
      'A Capability Case is the bridge from an observed failure to capability development. You state the gap you observed, attach at least one digest-addressed evidence reference, and record what you do not yet know (an honest case always carries known unknowns).',
    transition: 'create',
    validFrom: 'new',
    validTo: 'draft',
    inputNote:
      'The full case framing is collected here: problem statement, observed failure, evidence digest, unknowns, desired outcome, and the requirement refs (capability, domain, competency, environment, tools, evaluators, verifiers).',
  },
  {
    stepId: 'frame-gap',
    order: 2,
    title: 'Frame the capability gap',
    guidance:
      'The framed gap is submitted for triage. Anyone triaging will read exactly what you wrote — the framing stays inspectable for the whole life of the case.',
    transition: 'submit',
    validFrom: 'draft',
    validTo: 'submitted',
    inputNote: 'An optional note recorded on the submission event.',
  },
  {
    stepId: 'compose-task',
    order: 3,
    title: 'Compose the task',
    guidance:
      'Triage selects the case for capability development and a task compilation target is derived from this exact case state — the task always traces back to the case version and lifecycle state that motivated it. A non-empty triage rationale is required and stays inspectable.',
    transition: 'triage',
    validFrom: 'submitted',
    validTo: 'triaged',
    inputNote:
      'A REQUIRED non-empty triage rationale note (the selection rationale remains inspectable).',
  },
  {
    stepId: 'run',
    order: 4,
    title: 'Run the capability work',
    guidance:
      'Activating the case begins capability development: tasks run in their environments, experts perform the work the case asked for. The case stays active while the work is in flight.',
    transition: 'activate',
    validFrom: 'triaged',
    validTo: 'active',
    inputNote: 'An optional note recorded on the activation event.',
  },
  {
    stepId: 'observe',
    order: 5,
    title: 'Observe the run',
    guidance:
      'Observations become evidence: run and trajectory evidence is appended to the case (digest-addressed, append-only — evidence is never removed or rewritten).',
    transition: 'attach-evidence',
    validFrom: 'active',
    validTo: 'active',
    inputNote:
      'At least one NEW evidence reference (digest + description). Observation evidence describes what the run showed — it is not an evaluation result.',
  },
  {
    stepId: 'evaluate',
    order: 6,
    title: 'Evaluate the result',
    guidance:
      'Evaluation measures the result against the case’s evaluation requirements and appends the evaluation evidence. Evaluation is distinct from verification — an evaluation result is never a verification claim.',
    transition: 'attach-evidence',
    validFrom: 'active',
    validTo: 'active',
    inputNote:
      'At least one NEW evidence reference (digest + description) carrying the evaluation outcome. Verification evidence is a different, later concern.',
  },
  {
    stepId: 'decide',
    order: 7,
    title: 'Decide the outcome',
    guidance:
      'Resolving the case records the outcome decision. A resolution without a stated outcome is not a resolution — the statement is required and terminal: resolved cases are final and immutable (a follow-up case is the way to reopen work).',
    transition: 'resolve',
    validFrom: 'active',
    validTo: 'resolved',
    inputNote: 'A REQUIRED non-empty resolution statement (the outcome).',
  },
] as const);

/**
 * Disclosed canonical paths that are deliberately OUTSIDE the guided
 * linear flow (frozen data; surfaces render them as honest dead-ends and
 * follow-ups, never as invented UI lifecycle).
 */
export const FLOW_SUPPLEMENT: Readonly<{
  readonly supersede: string;
  readonly followUp: string;
  readonly terminalNote: string;
}> = Object.freeze({
  supersede:
    'Any non-terminal case version may be superseded by a strictly higher semver version of the same logical case (canonical supersession — the superseded version stays immutable and addressable).',
  followUp:
    'Terminal (resolved/superseded) cases are final. A follow-up case carries a parent ref to the case version it branched from.',
  terminalNote:
    'Every historical case state stays addressable by its content digest — the append-only lifecycle is auditable end to end.',
});

/** Look up one guided step by id (typed rejection for unknown ids). */
export function getFlowStep(stepId: string): FlowStepDefinition {
  const step = GUIDED_FLOW_STEPS.find((candidate) => candidate.stepId === stepId);
  if (step === undefined) {
    throw new ProductFlowError(PRODUCT_FLOW_ERROR_CODES.UNKNOWN_STEP, {
      message: `unknown guided-flow step id: ${JSON.stringify(stepId)} (known: ${GUIDED_FLOW_STEPS.map((s) => s.stepId).join(', ')})`,
      details: { stepId, known: GUIDED_FLOW_STEPS.map((s) => s.stepId) },
    });
  }
  return step;
}

/**
 * The next guided step whose `validFrom` equals the case's CURRENT
 * canonical status, or null at a terminal status (resolved/superseded —
 * honest dead-end: the guided flow is over; follow-ups are the path).
 * Pure lookup over frozen data.
 */
export function nextGuidedStep(status: CaseStatus): FlowStepDefinition | null {
  const step = GUIDED_FLOW_STEPS.find((candidate) => candidate.validFrom === status);
  return step === undefined ? null : step;
}

/** All guided steps valid from the given status (guided affordances). */
export function stepsValidFrom(status: CaseStatus): readonly FlowStepDefinition[] {
  return Object.freeze(GUIDED_FLOW_STEPS.filter((candidate) => candidate.validFrom === status));
}
