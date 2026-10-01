/**
 * Role registry suite (Work Order B003) — the 8 RC1.0 reference roles,
 * registry versioning and the unknown-role / registry-version typed
 * rejections.
 */

import { describe, expect, it } from 'vitest';
import {
  getRoleDefinition,
  isRoleDefinition,
  isRoleRegistry,
  listRoleIds,
  REFERENCE_ROLE_REGISTRY,
  ROLE_DEFINITION_RECORD_VERSION,
  ROLE_REGISTRY_RECORD_VERSION,
  ROLE_REGISTRY_VERSION,
  toRoleRegistry,
} from '../index.js';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../index.js';
import { ROLE_IDS } from '../index.js';

const RC1_0_ROLES: ReadonlyArray<{
  roleId: string;
  name: string;
  goal: string;
  surfaces: readonly string[];
}> = [
  {
    roleId: 'owner',
    name: 'Owner / Customer',
    goal: 'Understand capability gaps, track outcomes, procure expertise, and consume released capabilities.',
    surfaces: [
      'capability-inbox',
      'active-cases',
      'progress-outcomes',
      'body-library',
      'marketplace',
      'release-adoption',
    ],
  },
  {
    roleId: 'agent-builder',
    name: 'Agent Builder',
    goal: 'Assemble and improve Agent Bodies.',
    surfaces: [
      'body-studio',
      'skills',
      'tools',
      'knowledge',
      'possession-matrix',
      'compatibility',
      'certification',
      'release',
    ],
  },
  {
    roleId: 'expert',
    name: 'Expert',
    goal: 'Perform high-value professional work.',
    surfaces: [
      'assigned-work',
      'workbench',
      'evidence',
      'review',
      'compensation-status',
      'capability-history',
    ],
  },
  {
    roleId: 'evaluator',
    name: 'Evaluator',
    goal: 'Make "good" measurable.',
    surfaces: [
      'evaluator-builder',
      'criteria',
      'verifier-bindings',
      'suites',
      'runs',
      'failure-analysis',
    ],
  },
  {
    roleId: 'researcher',
    name: 'Researcher',
    goal: 'Discover capability boundaries and measure improvement.',
    surfaces: [
      'benchmark-lab',
      'experiments',
      'body-substrate-comparisons',
      'capability-graph',
      'datasets',
      'research-reports',
    ],
  },
  {
    roleId: 'operator',
    name: 'Operator',
    goal: 'Keep Arena healthy and understandable.',
    surfaces: ['jobs', 'environments', 'telemetry', 'slos', 'incidents', 'audit', 'quotas'],
  },
  {
    roleId: 'marketplace-participant',
    name: 'Marketplace Participant',
    goal: 'Publish, discover, and use capability artifacts.',
    surfaces: [
      'catalog',
      'artifact-detail',
      'provenance',
      'verification',
      'offers-grants',
      'review',
      'usage',
    ],
  },
  {
    roleId: 'administrator',
    name: 'Administrator',
    goal: 'Manage identity, tenant policy, entitlements, integrations, and audit.',
    surfaces: ['members', 'roles', 'policies', 'providers', 'entitlements', 'audit'],
  },
];

