/**
 * Per-mode result-contract suite (Work Order C007) — result typing for
 * every live + informational mode: positive construction, fail-closed
 * required fields, the mode-authorization guard inside the
 * constructor, and the single-taxonomy mapping onto C001 result inputs.
 */

import { describe, expect, it } from 'vitest';
import { createEscalationResult, isEscalationResult } from '@arena/escalation';
import { InterventionError, INTERVENTION_ERROR_CODES } from './errors.js';
import { createInterventionResult, evidenceRefsOfContract, toEscalationResultInput } from './results.js';
import type { CreateInterventionResultInput } from './results.js';
import {
  makeCorrectionInput,
  makeEvaluateInput,
  makeKnowledgeInput,
  makeReviewInput,
  makeSolveInput,
  makeTeachInput,
  makeToolGapInput,
  makeUnblockInput,
} from './test-support.js';

describe('CORRECT — correction patch + before/after evidence refs', () => {
  it('constructs the typed correction contract', () => {
    const contract = createInterventionResult(makeCorrectionInput());
    expect(contract.kind).toBe('correction');
    if (contract.kind !== 'correction') throw new Error('unreachable');
    expect(contract.correctedRef).toBe('artifact/boq-draft-7/line-42');
    expect(contract.replacement).toEqual({ material: 'aggregate', quantity: 82.5, unit: 'm3', rate: 210 });
    expect(contract.beforeEvidenceRefs).toEqual(['artifact/boq-draft-7/v3']);
    expect(contract.afterEvidenceRefs).toEqual(['artifact/boq-draft-7/v4']);
    expect(Object.isFrozen(contract)).toBe(true);
  });

  it('fails closed without BEFORE/AFTER evidence refs', () => {
    expect(() => createInterventionResult(makeCorrectionInput({ beforeEvidenceRefs: [] }))).toThrowError(
      InterventionError,
    );
    expect(() =>
      createInterventionResult(makeCorrectionInput({ afterEvidenceRefs: undefined })),
    ).toThrowError(InterventionError);
    try {
      createInterventionResult(makeCorrectionInput({ beforeEvidenceRefs: [] }));
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.INVALID_RESULT);
    }
  });
});

describe('UNBLOCK — exactly the missing information/decision + provenance', () => {
  it('constructs the typed unblock contract with provenance', () => {
    const contract = createInterventionResult(makeUnblockInput());
    expect(contract.kind).toBe('unblock');
    if (contract.kind !== 'unblock') throw new Error('unreachable');
    expect(contract.informationKind).toBe('information');
    expect(contract.provenance.sourceRefs).toEqual(['artifact/local-construction-code-gh/2026']);
    expect(contract.missingInformation).toMatchObject({ rule: 'GH-WET-SEASON-CONCRETE' });
  });

  it('accepts the decision flavor', () => {
    const contract = createInterventionResult(
      makeUnblockInput({ informationKind: 'decision', missingInformation: { decision: 'approve-alternative-b' } }),
    );
    expect(contract.kind).toBe('unblock');
    if (contract.kind !== 'unblock') throw new Error('unreachable');
    expect(contract.informationKind).toBe('decision');
  });

  it('fails closed without provenance', () => {
    expect(() => createInterventionResult(makeUnblockInput({ provenance: undefined }))).toThrowError(
      InterventionError,
    );
    try {
      createInterventionResult(makeUnblockInput({ provenance: undefined }));
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.INVALID_RESULT);
    }
  });

  it('fails closed on an out-of-vocabulary information kind', () => {
    expect(() =>
      createInterventionResult(makeUnblockInput({ informationKind: 'opinion' })),
    ).toThrowError(InterventionError);
  });
});

