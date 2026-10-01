import { describe, expect, it } from 'vitest';

/** Role-lens tests (Work Order B008): the UXM1.0 route-matrix rows are binding. */

import { ROLE_IDS } from '../../../../packages/role-context/src/index.js';
import { CASE_DETAIL_LENSES, CASE_LIST_LENSES, TASK_LENSES, caseDetailLens, caseListLens, taskLens } from './role-lens.js';

describe('case list lenses (UXM1.0 /cases row)', () => {
  it('covers every reference role with the route-matrix heading', () => {
    expect(CASE_LIST_LENSES.owner.heading).toBe('Your capability cases');
    expect(CASE_LIST_LENSES['agent-builder'].heading).toBe('Capability gaps');
    expect(CASE_LIST_LENSES.expert.heading).toBe('Assigned cases');
    expect(CASE_LIST_LENSES.evaluator.heading).toBe('Evaluation implications');
    expect(CASE_LIST_LENSES.researcher.heading).toBe('Failure clusters');
    expect(CASE_LIST_LENSES.operator.heading).toBe('Case job health');
    expect(CASE_LIST_LENSES.administrator.heading).toBe('Audit scope');
  });

  it('marks the marketplace row honestly as not-a-primary-surface (—)', () => {
    expect(CASE_LIST_LENSES['marketplace-participant'].notPrimarySurface).toBe(true);
    for (const roleId of ROLE_IDS.filter((id) => id !== 'marketplace-participant')) {
      expect(CASE_LIST_LENSES[roleId].notPrimarySurface).toBe(false);
    }
  });

  it('rejects unknown lenses (typed, never a silent fallback)', () => {
    expect(() => caseListLens('auditor')).toThrowError(/unknown case-list role lens/);
  });
});

describe('case detail lenses (UXM1.0 /cases/:id row)', () => {
  it('binds the route-matrix lens names', () => {
    expect(CASE_DETAIL_LENSES.owner.lensName).toBe('Outcome lens');
    expect(CASE_DETAIL_LENSES['agent-builder'].lensName).toBe('Capability lens');
    expect(CASE_DETAIL_LENSES.expert.lensName).toBe('Work lens');
    expect(CASE_DETAIL_LENSES.evaluator.lensName).toBe('Measurement lens');
    expect(CASE_DETAIL_LENSES.researcher.lensName).toBe('Hypothesis lens');
    expect(CASE_DETAIL_LENSES.operator.lensName).toBe('Operations lens');
    expect(CASE_DETAIL_LENSES.administrator.lensName).toBe('Policy lens');
  });

  it('answers the RC1.0 same-object questions', () => {
    expect(CASE_DETAIL_LENSES.owner.question).toContain('struggling');
    expect(CASE_DETAIL_LENSES.expert.question).toContain('asked to perform');
    expect(CASE_DETAIL_LENSES['agent-builder'].question).toContain('missing from the Body');
    expect(CASE_DETAIL_LENSES.researcher.question).toContain('hypothesis');
  });

  it('rejects unknown lenses', () => {
    expect(() => caseDetailLens('nobody')).toThrowError(/unknown case-detail role lens/);
  });
});

describe('task lenses (UXM1.0 /tasks/:id row)', () => {
  it('binds the route-matrix lens names', () => {
    expect(TASK_LENSES.owner.lensName).toBe('Task outcome');
    expect(TASK_LENSES['agent-builder'].lensName).toBe('Task design');
    expect(TASK_LENSES.expert.lensName).toBe('Execute / review');
    expect(TASK_LENSES.evaluator.lensName).toBe('Rubric');
    expect(TASK_LENSES.researcher.lensName).toBe('Benchmark');
    expect(TASK_LENSES.operator.lensName).toBe('Run health');
    expect(TASK_LENSES.administrator.lensName).toBe('Policy');
  });

  it('marks the marketplace row honestly', () => {
    expect(TASK_LENSES['marketplace-participant'].notPrimarySurface).toBe(true);
  });

  it('rejects unknown lenses', () => {
    expect(() => taskLens('ghost')).toThrowError(/unknown task role lens/);
  });
});
