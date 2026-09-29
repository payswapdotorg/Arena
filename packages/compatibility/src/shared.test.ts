import { describe, it, expect } from 'vitest';
import { 
  COMPATIBILITY_VERDICTS,
  isCompatibilityVerdictKind,
  toCompatibilityVerdictKind,
  createCompatibilityResult,
  isCompatibilityResult,
  validateTestSuiteRefs,
} from './shared';

describe('Compatibility Verdicts', () => {
  it('should have closed verdict vocabulary', () => {
    expect(COMPATIBILITY_VERDICTS).toEqual([
      'compatible',
      'incompatible-with-reasons',
      'unknown-with-structured-causes',
    ]);
  });

  it('should validate verdict kinds', () => {
    expect(isCompatibilityVerdictKind('compatible')).toBe(true);
    expect(isCompatibilityVerdictKind('incompatible-with-reasons')).toBe(true);
    expect(isCompatibilityVerdictKind('unknown-with-structured-causes')).toBe(true);
    expect(isCompatibilityVerdictKind('invalid-verdict')).toBe(false);
    expect(isCompatibilityVerdictKind(123)).toBe(false);
  });

  it('should convert strings to verdict kinds', () => {
    expect(toCompatibilityVerdictKind('compatible', 'test')).toBe('compatible');
    expect(() => toCompatibilityVerdictKind('invalid', 'test')).toThrow();
  });
});

describe('Compatibility Results', () => {
  it('should create compatibility results', () => {
    const result = createCompatibilityResult('compatible', ['all good']);
    expect(result.verdict).toBe('compatible');
    expect(result.reasons).toEqual(['all good']);
    expect(result.details).toEqual({});
  });

  it('should create compatibility results with details', () => {
    const details = { missingModalities: ['text'] };
    const result = createCompatibilityResult('incompatible-with-reasons', ['missing text'], details);
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toEqual(['missing text']);
    expect(result.details).toEqual(details);
  });

  it('should validate compatibility results', () => {
    expect(isCompatibilityResult({
      verdict: 'compatible',
      reasons: ['test'],
      details: {},
    })).toBe(true);

    expect(isCompatibilityResult({
      verdict: 'incompatible-with-reasons',
      reasons: ['test'],
      details: {},
    })).toBe(true);

    expect(isCompatibilityResult({
      verdict: 'unknown',
      reasons: ['test'],
      details: {},
    })).toBe(false);

    expect(isCompatibilityResult({
      verdict: 'compatible',
      reasons: 'not an array',
      details: {},
    })).toBe(false);

    expect(isCompatibilityResult(null)).toBe(false);
  });
});

describe('Test Suite Validation', () => {
  it('should validate test suite references', () => {
    const validSuites = [
      { namespace: 'test', name: 'suite', version: '1.0.0', digest: 'abc123' },
      { namespace: 'test', name: 'other', version: '1.0.0', digest: 'def456' },
    ];
    
    expect(() => validateTestSuiteRefs(validSuites)).not.toThrow();
  });

  it('should reject duplicate test suite references', () => {
    const duplicateSuites = [
      { namespace: 'test', name: 'suite', version: '1.0.0', digest: 'abc123' },
      { namespace: 'test', name: 'suite', version: '1.0.0', digest: 'abc123' },
    ];
    
    expect(() => validateTestSuiteRefs(duplicateSuites)).toThrow('duplicate test suite reference');
  });

  it('should reject invalid test suite references', () => {
    const invalidSuites = [
      { namespace: 'test', name: 'suite', version: '1.0.0', digest: 'invalid-digest' },
    ];
    
    expect(() => validateTestSuiteRefs(invalidSuites)).toThrow('invalid test suite reference');
  });
});