/**
 * Adjudication engine tests (Work Order C009): the EXPLICIT distinct
 * evaluation/verification stage combination (lock rule 7), verdict
 * typing with machine-readable reasons, and the fail-closed verdict
 * discipline (a verdict consumed as authorization must fail closed).
 */

import { describe, expect, it } from 'vitest';
import {
  ADJUDICATION_REASON_CODES,
  combineStages,
  createAdjudicationOutcome,
  isAdjudicationOutcome,
} from './adjudication.js';
import type { EvaluationStageResult, VerificationStageResult } from './adjudication.js';
import { newAdjudicationVerdictId } from './shared.js';
import { EscalationValidationError } from './errors.js';

function evaluationStage(outcome: EvaluationStageResult['outcome']): EvaluationStageResult {
  return {
    stage: 'evaluation',
    outcome,
    recordDigest: 'a'.repeat(64),
    evaluatorRef: 'b'.repeat(64),
    validatorExpertRef: 'expert-validator-1',
    criteriaJudgments: [
      {
        criteriaRef: 'boq-estimation.quantity-takeoff.completeness',
        verdict: outcome === 'meets-criteria' ? 'met' : 'not-met',
        score: outcome === 'meets-criteria' ? 0.9 : 0.4,
        note: null,
      },
    ],
    executedAt: '2026-10-07T12:00:00.000Z',
    provenance: 'reference-evaluation-fabric',
  };
}

function verificationStage(outcome: VerificationStageResult['outcome']): VerificationStageResult {
  return {
    stage: 'verification',
    outcome,
    recordDigest: 'c'.repeat(64),
    verifierRef: 'd'.repeat(64),
    evidenceSupport: [
      {
        claim: 'the corrected quantity takeoff is backed by a provenance-bearing artifact',
        status: outcome === 'pass' ? 'present-supported' : outcome === 'fail' ? 'present-unsupported' : 'missing',
      },
    ],
    evidenceRefs: ['artifact://after-1'],
    executedAt: '2026-10-07T12:01:00.000Z',
    provenance: 'reference-verification-fabric',
  };
}

describe('combineStages (the EXPLICIT composition — lock rule 7)', () => {
  it('ACCEPTS when evaluation meets criteria AND verification passes', () => {
    const result = combineStages(evaluationStage('meets-criteria'), verificationStage('pass'), {
      attemptNumber: 1,
      maxRevisionAttempts: 2,
    });
    expect(result.verdict).toBe('accepted');
    expect(result.validationStatus).toBe('passed');
    expect(result.reasons.map((reason) => reason.code)).toContain('evaluation-meets-criteria');
    expect(result.reasons.map((reason) => reason.code)).toContain('verification-pass');
  });

  it('REVISION_REQUIRED when a stage fails while attempts remain', () => {
    const result = combineStages(evaluationStage('below-criteria'), verificationStage('pass'), {
      attemptNumber: 1,
      maxRevisionAttempts: 2,
    });
    expect(result.verdict).toBe('revision_required');
    expect(result.validationStatus).toBe('failed');
    expect(result.reasons.map((reason) => reason.code)).toContain('revision-attempts-remain');
  });

  it('REJECTS with reasons when the revision budget is exhausted', () => {
    const result = combineStages(evaluationStage('meets-criteria'), verificationStage('fail'), {
      attemptNumber: 2,
      maxRevisionAttempts: 2,
    });
    expect(result.verdict).toBe('rejected');
    expect(result.validationStatus).toBe('failed');
    expect(result.reasons.map((reason) => reason.code)).toContain('revision-budget-exhausted');
    expect(result.reasons.map((reason) => reason.code)).toContain('verification-fail');
  });

  it('NEEDS_MORE_EVIDENCE when a stage is inconclusive/unknown (verdict cannot be established)', () => {
    for (const [evaluation, verification] of [
      ['inconclusive', 'pass'],
      ['meets-criteria', 'unknown'],
    ] as const) {
      const result = combineStages(
        evaluationStage(evaluation),
        verificationStage(verification),
        { attemptNumber: 1, maxRevisionAttempts: 2 },
      );
      expect(result.verdict).toBe('needs_more_evidence');
      expect(result.validationStatus).toBe('pending');
      expect(result.reasons.map((reason) => reason.code)).toContain(
        'insufficient-evidence-for-verdict',
      );
    }
  });

  it('carries the stage record digests as outcome refs (machine-readable reasons)', () => {
    const result = combineStages(evaluationStage('below-criteria'), verificationStage('fail'), {
      attemptNumber: 1,
      maxRevisionAttempts: 1,
    });
    const refs = result.reasons.map((reason) => reason.ref);
    expect(refs).toContain('a'.repeat(64));
    expect(refs).toContain('c'.repeat(64));
  });

  it('never collapses the stages: BOTH stage reasons always appear', () => {
    const result = combineStages(evaluationStage('below-criteria'), verificationStage('pass'), {
      attemptNumber: 1,
      maxRevisionAttempts: 3,
    });
    const codes = result.reasons.map((reason) => reason.code);
    expect(codes.some((code) => code.startsWith('evaluation-'))).toBe(true);
    expect(codes.some((code) => code.startsWith('verification-'))).toBe(true);
  });
});

