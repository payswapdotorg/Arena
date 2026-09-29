import { describe, it, expect } from 'vitest';
import { 
  evaluateBodySubstrateCompatibility, 
  evaluateMultipleSubstrates,
  isCompatible,
  CompatibilityEvaluationContext 
} from './evaluator';
import { 
  toSubstrateCompatibilityProfile,
  SubstrateCompatibilityProfile 
} from '@arena/agent-body';
import { createCompatibilityRegistry } from './registry';

// Mock substrate data for testing
const mockSubstrate = {
  digest: 'substrate-123',
  capabilities: {
    modalities: ['text', 'image'],
    toolCallingLevel: 'advanced',
  },
  contextLimits: {
    maxContextUnits: 100000,
  },
  costPerMillionRequests: 0.5,
  conditions: [],
};

const mockSubstrateLimited = {
  digest: 'substrate-limited',
  capabilities: {
    modalities: ['text'],
    toolCallingLevel: 'basic',
  },
  contextLimits: {
    maxContextUnits: 50000,
  },
  costPerMillionRequests: 2.0,
  conditions: ['experimental'],
};

const mockSubstrateMissing = {
  digest: 'substrate-missing',
  capabilities: {
    modalities: ['text'],
    toolCallingLevel: 'none',
  },
  contextLimits: {
    maxContextUnits: 1000,
  },
  costPerMillionRequests: 10.0,
  conditions: ['deprecated'],
};

describe('Compatibility Evaluation', () => {
  it('should evaluate compatible substrate', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate);
    
    expect(result.verdict).toBe('compatible');
    expect(result.reasons).toHaveLength(0);
  });

  it('should evaluate incompatible substrate - missing modalities', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text', 'audio'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate);
    
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('missing required modalities: audio');
    expect(result.details?.missingModalities).toEqual(['audio']);
  });

  it('should evaluate incompatible substrate - insufficient tool calling', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'advanced',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrateLimited);
    
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('insufficient tool-calling level: required advanced, substrate provides basic');
  });

  it('should evaluate incompatible substrate - insufficient context', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 200000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate);
    
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('insufficient context capacity: required 200000, substrate provides 100000');
  });

  it('should evaluate incompatible substrate - cost constraints', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
      costConstraints: { maxCostPerMillionRequests: 1.0 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrateLimited);
    
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('cost exceeds constraint: 2 > 1');
  });

  it('should evaluate incompatible substrate - prohibited conditions', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
      prohibitedConditions: ['experimental'],
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrateLimited);
    
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('prohibited conditions present: experimental');
  });

  it('should evaluate with unknown verdict when test suites are missing', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
      requiredEvaluationSuites: [
        { namespace: 'test', name: 'suite', version: '1.0.0', digest: 'missing-suite' },
      ],
    });

    const context: CompatibilityEvaluationContext = {
      registry: createCompatibilityRegistry(),
      adapters: [],
    };

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate, { context });
    
    expect(result.verdict).toBe('unknown-with-structured-causes');
    expect(result.reasons).toContain('missing required test suites: test/suite@1.0.0');
  });

  it('should evaluate with fail-closed behavior', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text', 'audio'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate, { failClosed: true });
    expect(result.verdict).toBe('incompatible-with-reasons');

    const resultUnknown = await evaluateBodySubstrateCompatibility(profile, mockSubstrate, { failClosed: false });
    expect(resultUnknown.verdict).toBe('unknown-with-structured-causes');
  });
});

describe('Batch Evaluation', () => {
  it('should evaluate multiple substrates', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const substrates = [mockSubstrate, mockSubstrateLimited, mockSubstrateMissing];
    const results = await evaluateMultipleSubstrates(profile, substrates);

    expect(results).toHaveLength(3);
    expect(results[0].verdict).toBe('compatible'); // mockSubstrate
    expect(results[1].verdict).toBe('compatible'); // mockSubstrateLimited (text + basic is enough)
    expect(results[2].verdict).toBe('incompatible-with-reasons'); // mockSubstrateMissing (no tool calling)
  });
});

describe('Compatibility Check', () => {
  it('should check compatibility with boolean result', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text'],
      requiredToolCalling: 'basic',
      contextRequirements: { minContextUnits: 10000 },
    });

    const compatible = await isCompatible(profile, mockSubstrate);
    expect(compatible).toBe(true);

    const incompatible = await isCompatible(profile, mockSubstrateMissing);
    expect(incompatible).toBe(false);
  });
});