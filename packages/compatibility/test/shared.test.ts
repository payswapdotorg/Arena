/**
 * @arena/compatibility — compatibility shared utilities tests (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 */

import { describe, it, expect } from 'vitest';
import {
  COMPATIBILITY_VERDICTS,
  isCompatibilityVerdictKind,
  createCompatibilityResult,
  isCompatibilityResult,
  isCompatibilityRecord,
} from '../src/shared.js';
import { CompatibilityError } from '../src/errors.js';
import { toSubstrateCompatibilityProfile } from '@arena/agent-body';

describe('Compatibility Shared Utilities', () => {
  describe('Verdict Constants', () => {
    it('should have expected verdict kinds', () => {
      expect(COMPATIBILITY_VERDICTS).toEqual([
        'compatible',
        'incompatible-with-reasons',
        'unknown-with-structured-causes',
      ]);
    });

    it('should validate verdict kinds correctly', () => {
      expect(isCompatibilityVerdictKind('compatible')).toBe(true);
      expect(isCompatibilityVerdictKind('incompatible-with-reasons')).toBe(true);
      expect(isCompatibilityVerdictKind('unknown-with-structured-causes')).toBe(true);
      expect(isCompatibilityVerdictKind('invalid-verdict')).toBe(false);
      expect(isCompatibilityVerdictKind('')).toBe(false);
      expect(isCompatibilityVerdictKind(undefined as any)).toBe(false);
      expect(isCompatibilityVerdictKind(null as any)).toBe(false);
    });
  });

  describe('Compatibility Result Creation', () => {
    it('should create compatible result', () => {
      const result = createCompatibilityResult('compatible', []);
      
      expect(result.verdict).toBe('compatible');
      expect(result.reasons).toEqual([]);
      expect(result.details).toEqual({});
    });

    it('should create incompatible result with reasons', () => {
      const result = createCompatibilityResult(
        'incompatible-with-reasons',
        ['missing modalities', 'insufficient context']
      );
      
      expect(result.verdict).toBe('incompatible-with-reasons');
      expect(result.reasons).toEqual(['missing modalities', 'insufficient context']);
      expect(result.details).toEqual({});
    });

    it('should create result with details', () => {
      const details = { missingModalities: ['image-input'], contextMismatch: { required: 200000, actual: 100000 } };
      const result = createCompatibilityResult('incompatible-with-reasons', ['reason 1'], details);
      
      expect(result.verdict).toBe('incompatible-with-reasons');
      expect(result.reasons).toEqual(['reason 1']);
      expect(result.details).toEqual(details);
    });

    it('should validate compatibility results correctly', () => {
      const validResult = createCompatibilityResult('compatible', []);
      expect(isCompatibilityResult(validResult)).toBe(true);

      const invalidResult = { verdict: 'compatible' as const };
      expect(isCompatibilityResult(invalidResult)).toBe(false);

      const invalidVerdict = createCompatibilityResult('invalid-verdict' as any, []);
      expect(isCompatibilityResult(invalidVerdict)).toBe(false);
    });
  });

  describe('Compatibility Record Validation', () => {
    const validRecord = {
      recordVersion: 1,
      recordDigest: 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234',
      bodyVersionRef: 'body-1',
      substrateRef: 'substrate-1',
      evaluatedAt: new Date().toISOString(),
      verdict: 'compatible',
      reasons: [],
      details: {},
    };

    it('should validate correct records', () => {
      expect(isCompatibilityRecord(validRecord)).toBe(true);
    });

    it('should reject invalid record versions', () => {
      const invalidRecord = { ...validRecord, recordVersion: 2 };
      expect(isCompatibilityRecord(invalidRecord)).toBe(false);
    });

    it('should reject invalid digests', () => {
      const invalidRecord = { ...validRecord, recordDigest: 'invalid-digest' };
      expect(isCompatibilityRecord(invalidRecord)).toBe(false);
    });

    it('should reject invalid verdicts', () => {
      const invalidRecord = { ...validRecord, verdict: 'invalid-verdict' as any };
      expect(isCompatibilityRecord(invalidRecord)).toBe(false);
    });

    it('should reject missing required fields', () => {
      const incompleteRecord = { ...validRecord };
      delete (incompleteRecord as any).bodyVersionRef;
      expect(isCompatibilityRecord(incompleteRecord)).toBe(false);
    });

    it('should reject non-object details', () => {
      const invalidRecord = { ...validRecord, details: 'not-an-object' as any };
      expect(isCompatibilityRecord(invalidRecord)).toBe(false);
    });
  });

  describe('Profile Creation', () => {
    it('should create basic compatibility profile', () => {
      const profile = toSubstrateCompatibilityProfile({
        requiredModalities: ['text-input'],
        requiredToolCalling: 'text-protocol',
        contextRequirements: { minContextUnits: 10000 },
      });

      expect(profile.recordVersion).toBe(1);
      expect(profile.requiredModalities).toEqual(['text-input']);
      expect(profile.requiredToolCalling).toBe('text-protocol');
      expect(profile.contextRequirements.minContextUnits).toBe(10000);
    });

    it('should create profile with all options', () => {
      const profile = toSubstrateCompatibilityProfile({
        requiredModalities: ['text-input', 'image-input'],
        requiredToolCalling: 'json-schema',
        contextRequirements: { minContextUnits: 50000, maxOutputUnits: 4000 },
        prohibitedConditions: ['deprecated', 'experimental'],
        requiredEvaluationSuites: [
          { namespace: 'test', name: 'suite', version: '1.0.0', digest: 'test-suite-digest' }
        ],
      });

      expect(profile.requiredModalities).toEqual(['text-input', 'image-input']);
      expect(profile.requiredToolCalling).toBe('json-schema');
      expect(profile.contextRequirements.minContextUnits).toBe(50000);
      expect(profile.prohibitedConditions).toEqual(['deprecated', 'experimental']);
      expect(profile.requiredEvaluationSuites).toHaveLength(1);
    });

    it('should validate required modalities', () => {
      expect(() => toSubstrateCompatibilityProfile({
        requiredModalities: ['text-input' as any],
      })).toThrow();
    });

    it('should validate tool calling levels', () => {
      expect(() => toSubstrateCompatibilityProfile({
        requiredModalities: ['text-input'],
        requiredToolCalling: 'invalid-level' as any,
      })).toThrow();
    });

    it('should validate context requirements', () => {
      expect(() => toSubstrateCompatibilityProfile({
        requiredModalities: ['text-input'],
        contextRequirements: { minContextUnits: -1 } as any,
      })).toThrow();
    });
  });
});