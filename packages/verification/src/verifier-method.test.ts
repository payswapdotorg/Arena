/**
 * VerifierMethod tests (Work Order A013): the CLOSED EV1.0 method
 * vocabulary, frozen at module load, with unknown methods rejected.
 */

import { describe, expect, it } from 'vitest';
import { VERIFICATION_ERROR_CODES } from './errors.js';
import { VERIFIER_METHODS, isVerifierMethod, toVerifierMethod } from './verifier-method.js';

describe('VERIFIER_METHODS (the closed EV1.0 vocabulary)', () => {
  it('contains exactly the eight dispatched EV1.0 verification methods', () => {
    expect([...VERIFIER_METHODS]).toEqual([
      'unit_integration_test',
      'deterministic_formal_check',
      'constraint_check',
      'simulation',
      'measurement',
      'inspection',
      'expert_review',
      'evidence_provenance_validation',
    ]);
  });

  it('is frozen at module load (closed vocabulary)', () => {
    expect(Object.isFrozen(VERIFIER_METHODS)).toBe(true);
  });

  it('isVerifierMethod accepts members and rejects everything else', () => {
    for (const method of VERIFIER_METHODS) {
      expect(isVerifierMethod(method)).toBe(true);
    }
    expect(isVerifierMethod('heuristic')).toBe(false);
    expect(isVerifierMethod('deterministic-test')).toBe(false); // that is the OTHER protocol's vocabulary
    expect(isVerifierMethod('Constraint_Check')).toBe(false);
    expect(isVerifierMethod(123)).toBe(false);
    expect(isVerifierMethod(null)).toBe(false);
  });

  it('toVerifierMethod validates and rejects unknowns with INVALID_METHOD', () => {
    expect(toVerifierMethod('constraint_check', 'ctx')).toBe('constraint_check');
    expect(() => toVerifierMethod('vibe-check', 'ctx')).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_METHOD }),
    );
  });
});
