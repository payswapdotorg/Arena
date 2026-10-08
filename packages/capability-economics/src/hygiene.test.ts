/**
 * Hygiene tests (Work Order C016) — the repo-wide discipline checks:
 * closed vocabularies, frozen exports, error taxonomy integrity, and
 * the structural laws (no collapsed score field anywhere in the
 * protocol vocabulary).
 */

import { describe, expect, it } from 'vitest';
import { CapabilityEconomicsError } from './errors.js';
import {
  CAPABILITY_ECONOMICS_ERROR_CODES,
  SUPPORTED_CAPABILITY_ECONOMICS_ERROR_CODES,
} from './index.js';
import {
  ARENA_REFERENCE_ECONOMICS_POLICY,
  ECONOMICS_METRICS,
  isEconomicsPolicy,
} from './policy.js';
import { ECONOMICS_DIMENSIONS, ECONOMICS_AGGREGATE_LIMITATIONS } from './aggregate.js';
import { LIFT_CONDITIONS, VALUE_ATTRIBUTION_KINDS } from './value.js';
import { MISSING_INPUT_REASONS, ECONOMICS_RESOURCE_CLASSES, ECONOMICS_VALIDATION_VERDICTS } from './record.js';

describe('capability-economics hygiene', () => {
  it('the error taxonomy is closed, frozen and category-mapped', () => {
    expect(Object.isFrozen(CAPABILITY_ECONOMICS_ERROR_CODES)).toBe(true);
    expect(SUPPORTED_CAPABILITY_ECONOMICS_ERROR_CODES.length).toBe(
      Object.keys(CAPABILITY_ECONOMICS_ERROR_CODES).length,
    );
    for (const code of Object.values(CAPABILITY_ECONOMICS_ERROR_CODES)) {
      const error = new CapabilityEconomicsError(code, { message: 'hygiene' });
      // UNKNOWN_ERROR is the only code that may carry the 'unknown' category.
      if (code !== 'CAPABILITY_ECONOMICS_UNKNOWN_ERROR') {
        expect(error.category).not.toBe('unknown');
      }
      expect(error.name).toBe('CapabilityEconomicsError');
      expect(Object.isFrozen(error.details)).toBe(true);
    }
  });

  it('every closed vocabulary is frozen and duplicate-free', () => {
    const vocabularies = [
      ECONOMICS_METRICS,
      ECONOMICS_DIMENSIONS,
      ECONOMICS_AGGREGATE_LIMITATIONS,
      LIFT_CONDITIONS,
      VALUE_ATTRIBUTION_KINDS,
      MISSING_INPUT_REASONS,
      ECONOMICS_RESOURCE_CLASSES,
      ECONOMICS_VALIDATION_VERDICTS,
    ];
    for (const vocabulary of vocabularies) {
      expect(Object.isFrozen(vocabulary)).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });

  it('the Q1.0 five lift conditions are exactly the quality-model conditions', () => {
    expect([...LIFT_CONDITIONS]).toEqual([
      'pinned-evaluation-population',
      'verification-audit',
      'evaluator-version-attribution',
      'protected-capability-regression',
      'reported-uncertainty',
    ]);
  });

  it('no protocol surface may declare a collapsed score field', () => {
    const smugglers: unknown[] = [
      { ...ARENA_REFERENCE_ECONOMICS_POLICY, score: 1 },
      { ...ARENA_REFERENCE_ECONOMICS_POLICY, roiScore: '1.0' },
    ];
    for (const smuggled of smugglers) {
      expect(() => isEconomicsPolicy(smuggled)).toThrow();
    }
  });

  it('the reference policy is exportable and deterministic', () => {
    expect(ARENA_REFERENCE_ECONOMICS_POLICY.policyId).toBe('arena-economics-reference');
    expect(ARENA_REFERENCE_ECONOMICS_POLICY.version).toBe(1);
    expect(JSON.parse(JSON.stringify(ARENA_REFERENCE_ECONOMICS_POLICY))).toEqual(
      JSON.parse(JSON.stringify(ARENA_REFERENCE_ECONOMICS_POLICY)),
    );
  });
});
