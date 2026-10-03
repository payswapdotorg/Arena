/**
 * Replay viewer role lenses (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * Role context is a LENS, never an authorization (RC1.0): the replay
 * surface renders through the B003 role context — each of the eight
 * reference roles gets a lens that selects LANDING CONTENT and what the
 * lens EMPHASIZES on a replay screen (timeline, failures, evidence,
 * linkage, audit…), while the underlying reads stay exactly the same
 * observational reads for every lens. Unknown roles are typed
 * rejections, never silent fallbacks.
 *
 * A requested-but-NOT-GRANTED role resolves to the truthful
 * `not-granted` outcome (the B007 cockpit active-role pattern): the UI
 * says so visibly — it NEVER fakes the authorization and never hides
 * data behind an invented denial.
 */

import {
  REFERENCE_ROLE_REGISTRY,
  ROLE_IDS,
  getRoleDefinition,
} from '@arena/role-context';
import type { RoleId } from '@arena/role-context';

/** One suggested next action (a real route, a calm note — never a promise). */
export interface ReplayNextAction {
  readonly label: string;
  readonly href: string;
  readonly note: string;
}

/** What a lens emphasizes on the replay surface (emphasis only — never a permission). */
export type ReplayLensEmphasis =
  | 'timeline'
  | 'failures'
  | 'evidence'
  | 'linkage'
  | 'reproducibility'
  | 'behavior'
  | 'release'
  | 'audit';

/** One role lens for the replay viewer. */
export interface ReplayRoleLens {
  readonly roleId: RoleId;
  /** Display name + goal, from the B003 reference registry by reference. */
  readonly roleName: string;
  readonly roleGoal: string;
  /** The lens's landing title on the replay surface. */
  readonly landingTitle: string;
  readonly landingIntro: string;
  /** What this lens looks at FIRST on a run detail (a note, never a permission). */
  readonly focusNote: string;
  readonly emphasis: ReplayLensEmphasis;
  readonly nextActions: readonly ReplayNextAction[];
}

const LENS_DATA: Readonly<
  Record<RoleId, Omit<ReplayRoleLens, 'roleId' | 'roleName' | 'roleGoal'>>
