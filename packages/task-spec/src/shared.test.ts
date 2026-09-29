/**
 * Vocabulary + shared-primitives suite (Work Order A008) — closed
 * vocabularies, quality dimensions, bindings, environment/data-rights
 * validators, shared helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  TASK_CLASSES,
  isTaskClass,
  toTaskClass,
  permitsLongHorizonEvidence,
  requiresLongHorizonEvidence,
} from './task-class.js';
import {
  isTaskDifficultyScale,
  toTaskDifficultyDeclaration,
  TASK_DIFFICULTY_SCALES,
} from './difficulty.js';
import {
  TASK_QUALITY_DIMENSIONS,
  isTaskQualityDimension,
  QUALITY_PROVENANCE_SOURCES,
} from './quality.js';
import { isEvaluatorBinding, isVerifierBinding } from './bindings.js';
import { toTaskEnvironmentRequirements, toTaskInitialStateRef, isTaskEnvironmentRequirements } from './environment.js';
import { toDataRightsMetadata, DEFAULT_DATA_RIGHTS_CLASSIFICATION, DATA_RIGHTS_CLASSIFICATIONS } from './data-rights.js';
import { toTaskExpertQualificationRequirements } from './expert-qualification.js';
import { TASK_SPEC_ERROR_CODES } from './errors.js';
import {
  isCapabilityLabel,
  isContentDigest,
  isTaskVersion,
  toArtifactRefView,
  toCaseRefView,
  toNodeRefView,
  toQualificationPolicyRefView,
  expectFields,
  toStatementList,
  deepFreeze,
} from './shared.js';
import { DIGESTS } from './test-support.js';

describe('task-class vocabulary', () => {
  it('is the CLOSED eleven-class TS1.0 vocabulary', () => {
    expect(TASK_CLASSES).toHaveLength(11);
    expect(TASK_CLASSES).toContain('recovery-failure');
    expect(TASK_CLASSES).toContain('long-horizon-execution');
    expect(isTaskClass('demonstration')).toBe(true);
    expect(isTaskClass('recovery/failure')).toBe(false);
    expect(() => toTaskClass('nope')).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_CLASS }),
    );
  });

  it('long-horizon evidence rules: required for long-horizon-execution only', () => {
    expect(requiresLongHorizonEvidence('long-horizon-execution')).toBe(true);
    expect(requiresLongHorizonEvidence('recovery-failure')).toBe(false);
    expect(permitsLongHorizonEvidence('recovery-failure')).toBe(true);
    expect(permitsLongHorizonEvidence('benchmark')).toBe(false);
  });
});

describe('difficulty vocabulary', () => {
  it('declares exactly one scale with three classes', () => {
    expect(TASK_DIFFICULTY_SCALES).toEqual(['arena:task-difficulty@1']);
    expect(isTaskDifficultyScale('arena:difficulty@2')).toBe(false);
    expect(() =>
      toTaskDifficultyDeclaration({ scale: 'arena:task-difficulty@1', class: 'nope' }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_DIFFICULTY }),
    );
  });
});

describe('quality dimensions', () => {
  it('is the seven-dimension TS1.0 Quality vocabulary', () => {
    expect(TASK_QUALITY_DIMENSIONS).toHaveLength(7);
    expect(TASK_QUALITY_DIMENSIONS).toContain('low-leakage');
    expect(TASK_QUALITY_DIMENSIONS).toContain('declared-limitations');
    expect(isTaskQualityDimension('realistic-context')).toBe(true);
    expect(isTaskQualityDimension('realism')).toBe(false);
    expect(QUALITY_PROVENANCE_SOURCES).toHaveLength(3);
  });
});

describe('bindings', () => {
  it('structural checks for A012/A013-shaped bindings', () => {
    expect(
      isEvaluatorBinding({
        evaluatorId: 'guard-evaluator',
        version: '1.0.0',
        descriptorDigest: DIGESTS.evaluator,
      }),
    ).toBe(true);
    expect(
      isVerifierBinding({
        verifierId: 'Guard',
        version: '1.0.0',
        descriptorDigest: DIGESTS.verifier,
      }),
    ).toBe(false);
    expect(
      isEvaluatorBinding({
        evaluatorId: 'guard-evaluator',
        version: '1.0.0',
        descriptorDigest: 'xyz',
      }),
    ).toBe(false);
  });
});

describe('environment + initial state', () => {
  it('validates ENV1.0-shaped requirements', () => {
    const requirements = toTaskEnvironmentRequirements({
      environments: [
        { namespace: 'tenant-alpha', name: 'review-workspace', version: '1.0.0', digest: DIGESTS.envA },
      ],
      constraints: ['ephemeral filesystem'],
    });
    expect(isTaskEnvironmentRequirements(requirements)).toBe(true);
    expect(() =>
      toTaskEnvironmentRequirements({ environments: [], constraints: [] }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_ENVIRONMENT }),
    );
  });

  it('validates initial state refs (seed pinned or null)', () => {
    const ref = toTaskInitialStateRef({
      environment: {
        namespace: 'tenant-alpha',
        name: 'review-workspace',
        version: '1.0.0',
        digest: DIGESTS.envA,
      },
      seed: 'seed-2026-alpha',
    });
    expect(ref.note).toBeNull();
    expect(() =>
      toTaskInitialStateRef({
        environment: {
          namespace: 'tenant-alpha',
          name: 'review-workspace',
          version: '1.0.0',
          digest: 'bad',
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_REF }),
    );
  });
});

describe('data rights', () => {
  it('defaults to private-tenant (R24 posture)', () => {
    expect(DEFAULT_DATA_RIGHTS_CLASSIFICATION).toBe('private-tenant');
    expect(DATA_RIGHTS_CLASSIFICATIONS).toHaveLength(4);
  });

  it('rejects private-tenant with cross-tenant reuse', () => {
    expect(() =>
      toDataRightsMetadata({
        classification: 'private-tenant',
        tenantScope: 'tenant-alpha',
        crossTenantReuse: true,
      }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_DATA_RIGHTS }),
    );
  });
});

describe('expert qualification requirements (A007 shapes)', () => {
  it('accepts competency refs + optional qualification policy', () => {
    const reqs = toTaskExpertQualificationRequirements({
      competencies: [
        { kind: 'capability', id: 'code-review', version: '1.2.0', digest: DIGESTS.capability },
      ],
      qualificationPolicy: {
        policyId: 'fixture-qualification-policy',
        version: '1.0.0',
        digest: DIGESTS.qualificationPolicy,
      },
      expectations: ['recent qualification'],
    });
    expect(reqs.qualificationPolicy?.policyId).toBe('fixture-qualification-policy');
  });

  it('rejects competency refs of non-claimable kinds', () => {
    expect(() =>
      toTaskExpertQualificationRequirements({
        competencies: [
          { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: DIGESTS.domain },
        ],
        expectations: ['x'],
      }),
    ).toThrowError(
      expect.objectContaining({ code: TASK_SPEC_ERROR_CODES.INVALID_REF }),
    );
  });
});

describe('shared primitives', () => {
  it('pattern validators', () => {
    expect(isContentDigest(DIGESTS.envA)).toBe(true);
    expect(isContentDigest('ABC')).toBe(false);
    expect(isTaskVersion('1.2.3-alpha.1')).toBe(true);
    expect(isTaskVersion('1.2.3+build')).toBe(false);
    expect(isCapabilityLabel('code-review')).toBe(true);
    expect(isCapabilityLabel('Code Review')).toBe(false);
  });

  it('view validators freeze + reject bad refs', () => {
    const artifact = toArtifactRefView({
      namespace: 'tenant-alpha',
      name: 'review-workspace',
      version: '1.0.0',
      digest: DIGESTS.envA,
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(() =>
      toArtifactRefView({ namespace: 'Bad', name: 'x', version: '1.0.0', digest: DIGESTS.envA }),
    ).toThrow();
    expect(() =>
      toNodeRefView({ kind: 'domain', id: 'x', version: '1.0.0', digest: 'nope' } as never, [
        'domain',
      ]),
    ).toThrow();
    expect(() =>
      toCaseRefView({ tenant: 'tenant-alpha', caseId: 'case-001', version: '1.0.0', digest: 'no' } as never),
    ).toThrow();
    expect(() =>
      toQualificationPolicyRefView({ policyId: 'X', version: '1.0.0', digest: DIGESTS.qualificationPolicy } as never),
    ).toThrow();
  });

  it('expectFields: missing + unknown fields are typed errors', () => {
    expect(() => expectFields({ a: 1 }, ['a', 'b'], [], TASK_SPEC_ERROR_CODES.INVALID_SPEC, 'x')).toThrow();
    expect(() => expectFields({ a: 1, c: 2 }, ['a'], [], TASK_SPEC_ERROR_CODES.INVALID_SPEC, 'x')).toThrow();
    expect(expectFields({ a: 1, b: 2 }, ['a'], ['b'], TASK_SPEC_ERROR_CODES.INVALID_SPEC, 'x')).toEqual({
      a: 1,
      b: 2,
    });
  });

  it('toStatementList: min-count + non-empty entries', () => {
    expect(() => toStatementList([], 'x', 1, TASK_SPEC_ERROR_CODES.INVALID_SPEC, 'c')).toThrow();
    expect(() =>
      toStatementList(['ok', ''], 'x', 1, TASK_SPEC_ERROR_CODES.INVALID_SPEC, 'c'),
    ).toThrow();
    expect(toStatementList(['ok'], 'x', 0, TASK_SPEC_ERROR_CODES.INVALID_SPEC, 'c')).toEqual(['ok']);
  });

  it('deepFreeze freezes nested structures', () => {
    const frozen = deepFreeze({ a: [1, { b: 2 }] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a[1])).toBe(true);
  });
});
