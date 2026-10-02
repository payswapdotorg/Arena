/**
 * Truth-class state-mark tests (Work Order B012; issue #87).
 *
 * The classification-exhaustiveness and INJECTIVITY contracts:
 *   - the mark set covers EXACTLY the closed B003 canonical taxonomy
 *     (eleven kinds — no more, no fewer);
 *   - no two truth classes share a mark on ANY channel (treatment, label,
 *     meaning) — evaluation results can never collapse into verified
 *     facts, certifications, or demo state;
 *   - the classifier is TOTAL: malformed carriers classify as 'unknown'
 *     (fail honest), never guessed, never thrown.
 */

import { describe, expect, it } from 'vitest';

import { CANONICAL_STATE_KINDS } from '../../../../packages/role-context/src/index.js';
import {
  TRUTH_CLASS_MARKS,
  TRUTH_CLASS_TREATMENT,
  classifyTruthCarrier,
  isBadgeTreatment,
  truthClassMark,
  truthClassTreatment,
  truthClassLegend,
} from './state-mark.js';

describe('truth-class classification (positive)', () => {
  it('covers exactly the closed B003 canonical taxonomy — all eleven kinds (exhaustiveness)', () => {
    expect(TRUTH_CLASS_MARKS.map((mark) => mark.truthClass).sort()).toEqual(
      [...CANONICAL_STATE_KINDS].sort(),
    );
    expect(TRUTH_CLASS_MARKS).toHaveLength(11);
  });

  it('maps every canonical kind to a treatment (total, closed)', () => {
    for (const kind of CANONICAL_STATE_KINDS) {
      expect(truthClassTreatment(kind)).toBeTruthy();
    }
  });

  it('resolves the mark of every canonical kind (closed set)', () => {
    for (const kind of CANONICAL_STATE_KINDS) {
      const mark = truthClassMark(kind);
      expect(mark.truthClass).toBe(kind);
      expect(mark.label.length).toBeGreaterThan(0);
      expect(mark.meaning.length).toBeGreaterThan(0);
    }
  });

  it('classifies every stateKind carrier through the canonical classifier', () => {
    for (const kind of CANONICAL_STATE_KINDS) {
      const classification = classifyTruthCarrier({ stateKind: kind });
      expect(classification.truthClass).toBe(kind);
      expect(classification.treatment).toBe(TRUTH_CLASS_TREATMENT[kind]);
    }
    for (const kind of CANONICAL_STATE_KINDS) {
      expect(classifyTruthCarrier(kind).truthClass).toBe(kind);
    }
  });

  it('keeps the two honesty-critical kinds OFF the badge vocabulary (pending/unknown render as their own marks)', () => {
    expect(isBadgeTreatment('pending')).toBe(false);
    expect(isBadgeTreatment('unknown')).toBe(false);
    for (const kind of CANONICAL_STATE_KINDS) {
      if (kind !== 'pending' && kind !== 'unknown') {
        expect(isBadgeTreatment(TRUTH_CLASS_TREATMENT[kind])).toBe(true);
      }
    }
  });

  it('serves the teaching legend in canonical order', () => {
    expect(truthClassLegend()).toBe(TRUTH_CLASS_MARKS);
  });
});

describe('truth-class marks are INJECTIVE (the no-collapse contract)', () => {
  it('no two classes share a TREATMENT (a badge can never mean two things)', () => {
    const treatments = TRUTH_CLASS_MARKS.map((mark) => mark.treatment);
    expect(new Set(treatments).size).toBe(treatments.length);
  });

  it('no two classes share a LABEL', () => {
    const labels = TRUTH_CLASS_MARKS.map((mark) => mark.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('no two classes share a MEANING', () => {
    const meanings = TRUTH_CLASS_MARKS.map((mark) => mark.meaning);
    expect(new Set(meanings).size).toBe(meanings.length);
  });

  it('no two classes share a MARK (pairwise distinct on every channel)', () => {
    for (let i = 0; i < TRUTH_CLASS_MARKS.length; i += 1) {
      for (let j = i + 1; j < TRUTH_CLASS_MARKS.length; j += 1) {
        const a = TRUTH_CLASS_MARKS[i];
        const b = TRUTH_CLASS_MARKS[j];
        if (a === undefined || b === undefined) {
          throw new Error('mark set exhausted before the pairwise sweep completed');
        }
        expect(a).not.toEqual(b);
        expect(a.truthClass).not.toBe(b.truthClass);
      }
    }
  });

  it('the evaluation/verification/certification triple can never collapse (B012 core truths)', () => {
    expect(TRUTH_CLASS_TREATMENT['evaluation-result']).toBe('evaluation');
    expect(TRUTH_CLASS_TREATMENT['verified-fact']).toBe('verified');
    expect(TRUTH_CLASS_TREATMENT.certification).toBe('certification');
    expect(new Set(['evaluation', 'verified', 'certification']).size).toBe(3);
  });
});

describe('truth-class classification (adversarial — fail honest)', () => {
  it('classifies malformed carriers as unknown, never guessed, never thrown', () => {
    for (const carrier of [null, undefined, 42, 'nonsense', {}, { stateKind: 'made-up' }, [], { stateKind: null }]) {
      const classification = classifyTruthCarrier(carrier);
      expect(classification.truthClass).toBe('unknown');
      expect(classification.treatment).toBe('unknown');
    }
  });

  it('throws on a foreign kind in the strict mark lookup (closed set)', () => {
    expect(() => truthClassMark('made-up' as never)).toThrow();
  });

  it('the demo class stays distinct from every content class (demo state is never customer state)', () => {
    expect(TRUTH_CLASS_TREATMENT['demo-state']).toBe('demo');
    const others = TRUTH_CLASS_MARKS.filter((mark) => mark.truthClass !== 'demo-state');
    for (const mark of others) {
      expect(mark.treatment).not.toBe('demo');
    }
  });
});