> = Object.freeze({
  owner: {
    landingTitle: 'What happened in your runs',
    landingIntro:
      'Replay the runs your workspace executed: what the agent did at each step, what it observed, and which evidence the completed runs produced. Observation only — a replay never mutates your world.',
    focusNote:
      'Read completed runs end-to-end: the timeline is the append-only record of what happened, and the evidence addresses are what your run actually produced.',
    emphasis: 'timeline',
    nextActions: [
      {
        label: 'Open a capability case',
        href: '/cases',
        note: 'Follow one gap from case to certified release.',
      },
    ],
  },
  'agent-builder': {
    landingTitle: 'Debug body behavior step by step',
    landingIntro:
      'Replay is the debugger for Agent Bodies: inspect the action an agent took, the observation it received, and the environment events around it — then improve the body (a new immutable version, never an in-place edit).',
    focusNote:
      'Inspect the per-step I/O: action inputs and observation channels show exactly what the body saw and did — the step inspector is your loop for improving the next body version.',
    emphasis: 'failures',
    nextActions: [
      {
        label: 'Open the Body Studio',
        href: '/bodies',
        note: 'Improvement lands as a new content-addressed version.',
      },
    ],
  },
  expert: {
    landingTitle: 'Review context, replayed',
    landingIntro:
      'The replayed trajectory is the review context for assigned work: what the agent did, in which order, with which evidence attached. Your judgment stays its own canonical kind — distinct from model output and from verification.',
    focusNote:
      'Trace the timeline around checkpoints and errors: the chain of steps is the ground truth of what was attempted, and expert judgment renders as expert judgment, never as a replay.',
    emphasis: 'timeline',
    nextActions: [
      {
        label: 'Open assigned cases',
        href: '/cases',
        note: 'Enter the workbench from the case that assigned the work.',
      },
    ],
  },
  evaluator: {
    landingTitle: 'How runs were measured',
    landingIntro:
      'Every evaluation result links back to the trajectory it judged. Replay the run to see the behavior the score was computed over — a score against explicit criteria, never a verification claim.',
    focusNote:
      'Open the linkage section: evaluation records bind to this run by trajectory digest, and each renders under the evaluation-result truth class — never as verified.',
    emphasis: 'linkage',
    nextActions: [
      {
        label: 'Open evaluation suites',
        href: '/evaluation',
        note: 'Evaluation ≠ verification ≠ certification.',
      },
    ],
  },
  researcher: {
    landingTitle: 'Behavioral traces under study',
    landingIntro:
      'Replayed trajectories are the behavioral traces of the study population: action/observation sequences, environment events and reproducibility data (seed, snapshots, digests) — composition-scoped, never bare-model claims.',
    focusNote:
      'Wall-clock vs logical ordering is explicit on every step — same-timestamp steps are ordered by the chain sequence, so behavioral comparisons stay deterministic.',
    emphasis: 'reproducibility',
    nextActions: [
      {
        label: 'Open the benchmark lab',
        href: '/research',
        note: 'Body × substrate comparisons and capability lift.',
      },
    ],
  },
  operator: {
    landingTitle: 'Investigate what the run did',
    landingIntro:
      'When a run fails or stalls, replay answers "what did it do?": the step timeline, the environment event stream (admission, transitions, checkpoints, cleanup) and the error entries — read-only, so investigation can never disturb the record.',
    focusNote:
      'Correlate the event stream with the timeline: environment events link to step indexes, and failed runs are evidenced by their streams (a run result exists only for completed runs).',
    emphasis: 'failures',
    nextActions: [
      {
        label: 'Open operations',
        href: '/operations',
        note: 'Jobs, SLOs, quotas and audit (B014).',
      },
    ],
  },
  'marketplace-participant': {
    landingTitle: 'Evidence behind releases',
    landingIntro:
      'A replayed run with its evidence addresses and linked verification is the provenance story behind a release candidate — purchase never implies certification, and a replay never becomes a live-world claim.',
    focusNote:
      'Check the evidence addresses and verification linkage of completed runs: these are the append-only artifacts a release decision rests on.',
    emphasis: 'release',
    nextActions: [
      {
        label: 'Browse the marketplace',
        href: '/marketplace',
        note: 'What it is, how it was created, verification, rights, price.',
      },
    ],
  },
  administrator: {
    landingTitle: 'Governance over run histories',
    landingIntro:
      'The replay surface is an audit surface: tenant-scoped run identities, content-addressed records, chain verification outcomes and append-only evidence — observable, never mutable from here.',
    focusNote:
      'The chain-verification stamp and the degradation notes are the audit trail of the viewer itself: what was verified, what failed validation, what stayed unknown.',
    emphasis: 'audit',
    nextActions: [
      {
        label: 'Open members and policy',
        href: '/settings',
        note: 'Members, roles, policies, entitlements, audit.',
      },
    ],
  },
} as const);

/** All 8 replay lenses, deterministically ordered by ROLE_IDS (B003 canonical order). */
export const REPLAY_ROLE_LENSES: Readonly<Record<RoleId, ReplayRoleLens>> = Object.freeze(
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
          focusNote: data.focusNote,
          emphasis: data.emphasis,
          nextActions: Object.freeze(data.nextActions),
        } satisfies ReplayRoleLens),
      ];
    }),
  ) as Readonly<Record<RoleId, ReplayRoleLens>>,
);

/** The lens for a role id (typed rejection for unknown ids — never a silent default). */
export function replayRoleLens(roleId: string): ReplayRoleLens {
  const lens = (REPLAY_ROLE_LENSES as Record<string, ReplayRoleLens | undefined>)[roleId];
  if (lens === undefined) {
    throw new Error(
      `unknown replay role lens: ${JSON.stringify(roleId)} (known: ${ROLE_IDS.join(', ')})`,
    );
  }
  return lens;
}

// ---------------------------------------------------------------------------
// Active-role resolution (explicit query state; granted-roles truthfulness)
// ---------------------------------------------------------------------------

/** The outcome of resolving a requested role against the granted-role set. */
export type ReplayActiveRoleResolution =
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
      /** The role the replay surface will lens through instead (the honest default). */
      readonly fallbackRoleId: RoleId;
      /** The granted roles, for the truthful denial message. */
      readonly grantedRoleIds: readonly RoleId[];
    };

/**
 * Resolve the active replay role lens. EXPLICIT state only: the request
 * comes from query state; when absent the default applies
 * (deterministic). A requested role that is not in the granted set
 * resolves to the typed `not-granted` outcome — the UI says so
 * truthfully; it NEVER fakes the authorization and NEVER invents a
 * denial over data the reads themselves would return.
 */
export function resolveReplayActiveRole(input: {
  readonly grantedRoleIds: readonly RoleId[];
  readonly requested?: string;
  readonly defaultRoleId?: RoleId;
}): ReplayActiveRoleResolution {
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