describe('reference role registry (RC1.0)', () => {
  it('contains exactly the 8 RC1.0 reference roles', () => {
    expect(listRoleIds(REFERENCE_ROLE_REGISTRY)).toEqual([...ROLE_IDS]);
    expect(REFERENCE_ROLE_REGISTRY.roles).toHaveLength(8);
    expect(new Set(listRoleIds(REFERENCE_ROLE_REGISTRY)).size).toBe(8);
  });

  it('transcribes every RC1.0 role definition verbatim (name, goal, surfaces)', () => {
    for (const expected of RC1_0_ROLES) {
      const definition = getRoleDefinition(REFERENCE_ROLE_REGISTRY, expected.roleId);
      expect(definition.name).toBe(expected.name);
      expect(definition.goal).toBe(expected.goal);
      expect([...definition.primarySurfaces]).toEqual([...expected.surfaces]);
      expect(definition.recordVersion).toBe(ROLE_DEFINITION_RECORD_VERSION);
      expect(definition.version).toBe('1.0.0');
    }
  });

  it('is versioned and deterministically ordered (roles sorted by roleId)', () => {
    expect(REFERENCE_ROLE_REGISTRY.recordVersion).toBe(ROLE_REGISTRY_RECORD_VERSION);
    expect(REFERENCE_ROLE_REGISTRY.registryVersion).toBe(ROLE_REGISTRY_VERSION);
    const ids = listRoleIds(REFERENCE_ROLE_REGISTRY);
    expect([...ids]).toEqual([...ids].sort());
  });

  it('is deep-frozen (immutable reference data)', () => {
    expect(Object.isFrozen(REFERENCE_ROLE_REGISTRY)).toBe(true);
    expect(Object.isFrozen(REFERENCE_ROLE_REGISTRY.roles)).toBe(true);
    for (const role of REFERENCE_ROLE_REGISTRY.roles) {
      expect(Object.isFrozen(role)).toBe(true);
      expect(Object.isFrozen(role.primarySurfaces)).toBe(true);
    }
    expect(() => {
      (REFERENCE_ROLE_REGISTRY as unknown as Record<string, unknown>)['registryVersion'] = '9.9.9';
    }).toThrow();
  });

  it('classifies shapes correctly (isRoleDefinition / isRoleRegistry)', () => {
    expect(isRoleDefinition(REFERENCE_ROLE_REGISTRY.roles[0])).toBe(true);
    expect(isRoleDefinition({ ...REFERENCE_ROLE_REGISTRY.roles[0], recordVersion: 2 })).toBe(false);
    expect(isRoleRegistry(REFERENCE_ROLE_REGISTRY)).toBe(true);
    expect(isRoleRegistry({ ...REFERENCE_ROLE_REGISTRY, registryVersion: 'not-semver' })).toBe(false);
    expect(isRoleRegistry(null)).toBe(false);
    expect(isRoleRegistry([])).toBe(false);
  });
});

describe('role lookup rejections (typed, closed codes)', () => {
  it('rejects an unknown role id with ROLE_NOT_FOUND', () => {
    expect(() => getRoleDefinition(REFERENCE_ROLE_REGISTRY, 'supervisor')).toThrowError(
      RoleContextError,
    );
    try {
      getRoleDefinition(REFERENCE_ROLE_REGISTRY, 'super-user');
      expect.unreachable('must throw');
    } catch (error) {
      const roleContextError = error as RoleContextError;
      expect(roleContextError.code).toBe(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND);
      expect(roleContextError.category).toBe('validation');
      expect(roleContextError.details).toMatchObject({ known: [...ROLE_IDS] });
    }
  });

  it('rejects a registry version mismatch with REGISTRY_VERSION_MISMATCH', () => {
    const futureRegistry = {
      ...REFERENCE_ROLE_REGISTRY,
      registryVersion: '2.0.0',
    };
    expect(() => toRoleRegistry(futureRegistry, ROLE_REGISTRY_VERSION)).toThrowError(
      RoleContextError,
    );
    try {
      toRoleRegistry(futureRegistry, ROLE_REGISTRY_VERSION);
      expect.unreachable('must throw');
    } catch (error) {
      const roleContextError = error as RoleContextError;
      expect(roleContextError.code).toBe(ROLE_CONTEXT_ERROR_CODES.REGISTRY_VERSION_MISMATCH);
      expect(roleContextError.category).toBe('versioning');
    }
  });

  it('toRoleRegistry round-trips the reference registry and deep-freezes it', () => {
    const parsed = toRoleRegistry(JSON.parse(JSON.stringify(REFERENCE_ROLE_REGISTRY)));
    expect(parsed).toEqual(REFERENCE_ROLE_REGISTRY);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.roles)).toBe(true);
  });

  it('toRoleRegistry fails closed on malformed registries', () => {
    expect(() => toRoleRegistry(null)).toThrowError(RoleContextError);
    expect(() => toRoleRegistry({ recordVersion: 2, registryVersion: '1.0.0', roles: [] })).toThrowError(
      RoleContextError,
    );
    expect(() =>
      toRoleRegistry({ recordVersion: 1, registryVersion: '1.0.0', roles: [] }),
    ).toThrowError(RoleContextError);
    // duplicate role ids are rejected
    const duplicated = {
      recordVersion: 1,
      registryVersion: '1.0.0',
      roles: [REFERENCE_ROLE_REGISTRY.roles[0], REFERENCE_ROLE_REGISTRY.roles[0]],
    };
    expect(() => toRoleRegistry(duplicated)).toThrowError(RoleContextError);
  });
});
