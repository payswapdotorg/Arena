/**
 * Intervention mode contract (Work Order C007; issue #114) — the typed
 * mapping from the eight approved ES1.0 escalation modes (spec/
 * expert-escalation-api.md; @arena/escalation's closed vocabulary) onto
 * the six EES1.0 session-mode policies C006 enforces (@arena/
 * expert-session's SESSION_MODE_CAPABILITIES).
 *
 * THE ESCALATION-MODES LAW (spec/human-escalation-work-items.md):
 *   "A request may transition between modes only through explicit
 *    lifecycle state and authorization."
 *
 * Enforced here as THREE fail-closed guards, each returning a
 * MACHINE-READABLE verdict (closed reason vocabulary — never a bare
 * boolean) and a throwing twin:
 *
 *   1. checkModeAuthorization — permitted modes come from the
 *      EscalationRequest's escalationModes; an unlisted or unknown mode
 *      is a typed UNPERMITTED_MODE / INVALID_MODE rejection, never a
 *      silent coercion to a weaker or stronger mode;
 *   2. checkModeTransition — a request may transition between modes
 *      only while the C001 escalation lifecycle sits in an explicit
 *      mid-flight state (in_progress, or revision_required re-entering
 *      in_progress) AND the target mode is authorized;
 *   3. checkModeSessionPolicy — the EES1.0 session-mode policy the
 *      intervention runs under must be within the C006 capsule's
 *      allowedModes (the capsule — not this package — is the enforcement
 *      authority for what the expert may DO).
 *
 * The five LIVE work modes (solve/correct/unblock/review/teach) require
 * a bounded-replica environment session; the three informational modes
 * (tool_gap/knowledge/evaluate) grant observation only under C006's
 * derivation and never upgrade an intervention by themselves.
 */

import { ESCALATION_MODES } from '@arena/escalation';
import type { EscalationMode, EscalationState } from '@arena/escalation';
import { EXPERT_SESSION_MODES } from '@arena/expert-session';
import type { ExpertSessionMode } from '@arena/expert-session';
import { INTERVENTION_ERROR_CODES, InterventionError } from './errors.js';

// ---------------------------------------------------------------------------
// The mode table (ES1.0 escalation mode → EES1.0 session-mode policy)
// ---------------------------------------------------------------------------

/** The five LIVE intervention modes (EES1.0 work happens in a session). */
export const LIVE_INTERVENTION_MODES = Object.freeze([
  'solve',
  'correct',
  'unblock',
  'review',
  'teach',
] as const);
export type LiveInterventionMode = (typeof LIVE_INTERVENTION_MODES)[number];

/** The three informational modes (observation-floor sessions only). */
export const INFORMATIONAL_INTERVENTION_MODES = Object.freeze([
  'tool_gap',
  'knowledge',
  'evaluate',
] as const);
export type InformationalInterventionMode = (typeof INFORMATIONAL_INTERVENTION_MODES)[number];

export function isLiveInterventionMode(value: unknown): value is LiveInterventionMode {
  return (
    typeof value === 'string' &&
    (LIVE_INTERVENTION_MODES as readonly string[]).includes(value)
  );
}

export function isInformationalInterventionMode(
  value: unknown,
): value is InformationalInterventionMode {
  return (
    typeof value === 'string' &&
    (INFORMATIONAL_INTERVENTION_MODES as readonly string[]).includes(value)
  );
}

/** One row of the mode contract: the EES1.0 policy + result shape per mode. */
export interface InterventionModeProfile {
  /** The escalation mode this row authorizes. */
  readonly mode: EscalationMode;
  /** The EES1.0 session-mode policy C006 enforces for this mode. */
  readonly sessionMode: ExpertSessionMode;
  /** True when a bounded-replica environment session is REQUIRED. */
  readonly requiresBoundedSession: boolean;
  /** The primary C001 escalation result kind this mode produces. */
  readonly primaryResultKind:
    | 'correction'
    | 'unblock'
    | 'solution'
    | 'review'
    | 'evidence-bundle'
    | 'tool-gap-signal'
    | 'knowledge-patch'
    | 'evaluation-verdict';
  /** Observable capture is MANDATORY for this mode (EES1.0 Teach). */
  readonly captureMandatory: boolean;
}

/**
 * THE MODE TABLE — every approved ES1.0 escalation mode maps to exactly
 * one EES1.0 session-mode policy (mirroring C006's deriveSessionModes
 * row-for-row) plus its C007 result-contract shape. Closure over the
 * closed vocabulary is asserted by the modes test suite.
 */
