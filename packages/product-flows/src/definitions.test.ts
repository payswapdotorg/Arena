import { describe, expect, it } from 'vitest';

import {
  FLOW_SUPPLEMENT,
  GUIDED_FLOW_STEPS,
  PRODUCT_FLOW_VERSION,
  getFlowStep,
  nextGuidedStep,
  stepsValidFrom,
} from './definitions.js';
import { PRODUCT_FLOW_ERROR_CODES } from './errors.js';

describe('guided-flow definitions (frozen, versioned, canonical-bound)', () => {
  it('ships seven ordered steps with contiguous 1-based order (positive)', () => {
    expect(GUIDED_FLOW_STEPS).toHaveLength(7);
    expect(GUIDED_FLOW_STEPS.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('uses each canonical transition exactly once, in canonical order (positive)', () => {
    expect(GUIDED_FLOW_STEPS.map((step) => step.transition)).toEqual([
      'create',
      'submit',
      'triage',
      'activate',
      'attach-evidence',
      'attach-evidence',
      'resolve',
    ]);
  });

  it('lands in the guided statuses; superseded is reachable only canonically, never by the guided path (positive)', () => {
    const landed = [...new Set(GUIDED_FLOW_STEPS.map((step) => step.validTo))];
    expect(landed).toEqual(['draft', 'submitted', 'triaged', 'active', 'resolved']);
    expect(landed).not.toContain('superseded');
  });

  it('binds steps to the canonical statuses they are valid from (positive)', () => {
    expect(GUIDED_FLOW_STEPS.map((step) => step.validFrom)).toEqual([
      'new',
      'draft',
      'submitted',
      'triaged',
      'active',
      'active',
      'active',
    ]);
  });

  it('answers the guided next step for every non-terminal status (positive)', () => {
    expect(nextGuidedStep('draft')?.stepId).toBe('frame-gap');
    expect(nextGuidedStep('submitted')?.stepId).toBe('compose-task');
    expect(nextGuidedStep('triaged')?.stepId).toBe('run');
    // Once ACTIVE, the guided path continues at observe (run happened from triaged).
    expect(nextGuidedStep('active')?.stepId).toBe('observe');
  });

  it('answers an honest dead-end at terminal statuses (negative)', () => {
    expect(nextGuidedStep('resolved')).toBeNull();
    expect(nextGuidedStep('superseded')).toBeNull();
  });

  it('offers every affordance valid from a status, not just the first (positive)', () => {
    const active = stepsValidFrom('active').map((step) => step.stepId);
    expect(active).toEqual(['observe', 'evaluate', 'decide']);
    expect(stepsValidFrom('triaged').map((step) => step.stepId)).toEqual(['run']);
  });

  it('rejects unknown step ids with the typed PRODUCT_FLOW_UNKNOWN_STEP (negative)', () => {
    expect(() => getFlowStep('make-coffee')).toThrowError(
      expect.objectContaining({ code: PRODUCT_FLOW_ERROR_CODES.UNKNOWN_STEP }),
    );
    expect(() => getFlowStep('')).toThrowError(/unknown guided-flow step id/);
  });

  it('versions the definition contract and discloses the canonical supersede/follow-up paths (positive)', () => {
    expect(PRODUCT_FLOW_VERSION).toBe(1);
    expect(FLOW_SUPPLEMENT.followUp).toContain('Terminal');
    expect(FLOW_SUPPLEMENT.supersede).toContain('superseded');
  });
});
