import { describe, expect, it } from 'vitest';

import {
  COCKPIT_ROLE_LENSES,
  cockpitRoleLens,
  resolveActiveRole,
} from './role-lens.js';
import { REFERENCE_ROLE_REGISTRY, ROLE_IDS } from '../../../../packages/role-context/src/index.js';
import { READ_MODEL_KINDS } from '../../../../packages/read-model/src/index.js';

const CORE_ROUTE_HREFS = ['/', '/cases', '/bodies', '/research', '/marketplace', '/operations', '/settings'];

describe('the 8 cockpit role lenses (UXM1.0 / row)', () => {
  it('covers exactly the 8 reference roles (B003 registry)', () => {
    expect(Object.keys(COCKPIT_ROLE_LENSES).sort()).toEqual([...ROLE_IDS].sort());
  });

  it('derives role names + goals from the B003 registry by reference (no re-transcription drift)', () => {
    for (const role of REFERENCE_ROLE_REGISTRY.roles) {
      const lens = cockpitRoleLens(role.roleId);
      expect(lens.roleName).toBe(role.name);
      expect(lens.roleGoal).toBe(role.goal);
    }
  });

  it('binds the UXM1.0 / landing per role', () => {
    expect(cockpitRoleLens('owner').landingTitle).toBe('Capability cockpit');
    expect(cockpitRoleLens('agent-builder').landingTitle).toBe('Capability cockpit');
    expect(cockpitRoleLens('expert').landingTitle).toBe('Assigned work');
    expect(cockpitRoleLens('evaluator').landingTitle).toBe('Evaluation queue');
    expect(cockpitRoleLens('researcher').landingTitle).toBe('Research queue');
    expect(cockpitRoleLens('operator').landingTitle).toBe('Health summary');
    expect(cockpitRoleLens('marketplace-participant').landingTitle).toBe('Discovery');
    expect(cockpitRoleLens('administrator').landingTitle).toBe('Admin summary');
  });

  it('gives every lens exactly one hero action into a real core route', () => {
    for (const roleId of ROLE_IDS) {
      const lens = cockpitRoleLens(roleId);
      expect(lens.heroAction.label.length).toBeGreaterThan(0);
      expect(CORE_ROUTE_HREFS).toContain(lens.heroAction.href);
    }
  });

  it('reads only disclosed read-model kinds and suggests next actions into real routes', () => {
    for (const roleId of ROLE_IDS) {
      const lens = cockpitRoleLens(roleId);
      expect(lens.primaryReadKinds.length).toBeGreaterThan(0);
      for (const kind of lens.primaryReadKinds) {
        expect(READ_MODEL_KINDS as readonly string[]).toContain(kind);
      }
      expect(lens.nextActions.length).toBeGreaterThan(0);
      for (const action of lens.nextActions) {
        expect(CORE_ROUTE_HREFS).toContain(action.href);
        expect(action.note.length).toBeGreaterThan(0);
      }
    }
  });

  it('emphasizes only real routes — emphasis never removes a capability of the shell', () => {
    for (const roleId of ROLE_IDS) {
      const lens = cockpitRoleLens(roleId);
      expect(lens.emphasizedRoutes.length).toBeGreaterThan(0);
      for (const href of lens.emphasizedRoutes) {
        expect(CORE_ROUTE_HREFS).toContain(href);
      }
    }
  });

  it('throws a typed rejection for an unknown role id (never a silent default)', () => {
    expect(() => cockpitRoleLens('wizard')).toThrow(/unknown cockpit role lens/);
  });
});

describe('resolveActiveRole (explicit query state; granted-role truthfulness)', () => {
  const granted = ['owner', 'operator'] as const;

  it('defaults deterministically when no role is requested', () => {
    const resolution = resolveActiveRole({ grantedRoleIds: granted, defaultRoleId: 'owner' });
    expect(resolution).toEqual({ status: 'granted', roleId: 'owner', byDefault: true });
  });

  it('resolves an explicitly requested GRANTED role', () => {
    const resolution = resolveActiveRole({
      grantedRoleIds: granted,
      requested: 'operator',
      defaultRoleId: 'owner',
    });
    expect(resolution).toEqual({ status: 'granted', roleId: 'operator', byDefault: false });
  });

  it('truthfully denies a requested role that is not granted (never fakes authorization)', () => {
    const resolution = resolveActiveRole({
      grantedRoleIds: granted,
      requested: 'expert',
      defaultRoleId: 'owner',
    });
    expect(resolution.status).toBe('not-granted');
    if (resolution.status === 'not-granted') {
      expect(resolution.requested).toBe('expert');
      expect(resolution.fallbackRoleId).toBe('owner');
      expect(resolution.grantedRoleIds).toEqual([...granted]);
    }
  });

  it('truthfully denies an unknown role id verbatim', () => {
    const resolution = resolveActiveRole({ grantedRoleIds: granted, requested: 'wizard' });
    expect(resolution.status).toBe('not-granted');
  });

  it('falls back to the first granted role when the requested default is not granted', () => {
    const resolution = resolveActiveRole({
      grantedRoleIds: ['expert'],
      defaultRoleId: 'owner',
    });
    expect(resolution.status).toBe('granted');
    if (resolution.status === 'granted') expect(resolution.roleId).toBe('expert');
  });
});