describe('SOLVE — completed-subproblem result + evidence bundle', () => {
  it('constructs the typed solution contract with an evidence bundle', () => {
    const contract = createInterventionResult(makeSolveInput());
    expect(contract.kind).toBe('solution');
    if (contract.kind !== 'solution') throw new Error('unreachable');
    expect(contract.steps.length).toBe(3);
    expect(contract.evidenceBundle.evidenceRefs.length).toBe(2);
    expect(contract.payload).toMatchObject({ total: 173_400 });
  });

  it('carries the optional trajectory binding inside the evidence bundle', () => {
    const contract = createInterventionResult(
      makeSolveInput({
        trajectoryRef: { trajectoryId: 'ivn-traj-solve-1', chainHead: 'c'.repeat(64) },
      }),
    );
    if (contract.kind !== 'solution') throw new Error('unreachable');
    expect(contract.evidenceBundle.trajectoryRef?.trajectoryId).toBe('ivn-traj-solve-1');
  });

  it('fails closed without steps or evidence', () => {
    expect(() => createInterventionResult(makeSolveInput({ steps: [] }))).toThrowError(
      InterventionError,
    );
    expect(() => createInterventionResult(makeSolveInput({ evidenceRefs: [] }))).toThrowError(
      InterventionError,
    );
  });
});

describe('REVIEW — critique/verdict against declared criteria', () => {
  it('constructs the typed review contract with one evaluation per declared criterion', () => {
    const contract = createInterventionResult(makeReviewInput());
    expect(contract.kind).toBe('review');
    if (contract.kind !== 'review') throw new Error('unreachable');
    expect(contract.verdict).toBe('approved');
    expect(contract.declaredCriteria.length).toBe(2);
    expect(contract.criteriaEvaluations.length).toBe(2);
    expect(contract.findings.length).toBe(1);
  });

  it('fails closed when a declared criterion is NOT evaluated (A012 discipline)', () => {
    expect(() =>
      createInterventionResult(
        makeReviewInput({ criteriaEvaluations: makeReviewInput().criteriaEvaluations?.slice(0, 1) }),
      ),
    ).toThrowError(InterventionError);
    try {
      createInterventionResult(
        makeReviewInput({ criteriaEvaluations: makeReviewInput().criteriaEvaluations?.slice(0, 1) }),
      );
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.INVALID_RESULT);
    }
  });

  it('fails closed when an evaluation references an UNDECLARED criterion', () => {
    expect(() =>
      createInterventionResult(
        makeReviewInput({
          criteriaEvaluations: [
            ...(makeReviewInput().criteriaEvaluations ?? []),
            { criteriaRef: 'criteria/undeclared', verdict: 'met', note: 'not declared up front' },
          ],
        }),
      ),
    ).toThrowError(InterventionError);
  });

  it('fails closed without declared criteria', () => {
    expect(() => createInterventionResult(makeReviewInput({ declaredCriteria: [] }))).toThrowError(
      InterventionError,
    );
  });

  it('fails closed on an out-of-vocabulary verdict', () => {
    expect(() => createInterventionResult(makeReviewInput({ verdict: 'maybe' }))).toThrowError(
      InterventionError,
    );
  });
});

describe('TEACH — observable demonstration record (capture mandatory)', () => {
  it('constructs the typed teach contract in the EES1.0 replay shape', () => {
    const contract = createInterventionResult(makeTeachInput());
    expect(contract.kind).toBe('teach-demonstration');
    if (contract.kind !== 'teach-demonstration') throw new Error('unreachable');
    expect(contract.demonstration.length).toBe(2);
    const step = contract.demonstration[0];
    expect(step?.stateRef).toBe('capsule/boq-teach-1/state-0');
    expect(step?.humanAction).toContain('annotated');
    expect(step?.consequenceRef).toBe('artifact/takeoff-notes-1');
    expect(step?.evidenceRefs.length).toBe(2);
    expect(contract.trajectoryRef?.chainHead).toBe('c'.repeat(64));
  });

  it('fails closed WITHOUT the mandatory trajectory binding', () => {
    expect(() => createInterventionResult(makeTeachInput({ trajectoryRef: undefined }))).toThrowError(
      InterventionError,
    );
    try {
      createInterventionResult(makeTeachInput({ trajectoryRef: undefined }));
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.CAPTURE_REQUIRED);
    }
  });

  it('fails closed without demonstration steps', () => {
    expect(() => createInterventionResult(makeTeachInput({ demonstration: [] }))).toThrowError(
      InterventionError,
    );
    try {
      createInterventionResult(makeTeachInput({ demonstration: [] }));
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.CAPTURE_REQUIRED);
    }
  });

  it('fails closed when a demonstration step lacks evidence', () => {
    expect(() =>
      createInterventionResult(
        makeTeachInput({
          demonstration:
            [{ stateRef: 's0', humanAction: 'act', consequenceRef: 'c0' }] as unknown as CreateInterventionResultInput['demonstration'],
        }),
      ),
    ).toThrowError(InterventionError);
  });
});

