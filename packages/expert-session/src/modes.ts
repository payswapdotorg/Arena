/**
 * Session-mode enforcement (Work Order C006; spec
 * expert-environment-session.md EES1.0 "Session modes").
 *
 * The SIX EES1.0 session modes — Observe / Correct / Unblock / Takeover /
 * Teach / Review — are a TYPED capability policy over what the expert can
 * observe and do inside a bounded capsule:
 *
 *   - Observe   — inspect the agent's current state (read-only);
 *   - Correct   — edit or correct a result;
 *   - Unblock   — supply exactly the missing information or decision;
 *   - Takeover  — complete the subproblem (tools + artifacts + result);
 *   - Teach     — perform the solution while observable actions and
 *                 artifacts are captured (capture is MANDATORY);
 *   - Review    — critique or validate a candidate solution.
 *
 * Allowed modes are derived from the EscalationRequest's escalationModes
 * (@arena/escalation's closed vocabulary — SOLVE/CORRECT/UNBLOCK/REVIEW/
 * TEACH/TOOL_GAP/KNOWLEDGE/EVALUATE) via deriveSessionModes; Observe is
 * always available when a bounded session exists (it is inspection, not
 * intervention). Mode escalation beyond the derived allowance is a typed
 * UNPERMITTED_MODE failure — never a silent capability grant.
 */

import { ESCALATION_MODES } from '@arena/escalation';
import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';

// ---------------------------------------------------------------------------
// The six EES1.0 session modes
// ---------------------------------------------------------------------------

export const EXPERT_SESSION_MODES = Object.freeze([
  'observe',
  'correct',
  'unblock',
  'takeover',
  'teach',
  'review',
] as const);
export type ExpertSessionMode = (typeof EXPERT_SESSION_MODES)[number];

