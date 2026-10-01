/**
 * The B008 role lenses for the capability surfaces (Work Order B008;
 * issue #80; apps/web/src/capability).
 *
 * UXM1.0 §Core routes binds:
 *   /cases      → owner: outcome/cases · builder: capability gaps ·
 *                 expert: assigned cases · evaluator: evaluation
 *                 implications · researcher: failure clusters · operator:
 *                 job health · marketplace: — · admin: audit scope
 *   /cases/:id  → outcome lens · capability lens · work lens ·
 *                 measurement lens · hypothesis lens · operations lens ·
 *                 marketplace: — · policy lens
 *   /tasks/:id  → task outcome · task design · execute/review · rubric ·
 *                 benchmark · run health · marketplace: — · policy
 *
 * A lens selects FRAMING, GUIDANCE and NEXT-STEP CUES — never
 * permissions (RC1.0: role context is not permission; the same canonical
 * case object is shared, only the projection is role-specific). Roles
 * whose route row is "—" get an honest not-a-primary-surface note, not a
 * removed surface. Pure + deterministic frozen data.
 */

import {
  REFERENCE_ROLE_REGISTRY,
  ROLE_IDS,
  getRoleDefinition,
} from '../../../../packages/role-context/src/index.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';

/** One role lens over the case LIST surface. */
export interface CaseListLens {
  readonly roleId: RoleId;
  readonly roleName: string;
  readonly roleGoal: string;
  readonly heading: string;
  readonly intro: string;
  /** True when the route-matrix row for this role is "—" (honest note rendered). */
  readonly notPrimarySurface: boolean;
}

/** One role lens over the case DETAIL surface. */
export interface CaseDetailLens {
  readonly roleId: RoleId;
  readonly roleName: string;
  readonly lensName: string;
  readonly question: string;
  readonly intro: string;
  readonly notPrimarySurface: boolean;
}

/** One role lens over the TASK surface. */
export interface TaskLens {
  readonly roleId: RoleId;
  readonly roleName: string;
  readonly lensName: string;
  readonly question: string;
  readonly intro: string;
  readonly notPrimarySurface: boolean;
}

const LIST_DATA: Readonly<Record<RoleId, Omit<CaseListLens, 'roleId' | 'roleName' | 'roleGoal'>>> =
  Object.freeze({
    owner: {
      heading: 'Your capability cases',
      intro:
        'Every case states an outcome you need, the gap observed, and the evidence behind it — from open gap to certified release.',
      notPrimarySurface: false,
    },
    'agent-builder': {
      heading: 'Capability gaps',
      intro:
        'The cases that say a capability is missing from a Body. Start here to find the gap your next Body improvement should close.',
      notPrimarySurface: false,
    },
    expert: {
      heading: 'Assigned cases',
      intro:
        'The cases that requested expert work. Enter the work from the case that assigned it; qualifications scope judgment, never authorization.',
      notPrimarySurface: false,
    },
    evaluator: {
      heading: 'Evaluation implications',
      intro:
        'Cases approaching evaluation: what will be measured, against which criteria, and what the measurement implies for the case outcome.',
      notPrimarySurface: false,
    },
    researcher: {
      heading: 'Failure clusters',
      intro:
        'Observed failures clustered by capability. Evidence supports or challenges a claim — it never decides it.',
      notPrimarySurface: false,
    },
    operator: {
      heading: 'Case job health',
      intro:
        'The cases in flight and their lifecycle state — run health through the canonical case lifecycle, meaning unchanged.',
      notPrimarySurface: false,
    },
    'marketplace-participant': {
      heading: 'Capability cases',
      intro:
        'Cases are not a marketplace surface: they are your workspace’s capability-development record. Publishing happens from released artifacts, not from open cases.',
      notPrimarySurface: true,
    },
    administrator: {
      heading: 'Audit scope',
      intro:
        'The tenant’s cases as an audit surface: identity, lifecycle events, evidence counts and provenance — every historical state stays addressable.',
      notPrimarySurface: false,
    },
  } as const);

const DETAIL_DATA: Readonly<
  Record<RoleId, Omit<CaseDetailLens, 'roleId' | 'roleName'>>
> = Object.freeze({
  owner: {
    lensName: 'Outcome lens',
    question: 'Why is my agent struggling, and what outcome do I need?',
    intro:
      'The case from the outcome side: the observed failure, the desired outcome, and where the guided workflow stands.',
    notPrimarySurface: false,
  },
  'agent-builder': {
    lensName: 'Capability lens',
    question: 'What capability is missing from the Body?',
    intro:
      'The case as a capability gap: target capability, domain, and the task requirements the missing capability must satisfy.',
    notPrimarySurface: false,
  },
  expert: {
    lensName: 'Work lens',
    question: 'What work am I being asked to perform?',
    intro:
      'The case as assigned work: expert requirements, environment requirements and the evidence criteria the work must produce.',
    notPrimarySurface: false,
  },
  evaluator: {
    lensName: 'Measurement lens',
    question: 'How will “good” be measured here?',
    intro:
      'The case from the measurement side: evaluation requirements and criteria — kept distinct from verification.',
    notPrimarySurface: false,
  },
  researcher: {
    lensName: 'Hypothesis lens',
    question: 'What evidence supports the capability hypothesis?',
    intro:
      'The case as a hypothesis under study: the unknowns, the evidence so far, and what a follow-up experiment would need.',
    notPrimarySurface: false,
  },
  operator: {
    lensName: 'Operations lens',
    question: 'Is the workflow healthy?',
    intro:
      'The case from the operations side: lifecycle progress, event history and where the workflow stands right now.',
    notPrimarySurface: false,
  },
  'marketplace-participant': {
    lensName: 'Case detail',
    question: 'What is this case?',
    intro:
      'Cases are not a marketplace surface — this is the shared case object through a neutral reading.',
    notPrimarySurface: true,
  },
  administrator: {
    lensName: 'Policy lens',
    question: 'What does policy need to know about this case?',
    intro:
      'The case from the policy side: tenancy, provenance, priority/risk classes and the append-only lifecycle as an audit trail.',
    notPrimarySurface: false,
  },
} as const);

