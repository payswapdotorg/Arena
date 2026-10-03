/**
 * Replay role-lens tests (Work Order B011; packages/replay-ui).
 *
 * Role context is a LENS, never an authorization: all eight B003
 * reference roles get a replay lens (deterministic registry order,
 * names/goals from the B003 registry by reference); unknown roles are
 * typed rejections; a requested-but-not-granted role resolves to the
 * truthful `not-granted` outcome — never a faked authorization.
 */

import { describe, expect, it } from 'vitest';
import { REFERENCE_ROLE_REGISTRY, ROLE_IDS, getRoleDefinition } from '@arena/role-context';
import {
  REPLAY_ROLE_LENSES,
  replayRoleLens,
  resolveReplayActiveRole,
} from './role-lens.js';

describe('replay role lenses (the B003 role context as a lens)', () => {
  it('defines one lens per reference role, in canonical ROLE_IDS order (positive)', () => {
    expect(Object.keys(REPLAY_ROLE_LENSES)).toEqual([...ROLE_IDS]);
    for (const roleId of ROLE_IDS) {
      const lens = REPLAY_ROLE_LENSES[roleId];
      expect(lens.roleId).toBe(roleId);
      expect(lens.roleName.length).toBeGreaterThan(0);
      expect(lens.roleGoal.length).toBeGreaterThan(0);
      expect(lens.landingTitle.length).toBeGreaterThan(0);
      expect(landingIntroMentionsObservation(lens.landingIntro)).toBe(true);
      expect(lens.focusNote.length).toBeGreaterThan(0);
      expect(lens.nextActions.length).toBeGreaterThan(0);
      for (const action of lens.nextActions) {
        expect(action.href.startsWith('/')).toBe(true);
        expect(action.note.length).toBeGreaterThan(0);
      }
    }
  });

  it('reuses the B003 registry names and goals BY REFERENCE (all eight)', () => {
    for (const roleId of ROLE_IDS) {
      const definition = getRoleDefinition(REFERENCE_ROLE_REGISTRY, roleId);
      expect(REPLAY_ROLE_LENSES[roleId].roleName).toBe(definition.name);
      expect(REPLAY_ROLE_LENSES[roleId].roleGoal).toBe(definition.goal);
    }
  });

  it('keeps every lens observational (a replay never mutates the world)', () => {
    for (const roleId of ROLE_IDS) {
      const lens = REPLAY_ROLE_LENSES[roleId];
      const text = `${lens.landingIntro} ${lens.focusNote}`;
      expect(text).not.toContain('re-run against live');
      expect(text.toLowerCase()).not.toContain('execute the run');
    }
  });

  it('throws a typed rejection for unknown roles (negative)', () => {
    expect(() => replayRoleLens('supervisor')).toThrowError(/unknown replay role lens/);
    expect(() => replayRoleLens('')).toThrowError(/unknown replay role lens/);
  });
});

describe('resolveReplayActiveRole — granted/not-granted truthfulness', () => {
  it('resolves the granted default when no explicit role is requested', () => {
    const resolution = resolveReplayActiveRole({ grantedRoleIds: ['owner', 'operator'] });
    expect(resolution.status).toBe('granted');
    if (resolution.status === 'granted') {
      expect(resolution.roleId).toBe('owner');
      expect(resolution.byDefault).toBe(true);
    }
  });

  it('resolves an explicitly granted role', () => {
    const resolution = resolveReplayActiveRole({
      grantedRoleIds: ['owner', 'operator'],
      requested: 'operator',
    });
    expect(resolution.status).toBe('granted');
    if (resolution.status === 'granted') {
      expect(resolution.roleId).toBe('operator');
      expect(resolution.byDefault).toBe(false);
    }
  });

  it('resolves a requested-but-NOT-granted role to the truthful not-granted outcome', () => {
    const resolution = resolveReplayActiveRole({
      grantedRoleIds: ['owner'],
      requested: 'expert',
    });
    expect(resolution.status).toBe('not-granted');
    if (resolution.status === 'not-granted') {
      expect(resolution.requested).toBe('expert');
      expect(resolution.fallbackRoleId).toBe('owner');
      expect(resolution.grantedRoleIds).toEqual(['owner']);
    }
  });

  it('falls back to the first granted role when the default is not granted', () => {
    const resolution = resolveReplayActiveRole({
      grantedRoleIds: ['researcher', 'operator'],
      defaultRoleId: 'owner',
    });
    expect(resolution.status).toBe('granted');
    if (resolution.status === 'granted') {
      expect(resolution.roleId).toBe('researcher');
    }
  });
});

function landingIntroMentionsObservation(intro: string): boolean {
  // Every lens's landing intro carries the observational posture.
  return /observ/i.test(intro) || /replay/i.test(intro);
}
