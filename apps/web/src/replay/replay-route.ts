/**
 * Replay-route composition (Work Order B011; issue #86;
 * apps/web/src/replay). SERVER-ONLY.
 *
 * Mirrors the B007/B010/B012 route patterns:
 *   - `/replay` and `/replay/[runKey]` probe the browser session FIRST
 *     (fail closed — an unauthenticated visitor gets the auth-required
 *     notice, NEVER an anonymous surface). In the local session posture
 *     no runs are recorded, so the run list renders its HONEST empty
 *     state and every run detail resolves the honest not-found outcome —
 *     nothing is fabricated;
 *   - `/demo/replay/**` composes over the shared B006 demo runtime (zero
 *     credentials, deterministic corpus, reserved demo tenant) with the
 *     deterministic B011 replay corpus, under the demo labelling
 *     contract;
 *   - role context is a LENS: the active role comes from explicit query
 *     state (`?role=`), resolved against the granted set — a
 *     not-granted request renders a truthful denial, never a fake
 *     switch;
 *   - step selection is explicit query state (`?step=`) — the inspector
 *     renders the requested step or the honest out-of-range note;
 *   - the run list scrolls with OPAQUE continuation tokens (`?after=`)
 *     — an invalid token renders the honest fail-closed notice, never a
 *     silently reset page.
 */

import type { CanonicalReadModel } from '../../../../packages/read-model/src/index.js';
import { ROLE_IDS } from '../../../../packages/role-context/src/index.js';
import type { RoleId } from '../../../../packages/role-context/src/index.js';
import {
  REPLAY_OBSERVATIONAL_NOTE,
  replayRoleLens,
  resolveReplayActiveRole,
  scrollReplayRuns,
  toReplayRunDetail,
  verifyReplayTrajectoryChain,
  REPLAY_UI_ERROR_CODES,
} from '../../../../packages/replay-ui/src/index.js';
import type {
  ReplayRunSummary,
  ReplayRoleLens,
} from '../../../../packages/replay-ui/src/index.js';
import { REPLAY_DISTINCTION_NOTE, REPLAY_ROLE_LENS_NOTE } from './state-mark.js';
import {
  getDemoReplayContext,
  resolveSessionReplay,
} from './runtime.js';
import type { CockpitSessionFacts } from './runtime.js';

// ---------------------------------------------------------------------------
// Shared view-model shapes
// ---------------------------------------------------------------------------

/** The role-switch state every replay screen carries (a lens, never an authorization). */
export interface ReplayRoleSwitchModel {
  readonly activeRoleId: RoleId;
  readonly activeLens: ReplayRoleLens;
  readonly grantedRoleIds: readonly RoleId[];
  /** True when the requested role was NOT granted (the truthful denial). */
  readonly denied: boolean;
  /** The requested-but-not-granted role id, verbatim (null when none). */
  readonly deniedRequested: string | null;
  readonly roleHrefBase: string;
  readonly lensNote: string;
}

/** Common facts every replay screen renders. */
export interface ReplaySurfaceFacts {
  readonly mode: 'session' | 'demo';
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly principalLabel: string;
  readonly observationalNote: string;
  readonly distinctionNote: string;
  readonly demo: {
    readonly isDemo: boolean;
    readonly corpusHash?: string;
  };
}

function surfaceFacts(input: {
  readonly mode: 'session' | 'demo';
  readonly facts: CockpitSessionFacts;
  readonly corpusHash?: string;
}): ReplaySurfaceFacts {
  return Object.freeze({
    mode: input.mode,
    tenantId: input.facts.tenantId,
    workspaceId: input.facts.workspaceId,
    principalLabel: input.facts.principalLabel,
    observationalNote: REPLAY_OBSERVATIONAL_NOTE,
    distinctionNote: REPLAY_DISTINCTION_NOTE,
    demo: Object.freeze({
      isDemo: input.mode === 'demo',
      ...(input.corpusHash !== undefined ? { corpusHash: input.corpusHash } : {}),
    }),
  });
}

function roleSwitchOf(input: {
  readonly grantedRoleIds: readonly RoleId[];
  readonly requestedRoleId?: string;
  readonly roleHrefBase: string;
}): ReplayRoleSwitchModel {
  const resolution = resolveReplayActiveRole({
    grantedRoleIds: input.grantedRoleIds,
    ...(input.requestedRoleId !== undefined ? { requested: input.requestedRoleId } : {}),
  });
  if (resolution.status === 'granted') {
    return Object.freeze({
      activeRoleId: resolution.roleId,
      activeLens: replayRoleLens(resolution.roleId),
      grantedRoleIds: Object.freeze([...input.grantedRoleIds]),
      denied: false,
      deniedRequested: null,
      roleHrefBase: input.roleHrefBase,
      lensNote: REPLAY_ROLE_LENS_NOTE,
    });
  }
  return Object.freeze({
    activeRoleId: resolution.fallbackRoleId,
    activeLens: replayRoleLens(resolution.fallbackRoleId),
    grantedRoleIds: Object.freeze([...input.grantedRoleIds]),
    denied: true,
    deniedRequested: resolution.requested,
    roleHrefBase: input.roleHrefBase,
    lensNote: REPLAY_ROLE_LENS_NOTE,
  });
}

