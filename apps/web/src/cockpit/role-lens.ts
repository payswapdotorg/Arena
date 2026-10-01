/**
 * The cockpit role lenses (Work Order B007; issue #78; apps/web/src/cockpit).
 *
 * UXM1.0 §Core routes binds `/` to a per-role landing: capability cockpit
 * (Owner/Builder), assigned work (Expert), evaluation queue (Evaluator),
 * research queue (Researcher), health summary (Operator), discovery
 * (Marketplace), admin summary (Admin). A lens selects LANDING CONTENT,
 * PRIMARY ACTION, NAVIGATION EMPHASIS and READ EMPHASIS — never
 * permissions (RC1.0 "Role contexts"; the permission authority stays
 * server-side/policy-driven).
 *
 * Pure + deterministic: every lens is frozen data; role names/goals come
 * from the B003 reference registry (single source of truth — this module
 * never re-transcribes them). Unknown roles are typed rejections, never
 * silent fallbacks.
 */

import {
  REFERENCE_ROLE_REGISTRY,
  ROLE_IDS,
  getRoleDefinition,
} from '../../../../packages/role-context/src/index.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';
import type { ReadModelKind } from '../../../../packages/read-model/src/index.js';

/** One suggested next action (a real route, a calm note — never a fabricated promise). */
export interface CockpitNextAction {
  readonly label: string;
  readonly href: string;
  readonly note: string;
}

/**
 * One role lens: everything the cockpit renders differently per active
 * role. NO permission, no policy, no grant — the lens is presentation.
 */
export interface CockpitRoleLens {
  readonly roleId: RoleId;
  /** Display name + goal, transcribed from the B003 registry by reference. */
  readonly roleName: string;
  readonly roleGoal: string;
  /** UXM1.0 `/` row landing (title + intro). */
  readonly landingTitle: string;
  readonly landingIntro: string;
  /** The ONE hero action (UX1.0: one meaningful primary action). */
  readonly heroAction: { readonly label: string; readonly href: string };
  /** "What am I doing" section headings for this lens. */
  readonly doingHeading: string;
  readonly doingIntro: string;
  /** "What can I do next" — suggested actions into real routes. */
  readonly nextActions: readonly CockpitNextAction[];
  /** Which disclosed read kinds feed "what am I doing" for this lens. */
  readonly primaryReadKinds: readonly ReadModelKind[];
  /** Contextual-navigation routes this lens emphasizes (never removes — the route is a capability of the shell). */
  readonly emphasizedRoutes: readonly string[];
}

const LENS_DATA: Readonly<
  Record<RoleId, Omit<CockpitRoleLens, 'roleId' | 'roleName' | 'roleGoal'>>
