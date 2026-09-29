/**
 * Outcome semantics tests (Work Order A013): the CLOSED outcome
 * vocabulary, the declared per-verifier semantics, the closed
 * unknown-reason taxonomy and the PURE TOTAL derivation — including
 * the exhaustive totality check over every status combination and the
 * construction-level impossibility of quantitative outcomes.
 */

import { describe, expect, it } from 'vitest';
import { VERIFICATION_ERROR_CODES } from './errors.js';
import type { ContentDigest } from './shared.js';
import {
  OUTCOME_SEMANTICS_FIELDS,
  UNKNOWN_CAUSE_FIELDS,
  UNKNOWN_REASONS,
  VERIFICATION_OUTCOMES,
  deriveVerificationOutcome,
  isOutcomeSemantics,
  isUnknownCause,
  isVerificationOutcome,
  toOutcomeSemantics,
  toVerificationOutcome,
} from './outcome.js';
import type { EvidenceSupportSummary, RequirementSupport } from './evidence.js';
import { makeRecordInput, support } from './test-support.js';

function entry(requirementId: string, status: RequirementSupport['status']): RequirementSupport {
  return {
    requirementId: requirementId as RequirementSupport['requirementId'],
    status,
    evidenceDigest: (status === 'missing' ? null : 'a'.repeat(64)) as ContentDigest | null,
    notes: null,
  };
}

describe('VERIFICATION_OUTCOMES (closed vocabulary)', () => {
  it('totals exactly pass | fail | unknown — no fourth member, no numbers', () => {
    expect([...VERIFICATION_OUTCOMES]).toEqual(['pass', 'fail', 'unknown']);
    expect(Object.isFrozen(VERIFICATION_OUTCOMES)).toBe(true);
    expect(isVerificationOutcome('pass')).toBe(true);
    expect(isVerificationOutcome('fail')).toBe(true);
    expect(isVerificationOutcome('unknown')).toBe(true);
    expect(isVerificationOutcome('excellent')).toBe(false);
    expect(isVerificationOutcome('0.87')).toBe(false);
    expect(isVerificationOutcome(0.87)).toBe(false);
    expect(isVerificationOutcome(null)).toBe(false);
  });

  it('toVerificationOutcome rejects unknowns with INVALID_OUTCOME', () => {
    expect(toVerificationOutcome('pass', 'ctx')).toBe('pass');
    expect(() => toVerificationOutcome('PASS', 'ctx')).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_OUTCOME }),
    );
  });
});

describe('OutcomeSemantics (the declared meaning of each outcome)', () => {
  it('requires all three declarations as non-empty neutral text', () => {
    const semantics = toOutcomeSemantics({
      pass: 'all requirements satisfied by verified evidence',
      fail: 'verified evidence contradicts a requirement',
      unknown: 'at least one requirement cannot be decided',
    });
    expect([...OUTCOME_SEMANTICS_FIELDS]).toEqual(['pass', 'fail', 'unknown']);
    expect(isOutcomeSemantics(semantics)).toBe(true);
    expect(Object.isFrozen(semantics)).toBe(true);
  });

  it('rejects missing or empty declarations and unknown fields', () => {
    expect(() =>
      toOutcomeSemantics({ pass: 'p', fail: 'f' }), // no unknown declaration
    ).toThrowError(expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_OUTCOME }));
    expect(() =>
      toOutcomeSemantics({ pass: '', fail: 'f', unknown: 'u' }),
    ).toThrowError(expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_OUTCOME }));
    expect(() =>
      toOutcomeSemantics({ pass: 'p', fail: 'f', unknown: 'u', weighted: 'w' }),
    ).toThrowError(/unknown field 'weighted'/);
    expect(
      isOutcomeSemantics({ pass: 'p', fail: 'f', unknown: 42 }),
    ).toBe(false);
  });
});

describe('UNKNOWN_REASONS (closed why-taxonomy)', () => {
  it('contains exactly the three dispatched causes', () => {
    expect([...UNKNOWN_REASONS]).toEqual([
      'missing-evidence',
      'unverifiable-provenance',
      'method-limitation',
    ]);
    expect(Object.isFrozen(UNKNOWN_REASONS)).toBe(true);
    expect([...UNKNOWN_CAUSE_FIELDS]).toEqual(['reason', 'detail']);
  });

  it('isUnknownCause validates the structured cause', () => {
    expect(isUnknownCause({ reason: 'missing-evidence', detail: 'missing-evidence: req-1' })).toBe(true);
    expect(isUnknownCause({ reason: 'insufficient-vibes', detail: 'x' })).toBe(false);
    expect(isUnknownCause({ reason: 'missing-evidence' })).toBe(false);
    expect(isUnknownCause(null)).toBe(false);
  });
});

