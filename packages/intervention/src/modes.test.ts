/**
 * Mode-contract suite (Work Order C007) — mapping-table closure across
 * ALL ES1.0 escalation modes, mode-authorization guards (fail-closed,
 * never coerced), the escalation-modes law (mode transitions only
 * through explicit lifecycle state + authorization), and the C006
 * capsule-policy containment guard.
 */

import { describe, expect, it } from 'vitest';
import { ESCALATION_MODES, ESCALATION_STATES } from '@arena/escalation';
import { EXPERT_SESSION_MODES } from '@arena/expert-session';
import { InterventionError, INTERVENTION_ERROR_CODES } from './errors.js';
import {
  INTERVENTION_MODE_TABLE,
  LIVE_INTERVENTION_MODES,
  MODE_TRANSITION_STATES,
  assertModeAuthorized,
  assertModeSessionPolicy,
  assertModeTransition,
  checkModeAuthorization,
  checkModeSessionPolicy,
  checkModeTransition,
  modeTableSessionModesAreClosed,
  profileForMode,
  sessionModeForEscalationMode,
} from './modes.js';

describe('mode table — closure across ALL ES1.0 escalation modes', () => {
  it('maps every approved escalation mode to exactly one profile', () => {
    expect(Object.keys(INTERVENTION_MODE_TABLE).sort()).toEqual([...ESCALATION_MODES].sort());
    for (const mode of ESCALATION_MODES) {
      expect(INTERVENTION_MODE_TABLE[mode].mode).toBe(mode);
    }
  });

  it('every mapped session mode is in the six-mode EES1.0 vocabulary', () => {
    expect(modeTableSessionModesAreClosed()).toBe(true);
    for (const mode of ESCALATION_MODES) {
      expect(EXPERT_SESSION_MODES).toContain(INTERVENTION_MODE_TABLE[mode].sessionMode);
    }
  });

  it('mirrors C006 deriveSessionModes row-for-row', () => {
    expect(sessionModeForEscalationMode('solve')).toBe('takeover');
    expect(sessionModeForEscalationMode('correct')).toBe('correct');
    expect(sessionModeForEscalationMode('unblock')).toBe('unblock');
    expect(sessionModeForEscalationMode('review')).toBe('review');
    expect(sessionModeForEscalationMode('teach')).toBe('teach');
    expect(sessionModeForEscalationMode('tool_gap')).toBe('observe');
    expect(sessionModeForEscalationMode('knowledge')).toBe('observe');
    expect(sessionModeForEscalationMode('evaluate')).toBe('observe');
  });

  it('the five live modes require a bounded replica; the informational three do not', () => {
    for (const mode of LIVE_INTERVENTION_MODES) {
      expect(profileForMode(mode).requiresBoundedSession).toBe(true);
    }
    for (const mode of ['tool_gap', 'knowledge', 'evaluate'] as const) {
      expect(profileForMode(mode).requiresBoundedSession).toBe(false);
      expect(profileForMode(mode).sessionMode).toBe('observe');
    }
  });

  it('only teach mandates observable capture', () => {
    for (const mode of ESCALATION_MODES) {
      expect(profileForMode(mode).captureMandatory).toBe(mode === 'teach');
    }
  });

  it('profileForMode fails closed on unknown modes', () => {
    expect(() => profileForMode('supervise')).toThrowError(InterventionError);
    try {
      profileForMode('supervise');
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.INVALID_MODE);
    }
  });
});