// ---------------------------------------------------------------------------
// The /replay home (run list) view model
// ---------------------------------------------------------------------------

/** The complete `/replay` + `/demo/replay` home view model. */
export interface ReplayHomeViewModel extends ReplaySurfaceFacts {
  /** The run-list page rows (truth-classed summaries). */
  readonly runs: readonly ReplayRunSummary[];
  /** Total runs known to the scrolled list (the scroll's authority). */
  readonly totalKnown: number;
  /** The continuation token for the next page (null when this is the last). */
  readonly nextContinuation: string | null;
  /** Base href for run detail links ('/replay' session, '/demo/replay' demo). */
  readonly runHrefBase: string;
  readonly roleSwitch: ReplayRoleSwitchModel;
  /** The honest note when the list is empty (session posture). */
  readonly emptyNote: string | null;
}

/** What `/replay` renders: auth-required, the honest invalid-continuation notice, or the run list. */
export type ReplayHomeExperience =
  | { readonly kind: 'auth-required' }
  | {
      readonly kind: 'invalid-continuation';
      readonly code: string;
      readonly message: string;
    }
  | { readonly kind: 'home'; readonly view: ReplayHomeViewModel };

export interface ResolveReplayHomeOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: NonNullable<Parameters<typeof resolveSessionReplay>[0]>['probe'];
  /** Read-model override (composition seam). */
  readonly readModel?: CanonicalReadModel;
  /** The requested role lens (explicit `?role=` query state). */
  readonly requestedRoleId?: string;
  /** The page size (bounded by the run-list surface). */
  readonly limit?: number;
  /** The continuation token (explicit `?after=` query state). */
  readonly continuation?: string;
}

/**
 * Resolve the `/replay` experience: probe the browser session (fail
 * closed — typed AUTH_* outcomes render the auth-required notice, never
 * an anonymous surface), then build the run-list view. In the local
 * session posture no runs are recorded, so the list renders its HONEST
 * empty state — nothing is fabricated to fill the space.
 */