> = Object.freeze({
  owner: {
    landingTitle: 'Capability cockpit',
    landingIntro:
      'Your agent capability at a glance: open cases, the bodies behind them, and what has actually been certified.',
    heroAction: { label: 'Find what your agent can\u2019t do yet', href: '/cases' },
    doingHeading: 'What am I working on?',
    doingIntro:
      'Open capability cases with their live lifecycle state, the bodies assigned to them, and certified releases you can adopt.',
    nextActions: [
      { label: 'Open a capability case', href: '/cases', note: 'Follow one gap from case to certified release.' },
      { label: 'Inspect your body library', href: '/bodies', note: 'See what each Agent Body is composed of.' },
      { label: 'Browse the marketplace', href: '/marketplace', note: 'Discover expertise and artifacts — purchase never implies certification.' },
    ],
    primaryReadKinds: ['capability-case', 'agent-body', 'certification'],
    emphasizedRoutes: ['/cases', '/bodies', '/marketplace'],
  },
  'agent-builder': {
    landingTitle: 'Capability cockpit',
    landingIntro:
      'Assemble and improve Agent Bodies: what you are building, what evidence exists, and what is certified.',
    heroAction: { label: 'Improve an Agent Body', href: '/bodies' },
    doingHeading: 'What am I building?',
    doingIntro:
      'Bodies in the workspace, the capability cases motivating them, and certifications over the tested compositions.',
    nextActions: [
      { label: 'Open the body library', href: '/bodies', note: 'A body composes skills, knowledge, tools and policies — it is never just a model.' },
      { label: 'Review capability gaps', href: '/cases', note: 'Which cases say a capability is missing?' },
      { label: 'Compare substrates in research', href: '/research', note: 'Substrate comparisons are composition-scoped.' },
    ],
    primaryReadKinds: ['agent-body', 'capability-case', 'certification'],
    emphasizedRoutes: ['/bodies', '/cases', '/research'],
  },
  expert: {
    landingTitle: 'Assigned work',
    landingIntro:
      'The professional work this workspace has asked of you — qualifications that scope it, cases it serves, and evidence to attach.',
    heroAction: { label: 'Review assigned work', href: '/cases' },
    doingHeading: 'What work am I assigned?',
    doingIntro:
      'Your expert qualifications (what you are scoped to judge — qualification is not authorization) and the cases that requested expert work.',
    nextActions: [
      { label: 'Open assigned cases', href: '/cases', note: 'Enter the workbench from the case that assigned the work.' },
      { label: 'Check the marketplace', href: '/marketplace', note: 'Offer expertise where entitled.' },
    ],
    primaryReadKinds: ['expert-qualification', 'capability-case'],
    emphasizedRoutes: ['/cases', '/marketplace'],
  },
  evaluator: {
    landingTitle: 'Evaluation queue',
    landingIntro:
      'Make “good” measurable: the objects awaiting evaluation, and the certifications your measurements feed.',
    heroAction: { label: 'Open the evaluation queue', href: '/research' },
    doingHeading: 'What awaits evaluation?',
    doingIntro:
      'Cases whose trajectories and bodies are ready to be measured, plus existing certifications over tested compositions.',
    nextActions: [
      { label: 'Open evaluation suites', href: '/research', note: 'Suites, criteria and verifier bindings live in the research lab.' },
      { label: 'Review certified compositions', href: '/bodies', note: 'A certification claim covers the tested composition, never the model alone.' },
    ],
    primaryReadKinds: ['capability-case', 'certification'],
    emphasizedRoutes: ['/research', '/bodies', '/cases'],
  },
  researcher: {
    landingTitle: 'Research queue',
    landingIntro:
      'Capability boundaries, experiments and comparisons — what is under investigation right now.',
    heroAction: { label: 'Run a capability experiment', href: '/research' },
    doingHeading: 'What is under investigation?',
    doingIntro:
      'Cases stating capability hypotheses and the bodies being studied. Evidence supports or challenges a claim — it never decides it.',
    nextActions: [
      { label: 'Open the benchmark lab', href: '/research', note: 'Body × substrate comparisons and capability lift.' },
      { label: 'Study the body population', href: '/bodies', note: 'The bodies behind the capability claims.' },
    ],
    primaryReadKinds: ['capability-case', 'agent-body'],
    emphasizedRoutes: ['/research', '/bodies'],
  },
  operator: {
    landingTitle: 'Health summary',
    landingIntro:
      'Keep Arena healthy and understandable: jobs, environments, failures and the objects they carry — business meaning unchanged.',
    heroAction: { label: 'Investigate a failure', href: '/operations' },
    doingHeading: 'Is the workflow healthy?',
    doingIntro:
      'The canonical objects currently in flight. An operator traces failures without changing what the object means.',
    nextActions: [
      { label: 'Open operations', href: '/operations', note: 'Jobs, SLOs, quotas and audit as they land (B014).' },
      { label: 'Inspect live cases', href: '/cases', note: 'Run health through the case lifecycle.' },
    ],
    primaryReadKinds: ['capability-case', 'agent-body', 'expert-qualification', 'certification'],
    emphasizedRoutes: ['/operations', '/cases'],
  },
  'marketplace-participant': {
    landingTitle: 'Discovery',
    landingIntro:
      'Publish, discover, buy or license capability artifacts — with provenance, verification and entitlements explicit.',
    heroAction: { label: 'Discover capability artifacts', href: '/marketplace' },
    doingHeading: 'What can I discover?',
    doingIntro:
      'Bodies available as releases and certifications over tested compositions. A purchased artifact is never automatically certified.',
    nextActions: [
      { label: 'Browse the catalog', href: '/marketplace', note: 'What it is, how it was created, verification, rights, price.' },
      { label: 'Inspect available bodies', href: '/bodies', note: 'License/offer posture per body.' },
    ],
    primaryReadKinds: ['agent-body', 'certification'],
    emphasizedRoutes: ['/marketplace', '/bodies'],
  },
  administrator: {
    landingTitle: 'Admin summary',
    landingIntro:
      'Tenant configuration, identity, policy and audit — the workspace as an administrative surface.',
    heroAction: { label: 'Review tenant policy and audit', href: '/settings' },
    doingHeading: 'What is in this tenant?',
    doingIntro:
      'The disclosed canonical inventory of the tenant. Administration is policy work — roles here are lenses, never grants.',
    nextActions: [
      { label: 'Open members and policy', href: '/settings', note: 'Members, roles, policies, entitlements, audit.' },
      { label: 'Audit the object inventory', href: '/cases', note: 'Every kind through its policy lens.' },
    ],
    primaryReadKinds: ['capability-case', 'agent-body', 'expert-qualification', 'certification'],
    emphasizedRoutes: ['/settings', '/operations'],
  },
} as const);

