/**
 * Verdict semantics + closed-vocabulary tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import { CertificationError } from './errors.js';
import {
  CERTIFICATION_VERDICTS,
  COMPONENT_VERDICTS,
  COMPONENT_VERDICT_ENTRY_FIELDS,
  UNKNOWN_REASONS,
  UNKNOWN_CAUSE_FIELDS,
  VERDICT_SEMANTICS_FIELDS,
  deriveCertificationVerdict,
  isCertificationVerdict,
  isComponentVerdict,
  isComponentVerdictEntry,
  isComponentVerdictSummary,
  isUnknownCause,
  isUnknownReason,
  isVerdictSemantics,
  toCertificationVerdict,
  toComponentVerdict,
  toComponentVerdictSummary,
  toVerdictSemantics,
} from './verdict.js';
import type {
  ComponentVerdictSummary,
  ComponentVerdictEntry,
} from './verdict.js';
import type { ContentDigest, NeutralText } from './shared.js';

const DIGEST = '0'.repeat(64) as ContentDigest;

function passEntry(refKind: 'evaluation' | 'verification' | 'compatibility' = 'evaluation'): ComponentVerdictEntry {
  return {
    refKind,
    refDigest: DIGEST,
    verdict: 'pass',
    constraints: [],
    notes: null,
  };
}

function failEntry(): ComponentVerdictEntry {
  return {
    refKind: 'verification',
    refDigest: 'a'.repeat(64) as ContentDigest,
    verdict: 'fail',
    constraints: null,
    notes: null,
  };
}

function unknownEntry(): ComponentVerdictEntry {
  return {
    refKind: 'compatibility',
    refDigest: 'b'.repeat(64) as ContentDigest,
    verdict: 'unknown',
    constraints: null,
    notes: null,
  };
}

const CONSTRAINT_TEXT = 'must be deployed in pinned environment' as NeutralText;

function passWithConstraintEntry(): ComponentVerdictEntry {
  return {
    refKind: 'evaluation',
    refDigest: 'c'.repeat(64) as ContentDigest,
    verdict: 'pass',
    constraints: [CONSTRAINT_TEXT],
    notes: null,
  };
}

describe('closed verdict vocabulary (exactly four members, no graded/scored member)', () => {
  it('the verdict enum is closed with the four design-law members', () => {
    expect([...CERTIFICATION_VERDICTS]).toEqual([
      'pass',
      'conditional-pass',
      'fail',
      'unknown',
    ]);
  });
  it('the component verdict enum is closed with three members (mirrors A012/A013)', () => {
    expect([...COMPONENT_VERDICTS]).toEqual(['pass', 'fail', 'unknown']);
  });
  it('isCertificationVerdict / toCertificationVerdict reject unknown members', () => {
    expect(isCertificationVerdict('pass')).toBe(true);
    expect(isCertificationVerdict('high-score')).toBe(false);
    expect(() => toCertificationVerdict('high-score', 'test')).toThrowError(CertificationError);
  });
  it('isComponentVerdict / toComponentVerdict reject unknown members', () => {
    expect(isComponentVerdict('pass')).toBe(true);
    expect(isComponentVerdict('partial')).toBe(false);
    expect(() => toComponentVerdict('partial', 'test')).toThrowError(CertificationError);
  });
});

describe('verdict semantics (declared meaning per suite — all four mandatory)', () => {
  it('accepts a complete four-member declaration', () => {
    expect(
      isVerdictSemantics({
        pass: 'all components pass',
        'conditional-pass': 'all pass with constraints',
        fail: 'some component failed',
        unknown: 'some component undecided',
      }),
    ).toBe(true);
  });
  it('rejects a declaration missing any of the four', () => {
    expect(
      isVerdictSemantics({
        pass: '',
        'conditional-pass': '',
        fail: '',
      }),
    ).toBe(false);
  });
  it('toVerdictSemantics freezes the declaration', () => {
    const v = toVerdictSemantics({
      pass: 'p',
      'conditional-pass': 'cp',
      fail: 'f',
      unknown: 'u',
    });
    expect(Object.isFrozen(v)).toBe(true);
    expect(v.pass).toBe('p');
    expect(v['conditional-pass']).toBe('cp');
    expect([...VERDICT_SEMANTICS_FIELDS]).toEqual([
      'pass',
      'conditional-pass',
      'fail',
      'unknown',
    ]);
  });
});

describe('unknown-cause taxonomy (closed, two reasons)', () => {
  it('UNKNOWN_REASONS is exactly the two closed members', () => {
    expect([...UNKNOWN_REASONS]).toEqual([
      'unverifiable-component',
      'suite-misconfiguration',
    ]);
  });
  it('UNKNOWN_CAUSE_FIELDS is the closed two-field set', () => {
    expect([...UNKNOWN_CAUSE_FIELDS]).toEqual(['reason', 'detail']);
  });
  it('isUnknownReason / isUnknownCause reject quantitative values', () => {
    expect(isUnknownReason('unverifiable-component')).toBe(true);
    expect(isUnknownReason('scored-low')).toBe(false);
    expect(
      isUnknownCause({ reason: 'suite-misconfiguration', detail: 'no components' }),
    ).toBe(true);
    expect(
      isUnknownCause({ reason: 'scored-low', detail: 'bad' }),
    ).toBe(false);
    expect(isUnknownCause(null)).toBe(false);
  });
});

describe('component verdict summary — structural guards', () => {
  it('isComponentVerdictEntry rejects malformed shapes', () => {
    expect(isComponentVerdictEntry(null)).toBe(false);
    expect(isComponentVerdictEntry({})).toBe(false);
    expect(
      isComponentVerdictEntry({
        refKind: 'evaluation',
        refDigest: DIGEST,
        verdict: 'pass',
        constraints: ['c'],
        notes: null,
      }),
    ).toBe(true);
  });
  it('pass components MUST carry a constraints array (null is rejected for pass)', () => {
    expect(
      isComponentVerdictEntry({
        refKind: 'evaluation',
        refDigest: DIGEST,
        verdict: 'pass',
        constraints: null,
        notes: null,
      }),
    ).toBe(false);
  });
  it('fail / unknown components MUST have null constraints', () => {
    expect(
      isComponentVerdictEntry({
        refKind: 'verification',
        refDigest: DIGEST,
        verdict: 'fail',
        constraints: ['c'],
        notes: null,
      }),
    ).toBe(false);
    expect(
      isComponentVerdictEntry({
        refKind: 'verification',
        refDigest: DIGEST,
        verdict: 'unknown',
        constraints: ['c'],
        notes: null,
      }),
    ).toBe(false);
  });
  it('isComponentVerdictSummary rejects an empty array', () => {
    expect(isComponentVerdictSummary([])).toBe(false);
  });
  it('toComponentVerdictSummary freezes the result', () => {
    const summary = toComponentVerdictSummary([passEntry()]);
    expect(Object.isFrozen(summary)).toBe(true);
    expect(Object.isFrozen(summary[0])).toBe(true);
  });
  it('toComponentVerdictSummary rejects duplicate (refKind, refDigest) keys', () => {
    expect(() =>
      toComponentVerdictSummary([passEntry('evaluation'), passEntry('evaluation')]),
    ).toThrowError(CertificationError);
  });
  it('toComponentVerdictSummary rejects pass-with-null-constraints', () => {
    expect(() =>
      toComponentVerdictSummary([
        {
          refKind: 'evaluation',
          refDigest: DIGEST,
          verdict: 'pass',
          constraints: null,
          notes: null,
        },
      ]),
    ).toThrowError(CertificationError);
  });
  it('toComponentVerdictSummary rejects unknown fields (strict shape)', () => {
    expect(() =>
      toComponentVerdictSummary([
        {
          refKind: 'evaluation',
          refDigest: DIGEST,
          verdict: 'pass',
          constraints: [],
          notes: null,
          // unknown field:
          score: 0.9,
        },
      ]),
    ).toThrowError(CertificationError);
  });
  it('the field list mirrors the contract surface', () => {
    expect([...COMPONENT_VERDICT_ENTRY_FIELDS]).toEqual([
      'refKind',
      'refDigest',
      'verdict',
      'constraints',
      'notes',
    ]);
  });
});

describe('deriveCertificationVerdict — the pure total heart (lock rule 7 + design law)', () => {
  it('any component unknown ⇒ unknown / unverifiable-component', () => {
    const { verdict, unknownCause } = deriveCertificationVerdict([
      passEntry(),
      unknownEntry(),
    ]);
    expect(verdict).toBe('unknown');
    expect(unknownCause?.reason).toBe('unverifiable-component');
    expect(unknownCause?.detail).toContain('unverifiable-component');
  });
  it('any component fail (with no unknowns) ⇒ fail', () => {
    const { verdict, unknownCause } = deriveCertificationVerdict([
      passEntry(),
      failEntry(),
    ]);
    expect(verdict).toBe('fail');
    expect(unknownCause).toBeNull();
  });
  it('all pass with at least one constraint ⇒ conditional-pass', () => {
    const { verdict, unknownCause } = deriveCertificationVerdict([
      passEntry(),
      passWithConstraintEntry(),
    ]);
    expect(verdict).toBe('conditional-pass');
    expect(unknownCause).toBeNull();
  });
  it('all pass with no constraints ⇒ pass', () => {
    const { verdict, unknownCause } = deriveCertificationVerdict([
      passEntry('evaluation'),
      passEntry('verification'),
    ]);
    expect(verdict).toBe('pass');
    expect(unknownCause).toBeNull();
  });
  it('a single pass component ⇒ pass', () => {
    const { verdict } = deriveCertificationVerdict([passEntry()]);
    expect(verdict).toBe('pass');
  });
  it('the unknown cause is null when verdict !== unknown', () => {
    expect(deriveCertificationVerdict([passEntry()]).unknownCause).toBeNull();
    expect(deriveCertificationVerdict([failEntry()]).unknownCause).toBeNull();
    expect(
      deriveCertificationVerdict([passWithConstraintEntry()]).unknownCause,
    ).toBeNull();
  });
  it('the unknown cause is required when verdict === unknown', () => {
    expect(deriveCertificationVerdict([unknownEntry()]).unknownCause).not.toBeNull();
  });
  it('precedence: unknown > fail > conditional-pass > pass', () => {
    // unknown + fail → unknown
    expect(
      deriveCertificationVerdict([unknownEntry(), failEntry()]).verdict,
    ).toBe('unknown');
    // fail + conditional-pass-component → fail
    expect(
      deriveCertificationVerdict([failEntry(), passWithConstraintEntry()]).verdict,
    ).toBe('fail');
    // conditional-pass-component + plain pass → conditional-pass
    expect(
      deriveCertificationVerdict([passWithConstraintEntry(), passEntry()]).verdict,
    ).toBe('conditional-pass');
  });
  it('rejects a non-summary input (fail-closed)', () => {
    expect(() => deriveCertificationVerdict([])).toThrowError(CertificationError);
    expect(() => deriveCertificationVerdict(null as never)).toThrowError(CertificationError);
  });
  it('the function NEVER returns a quantitative or graded member', () => {
    const summaries: ComponentVerdictSummary[] = [
      [passEntry()],
      [failEntry()],
      [unknownEntry()],
      [passWithConstraintEntry()],
      [passEntry(), failEntry()],
      [passEntry(), unknownEntry()],
      [passEntry(), passWithConstraintEntry()],
      [failEntry(), unknownEntry()],
    ];
    for (const summary of summaries) {
      const { verdict } = deriveCertificationVerdict(summary);
      expect((CERTIFICATION_VERDICTS as readonly string[]).includes(verdict)).toBe(true);
    }
  });
});
