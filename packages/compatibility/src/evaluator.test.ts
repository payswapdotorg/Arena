/**
 * @arena/compatibility — compatibility evaluation tests
 * (Work Order A022; requirements R2, R20; spec AB1.0).
 *
 * All fixtures use the REAL closed vocabularies from @arena/agent-body:
 * SUBSTRATE_MODALITIES ('text-input', 'text-output', ...),
 * TOOL_CALLING_LEVELS ('none', 'text-protocol', 'json-schema',
 * 'function-calling') and SUBSTRATE_CONDITIONS ('stable', 'preview', ...).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateBodySubstrateCompatibility,
  evaluateMultipleSubstrates,
  isCompatible,
} from './evaluator.js';
import {
  toSubstrateCompatibilityProfile,
  createCognitiveSubstrate,
  type CognitiveSubstrate,
} from '@arena/agent-body';

// Real substrate data using the actual API
const mockSubstrate = await createCognitiveSubstrate({
  adapterId: 'test-adapter',
  adapterVersion: '1.0.0',
  modelFamily: 'test-family',
  modelId: 'test-model',
  modelRevision: '1.0.0',
  modalityProfile: ['text-input', 'text-output'],
  toolCallingProfile: 'json-schema',
  contextLimits: { maxContextUnits: 100000, maxOutputUnits: 50000 },
  conditions: ['stable'],
});

const mockSubstrateLimited = await createCognitiveSubstrate({
  adapterId: 'test-adapter',
  adapterVersion: '1.0.0',
  modelFamily: 'test-family',
  modelId: 'limited-model',
  modelRevision: '1.0.0',
  modalityProfile: ['text-input'],
  toolCallingProfile: 'text-protocol',
  contextLimits: { maxContextUnits: 50000, maxOutputUnits: 25000 },
  conditions: ['preview'],
});

const mockSubstrateMissing = await createCognitiveSubstrate({
  adapterId: 'test-adapter',
  adapterVersion: '1.0.0',
  modelFamily: 'test-family',
  modelId: 'basic-model',
  modelRevision: '1.0.0',
  modalityProfile: ['text-input'],
  toolCallingProfile: 'none',
  contextLimits: { maxContextUnits: 1000, maxOutputUnits: 500 },
  conditions: ['deprecated'],
});

describe('Compatibility Evaluation', () => {
  it('should evaluate compatible substrate', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate);

    expect(result.verdict).toBe('compatible');
    expect(result.reasons).toHaveLength(0);
  });

  it('should evaluate incompatible substrate - missing modalities', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input', 'audio-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('missing required modalities: audio-input');
    expect(result.details.missingModalities).toEqual(['audio-input']);
  });

  it('should evaluate incompatible substrate - insufficient tool calling', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrateLimited);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('insufficient tool-calling level: required json-schema, substrate provides text-protocol');
  });

  it('should evaluate incompatible substrate - insufficient context', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 200000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('insufficient context capacity: required 200000, substrate provides 100000');
  });

  it('should evaluate incompatible substrate - prohibited conditions', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
      prohibitedConditions: ['preview'],
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrateLimited);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('prohibited conditions present: preview');
  });

  it('should treat declarative evaluation suites as certification inputs, not capability failures', async () => {
    // Spec AB1.0: required evaluation suites are declarative certification
    // prerequisites evaluated by the certification services — the capability
    // predicate itself stays honest about what it can decide.
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
      requiredEvaluationSuites: [
        { namespace: 'test', name: 'suite', version: '1.0.0', digest: 'b2a0f454c9e0d6929c166ae4512355954d21448c30a9474d69ab34cbb70458a3' },
      ],
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate);

    expect(result.verdict).toBe('compatible');
    expect(result.reasons).toHaveLength(0);
  });

  it('should evaluate with fail-closed behavior', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input', 'audio-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate, { failClosed: true });
    expect(result.verdict).toBe('incompatible-with-reasons');

    const resultUnknown = await evaluateBodySubstrateCompatibility(profile, mockSubstrate, { failClosed: false });
    expect(resultUnknown.verdict).toBe('unknown-with-structured-causes');
  });

  it('should omit details when includeDetails is false', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input', 'audio-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const result = await evaluateBodySubstrateCompatibility(profile, mockSubstrate, { includeDetails: false });
    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.details).toEqual({});
  });

  it('should reject an invalid substrate (fail closed)', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    await expect(
      evaluateBodySubstrateCompatibility(profile, { not: 'a substrate' } as unknown as CognitiveSubstrate),
    ).rejects.toThrow('COMPATIBILITY_INVALID_INPUT');
  });
});

describe('Batch Evaluation', () => {
  it('should evaluate multiple substrates', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const substrates = [mockSubstrate, mockSubstrateLimited, mockSubstrateMissing];
    const results = await evaluateMultipleSubstrates(profile, substrates);

    expect(results).toHaveLength(3);
    expect(results[0]?.verdict).toBe('compatible'); // mockSubstrate
    expect(results[1]?.verdict).toBe('compatible'); // mockSubstrateLimited (text-input + text-protocol is enough)
    expect(results[2]?.verdict).toBe('incompatible-with-reasons'); // mockSubstrateMissing (no tool calling)
  });
});

describe('Compatibility Check', () => {
  it('should check compatibility with boolean result', async () => {
    const profile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const compatible = await isCompatible(profile, mockSubstrate);
    expect(compatible).toBe(true);

    const incompatible = await isCompatible(profile, mockSubstrateMissing);
    expect(incompatible).toBe(false);
  });
});
