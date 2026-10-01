/**
 * Projection suite (Work Order B003) — the RC1.0 same-object /
 * different-lens rule: ONE canonical Capability Case input produces FIVE
 * role-specific projections, all carrying the SAME canonical object
 * identity. Plus the wrong-canonical-kind typed rejection.
 */

import { describe, expect, it } from 'vitest';
import {
  applyRoleProjection,
  CAPABILITY_CASE_BUILDER_LENS,
  CAPABILITY_CASE_EXPERT_LENS,
  CAPABILITY_CASE_LENSES,
  CAPABILITY_CASE_OPERATOR_LENS,
  CAPABILITY_CASE_OWNER_LENS,
  CAPABILITY_CASE_RESEARCHER_LENS,
  defineRoleProjection,
  projectCapabilityCase,
  roleProjectionRecord,
  toTenantId,
} from '../index.js';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../index.js';
import { CANONICAL_CASE } from '../test-support.js';

function expectRoleContextError(action: () => unknown, code: string): RoleContextError {
  try {
    action();
    expect.unreachable(`expected a RoleContextError with code ${code}`);
  } catch (error) {
    const roleContextError = error as RoleContextError;
    expect(roleContextError).toBeInstanceOf(RoleContextError);
    expect(roleContextError.code).toBe(code);
    return roleContextError;
  }
}

describe('positive: one canonical input → role-specific outputs', () => {
  it('ships exactly the 5 RC1.0 lenses for capability-case', () => {
    expect(CAPABILITY_CASE_LENSES.map((lens) => lens.roleId)).toEqual([
      'owner',
      'expert',
      'agent-builder',
      'researcher',
      'operator',
    ]);
    for (const lens of CAPABILITY_CASE_LENSES) {
      expect(lens.canonicalKind).toBe('capability-case');
      expect(lens.recordVersion).toBe(1);
    }
  });

  it('all five lenses carry the SAME canonical object identity (same-object rule)', () => {
    const projections = CAPABILITY_CASE_LENSES.map((lens) => applyRoleProjection(lens, CANONICAL_CASE));
    for (const projection of projections) {
      expect(projection.canonical).toEqual({
        kind: 'capability-case',
        tenant: 'acme',
        objectId: 'case-42',
        version: '1.2.0',
      });
      expect(projection.canonicalKind).toBe('capability-case');
    }
    const identities = new Set(projections.map((projection) => JSON.stringify(projection.canonical)));
    expect(identities.size).toBe(1);
  });

  it('each lens answers its RC1.0 question and emphasizes its role surfaces', () => {
    const owner = applyRoleProjection(CAPABILITY_CASE_OWNER_LENS, CANONICAL_CASE);
    expect(owner.lensQuestion).toBe('Why is my agent struggling?');
    expect(owner.roleId).toBe('owner');
    expect(owner.emphasis).toContain('capability-inbox');
    expect(owner.payload['capabilityGap']).toMatchObject({
      target: 'invoice-reconciliation',
      missing: ['fx-rate-lookup', 'partial-evidence-reasoning'],
    });

    const expert = applyRoleProjection(CAPABILITY_CASE_EXPERT_LENS, CANONICAL_CASE);
    expect(expert.lensQuestion).toBe('What work am I being asked to perform?');
    expect(expert.roleId).toBe('expert');
    expect(expert.payload['requestedWork']).toMatchObject({
      problem: CANONICAL_CASE.observedFailure,
    });
    expect(expert.payload['environment']).toBe('substrate-standard');
    expect(expert.payload['assignment']).toBe('expert-nadia');

    const builder = applyRoleProjection(CAPABILITY_CASE_BUILDER_LENS, CANONICAL_CASE);
    expect(builder.lensQuestion).toBe('What capability is missing from the Body?');
    expect(builder.roleId).toBe('agent-builder');
    expect(builder.payload['missingCapabilities']).toEqual([
      'fx-rate-lookup',
      'partial-evidence-reasoning',
    ]);
    expect(builder.payload['bodyVersion']).toBe('9.4.1');
    expect(builder.payload['certificationState']).toBe('evaluation-failed');

    const researcher = applyRoleProjection(CAPABILITY_CASE_RESEARCHER_LENS, CANONICAL_CASE);
    expect(researcher.lensQuestion).toBe('What evidence supports the capability hypothesis?');
    expect(researcher.roleId).toBe('researcher');
    expect(researcher.payload['evidenceCounts']).toEqual({
      evidence: 1,
      'expert-judgment': 1,
      'model-output': 1,
      'evaluation-result': 1,
    });
    expect(researcher.payload['uncertainty']).toBe('high');

    const operator = applyRoleProjection(CAPABILITY_CASE_OPERATOR_LENS, CANONICAL_CASE);
    expect(operator.lensQuestion).toBe('Is the workflow/job healthy?');
    expect(operator.roleId).toBe('operator');
    expect(operator.payload['jobHealth']).toBe('degraded');
    expect(operator.payload['openTasks']).toBe(3);
  });

  it('the five payloads are role-SPECIFIC (no two lenses agree on everything)', () => {
    const projections = CAPABILITY_CASE_LENSES.map((lens) => applyRoleProjection(lens, CANONICAL_CASE));
    const payloads = new Set(projections.map((projection) => JSON.stringify(projection.payload)));
    expect(payloads.size).toBe(5);
    const questions = new Set(projections.map((projection) => projection.lensQuestion));
    expect(questions.size).toBe(5);
  });

  it('projections are deep-frozen records', () => {
    const owner = applyRoleProjection(CAPABILITY_CASE_OWNER_LENS, CANONICAL_CASE);
    expect(Object.isFrozen(owner)).toBe(true);
    expect(Object.isFrozen(owner.canonical)).toBe(true);
    expect(Object.isFrozen(owner.emphasis)).toBe(true);
  });

  it('projectCapabilityCase resolves lenses by role id', () => {
    const owner = projectCapabilityCase(CANONICAL_CASE, 'owner');
    expect(owner.projectionId).toBe('capability-case.owner-lens');
    expect(projectCapabilityCase(CANONICAL_CASE, 'operator').projectionId).toBe(
      'capability-case.operator-lens',
    );
  });
});

