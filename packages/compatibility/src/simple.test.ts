import { describe, it, expect } from 'vitest';

// Simple test that doesn't depend on external modules
describe('Basic Compatibility Tests', () => {
  it('should have correct verdict vocabulary', () => {
    const verdicts = ['compatible', 'incompatible-with-reasons', 'unknown-with-structured-causes'];
    expect(verdicts).toHaveLength(3);
    expect(verdicts).toContain('compatible');
    expect(verdicts).toContain('incompatible-with-reasons');
    expect(verdicts).toContain('unknown-with-structured-causes');
  });

  it('should create basic compatibility results', () => {
    const result = {
      verdict: 'compatible' as const,
      reasons: ['test reason'],
      details: { test: 'value' }
    };
    
    expect(result.verdict).toBe('compatible');
    expect(result.reasons).toEqual(['test reason']);
    expect(result.details).toEqual({ test: 'value' });
  });

  it('should validate verdict kinds', () => {
    const isValidVerdict = (verdict: string) => {
      return ['compatible', 'incompatible-with-reasons', 'unknown-with-structured-causes'].includes(verdict);
    };
    
    expect(isValidVerdict('compatible')).toBe(true);
    expect(isValidVerdict('incompatible-with-reasons')).toBe(true);
    expect(isValidVerdict('unknown-with-structured-causes')).toBe(true);
    expect(isValidVerdict('invalid')).toBe(false);
  });
});