export const INTERVENTION_MODE_TABLE: Readonly<Record<EscalationMode, InterventionModeProfile>> =
  Object.freeze({
    solve: Object.freeze({
      mode: 'solve',
      sessionMode: 'takeover',
      requiresBoundedSession: true,
      primaryResultKind: 'solution',
      captureMandatory: false,
    }),
    correct: Object.freeze({
      mode: 'correct',
      sessionMode: 'correct',
      requiresBoundedSession: true,
      primaryResultKind: 'correction',
      captureMandatory: false,
    }),
    unblock: Object.freeze({
      mode: 'unblock',
      sessionMode: 'unblock',
      requiresBoundedSession: true,
      primaryResultKind: 'unblock',
      captureMandatory: false,
    }),
    review: Object.freeze({
      mode: 'review',
      sessionMode: 'review',
      requiresBoundedSession: true,
      primaryResultKind: 'review',
      captureMandatory: false,
    }),
    teach: Object.freeze({
      mode: 'teach',
      sessionMode: 'teach',
      requiresBoundedSession: true,
      primaryResultKind: 'evidence-bundle',
      captureMandatory: true,
    }),
    tool_gap: Object.freeze({
      mode: 'tool_gap',
      sessionMode: 'observe',
      requiresBoundedSession: false,
      primaryResultKind: 'tool-gap-signal',
      captureMandatory: false,
    }),
    knowledge: Object.freeze({
      mode: 'knowledge',
      sessionMode: 'observe',
      requiresBoundedSession: false,
      primaryResultKind: 'knowledge-patch',
      captureMandatory: false,
    }),
    evaluate: Object.freeze({
      mode: 'evaluate',
      sessionMode: 'observe',
      requiresBoundedSession: false,
      primaryResultKind: 'evaluation-verdict',
      captureMandatory: false,
    }),
  });

/** The mode profile for an escalation mode (fail-closed on unknown modes). */
export function profileForMode(mode: string): InterventionModeProfile {
  if (!(ESCALATION_MODES as readonly string[]).includes(mode)) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_MODE, {
      message: `unknown escalation mode: ${JSON.stringify(mode)}`,
      details: { approved: ESCALATION_MODES },
    });
  }
  return INTERVENTION_MODE_TABLE[mode as EscalationMode];
}

/** The EES1.0 session-mode policy an escalation mode runs under. */
export function sessionModeForEscalationMode(mode: string): ExpertSessionMode {
  return profileForMode(mode).sessionMode;
}

// ---------------------------------------------------------------------------
// Guard 1 — mode authorization (permitted modes come from the request)
// ---------------------------------------------------------------------------

export const MODE_AUTHORIZATION_REASONS = Object.freeze([
  'mode_authorized',
  'mode_not_in_request',
  'mode_unknown',
  'mode_requires_bounded_session',
] as const);
export type ModeAuthorizationReason = (typeof MODE_AUTHORIZATION_REASONS)[number];

export function isModeAuthorizationReason(value: unknown): value is ModeAuthorizationReason {
  return (
    typeof value === 'string' &&
    (MODE_AUTHORIZATION_REASONS as readonly string[]).includes(value)
  );
}

/** The machine-readable verdict of a mode-authorization check. */
export interface ModeAuthorizationCheck {
  readonly allowed: boolean;
  readonly reason: ModeAuthorizationReason;
  readonly mode: string;
  /** The modes the request authorizes (closed @arena/escalation vocabulary). */
  readonly permittedModes: readonly EscalationMode[];
}

/** The request view the authorization guard needs (ES1.0 fields). */
export interface ModeAuthorizationRequestView {
  /** escalationModes from the EscalationRequest (>= 1, closed vocabulary). */
  readonly escalationModes: readonly string[];
  /** environmentSessionPolicy.sessionMode from the EscalationRequest. */
  readonly environmentSessionMode?: string;
}

/**
 * May the expert work in this escalation mode? Permitted modes come from
 * the EscalationRequest; an unlisted mode is a typed failure — NEVER a
 * silent coercion to a weaker or stronger mode.
 */
