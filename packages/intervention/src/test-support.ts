/**
 * Deterministic test fixtures for @arena/intervention (Work Order
 * C007) — mirrors the sibling packages' test-support.ts discipline.
 */

import type { CreateInterventionResultInput } from './results.js';
import type { InterventionStep, InterventionTrajectoryBinding } from './trajectory-binding.js';

export const TENANT_A = 'tenant-alpha';
export const TENANT_B = 'tenant-beta';
export const REQUEST_ID_A = 'esc_11111111111111111111111111111111';
export const REQUEST_ID_B = 'esc_22222222222222222222222222222222';
export const SESSION_ID_A = 'session-boq-teach-1';
export const EXPERT_REF_A = 'expert-alice';
export const T0 = '2026-10-07T12:00:00.000Z';
export const T1 = '2026-10-07T12:10:00.000Z';
export const T2 = '2026-10-07T12:20:00.000Z';
export const T3 = '2026-10-07T12:30:00.000Z';
export const T4 = '2026-10-07T12:40:00.000Z';
export const DIGEST_A = 'a'.repeat(64);
export const DIGEST_B = 'b'.repeat(64);
export const CHAIN_HEAD = 'c'.repeat(64);
export const ALL_LIVE_MODES = ['solve', 'correct', 'unblock', 'review', 'teach'] as const;
export const ALL_INFORMATIONAL_MODES = ['tool_gap', 'knowledge', 'evaluate'] as const;

/** A base contract input for every live mode (override per case). */
export function makeCorrectionInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'correct',
    permittedModes: ['correct'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'fixed the flawed BOQ quantity assumption for aggregate wastage',
    correctedRef: 'artifact/boq-draft-7/line-42',
    replacement: { material: 'aggregate', quantity: 82.5, unit: 'm3', rate: 210 },
    beforeEvidenceRefs: ['artifact/boq-draft-7/v3'],
    afterEvidenceRefs: ['artifact/boq-draft-7/v4'],
    ...overrides,
  };
}

export function makeUnblockInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'unblock',
    permittedModes: ['unblock'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'supplied the missing Accra wet-season concreting rule',
    blockageRef: 'task/boq-estimation-42/awaiting-local-rule',
    missingInformation: {
      rule: 'GH-WET-SEASON-CONCRETE',
      statement: 'Pour only before 10:00 local between May and July; otherwise use retarding admixture R-2.',
    },
    informationKind: 'information',
    provenance: {
      sourceRefs: ['artifact/local-construction-code-gh/2026'],
      method: 'consulted the scoped local construction rulebook and cited the clause',
    },
    ...overrides,
  };
}

export function makeSolveInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'solve',
    permittedModes: ['solve'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'completed the quantity-takeoff subproblem for the Accra BOQ',
    payload: { total: 173_400, currency: 'USD', lines: 38 },
    steps: [
      'measured the foundation takeoff from the capsule plans',
      'applied the local wastage factors',
      'computed the consolidated BOQ totals',
    ],
    evidenceRefs: ['artifact/takeoff-sheet-1', 'artifact/boq-draft-7/v4'],
    ...overrides,
  };
}

export function makeReviewInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'review',
    permittedModes: ['review'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'the generated BOQ is acceptable against the declared criteria',
    verdict: 'approved',
    declaredCriteria: [
      { criteriaRef: 'criteria/quantity-accuracy', description: 'quantities within ±5% of plan measurement' },
      { criteriaRef: 'criteria/local-code-compliance', description: 'complies with GH local construction code' },
    ],
    criteriaEvaluations: [
      { criteriaRef: 'criteria/quantity-accuracy', verdict: 'met', note: 'measured deviation is 2.1%' },
      { criteriaRef: 'criteria/local-code-compliance', verdict: 'met', note: 'wet-season rule applied correctly' },
    ],
    findings: ['aggregate wastage factor was correctly applied'],
    ...overrides,
  };
}