describe('TOOL_GAP / KNOWLEDGE / EVALUATE — informational contracts', () => {
  it('constructs the tool-gap contract with evidence of use', () => {
    const contract = createInterventionResult(makeToolGapInput());
    if (contract.kind !== 'tool-gap-signal') throw new Error('unreachable');
    expect(contract.missingToolId).toBe('tool/gh-local-rate-db');
    expect(contract.evidenceOfUseRefs.length).toBe(1);
  });

  it('constructs the knowledge contract with an EXPLICIT scope', () => {
    const contract = createInterventionResult(makeKnowledgeInput());
    if (contract.kind !== 'knowledge-patch') throw new Error('unreachable');
    expect(contract.scope).toBe('construction.boq.gh-accra.foundation');
    expect(() =>
      createInterventionResult(makeKnowledgeInput({ scope: '' })),
    ).toThrowError(InterventionError);
  });

  it('constructs the evaluate contract over a subject', () => {
    const contract = createInterventionResult(makeEvaluateInput());
    if (contract.kind !== 'evaluation-verdict') throw new Error('unreachable');
    expect(contract.verdict).toBe('pass');
    expect(contract.subjectRef).toBe('artifact/boq-draft-7/v4');
    expect(() =>
      createInterventionResult(makeEvaluateInput({ verdict: 'maybe' })),
    ).toThrowError(InterventionError);
  });
});

describe('the constructor is mode-authorization guarded (never coerced)', () => {
  it('rejects an unlisted mode with the typed UNPERMITTED_MODE failure', () => {
    expect(() =>
      createInterventionResult(makeCorrectionInput({ permittedModes: ['unblock'] })),
    ).toThrowError(InterventionError);
    try {
      createInterventionResult(makeCorrectionInput({ permittedModes: ['unblock'] }));
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE);
    }
  });

  it('rejects an unknown mode with the typed INVALID_MODE failure', () => {
    expect(() =>
      createInterventionResult(makeCorrectionInput({ mode: 'supervise' })),
    ).toThrowError(InterventionError);
  });
});

describe('single taxonomy — mapping onto C001 escalation results', () => {
  const cases = [
    ['correction', makeCorrectionInput],
    ['unblock', makeUnblockInput],
    ['solution', makeSolveInput],
    ['review', makeReviewInput],
    ['teach-demonstration', makeTeachInput],
    ['tool-gap-signal', makeToolGapInput],
    ['knowledge-patch', makeKnowledgeInput],
    ['evaluation-verdict', makeEvaluateInput],
  ] as const;

  it.each(cases)('%s maps onto a valid C001 EscalationResult', async (kind, factory) => {
    const contract = createInterventionResult(factory());
    expect(contract.kind).toBe(kind);
    const result = createEscalationResult(toEscalationResultInput(contract));
    expect(isEscalationResult(result)).toBe(true);
    expect(result.summary).toBe(contract.summary);
  });

  it('correction maps with the patch; unblock with the resolution; review folds criteria evaluations', () => {
    const correction = createInterventionResult(makeCorrectionInput());
    const correctionResult = createEscalationResult(toEscalationResultInput(correction));
    expect(correctionResult.kind).toBe('correction');

    const unblock = createInterventionResult(makeUnblockInput());
    const unblockResult = createEscalationResult(toEscalationResultInput(unblock));
    expect(unblockResult.kind).toBe('unblock');

    const review = createInterventionResult(makeReviewInput());
    const reviewResult = createEscalationResult(toEscalationResultInput(review));
    expect(reviewResult.kind).toBe('review');
    if (reviewResult.kind !== 'review') throw new Error('unreachable');
    expect(reviewResult.findings.length).toBe(3);
  });

  it('evidenceRefsOfContract exposes each mode\'s submission evidence', () => {
    expect(evidenceRefsOfContract(createInterventionResult(makeCorrectionInput())).length).toBe(2);
    expect(evidenceRefsOfContract(createInterventionResult(makeUnblockInput())).length).toBe(1);
    expect(evidenceRefsOfContract(createInterventionResult(makeTeachInput())).length).toBe(4);
  });
});