const TASK_DATA: Readonly<Record<RoleId, Omit<TaskLens, 'roleId' | 'roleName'>>> =
  Object.freeze({
    owner: {
      lensName: 'Task outcome',
      question: 'What outcome does this task drive?',
      intro: 'The task from the outcome side: objectives, success conditions and what it proves for the case.',
      notPrimarySurface: false,
    },
    'agent-builder': {
      lensName: 'Task design',
      question: 'How is this task designed?',
      intro:
        'The task as a designed instrument: instructions, constraints, permitted tools, prohibited shortcuts and completion criteria.',
      notPrimarySurface: false,
    },
    expert: {
      lensName: 'Execute / review',
      question: 'What work does this task ask for?',
      intro:
        'The task as work to perform or review: the instructions, the environment, and the evidence criteria to attach.',
      notPrimarySurface: false,
    },
    evaluator: {
      lensName: 'Rubric',
      question: 'What rubric grades this task?',
      intro: 'The task from the rubric side: objectives, completion criteria and evidence criteria.',
      notPrimarySurface: false,
    },
    researcher: {
      lensName: 'Benchmark',
      question: 'How does this task benchmark capability?',
      intro: 'The task as a benchmark probe: difficulty, environment and expected outputs.',
      notPrimarySurface: false,
    },
    operator: {
      lensName: 'Run health',
      question: 'Is this task’s run healthy?',
      intro:
        'The task from the run side: environment, difficulty and state. Replay views arrive with the replay surface (B011).',
      notPrimarySurface: false,
    },
    'marketplace-participant': {
      lensName: 'Task',
      question: 'What is this task?',
      intro: 'Tasks are not a marketplace surface — this is the shared task object through a neutral reading.',
      notPrimarySurface: true,
    },
    administrator: {
      lensName: 'Policy',
      question: 'What does policy need to know about this task?',
      intro: 'The task from the policy side: data rights, provenance and tenant scope.',
      notPrimarySurface: false,
    },
  } as const);

/** All case-list lenses, deterministically ordered by ROLE_IDS (B003 order). */
export const CASE_LIST_LENSES: Readonly<Record<RoleId, CaseListLens>> = Object.freeze(
  Object.fromEntries(
    ROLE_IDS.map((roleId) => {
      const definition = getRoleDefinition(REFERENCE_ROLE_REGISTRY, roleId);
      return [
        roleId,
        Object.freeze({
          roleId,
          roleName: definition.name,
          roleGoal: definition.goal,
          ...LIST_DATA[roleId],
        } satisfies CaseListLens),
      ];
    }),
  ) as Readonly<Record<RoleId, CaseListLens>>,
);

/** All case-detail lenses, in ROLE_IDS order. */
export const CASE_DETAIL_LENSES: Readonly<Record<RoleId, CaseDetailLens>> = Object.freeze(
  Object.fromEntries(
    ROLE_IDS.map((roleId) => {
      const definition = getRoleDefinition(REFERENCE_ROLE_REGISTRY, roleId);
      return [
        roleId,
        Object.freeze({
          roleId,
          roleName: definition.name,
          ...DETAIL_DATA[roleId],
        } satisfies CaseDetailLens),
      ];
    }),
  ) as Readonly<Record<RoleId, CaseDetailLens>>,
);

/** All task lenses, in ROLE_IDS order. */
export const TASK_LENSES: Readonly<Record<RoleId, TaskLens>> = Object.freeze(
  Object.fromEntries(
    ROLE_IDS.map((roleId) => {
      const definition = getRoleDefinition(REFERENCE_ROLE_REGISTRY, roleId);
      return [
        roleId,
        Object.freeze({
          roleId,
          roleName: definition.name,
          ...TASK_DATA[roleId],
        } satisfies TaskLens),
      ];
    }),
  ) as Readonly<Record<RoleId, TaskLens>>,
);

/** The case-list lens for a role id (typed rejection for unknown ids). */
export function caseListLens(roleId: string): CaseListLens {
  const lens = (CASE_LIST_LENSES as Record<string, CaseListLens | undefined>)[roleId];
  if (lens === undefined) {
    throw new Error(
      `unknown case-list role lens: ${JSON.stringify(roleId)} (known: ${ROLE_IDS.join(', ')})`,
    );
  }
  return lens;
}

/** The case-detail lens for a role id (typed rejection for unknown ids). */
export function caseDetailLens(roleId: string): CaseDetailLens {
  const lens = (CASE_DETAIL_LENSES as Record<string, CaseDetailLens | undefined>)[roleId];
  if (lens === undefined) {
    throw new Error(
      `unknown case-detail role lens: ${JSON.stringify(roleId)} (known: ${ROLE_IDS.join(', ')})`,
    );
  }
  return lens;
}

/** The task lens for a role id (typed rejection for unknown ids). */
export function taskLens(roleId: string): TaskLens {
  const lens = (TASK_LENSES as Record<string, TaskLens | undefined>)[roleId];
  if (lens === undefined) {
    throw new Error(`unknown task role lens: ${JSON.stringify(roleId)} (known: ${ROLE_IDS.join(', ')})`);
  }
  return lens;
}