export function makeTeachInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'teach',
    permittedModes: ['teach'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'performed the takeoff so the agent could observe the method',
    trajectoryRef: { trajectoryId: 'ivn-traj-teach-1', chainHead: CHAIN_HEAD },
    demonstration: [
      {
        stateRef: 'capsule/boq-teach-1/state-0',
        humanAction: 'annotated the foundation plan measurement points',
        consequenceRef: 'artifact/takeoff-notes-1',
        evidenceRefs: ['event/session-evt-3', 'artifact/takeoff-notes-1'],
      },
      {
        stateRef: 'capsule/boq-teach-1/state-1',
        humanAction: 'computed the wastage-adjusted quantities with the reconciliation tool',
        consequenceRef: 'artifact/takeoff-sheet-1',
        evidenceRefs: ['event/session-evt-5', 'artifact/takeoff-sheet-1'],
      },
    ],
    ...overrides,
  };
}

export function makeToolGapInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'tool_gap',
    permittedModes: ['tool_gap'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'required a local rate database the agent environment lacks',
    missingToolId: 'tool/gh-local-rate-db',
    rationale: 'the BOQ needs Accra market rates which are only available in the local rate database',
    evidenceOfUseRefs: ['event/session-evt-7'],
    ...overrides,
  };
}

export function makeKnowledgeInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'knowledge',
    permittedModes: ['knowledge'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'a scoped reusable construction rule for Accra BOQ work',
    statement: 'Accra aggregate wastage is 7.5% for hand-mixed foundations, 4% for pre-mix.',
    scope: 'construction.boq.gh-accra.foundation',
    ...overrides,
  };
}

export function makeEvaluateInput(
  overrides: Partial<CreateInterventionResultInput> = {},
): CreateInterventionResultInput {
  return {
    mode: 'evaluate',
    permittedModes: ['evaluate'],
    requestId: REQUEST_ID_A,
    sessionId: SESSION_ID_A,
    producedAt: T3,
    summary: 'evaluated the agent BOQ draft against the golden set',
    verdict: 'pass',
    subjectRef: 'artifact/boq-draft-7/v4',
    ...overrides,
  };
}

/** A deterministic trajectory binding for the trajectory-binding suite. */
export function makeTrajectoryBinding(
  overrides: Partial<InterventionTrajectoryBinding> = {},
): InterventionTrajectoryBinding {
  return {
    trajectoryId: 'ivn-traj-teach-1',
    run: {
      taskVersion: { taskId: 'task-boq-42', version: '1.0.0' },
      environmentVersion: { namespace: 'boq', name: 'accra-standard', version: '1.2.0', digest: DIGEST_A },
      runId: 'tenant-alpha/run-boq-42',
      initialSnapshotDigest: DIGEST_B,
      runRecordDigest: null,
    },
    agentBodyRef: DIGEST_A,
    substrateRef: DIGEST_B,
    seed: 'seed-0001',
    startedAt: T0,
    ...overrides,
  };
}

/** Observable steps for the trajectory-binding suite. */
export function makeObservableSteps(): readonly InterventionStep[] {
  return [
    {
      kind: 'human-action',
      stepId: 'step-annotate-plan',
      payload: { annotation: 'measurement points marked on foundation plan', subjectRef: 'artifact/plan-1' },
      occurredAt: T1,
    },
    {
      kind: 'tool-invocation',
      stepId: 'step-invoke-reconciliation',
      payload: { toolName: 'compute-reconciliation', input: { lines: 38 } },
      occurredAt: T2,
    },
    {
      kind: 'tool-result',
      stepId: 'step-result-reconciliation',
      payload: { toolName: 'compute-reconciliation', total: 173_400 },
      occurredAt: T2,
    },
    {
      kind: 'artifact-change',
      stepId: 'step-write-takeoff-sheet',
      payload: { artifactRef: 'artifact/takeoff-sheet-1', change: 'created' },
      occurredAt: T3,
    },
    {
      kind: 'checkpoint',
      stepId: 'step-checkpoint-1',
      payload: { snapshotDigest: DIGEST_A },
      occurredAt: T3,
    },
  ];
}