export function checkModeAuthorization(
  request: ModeAuthorizationRequestView,
  mode: string,
): ModeAuthorizationCheck {
  const deny = (reason: ModeAuthorizationReason): ModeAuthorizationCheck => ({
    allowed: false,
    reason,
    mode,
    permittedModes: request.escalationModes as readonly EscalationMode[],
  });
  if (!(ESCALATION_MODES as readonly string[]).includes(mode)) {
    return deny('mode_unknown');
  }
  if (!(request.escalationModes as readonly string[]).includes(mode)) {
    return deny('mode_not_in_request');
  }
  const profile = INTERVENTION_MODE_TABLE[mode as EscalationMode];
  if (
    profile.requiresBoundedSession &&
    request.environmentSessionMode !== undefined &&
    request.environmentSessionMode !== 'bounded-replica'
  ) {
    return deny('mode_requires_bounded_session');
  }
  return {
    allowed: true,
    reason: 'mode_authorized',
    mode,
    permittedModes: request.escalationModes as readonly EscalationMode[],
  };
}

/** Fail-closed enforcement of the mode-authorization guard. */
export function assertModeAuthorized(
  request: ModeAuthorizationRequestView,
  mode: string,
): void {
  const verdict = checkModeAuthorization(request, mode);
  if (verdict.allowed) return;
  if (verdict.reason === 'mode_unknown') {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_MODE, {
      message: `escalation mode is not in the approved closed vocabulary: ${JSON.stringify(mode)}`,
      details: { mode, approved: ESCALATION_MODES },
    });
  }
  if (verdict.reason === 'mode_requires_bounded_session') {
    throw new InterventionError(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE, {
      message: `live intervention mode '${mode}' requires a bounded-replica environment session (environmentSessionPolicy.sessionMode: ${JSON.stringify(request.environmentSessionMode)})`,
      details: { mode, environmentSessionMode: request.environmentSessionMode },
    });
  }
  throw new InterventionError(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE, {
    message: `escalation mode '${mode}' is not permitted for this request (permitted: ${JSON.stringify([...request.escalationModes])})`,
    details: { mode, permitted: [...request.escalationModes] },
  });
}

// ---------------------------------------------------------------------------
// Guard 2 — mode transitions (explicit lifecycle state + authorization)
// ---------------------------------------------------------------------------

export const MODE_TRANSITION_REASONS = Object.freeze([
  'mode_transition_ok',
  'mode_transition_same_mode',
  'mode_transition_not_authorized',
  'mode_transition_wrong_state',
] as const);
export type ModeTransitionReason = (typeof MODE_TRANSITION_REASONS)[number];

export function isModeTransitionReason(value: unknown): value is ModeTransitionReason {
  return (
    typeof value === 'string' &&
    (MODE_TRANSITION_REASONS as readonly string[]).includes(value)
  );
}

/** The machine-readable verdict of a proposed mode transition. */
export interface ModeTransitionCheck {
  readonly allowed: boolean;
  readonly reason: ModeTransitionReason;
  readonly from: string;
  readonly to: string;
  /** The C001 escalation lifecycle state the check ran against. */
  readonly escalationState: EscalationState | string;
}

/**
 * The escalation-modes law: a request may transition between modes only
 * through EXPLICIT lifecycle state and authorization. The explicit
 * mid-flight states are `in_progress` and `revision_required` (the state
 * C001 routes a failed validation into so the expert can revise — the
 * natural re-entry point for a different authorized mode).
 */
export const MODE_TRANSITION_STATES = Object.freeze(['in_progress', 'revision_required'] as const);
export type ModeTransitionCapableState = (typeof MODE_TRANSITION_STATES)[number];

export interface ModeTransitionContext {
  /** The mode the intervention currently runs in. */
  readonly from: string;
  /** The requested next mode. */
  readonly to: string;
  /** The CURRENT C001 escalation lifecycle state. */
  readonly escalationState: string;
  /** The EscalationRequest view (authorization source). */
  readonly request: ModeAuthorizationRequestView;
}

/**
 * May the intervention switch from one authorized mode to another?
 * Requires: a different mode, explicit lifecycle state, and a target
 * mode the request authorizes (bounded-session policy included).
 */
export function checkModeTransition(context: ModeTransitionContext): ModeTransitionCheck {
  const base = {
    from: context.from,
    to: context.to,
    escalationState: context.escalationState,
  };
  if (context.from === context.to) {
    return { allowed: false, reason: 'mode_transition_same_mode', ...base };
  }
  const authorization = checkModeAuthorization(context.request, context.to);
  if (!authorization.allowed) {
    return { allowed: false, reason: 'mode_transition_not_authorized', ...base };
  }
  if (!(MODE_TRANSITION_STATES as readonly string[]).includes(context.escalationState)) {
    return { allowed: false, reason: 'mode_transition_wrong_state', ...base };
  }
  return { allowed: true, reason: 'mode_transition_ok', ...base };
}

