/**
 * Validator-selection tests (Work Order C009): the conflict-of-interest
 * exclusion closure, deterministic ranking, the exclusion ledger, and
 * the no-authorization discipline (lock rule 35).
 */

import { describe, expect, it } from 'vitest';
import {
  consumeSelectionAsAuthorization,
  createValidatorCandidate,
  selectValidator,
} from './validator-selection.js';

const INPUT = {
  requestId: 'esc_00000000000000000000000000000000',
  tenantId: 'tenant-alpha',
  submittingExpertRef: 'expert-submitter-1',
  coiExpertRefs: ['expert-rival-9'],
  requiredSkills: ['boq-estimation.quantity-takeoff'],
};

function candidate(
  expertRef: string,
  evidenceRecords: number,
  overrides: {
    tenant?: string;
    stale?: boolean;
    skill?: string;
    agreements?: number;
    disagreements?: number;
  } = {},
) {
  return createValidatorCandidate({
    expertRef,
    tenant: overrides.tenant ?? 'tenant-alpha',
    competency: [
      {
        skill: overrides.skill ?? 'boq-estimation.quantity-takeoff',
        evidenceRecords,
        totalSampleSize: evidenceRecords * 10,
        latestOutcome: 'demonstrated',
        stale: overrides.stale ?? false,
      },
    ],
    agreement:
      overrides.agreements === undefined
        ? null
        : {
            agreements: overrides.agreements,
            disagreements: overrides.disagreements ?? 0,
          },
  });
}

describe('selectValidator (typed outcome + COI closure)', () => {
  it('selects the strongest eligible candidate (deterministic)', () => {
    const result = selectValidator(
      [candidate('expert-validator-2', 5), candidate('expert-validator-1', 12)],
      INPUT,
    );
    expect(result.outcome).toBe('selected');
    if (result.outcome !== 'selected') throw new Error('unreachable');
    expect(result.validator.expertRef).toBe('expert-validator-1');
    expect(result.considered).toBe(2);
    expect(result.exclusions).toHaveLength(0);
  });

  it('THE COI FILTER IS CLOSED: the submitting expert is NEVER selected, even when strongest', () => {
    const result = selectValidator(
      [
        candidate('expert-submitter-1', 99),
        candidate('expert-validator-1', 3),
      ],
      INPUT,
    );
    expect(result.outcome).toBe('selected');
    if (result.outcome !== 'selected') throw new Error('unreachable');
    expect(result.validator.expertRef).not.toBe('expert-submitter-1');
    expect(result.exclusions).toContainEqual({
      expertRef: 'expert-submitter-1',
      reason: 'conflict-of-interest',
    });
  });

  it('excludes listed COI experts with the machine-readable reason', () => {
    const result = selectValidator(
      [candidate('expert-rival-9', 50), candidate('expert-validator-1', 1)],
      INPUT,
    );
    if (result.outcome !== 'selected') throw new Error('unreachable');
    expect(result.validator.expertRef).toBe('expert-validator-1');
    expect(result.exclusions).toContainEqual({
      expertRef: 'expert-rival-9',
      reason: 'conflict-of-interest',
    });
  });

  it('closure over EVERY candidate: COI-only pools produce the typed no-validator outcome', () => {
    const result = selectValidator(
      [candidate('expert-submitter-1', 99), candidate('expert-rival-9', 98)],
      INPUT,
    );
    expect(result.outcome).toBe('no-validator');
    if (result.outcome !== 'no-validator') throw new Error('unreachable');
    expect(result.exclusions).toHaveLength(2);
    expect(result.exclusions.every((entry) => entry.reason === 'conflict-of-interest')).toBe(true);
  });

  it('excludes cross-tenant candidates (defense in depth)', () => {
    const result = selectValidator(
      [candidate('expert-other-tenant-1', 99, { tenant: 'tenant-beta' })],
      INPUT,
    );
    expect(result.outcome).toBe('no-validator');
    if (result.outcome !== 'no-validator') throw new Error('unreachable');
    expect(result.exclusions).toContainEqual({
      expertRef: 'expert-other-tenant-1',
      reason: 'cross-tenant',
    });
  });

  it('admits the reserved global public scope (C002 precedent)', () => {
    const result = selectValidator(
      [candidate('expert-public-1', 7, { tenant: 'public' })],
      INPUT,
    );
    expect(result.outcome).toBe('selected');
  });

  it('excludes candidates without competency evidence for the required skills', () => {
    const result = selectValidator(
      [candidate('expert-novice-1', 9, { skill: 'some.other-skill' })],
      INPUT,
    );
    expect(result.outcome).toBe('no-validator');
    if (result.outcome !== 'no-validator') throw new Error('unreachable');
    expect(result.exclusions).toContainEqual({
      expertRef: 'expert-novice-1',
      reason: 'no-competency-evidence',
    });
  });

  it('excludes candidates whose relevant evidence is entirely stale', () => {
    const result = selectValidator([candidate('expert-stale-1', 9, { stale: true })], INPUT);
    expect(result.outcome).toBe('no-validator');
    if (result.outcome !== 'no-validator') throw new Error('unreachable');
    expect(result.exclusions).toContainEqual({
      expertRef: 'expert-stale-1',
      reason: 'stale-evidence-only',
    });
  });

  it('is DETERMINISTIC: identical inputs yield identical selections', () => {
    const pool = [
      candidate('expert-validator-2', 5),
      candidate('expert-validator-1', 12),
      candidate('expert-validator-3', 12),
    ];
    const first = selectValidator(pool, INPUT);
    const second = selectValidator(pool, INPUT);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('breaks evidence-volume ties by sample size, then expert ref (stable total order)', () => {
    const result = selectValidator(
      [
        candidate('expert-validator-b', 12),
        candidate('expert-validator-a', 12),
      ],
      INPUT,
    );
    if (result.outcome !== 'selected') throw new Error('unreachable');
    expect(result.validator.expertRef).toBe('expert-validator-a');
  });
});

describe('the authority discipline (lock rule 35)', () => {
  it('consumeSelectionAsAuthorization has NO happy path (fail-closed by construction)', () => {
    const selection = selectValidator([candidate('expert-validator-1', 5)], INPUT);
    const consumed = consumeSelectionAsAuthorization(selection);
    expect(consumed.granted).toBe(false);
    expect(consumed.reason).toBe('selection-is-not-authorization');
  });
});