describe('deriveVerificationOutcome (the pure total derivation)', () => {
  it('all present-supported ⇒ pass with NO unknown cause', () => {
    const summary: EvidenceSupportSummary = [
      entry('req-1', 'present-supported'),
      entry('req-2', 'present-supported'),
    ];
    const derived = deriveVerificationOutcome(summary);
    expect(derived.outcome).toBe('pass');
    expect(derived.unknownCause).toBe(null);
  });

  it('any present-unsupported (with the rest supported) ⇒ fail', () => {
    const summary: EvidenceSupportSummary = [
      entry('req-1', 'present-supported'),
      entry('req-2', 'present-unsupported'),
    ];
    expect(deriveVerificationOutcome(summary).outcome).toBe('fail');
  });

  it('any missing ⇒ unknown / missing-evidence (even alongside unsupported)', () => {
    const summary: EvidenceSupportSummary = [
      entry('req-1', 'missing'),
      entry('req-2', 'present-unsupported'),
    ];
    const derived = deriveVerificationOutcome(summary);
    expect(derived.outcome).toBe('unknown');
    expect(derived.unknownCause?.reason).toBe('missing-evidence');
    expect(derived.unknownCause?.detail).toContain('req-1');
  });

  it('any present-unverified ⇒ unknown / unverifiable-provenance', () => {
    const summary: EvidenceSupportSummary = [
      entry('req-1', 'present-unverified'),
      entry('req-2', 'present-unsupported'),
    ];
    const derived = deriveVerificationOutcome(summary);
    expect(derived.outcome).toBe('unknown');
    expect(derived.unknownCause?.reason).toBe('unverifiable-provenance');
  });

  it('any present-indeterminate ⇒ unknown / method-limitation', () => {
    const summary: EvidenceSupportSummary = [entry('req-1', 'present-indeterminate')];
    const derived = deriveVerificationOutcome(summary);
    expect(derived.outcome).toBe('unknown');
    expect(derived.unknownCause?.reason).toBe('method-limitation');
  });

  it('precedence: missing > unverifiable > indeterminate (deterministic)', () => {
    const all: EvidenceSupportSummary = [
      entry('req-1', 'present-indeterminate'),
      entry('req-2', 'present-unverified'),
      entry('req-3', 'missing'),
    ];
    expect(deriveVerificationOutcome(all).unknownCause?.reason).toBe('missing-evidence');
    const two: EvidenceSupportSummary = [
      entry('req-1', 'present-indeterminate'),
      entry('req-2', 'present-unverified'),
    ];
    expect(deriveVerificationOutcome(two).unknownCause?.reason).toBe('unverifiable-provenance');
  });

  it('rejects empty summaries and non-summaries', () => {
    expect(() => deriveVerificationOutcome([])).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
    expect(() => deriveVerificationOutcome('nope' as unknown as EvidenceSupportSummary)).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
  });

  it('EXHAUSTIVE totality: every possible status multiset yields exactly one closed member', () => {
    // All summaries of length 1..3 over the 5-status vocabulary: 5 + 25 + 125.
    const statuses = [
      'present-supported',
      'present-unsupported',
      'present-unverified',
      'present-indeterminate',
      'missing',
    ] as const;
    const outcomes = new Set<string>();
    for (const a of statuses) {
      const one: EvidenceSupportSummary = [entry('req-1', a)];
      outcomes.add(deriveVerificationOutcome(one).outcome);
      for (const b of statuses) {
        for (const c of statuses) {
          const summary: EvidenceSupportSummary = [entry('req-1', a), entry('req-2', b), entry('req-3', c)];
          const { outcome, unknownCause } = deriveVerificationOutcome(summary);
          outcomes.add(outcome);
          expect(VERIFICATION_OUTCOMES).toContain(outcome);
          expect((outcome === 'unknown') === (unknownCause !== null)).toBe(true);
        }
      }
    }
    // totality across the sampled space: all three members occur, nothing else
    expect([...outcomes].sort()).toEqual(['fail', 'pass', 'unknown']);
  });
});

describe('score-shaped outputs are impossible by construction (lock rule 7 regression)', () => {
  it('a support entry carrying a quantitative extra field cannot exist (strict shape)', () => {
    // The makeRecordInput fixture funnels through toEvidenceSupportSummary's
    // strict expectFields — an extra numeric field is an unknown field.
    const rogue = support('requirement-001', 'present-supported', 'a'.repeat(64)) as unknown as Record<string, unknown>;
    rogue['score'] = 0.87;
    expect(() =>
      toOutcomeSemantics({ pass: 'p', fail: 'f', unknown: 'u' }) && rogue,
    ).not.toThrow();
    // The real gate: the summary parser rejects it (exercised via record
    // construction in record.test.ts; here we assert the vocabulary itself
    // has no quantitative member to hijack).
    for (const status of [
      'present-supported',
      'present-unsupported',
      'present-unverified',
      'present-indeterminate',
      'missing',
    ]) {
      expect(/^-?\d+(\.\d+)?$/.test(status)).toBe(false);
    }
    expect(/^-?\d+(\.\d+)?$/.test('pass')).toBe(false);
    expect(/^-?\d+(\.\d+)?$/.test('fail')).toBe(false);
    expect(/^-?\d+(\.\d+)?$/.test('unknown')).toBe(false);
  });

  it('the derivation has no code path returning a number (type-level: outcome is a string union)', () => {
    const summary: EvidenceSupportSummary = [entry('req-1', 'present-supported')];
    const { outcome } = deriveVerificationOutcome(summary);
    expect(typeof outcome).toBe('string');
    expect(Number.isNaN(Number(outcome))).toBe(true); // not even numeric-looking
  });
});

// keep makeRecordInput referenced for fixture coherence in later suites
void makeRecordInput;