export function isExpertSessionMode(value: unknown): value is ExpertSessionMode {
  return (
    typeof value === 'string' &&
    (EXPERT_SESSION_MODES as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Capability policy per mode
// ---------------------------------------------------------------------------

/** What the expert may DO inside the capsule under a given mode. */
export interface SessionModeCapabilities {
  /** Inspect screened capsule state (always true — observation floor). */
  readonly canObserve: boolean;
  /** Attach structured annotations to evidence. */
  readonly canAnnotate: boolean;
  /** Edit capsule artifacts (proposed patches — never live-world writes). */
  readonly canEditArtifacts: boolean;
  /** Invoke capsule-bounded tools. */
  readonly canRunTools: boolean;
  /** Supply exactly the missing information or decision. */
  readonly canSupplyInformation: boolean;
  /** Submit a session result. */
  readonly canSubmitResult: boolean;
  /** Observable actions and artifacts MUST be captured (Teach). */
  readonly captureMandatory: boolean;
}

export const SESSION_MODE_CAPABILITIES: Readonly<Record<ExpertSessionMode, SessionModeCapabilities>> =
  Object.freeze({
    observe: Object.freeze({
      canObserve: true,
      canAnnotate: false,
      canEditArtifacts: false,
      canRunTools: false,
      canSupplyInformation: false,
      canSubmitResult: false,
      captureMandatory: false,
    }),
    correct: Object.freeze({
      canObserve: true,
      canAnnotate: true,
      canEditArtifacts: true,
      canRunTools: false,
      canSupplyInformation: false,
      canSubmitResult: true,
      captureMandatory: false,
    }),
    unblock: Object.freeze({
      canObserve: true,
      canAnnotate: true,
      canEditArtifacts: false,
      canRunTools: false,
      canSupplyInformation: true,
      canSubmitResult: true,
      captureMandatory: false,
    }),
    takeover: Object.freeze({
      canObserve: true,
      canAnnotate: true,
      canEditArtifacts: true,
      canRunTools: true,
      canSupplyInformation: true,
      canSubmitResult: true,
      captureMandatory: false,
    }),
    teach: Object.freeze({
      canObserve: true,
      canAnnotate: true,
      canEditArtifacts: true,
      canRunTools: true,
      canSupplyInformation: true,
      canSubmitResult: true,
      captureMandatory: true,
    }),
    review: Object.freeze({
      canObserve: true,
      canAnnotate: true,
      canEditArtifacts: false,
      canRunTools: false,
      canSupplyInformation: false,
      canSubmitResult: true,
      captureMandatory: false,
    }),
  });

/** Capabilities granted by one session mode (frozen table lookup). */
export function capabilitiesForMode(mode: ExpertSessionMode): SessionModeCapabilities {
  return SESSION_MODE_CAPABILITIES[mode];
}

// ---------------------------------------------------------------------------
// Session actions (what an expert attempt looks like)
// ---------------------------------------------------------------------------

export const SESSION_ACTIONS = Object.freeze([
  'observe-state',
  'annotate',
  'edit-artifact',
  'invoke-tool',
  'supply-information',
  'submit-result',
  'signal-tool-gap',
  'capture-checkpoint',
] as const);
export type SessionAction = (typeof SESSION_ACTIONS)[number];

export function isSessionAction(value: unknown): value is SessionAction {
  return typeof value === 'string' && (SESSION_ACTIONS as readonly string[]).includes(value);
}

export const SESSION_ACTION_REASONS = Object.freeze([
  'action_ok',
  'mode_forbids_action',
] as const);
export type SessionActionReason = (typeof SESSION_ACTION_REASONS)[number];

/** Machine-readable mode/action verdict (never a bare boolean). */
export interface SessionActionCheck {
  readonly allowed: boolean;
  readonly reason: SessionActionReason;
  readonly mode: ExpertSessionMode;
  readonly action: SessionAction;
}

const ACTION_CAPABILITY: Readonly<Record<SessionAction, keyof SessionModeCapabilities>> = Object.freeze({
  'observe-state': 'canObserve',
  annotate: 'canAnnotate',
  'edit-artifact': 'canEditArtifacts',
  'invoke-tool': 'canRunTools',
  'supply-information': 'canSupplyInformation',
  'submit-result': 'canSubmitResult',
  // Tool-gap signalling and checkpointing are ALWAYS permitted inside a
  // session — they are observations about capability, not interventions.
  'signal-tool-gap': 'canObserve',
  'capture-checkpoint': 'canObserve',
});

/** May the expert perform this action under this mode? */
export function checkSessionAction(mode: ExpertSessionMode, action: SessionAction): SessionActionCheck {
  const capabilities = capabilitiesForMode(mode);
  const capability = ACTION_CAPABILITY[action];
  const allowed = capabilities[capability] === true;
  return {
    allowed,
    reason: allowed ? 'action_ok' : 'mode_forbids_action',
    mode,
    action,
  };
}

/** Fail-closed enforcement of the mode/action policy. */
export function assertSessionActionAllowed(mode: ExpertSessionMode, action: SessionAction): void {
  const verdict = checkSessionAction(mode, action);
  if (!verdict.allowed) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.UNPERMITTED_MODE, {
      message: `session mode '${mode}' forbids action '${action}'`,
      details: { mode, action, reason: verdict.reason },
    });
  }
}

// ---------------------------------------------------------------------------
// Derivation from the EscalationRequest's escalation modes
// ---------------------------------------------------------------------------

/** Escalation-mode → session-mode mapping (EES1.0 six modes; observe added). */
const ESCALATION_TO_SESSION_MODE: Readonly<Record<string, ExpertSessionMode>> = Object.freeze({
  solve: 'takeover',
  correct: 'correct',
  unblock: 'unblock',
  review: 'review',
  teach: 'teach',
  // Informational escalation modes grant observation only — the session
  // never gains intervention capability from them.
  'tool_gap': 'observe',
  knowledge: 'observe',
  evaluate: 'observe',
});

/**
 * Derive the allowed session modes from the EscalationRequest's
 * escalationModes. Observe is ALWAYS included (inspection floor); every
 * escalation mode maps to at most one session mode; unknown escalation
 * modes are a typed INVALID_MODE failure (fail-closed — the vocabulary
 * is @arena/escalation's closed set).
 */
export function deriveSessionModes(escalationModes: readonly string[]): readonly ExpertSessionMode[] {
  if (!Array.isArray(escalationModes) || escalationModes.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_MODE, {
      message: 'escalationModes must be a non-empty array to derive session modes',
    });
  }
  const modes = new Set<ExpertSessionMode>(['observe']);
  for (const escalationMode of escalationModes) {
    if (!(ESCALATION_MODES as readonly string[]).includes(escalationMode)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_MODE, {
        message: `unknown escalation mode: ${JSON.stringify(escalationMode)}`,
        details: { approved: ESCALATION_MODES },
      });
    }
    modes.add(ESCALATION_TO_SESSION_MODE[escalationMode] as ExpertSessionMode);
  }
  return Object.freeze([...modes]);
}

/** Fail-closed check that a session mode is within the allowed set. */
export function assertModeAllowed(mode: ExpertSessionMode, allowedModes: readonly ExpertSessionMode[]): void {
  if (!allowedModes.includes(mode)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.UNPERMITTED_MODE, {
      message: `session mode '${mode}' is not permitted for this escalation (allowed: ${JSON.stringify([...allowedModes])})`,
      details: { mode, allowed: [...allowedModes] },
    });
  }
}