describe('negative: projection rejections (typed, closed codes)', () => {
  it('rejects a projection for the WRONG canonical kind (CANONICAL_KIND_MISMATCH)', () => {
    const taskObject = {
      ...CANONICAL_CASE,
      kind: 'task',
      objectId: 'task-7',
      version: '1.0.0',
    } as unknown as typeof CANONICAL_CASE;
    const error = expectRoleContextError(
      () => applyRoleProjection(CAPABILITY_CASE_OWNER_LENS, taskObject),
      ROLE_CONTEXT_ERROR_CODES.CANONICAL_KIND_MISMATCH,
    );
    expect(error.details).toMatchObject({ expected: 'capability-case', actual: 'task' });
  });

  it('rejects an unknown canonical kind on the input (CANONICAL_KIND_MISMATCH)', () => {
    const alien = {
      ...CANONICAL_CASE,
      kind: 'spaceship',
    } as unknown as typeof CANONICAL_CASE;
    expectRoleContextError(
      () => applyRoleProjection(CAPABILITY_CASE_OWNER_LENS, alien),
      ROLE_CONTEXT_ERROR_CODES.CANONICAL_KIND_MISMATCH,
    );
  });

  it('rejects a role with no v1 capability-case lens (INVALID_PROJECTION)', () => {
    expectRoleContextError(
      () => projectCapabilityCase(CANONICAL_CASE, 'administrator'),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
    expectRoleContextError(
      () => projectCapabilityCase(CANONICAL_CASE, 'evaluator'),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
  });

  it('rejects malformed canonical identity (invalid tenant / version)', () => {
    const badTenant = {
      ...CANONICAL_CASE,
      tenant: 'Not A Tenant',
    } as typeof CANONICAL_CASE;
    expectRoleContextError(
      () => applyRoleProjection(CAPABILITY_CASE_OWNER_LENS, badTenant),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
    const badVersion = {
      ...CANONICAL_CASE,
      version: 'v1',
    } as typeof CANONICAL_CASE;
    expectRoleContextError(
      () => applyRoleProjection(CAPABILITY_CASE_OWNER_LENS, badVersion),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
  });

  it('rejects emphasis surfaces that are not the lensing role\'s surfaces (INVALID_PROJECTION)', () => {
    // emphasis validation happens at projection-record assembly time:
    const badLens = defineRoleProjection({
      projectionId: 'capability-case.expert-lens',
      roleId: 'expert',
      canonicalKind: 'capability-case',
      projectionKind: 'expert-lens',
      lensQuestion: 'What work am I being asked to perform?',
      description: 'emphasis must be expert surfaces only',
      project: (view: typeof CANONICAL_CASE) =>
        roleProjectionRecord({
          projectionId: 'capability-case.expert-lens',
          roleId: 'expert',
          canonical: {
            kind: 'capability-case',
            tenant: toTenantId(view.tenant),
            objectId: view.objectId,
            version: view.version,
          },
          lensQuestion: 'What work am I being asked to perform?',
          emphasis: ['jobs'], // an OPERATOR surface, not an EXPERT surface
          recommendedActions: [],
          payload: {},
        }),
    });
    expectRoleContextError(
      () => applyRoleProjection(badLens, CANONICAL_CASE),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
  });

  it('rejects malformed projection definitions (ids, kinds, transforms)', () => {
    const base = {
      projectionId: 'capability-case.owner-lens',
      roleId: 'owner',
      canonicalKind: 'capability-case',
      projectionKind: 'owner-lens',
      lensQuestion: 'Why is my agent struggling?',
      description: 'validation fixture',
    } as const;
    expectRoleContextError(
      () => defineRoleProjection({ ...base, projectionId: 'no-dots', project: (v: typeof CANONICAL_CASE) => v }),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
    expectRoleContextError(
      () => defineRoleProjection({ ...base, roleId: 'wizard', project: (v: typeof CANONICAL_CASE) => v }),
      ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND,
    );
    expectRoleContextError(
      () =>
        defineRoleProjection({
          ...base,
          canonicalKind: 'unicorn',
          project: (v: typeof CANONICAL_CASE) => v,
        } as never),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
    expectRoleContextError(
      () => defineRoleProjection({ ...base, projectionKind: 'Not Kebab', project: (v: typeof CANONICAL_CASE) => v }),
      ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION,
    );
  });
});

describe('determinism of projections', () => {
  it('identical canonical input → identical projection output, repeatedly', () => {
    for (const lens of CAPABILITY_CASE_LENSES) {
      const first = applyRoleProjection(lens, CANONICAL_CASE);
      const second = applyRoleProjection(lens, CANONICAL_CASE);
      const third = applyRoleProjection(lens, CANONICAL_CASE);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(JSON.stringify(second)).toBe(JSON.stringify(third));
    }
  });
});
