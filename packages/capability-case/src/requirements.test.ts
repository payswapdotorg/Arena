/**
 * Requirements suite (Work Order A005 gate 2 + gate 11): positive and
 * negative tests for every §5 requirement object — observed failure,
 * expert, environment, task, evaluation and verification requirements.
 * The negative cases are grouped per FIELD GROUP (gate 2).
 */

import { describe, expect, it } from 'vitest';
import {
  TASK_DIFFICULTY_LEVELS,
  isEnvironmentRequirements,
  isEvaluationRequirements,
  isExpertRequirements,
  isObservedFailureRecord,
  isTaskDifficulty,
  isTaskRequirements,
  isVerificationRequirements,
  toEnvironmentRequirements,
  toEvaluationRequirements,
  toExpertRequirements,
  toObservedFailureRecord,
  toTaskRequirements,
  toVerificationRequirements,
} from './requirements.js';
import { CapabilityCaseError } from './errors.js';
import { AT, DIGEST_A, DIGEST_B, DIGEST_E } from './test-support.js';

const nodeRef = (kind: string, id: string) => ({
  kind,
  id,
  version: '1.0.0',
  digest: DIGEST_A,
});

describe('observed failure record (positive)', () => {
  it('validates and freezes a full record', () => {
    const record = toObservedFailureRecord({
      summary: 'Agent mis-settled a partially paid invoice.',
      observedAt: AT,
      reproduction: 'Run the monthly close.',
      failureNode: nodeRef('observed-failure', 'cluster-invoice-netting'),
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(isObservedFailureRecord(record)).toBe(true);
    expect(record.failureNode?.kind).toBe('observed-failure');
  });

  it('the failureNode mapping is optional (clusters come later)', () => {
    const record = toObservedFailureRecord({ summary: 's', observedAt: AT });
    expect(record.failureNode).toBeUndefined();
    expect(isObservedFailureRecord(record)).toBe(true);
  });
});

describe('observed failure record (negative, per field group)', () => {
  it('empty summary is rejected', () => {
    expect(() => toObservedFailureRecord({ summary: '', observedAt: AT })).toThrow(
      /non-empty summary/,
    );
  });

  it('invalid observedAt timestamps are rejected', () => {
    expect(() =>
      toObservedFailureRecord({ summary: 's', observedAt: '2026-09-28T10:00:00Z' }),
    ).toThrow(CapabilityCaseError);
  });

  it('a failureNode of the WRONG graph kind is rejected', () => {
    expect(() =>
      toObservedFailureRecord({
        summary: 's',
        observedAt: AT,
        failureNode: nodeRef('domain', 'accounts-payable'),
      }),
    ).toThrow(/is not allowed here/);
  });

  it('guards reject malformed shapes', () => {
    expect(isObservedFailureRecord({ summary: 's' })).toBe(false);
    expect(isObservedFailureRecord(null)).toBe(false);
    expect(
      isObservedFailureRecord({ summary: 's', observedAt: AT, reproduction: '' }),
    ).toBe(false);
  });
});

describe('expert requirements (positive)', () => {
  it('validates and freezes requirements', () => {
    const req = toExpertRequirements({
      competencies: [nodeRef('expert-competency', 'ap-reconciliation')],
      qualifications: ['certified-accountant'],
      availability: 'business hours, EU jurisdiction',
    });
    expect(Object.isFrozen(req)).toBe(true);
    expect(isExpertRequirements(req)).toBe(true);
  });

  it('qualifications may be empty (competencies are the requirement)', () => {
    const req = toExpertRequirements({
      competencies: [nodeRef('expert-competency', 'ap-reconciliation')],
    });
    expect(req.qualifications).toEqual([]);
    expect(isExpertRequirements(req)).toBe(true);
  });
});

describe('expert requirements (negative, per field group)', () => {
  it('zero competencies is rejected', () => {
    expect(() => toExpertRequirements({ competencies: [] })).toThrow(
      /at least one competency/,
    );
  });

  it('wrong competency kind is rejected', () => {
    expect(() =>
      toExpertRequirements({ competencies: [nodeRef('skill', 'some-skill')] }),
    ).toThrow(/is not allowed here/);
  });

  it('empty qualification statements are rejected', () => {
    expect(() =>
      toExpertRequirements({
        competencies: [nodeRef('expert-competency', 'ap')],
        qualifications: [''],
      }),
    ).toThrow(/non-empty strings/);
  });

  it('guards reject malformed shapes', () => {
    expect(isExpertRequirements({ competencies: [], qualifications: [] })).toBe(false);
    expect(isExpertRequirements({ qualifications: [] })).toBe(false);
  });
});

describe('environment requirements (positive)', () => {
  it('validates and freezes requirements', () => {
    const req = toEnvironmentRequirements({
      environments: [
        { namespace: 'tenant-a', name: 'erp-close-sandbox', version: '1.4.0', digest: DIGEST_E },
      ],
      constraints: ['No live ERP writes'],
    });
    expect(Object.isFrozen(req)).toBe(true);
    expect(isEnvironmentRequirements(req)).toBe(true);
  });
});

describe('environment requirements (negative, per field group)', () => {
  it('zero environment declarations is rejected', () => {
    expect(() => toEnvironmentRequirements({ environments: [] })).toThrow(
      /at least one/,
    );
  });

  it('malformed environment refs are rejected', () => {
    expect(() =>
      toEnvironmentRequirements({
        environments: [{ namespace: 'tenant-a', name: 'box', version: '1.0.0', digest: 'no' }],
      }),
    ).toThrow(CapabilityCaseError);
  });

  it('empty constraint statements are rejected', () => {
    expect(() =>
      toEnvironmentRequirements({
        environments: [
          { namespace: 'tenant-a', name: 'sandbox-x', version: '1.0.0', digest: DIGEST_A },
        ],
        constraints: [''],
      }),
    ).toThrow(/non-empty strings/);
  });

  it('guards reject malformed shapes', () => {
    expect(isEnvironmentRequirements({ environments: [], constraints: [] })).toBe(false);
    expect(isEnvironmentRequirements({ constraints: [] })).toBe(false);
  });
});

describe('task requirements (positive)', () => {
  it('validates and freezes the full TaskSpec §6 vocabulary', () => {
    const req = toTaskRequirements({
      objectives: ['Reconcile credit notes'],
      constraints: ['Snapshot only'],
      allowedTools: [
        { namespace: 'tenant-a', name: 'erp-export-reader', version: '1.0.0', digest: DIGEST_B },
      ],
      forbiddenShortcuts: ['Assume full settlement'],
      successConditions: ['Netted total matches'],
      evidenceCriteria: ['Annotated trajectory'],
      difficulty: 'standard',
    });
    expect(Object.isFrozen(req)).toBe(true);
    expect(isTaskRequirements(req)).toBe(true);
    expect(TASK_DIFFICULTY_LEVELS).toEqual(['exploratory', 'standard', 'routine']);
  });

  it('optional lists may be empty', () => {
    const req = toTaskRequirements({
      objectives: ['o'],
      successConditions: ['s'],
      evidenceCriteria: ['e'],
      difficulty: 'exploratory',
    });
    expect(req.constraints).toEqual([]);
    expect(req.allowedTools).toEqual([]);
    expect(req.forbiddenShortcuts).toEqual([]);
  });
});

describe('task requirements (negative, per field group)', () => {
  it('zero objectives is rejected', () => {
    expect(() =>
      toTaskRequirements({
        objectives: [],
        successConditions: ['s'],
        evidenceCriteria: ['e'],
        difficulty: 'standard',
      }),
    ).toThrow(/objectives.*at least 1/);
  });

  it('zero success conditions is rejected', () => {
    expect(() =>
      toTaskRequirements({
        objectives: ['o'],
        successConditions: [],
        evidenceCriteria: ['e'],
        difficulty: 'standard',
      }),
    ).toThrow(/successConditions.*at least 1/);
  });

  it('zero evidence criteria is rejected', () => {
    expect(() =>
      toTaskRequirements({
        objectives: ['o'],
        successConditions: ['s'],
        evidenceCriteria: [],
        difficulty: 'standard',
      }),
    ).toThrow(/evidenceCriteria.*at least 1/);
  });

  it('unknown difficulty is rejected', () => {
    expect(() =>
      toTaskRequirements({
        objectives: ['o'],
        successConditions: ['s'],
        evidenceCriteria: ['e'],
        difficulty: 'impossible',
      }),
    ).toThrow(/unknown task difficulty/);
    expect(isTaskDifficulty('extreme')).toBe(false);
  });

  it('empty statements are rejected', () => {
    expect(() =>
      toTaskRequirements({
        objectives: [''],
        successConditions: ['s'],
        evidenceCriteria: ['e'],
        difficulty: 'standard',
      }),
    ).toThrow(/non-empty statements/);
  });

  it('guards reject malformed shapes', () => {
    expect(
      isTaskRequirements({
        objectives: ['o'],
        constraints: [],
        allowedTools: [],
        forbiddenShortcuts: [],
        successConditions: ['s'],
        evidenceCriteria: ['e'],
        difficulty: 'nope',
      }),
    ).toBe(false);
    expect(isTaskRequirements({ objectives: ['o'] })).toBe(false);
  });
});

describe('evaluation requirements (lock rule 7) (positive)', () => {
  it('validates and freezes requirements', () => {
    const req = toEvaluationRequirements({
      evaluators: [nodeRef('evaluator', 'reconciliation-accuracy')],
      criteria: ['Netting accuracy >= 99%'],
    });
    expect(Object.isFrozen(req)).toBe(true);
    expect(isEvaluationRequirements(req)).toBe(true);
  });
});

describe('evaluation requirements (negative, per field group)', () => {
  it('zero evaluators is rejected', () => {
    expect(() =>
      toEvaluationRequirements({ evaluators: [], criteria: ['c'] }),
    ).toThrow(/at least one evaluator/);
  });

  it('wrong evaluator kind is rejected', () => {
    expect(() =>
      toEvaluationRequirements({
        evaluators: [nodeRef('verifier', 'erp-balance-check')],
        criteria: ['c'],
      }),
    ).toThrow(/is not allowed here/);
  });

  it('zero criteria is rejected', () => {
    expect(() =>
      toEvaluationRequirements({
        evaluators: [nodeRef('evaluator', 'e')],
        criteria: [],
      }),
    ).toThrow(/at least one criterion/);
  });

  it('guards reject malformed shapes', () => {
    expect(isEvaluationRequirements({ evaluators: [], criteria: [] })).toBe(false);
  });
});

describe('verification requirements (lock rule 7) (positive)', () => {
  it('validates and freezes requirements', () => {
    const req = toVerificationRequirements({
      verifiers: [nodeRef('verifier', 'erp-balance-check')],
      evidenceStandards: ['Balance proof exported from the sandbox ERP'],
    });
    expect(Object.isFrozen(req)).toBe(true);
    expect(isVerificationRequirements(req)).toBe(true);
  });
});

describe('verification requirements (negative, per field group)', () => {
  it('zero verifiers is rejected', () => {
    expect(() =>
      toVerificationRequirements({ verifiers: [], evidenceStandards: ['s'] }),
    ).toThrow(/at least one verifier/);
  });

  it('wrong verifier kind is rejected', () => {
    expect(() =>
      toVerificationRequirements({
        verifiers: [nodeRef('evaluator', 'e')],
        evidenceStandards: ['s'],
      }),
    ).toThrow(/is not allowed here/);
  });

  it('zero evidence standards is rejected', () => {
    expect(() =>
      toVerificationRequirements({
        verifiers: [nodeRef('verifier', 'v')],
        evidenceStandards: [],
      }),
    ).toThrow(/at least one evidence-standard/);
  });

  it('guards reject malformed shapes', () => {
    expect(isVerificationRequirements({ verifiers: [], evidenceStandards: [] })).toBe(
      false,
    );
  });
});