describe('createAdjudicationOutcome (strict, fail-closed)', () => {
  const base = {
    verdictId: newAdjudicationVerdictId(),
    requestId: 'esc_00000000000000000000000000000000',
    tenantId: 'tenant-alpha',
    attemptNumber: 1,
    adjudicatedAt: '2026-10-07T12:02:00.000Z',
  };

  it('freezes the outcome and its stages', () => {
    const outcome = createAdjudicationOutcome({
      ...base,
      verdict: 'accepted',
      reasons: [{ code: 'evaluation-meets-criteria', detail: 'ok', ref: null }],
      evaluationStage: evaluationStage('meets-criteria'),
      verificationStage: verificationStage('pass'),
    });
    expect(Object.isFrozen(outcome)).toBe(true);
    expect(Object.isFrozen(outcome.reasons)).toBe(true);
    expect(isAdjudicationOutcome(outcome)).toBe(true);
  });

  it('REJECTS a verdict that disagrees with its own stages (fail-closed)', () => {
    expect(() =>
      createAdjudicationOutcome({
        ...base,
        verdict: 'accepted',
        reasons: [{ code: 'evaluation-meets-criteria', detail: 'ok', ref: null }],
        evaluationStage: evaluationStage('below-criteria'),
        verificationStage: verificationStage('fail'),
      }),
    ).toThrow(EscalationValidationError);
  });

  it('REJECTS a smuggled authority-shaped field (a verdict is NEVER an authorization)', () => {
    const input = {
      ...base,
      verdict: 'accepted',
      authorization: 'granted',
      reasons: [{ code: 'evaluation-meets-criteria', detail: 'ok', ref: null }],
      evaluationStage: evaluationStage('meets-criteria'),
      verificationStage: verificationStage('pass'),
    } as unknown as Parameters<typeof createAdjudicationOutcome>[0];
    expect(() => createAdjudicationOutcome(input)).toThrow(/unknown field/u);
  });

  it('REJECTS reason codes outside the closed vocabulary', () => {
    expect(() =>
      createAdjudicationOutcome({
        ...base,
        verdict: 'accepted',
        reasons: [{ code: 'certified-correct', detail: 'ok', ref: null }],
        evaluationStage: evaluationStage('meets-criteria'),
        verificationStage: verificationStage('pass'),
      }),
    ).toThrow(/closed vocabulary/u);
  });

  it('REJECTS an outcome without machine-readable reasons', () => {
    expect(() =>
      createAdjudicationOutcome({
        ...base,
        verdict: 'accepted',
        reasons: [],
        evaluationStage: evaluationStage('meets-criteria'),
        verificationStage: verificationStage('pass'),
      }),
    ).toThrow(/REQUIRES machine-readable reasons/u);
  });

  it('keeps the reason code vocabulary closed and frozen', () => {
    expect(Object.isFrozen(ADJUDICATION_REASON_CODES)).toBe(true);
    expect([...ADJUDICATION_REASON_CODES]).toHaveLength(9);
  });
});