describe('mode-authorization guard — permitted modes come from the request', () => {
  const request = {
    escalationModes: ['correct', 'unblock'],
    environmentSessionMode: 'bounded-replica',
  };

  it('authorizes a listed mode', () => {
    const verdict = checkModeAuthorization(request, 'correct');
    expect(verdict).toEqual({
      allowed: true,
      reason: 'mode_authorized',
      mode: 'correct',
      permittedModes: ['correct', 'unblock'],
    });
  });

  it('rejects an UNLISTED mode with a typed verdict — never a coercion', () => {
    const verdict = checkModeAuthorization(request, 'solve');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('mode_not_in_request');
    expect(verdict.permittedModes).toEqual(['correct', 'unblock']);
  });

  it('rejects an UNKNOWN mode with the typed invalid-mode reason', () => {
    const verdict = checkModeAuthorization(request, 'supervise');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('mode_unknown');
  });

  it('rejects a live mode when the request authorizes no bounded session', () => {
    const verdict = checkModeAuthorization(
      { escalationModes: ['solve'], environmentSessionMode: 'none' },
      'solve',
    );
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('mode_requires_bounded_session');
  });

  it('informational modes need no bounded session', () => {
    const verdict = checkModeAuthorization(
      { escalationModes: ['tool_gap'], environmentSessionMode: 'none' },
      'tool_gap',
    );
    expect(verdict.allowed).toBe(true);
  });

  it('assertModeAuthorized throws the typed UNPERMITTED_MODE failure', () => {
    expect(() => assertModeAuthorized(request, 'solve')).toThrowError(InterventionError);
    try {
      assertModeAuthorized(request, 'solve');
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE);
      expect((error as InterventionError).category).toBe('scope');
    }
  });

  it('the authorization verdicts are machine-readable across the whole vocabulary', () => {
    for (const mode of ESCALATION_MODES) {
      const verdict = checkModeAuthorization(request, mode);
      expect(typeof verdict.allowed).toBe('boolean');
      expect(verdict.reason).toBeTruthy();
    }
  });
});

describe('the escalation-modes law — mode transitions', () => {
  const request = {
    escalationModes: ['correct', 'unblock', 'review'],
    environmentSessionMode: 'bounded-replica',
  };

  it('permits a transition between two authorized modes in an explicit mid-flight state', () => {
    for (const state of MODE_TRANSITION_STATES) {
      const verdict = checkModeTransition({
        from: 'correct',
        to: 'unblock',
        escalationState: state,
        request,
      });
      expect(verdict.allowed).toBe(true);
      expect(verdict.reason).toBe('mode_transition_ok');
    }
  });

  it('denies the non-transition (same mode)', () => {
    const verdict = checkModeTransition({
      from: 'correct',
      to: 'correct',
      escalationState: 'in_progress',
      request,
    });
    expect(verdict.reason).toBe('mode_transition_same_mode');
  });

  it('denies a transition to an unauthorized target mode', () => {
    const verdict = checkModeTransition({
      from: 'correct',
      to: 'teach',
      escalationState: 'in_progress',
      request,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('mode_transition_not_authorized');
  });

  it('denies a transition in every NON-mid-flight lifecycle state', () => {
    const nonMidFlight = ESCALATION_STATES.filter(
      (state) => !(MODE_TRANSITION_STATES as readonly string[]).includes(state),
    );
    expect(nonMidFlight.length).toBeGreaterThan(0);
    for (const state of nonMidFlight) {
      const verdict = checkModeTransition({
        from: 'correct',
        to: 'unblock',
        escalationState: state,
        request,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('mode_transition_wrong_state');
    }
  });

  it('assertModeTransition throws typed failures for both denial classes', () => {
    expect(() =>
      assertModeTransition({ from: 'correct', to: 'teach', escalationState: 'in_progress', request }),
    ).toThrowError(InterventionError);
    try {
      assertModeTransition({ from: 'correct', to: 'teach', escalationState: 'in_progress', request });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE);
    }
    try {
      assertModeTransition({
        from: 'correct',
        to: 'unblock',
        escalationState: 'session_ready',
        request,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.INVALID_TRANSITION);
    }
  });
});

describe('capsule-policy containment — the C006 seam', () => {
  it('allows a mode whose session policy is within the capsule allowance', () => {
    const verdict = checkModeSessionPolicy('teach', ['observe', 'teach', 'takeover']);
    expect(verdict.allowed).toBe(true);
    expect(verdict.requiredSessionMode).toBe('teach');
  });

  it('denies a mode whose session policy is outside the capsule allowance', () => {
    const verdict = checkModeSessionPolicy('solve', ['observe', 'correct']);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('session_policy_not_derivable');
    expect(verdict.requiredSessionMode).toBe('takeover');
  });

  it('assertModeSessionPolicy throws the typed UNPERMITTED_MODE failure', () => {
    expect(() => assertModeSessionPolicy('solve', ['observe', 'correct'])).toThrowError(
      InterventionError,
    );
    try {
      assertModeSessionPolicy('solve', ['observe', 'correct']);
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE);
    }
  });
});