/** Fail-closed enforcement of the escalation-modes law. */
export function assertModeTransition(context: ModeTransitionContext): void {
  const verdict = checkModeTransition(context);
  if (verdict.allowed) return;
  if (verdict.reason === 'mode_transition_same_mode') {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_TRANSITION, {
      message: `mode transition to the same mode ('${context.from}') is not a transition`,
      details: { from: context.from, to: context.to },
    });
  }
  if (verdict.reason === 'mode_transition_not_authorized') {
    throw new InterventionError(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE, {
      message: `mode transition '${context.from}' -> '${context.to}' denied: the target mode is not authorized for this request`,
      details: { from: context.from, to: context.to, permitted: [...context.request.escalationModes] },
    });
  }
  throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_TRANSITION, {
    message: `mode transition '${context.from}' -> '${context.to}' denied: escalation lifecycle state '${context.escalationState}' permits no mode transition (requires ${JSON.stringify([...MODE_TRANSITION_STATES])})`,
    details: { from: context.from, to: context.to, escalationState: context.escalationState },
  });
}

// ---------------------------------------------------------------------------
// Guard 3 — session-policy containment (the C006 capsule is the authority)
// ---------------------------------------------------------------------------

export const MODE_SESSION_POLICY_REASONS = Object.freeze([
  'session_policy_ok',
  'session_policy_not_derivable',
] as const);
export type ModeSessionPolicyReason = (typeof MODE_SESSION_POLICY_REASONS)[number];

/** The machine-readable verdict of the capsule-policy containment check. */
export interface ModeSessionPolicyCheck {
  readonly allowed: boolean;
  readonly reason: ModeSessionPolicyReason;
  readonly mode: string;
  /** The EES1.0 session mode this escalation mode requires. */
  readonly requiredSessionMode: ExpertSessionMode;
  /** The capsule's allowedModes (C006 derivation; observe is the floor). */
  readonly capsuleAllowedModes: readonly ExpertSessionMode[];
}

/**
 * The EES1.0 session-mode policy an escalation mode runs under must be
 * within the C006 capsule's allowedModes. The CAPSULE enforces what the
 * expert may do; this guard keeps the intervention's mode contract from
 * drifting outside the capsule's derived allowance.
 */
export function checkModeSessionPolicy(
  mode: string,
  capsuleAllowedModes: readonly string[],
): ModeSessionPolicyCheck {
  const profile = profileForMode(mode);
  const allowed = (capsuleAllowedModes as readonly string[]).includes(profile.sessionMode);
  return {
    allowed,
    reason: allowed ? 'session_policy_ok' : 'session_policy_not_derivable',
    mode,
    requiredSessionMode: profile.sessionMode,
    capsuleAllowedModes: capsuleAllowedModes as readonly ExpertSessionMode[],
  };
}

/** Fail-closed enforcement of the capsule-policy containment guard. */
export function assertModeSessionPolicy(mode: string, capsuleAllowedModes: readonly string[]): void {
  const verdict = checkModeSessionPolicy(mode, capsuleAllowedModes);
  if (!verdict.allowed) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE, {
      message: `escalation mode '${mode}' requires session mode '${verdict.requiredSessionMode}', which the capsule does not allow (${JSON.stringify([...capsuleAllowedModes])})`,
      details: { mode, requiredSessionMode: verdict.requiredSessionMode, capsuleAllowedModes: [...capsuleAllowedModes] },
    });
  }
}

/** Every session mode referenced by the mode table (test closure helper). */
export function sessionModesReferencedByTable(): readonly ExpertSessionMode[] {
  const modes = new Set<ExpertSessionMode>();
  for (const mode of ESCALATION_MODES) {
    modes.add(INTERVENTION_MODE_TABLE[mode].sessionMode);
  }
  return Object.freeze([...modes]);
}

/** True when every referenced session mode is in the EES1.0 vocabulary. */
export function modeTableSessionModesAreClosed(): boolean {
  const referenced = sessionModesReferencedByTable();
  return (
    referenced.every((mode) => (EXPERT_SESSION_MODES as readonly string[]).includes(mode)) &&
    referenced.length > 0
  );
}
