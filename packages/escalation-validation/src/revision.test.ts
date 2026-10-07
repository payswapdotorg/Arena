/**
 * Revision-loop tests (Work Order C009): the bounded versioned policy,
 * typed revision requests, the impossible revision-limit bypass, and
 * the deadline derivation.
 */

import { describe, expect, it } from 'vitest';
import {
  checkRevisionBudget,
  createRevisionRequest,
  initialRevisionState,
  nextRevisionState,
  requiredChangesOf,
  revisionResubmissionDeadline,
} from './revision.js';
import { createAdjudicationOutcome } from './adjudication.js';
import type { EvaluationStageResult, VerificationStageResult } from './adjudication.js';
import { newAdjudicationVerdictId, newRevisionRequestId } from './shared.js';
import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';

const POLICY = { policyVersion: 1 as const, maxRevisionAttempts: 2, revisionWindowMs: 3_600_000 };

function evaluationStage(): EvaluationStageResult {
  return {
    stage: 'evaluation',
    outcome: 'below-criteria',
    recordDigest: 'a'.repeat(64),
    evaluatorRef: 'b'.repeat(64),
    validatorExpertRef: 'expert-validator-1',
    criteriaJudgments: [
      {
        criteriaRef: 'boq-estimation.quantity-takeoff.completeness',
        verdict: 'not-met',
        score: 0.4,
        note: null,
      },
    ],
    executedAt: '2026-10-07T12:00:00.000Z',
    provenance: 'reference-evaluation-fabric',
  };
}

function verificationStage(): VerificationStageResult {
  return {
    stage: 'verification',
    outcome: 'fail',
    recordDigest: 'c'.repeat(64),
    verifierRef: 'd'.repeat(64),
    evidenceSupport: [
      {
        claim: 'the corrected quantity takeoff is backed by a provenance-bearing artifact',
        status: 'present-unsupported',
      },
    ],
    evidenceRefs: ['artifact://after-1'],
    executedAt: '2026-10-07T12:01:00.000Z',
    provenance: 'reference-verification-fabric',
  };
}

function failedOutcome() {
  return createAdjudicationOutcome({
    verdictId: newAdjudicationVerdictId(),
    requestId: 'esc_00000000000000000000000000000000',
    tenantId: 'tenant-alpha',
    attemptNumber: 1,
    verdict: 'revision_required',
    reasons: [
      { code: 'evaluation-below-criteria', detail: 'below the declared criteria', ref: 'a'.repeat(64) },
      { code: 'verification-fail', detail: 'unsupported claim', ref: 'c'.repeat(64) },
      { code: 'revision-attempts-remain', detail: 'attempt 1 of 2', ref: null },
    ],
    evaluationStage: evaluationStage(),
    verificationStage: verificationStage(),
    adjudicatedAt: '2026-10-07T12:02:00.000Z',
  });
}

describe('revision state accounting', () => {
  it('starts at attempt 1 and advances monotonically', () => {
    const state = initialRevisionState(POLICY);
    expect(state.attemptNumber).toBe(1);
    expect(nextRevisionState(state).attemptNumber).toBe(2);
  });

  it('checkRevisionBudget is typed, never a bare boolean', () => {
    expect(checkRevisionBudget({ attemptNumber: 2, maxRevisionAttempts: 2 })).toEqual({
      allowed: true,
    });
    const exhausted = checkRevisionBudget({ attemptNumber: 3, maxRevisionAttempts: 2 });
    expect(exhausted.allowed).toBe(false);
    if (!exhausted.allowed) expect(exhausted.reason).toBe('revision-budget-exhausted');
  });
});

describe('createRevisionRequest (bounded by construction)', () => {
  const base = {
    revisionId: newRevisionRequestId(),
    requestId: 'esc_00000000000000000000000000000000',
    tenantId: 'tenant-alpha',
    requiredChanges: [{ code: 'criteria-not-met', detail: 'fix the takeoff', ref: null }],
    requestedAt: '2026-10-07T12:03:00.000Z',
  };

  it('creates a typed revision request with attempt number and deadline', () => {
    const request = createRevisionRequest(
      { ...base, attemptNumber: 1, resubmissionDeadline: '2026-10-07T13:00:00.000Z' },
      POLICY,
    );
    expect(request.revisionVersion).toBe(1);
    expect(request.attemptNumber).toBe(1);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('THE BYPASS IS IMPOSSIBLE: an attempt beyond the policy cannot be constructed', () => {
    expect(() =>
      createRevisionRequest(
        { ...base, attemptNumber: 3, resubmissionDeadline: '2026-10-07T13:00:00.000Z' },
        POLICY,
      ),
    ).toThrow(/revision-limit bypass denied/u);
  });

  it('rejects change codes outside the closed vocabulary', () => {
    expect(() =>
      createRevisionRequest(
        {
          ...base,
          attemptNumber: 1,
          resubmissionDeadline: '2026-10-07T13:00:00.000Z',
          requiredChanges: [{ code: 'just-trust-me', detail: 'no', ref: null }],
        },
        POLICY,
      ),
    ).toThrow(/closed vocabulary/u);
  });

  it('rejects a deadline at or before the request time', () => {
    expect(() =>
      createRevisionRequest(
        { ...base, attemptNumber: 1, resubmissionDeadline: '2026-10-07T12:03:00.000Z' },
        POLICY,
      ),
    ).toThrow(/after requestedAt/u);
  });
});

describe('requiredChangesOf (deterministic reason mapping)', () => {
  it('derives machine-readable changes from the adjudication reasons', () => {
    const changes = requiredChangesOf(failedOutcome());
    expect(changes.map((change) => change.code)).toEqual([
      'criteria-not-met',
      'evidence-unsupported',
    ]);
    expect(changes[0]?.ref).toBe('a'.repeat(64));
  });

  it('fails closed when no changes are derivable (verdict/reason contradiction)', () => {
    const accepted = createAdjudicationOutcome({
      verdictId: newAdjudicationVerdictId(),
      requestId: 'esc_00000000000000000000000000000000',
      tenantId: 'tenant-alpha',
      attemptNumber: 1,
      verdict: 'accepted',
      reasons: [{ code: 'evaluation-meets-criteria', detail: 'ok', ref: null }],
      evaluationStage: {
        ...evaluationStage(),
        outcome: 'meets-criteria',
      },
      verificationStage: {
        ...verificationStage(),
        outcome: 'pass',
      },
      adjudicatedAt: '2026-10-07T12:02:00.000Z',
    });
    expect(() => requiredChangesOf(accepted)).toThrow(EscalationValidationError);
  });
});

describe('revisionResubmissionDeadline', () => {
  it('picks the EARLIER of the request deadline and the window', () => {
    const byWindow = revisionResubmissionDeadline(
      '2027-01-01T00:00:00.000Z',
      POLICY,
      '2026-10-07T12:00:00.000Z',
    );
    expect(byWindow).toBe('2026-10-07T13:00:00.000Z');
    const byDeadline = revisionResubmissionDeadline(
      '2026-10-07T12:30:00.000Z',
      POLICY,
      '2026-10-07T12:00:00.000Z',
    );
    expect(byDeadline).toBe('2026-10-07T12:30:00.000Z');
  });
});