export async function resolveReplayHome(
  options: ResolveReplayHomeOptions = {},
): Promise<ReplayHomeExperience> {
  const outcome = await resolveSessionReplay({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  return {
    kind: 'home',
    view: Object.freeze({
      ...surfaceFacts({ mode: 'session', facts: outcome.facts }),
      runs: Object.freeze([]),
      totalKnown: 0,
      nextContinuation: null,
      runHrefBase: '/replay',
      roleSwitch: roleSwitchOf({
        grantedRoleIds: outcome.facts.grantedRoleIds,
        ...(options.requestedRoleId !== undefined
          ? { requestedRoleId: options.requestedRoleId }
          : {}),
        roleHrefBase: '/replay',
      }),
      emptyNote:
        'No runs are recorded in this workspace posture yet. Runs (and their trajectories, environment event streams and linked evaluation/verification records) land here through the canonical seams as the hosted control plane wires them — nothing is fabricated to fill the space.',
    } satisfies ReplayHomeViewModel),
  };
}

/** The deterministic page size the demo run list uses (exercises continuation visibly). */
export const DEMO_REPLAY_PAGE_SIZE = 2 as const;

/**
 * Resolve the DEMO `/demo/replay` home over the deterministic corpus
 * (B006 posture): the run list scrolls with bounded pages + opaque
 * continuation tokens. An invalid token renders the honest
 * fail-closed notice — never a silently reset page.
 */
export async function resolveDemoReplayHome(
  options: Omit<ResolveReplayHomeOptions, 'probe' | 'readModel'> = {},
): Promise<ReplayHomeExperience> {
  const context = await getDemoReplayContext();
  const summaries = context.corpus.runs.map((run) => ({
    runId: run.runId,
    submittedAt: run.runRecord.submittedAt,
    outcome:
      run.runResult !== null
        ? 'completed'
        : run.trajectory.entries.some((entry) => entry.kind === 'completion')
          ? 'failed'
          : 'in-flight',
    stepCount: run.trajectory.entries.length,
    trajectoryDigest: run.trajectory.chainHead,
  }));
  try {
    const page = scrollReplayRuns(summaries, {
      limit: options.limit ?? DEMO_REPLAY_PAGE_SIZE,
      ...(options.continuation !== undefined ? { continuation: options.continuation } : {}),
    });
    return {
      kind: 'home',
      view: Object.freeze({
        ...surfaceFacts({ mode: 'demo', facts: context.facts, corpusHash: context.corpusHash }),
        runs: page.rows,
        totalKnown: page.totalKnown,
        nextContinuation: page.nextContinuation,
        runHrefBase: '/demo/replay',
        roleSwitch: roleSwitchOf({
          grantedRoleIds: [...ROLE_IDS],
          ...(options.requestedRoleId !== undefined
            ? { requestedRoleId: options.requestedRoleId }
            : {}),
          roleHrefBase: '/demo/replay',
        }),
        emptyNote: null,
      } satisfies ReplayHomeViewModel),
    };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION) {
      return {
        kind: 'invalid-continuation',
        code: REPLAY_UI_ERROR_CODES.INVALID_CONTINUATION,
        message: error instanceof Error ? error.message : 'the continuation token was rejected',
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The run-detail experiences
// ---------------------------------------------------------------------------

/** What a run detail renders: auth-required, honest not-found, or the run. */
export type ReplayRunExperience =
  | { readonly kind: 'auth-required' }
  | { readonly kind: 'not-found'; readonly runKey: string }
  | { readonly kind: 'run'; readonly view: ReplayRunScreenModel };

/** The complete run-detail screen view model. */
export interface ReplayRunScreenModel extends ReplaySurfaceFacts {
  readonly runHrefBase: string;
  readonly roleSwitch: ReplayRoleSwitchModel;
  readonly detail: ReturnType<typeof toReplayRunDetail>;
}

export interface ResolveReplayRunOptions {
  /** Session probe override (test seam); default: the B004 session boundary. */
  readonly probe?: NonNullable<Parameters<typeof resolveSessionReplay>[0]>['probe'];
  /** Read-model override (composition seam). */
  readonly readModel?: CanonicalReadModel;
  readonly runKey: string;
  /** The requested role lens (explicit `?role=` query state). */
  readonly requestedRoleId?: string;
  /** The requested step sequence (explicit `?step=` query state). */
  readonly requestedSequence?: number | null;
}

/**
 * Resolve the `/replay/[runKey]` experience. The session posture has no
 * recorded runs, so an authenticated session resolves the honest
 * not-found outcome — never a fabricated run.
 */
export async function resolveReplayRun(
  options: ResolveReplayRunOptions,
): Promise<ReplayRunExperience> {
  const outcome = await resolveSessionReplay({
    ...(options.probe !== undefined ? { probe: options.probe } : {}),
    ...(options.readModel !== undefined ? { readModel: options.readModel } : {}),
  });
  if (outcome.status === 'unauthenticated') {
    return { kind: 'auth-required' };
  }
  return { kind: 'not-found', runKey: options.runKey };
}

/**
 * Resolve the DEMO `/demo/replay/[runKey]` detail over the
 * deterministic corpus: the full run-inspection assembly (timeline,
 * event stream, linkage, step selection) plus the ASYNC full-chain
 * verification outcome.
 */
export async function resolveDemoReplayRun(
  options: Omit<ResolveReplayRunOptions, 'probe' | 'readModel'>,
): Promise<ReplayRunExperience> {
  const context = await getDemoReplayContext();
  const run = context.corpus.runs.find(
    (candidate) => candidate.runId === `${context.facts.tenantId}/${options.runKey}`,
  );
  if (run === undefined) {
    return { kind: 'not-found', runKey: options.runKey };
  }
  const chainVerification = await verifyReplayTrajectoryChain(run.trajectory);
  const detail = toReplayRunDetail({
    runId: run.runId,
    trajectoryPayload: run.trajectory,
    eventStreamPayload: run.eventLog,
    runRecordPayload: run.runRecord,
    runResultPayload: run.runResult,
    evaluationRecords: run.evaluationRecords,
    verificationRecords: run.verificationRecords,
    ...(options.requestedSequence !== undefined
      ? { requestedSequence: options.requestedSequence }
      : {}),
    chainVerification,
  });
  return {
    kind: 'run',
    view: Object.freeze({
      ...surfaceFacts({ mode: 'demo', facts: context.facts, corpusHash: context.corpusHash }),
      runHrefBase: '/demo/replay',
      roleSwitch: roleSwitchOf({
        grantedRoleIds: [...ROLE_IDS],
        ...(options.requestedRoleId !== undefined
          ? { requestedRoleId: options.requestedRoleId }
          : {}),
        roleHrefBase: '/demo/replay',
      }),
      detail,
    } satisfies ReplayRunScreenModel),
  };
}

/** Build the step-selection href for the run detail (preserves the active role lens). */
export function replayStepHref(input: {
  readonly runHrefBase: string;
  readonly runKey: string;
  readonly step: number;
  readonly activeRoleId?: RoleId;
}): string {
  const role = input.activeRoleId !== undefined ? `?role=${input.activeRoleId}` : '';
  return `${input.runHrefBase}/${encodeURIComponent(input.runKey)}${role}${role !== '' ? '&' : '?'}step=${String(input.step)}`;
}

/** Build the run-list continuation href (preserves the active role lens). */
export function replayContinuationHref(input: {
  readonly runHrefBase: string;
  readonly continuation: string;
  readonly activeRoleId?: RoleId;
}): string {
  const role = input.activeRoleId !== undefined ? `?role=${input.activeRoleId}` : '';
  return `${input.runHrefBase}${role}${role !== '' ? '&' : '?'}after=${encodeURIComponent(input.continuation)}`;
}