/** All 8 lenses, deterministically ordered by ROLE_IDS (B003 canonical order). */
export const COCKPIT_ROLE_LENSES: Readonly<Record<RoleId, CockpitRoleLens>> = Object.freeze(
  Object.fromEntries(
    ROLE_IDS.map((roleId) => {
      const definition = getRoleDefinition(REFERENCE_ROLE_REGISTRY, roleId);
      const data = LENS_DATA[roleId];
      return [
        roleId,
        Object.freeze({
          roleId,
          roleName: definition.name,
          roleGoal: definition.goal,
          landingTitle: data.landingTitle,
          landingIntro: data.landingIntro,
          heroAction: Object.freeze(data.heroAction),
          doingHeading: data.doingHeading,
          doingIntro: data.doingIntro,
          nextActions: Object.freeze(data.nextActions),
          primaryReadKinds: Object.freeze(data.primaryReadKinds),
          emphasizedRoutes: Object.freeze(data.emphasizedRoutes),
        } satisfies CockpitRoleLens),
      ];
    }),
  ) as Readonly<Record<RoleId, CockpitRoleLens>>,
);

/** The lens for a role id (typed rejection for unknown ids — never a silent default). */
export function cockpitRoleLens(roleId: string): CockpitRoleLens {
  const lens = (COCKPIT_ROLE_LENSES as Record<string, CockpitRoleLens | undefined>)[roleId];
  if (lens === undefined) {
    throw new Error(
      `unknown cockpit role lens: ${JSON.stringify(roleId)} (known: ${ROLE_IDS.join(', ')})`,
    );
  }
  return lens;
}

// ---------------------------------------------------------------------------
// Active-role resolution (explicit query state; granted-roles truthfulness)
// ---------------------------------------------------------------------------

/** The outcome of resolving a requested role against the granted-role set. */
export type ActiveRoleResolution =
  | {
      readonly status: 'granted';
      readonly roleId: RoleId;
      /** True when the resolution fell back to the default (no explicit request). */
      readonly byDefault: boolean;
    }
  | {
      readonly status: 'not-granted';
      /** The explicitly requested (but not granted) role id, verbatim. */
      readonly requested: string;
      /** The role the cockpit will lens through instead (the honest default). */
      readonly fallbackRoleId: RoleId;
      /** The granted roles, for the truthful denial message. */
      readonly grantedRoleIds: readonly RoleId[];
    };

/**
 * Resolve the active role lens. EXPLICIT state only: the request comes from
 * query state; when absent the default applies (deterministic — never
 * implicit time, randomness or history). A requested role that is not in
 * the granted set resolves to a typed `not-granted` outcome — the UI says
 * so truthfully; it NEVER fakes the authorization (RC1.0 role switcher:
 * "permission warnings when a workflow is unavailable").
 */
export function resolveActiveRole(input: {
  readonly grantedRoleIds: readonly RoleId[];
  readonly requested?: string;
  readonly defaultRoleId?: RoleId;
}): ActiveRoleResolution {
  const granted = Object.freeze([...input.grantedRoleIds]);
  const fallbackRoleId: RoleId =
    input.defaultRoleId !== undefined && granted.includes(input.defaultRoleId)
      ? input.defaultRoleId
      : (granted[0] as RoleId | undefined) ?? 'owner';
  if (input.requested === undefined || input.requested.length === 0) {
    return { status: 'granted', roleId: fallbackRoleId, byDefault: true };
  }
  const requested = input.requested;
  if ((ROLE_IDS as readonly string[]).includes(requested) && granted.includes(requested as RoleId)) {
    return { status: 'granted', roleId: requested as RoleId, byDefault: false };
  }
  return {
    status: 'not-granted',
    requested,
    fallbackRoleId,
    grantedRoleIds: granted,
  };
}
