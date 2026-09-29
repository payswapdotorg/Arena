/**
 * @arena/compatibility — compatibility evaluator tests (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateBodySubstrateCompatibility,
  evaluateMultipleSubstrates,
  isCompatible,
} from '../src/evaluator.js';
import { toSubstrateCompatibilityProfile, toCognitiveSubstrate } from '@arena/agent-body';

describe('Compatibility Evaluator', () => {
  it('should evaluate basic compatibility', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const substrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input', 'image-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 20000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

    expect(result.verdict).toBe('compatible');
    expect(result.reasons).toEqual([]);
  });

  it('should detect incompatibility due to missing modalities', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input', 'image-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const substrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 20000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('missing required modalities: image-input');
  });

  it('should detect incompatibility due to insufficient context', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 20000 },
    });

    const substrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 10000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('insufficient context capacity');
  });

  it('should detect tool calling incompatibility', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 10000 },
    });

    const substrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 20000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('insufficient tool-calling level');
  });

  it('should detect prohibited substrate conditions', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
      prohibitedConditions: ['deprecated'],
    });

    const substrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 20000, maxOutputUnits: 4000 },
      conditions: ['deprecated', 'stable'],
    });

    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

    expect(result.verdict).toBe('incompatible-with-reasons');
    expect(result.reasons).toContain('prohibited conditions present: deprecated');
  });

  it('should perform comprehensive compatibility evaluation', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 10000 },
      prohibitedConditions: ['deprecated'],
    });

    const substrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'json-schema',
      contextLimits: { maxContextUnits: 20000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

    expect(result.verdict).toBe('compatible');
    expect(result.reasons).toEqual([]);
  });

  it('should handle evaluation with details', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input', 'image-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 20000 },
    });

    const substrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 10000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate, { includeDetails: true });

    expect(result.details).toBeDefined();
    expect(typeof result.details).toBe('object');
    expect(result.details.missingModalities).toEqual(['image-input']);
    expect(result.details.contextMismatch).toBeDefined();
  });

  it('should evaluate multiple substrates', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const substrates = [
      await toCognitiveSubstrate({
        adapterId: 'test-adapter',
        adapterVersion: '1.0.0',
        modelFamily: 'test-model',
        modelId: 'test-model-v1',
        modelRevision: '2024-01-01',
        modalityProfile: ['text-input'],
        toolCallingProfile: 'text-protocol',
        contextLimits: { maxContextUnits: 20000, maxOutputUnits: 4000 },
        conditions: ['stable'],
      }),
      await toCognitiveSubstrate({
        adapterId: 'test-adapter',
        adapterVersion: '1.0.0',
        modelFamily: 'test-model',
        modelId: 'test-model-v1',
        modelRevision: '2024-01-01',
        modalityProfile: ['text-input'],
        toolCallingProfile: 'text-protocol',
        contextLimits: { maxContextUnits: 5000, maxOutputUnits: 4000 },
        conditions: ['stable'],
      }),
    ];

    const results = await evaluateMultipleSubstrates(bodyProfile, substrates);

    expect(results).toHaveLength(2);
    expect(results[0].verdict).toBe('compatible');
    expect(results[1].verdict).toBe('incompatible-with-reasons');
  });

  it('should check compatibility with boolean shortcut', async () => {
    const bodyProfile = toSubstrateCompatibilityProfile({
      requiredModalities: ['text-input'],
      requiredToolCalling: 'text-protocol',
      contextRequirements: { minContextUnits: 10000 },
    });

    const compatibleSubstrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 20000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const incompatibleSubstrate = await toCognitiveSubstrate({
      adapterId: 'test-adapter',
      adapterVersion: '1.0.0',
      modelFamily: 'test-model',
      modelId: 'test-model-v1',
      modelRevision: '2024-01-01',
      modalityProfile: ['text-input'],
      toolCallingProfile: 'text-protocol',
      contextLimits: { maxContextUnits: 5000, maxOutputUnits: 4000 },
      conditions: ['stable'],
    });

    const compatible1 = await isCompatible(bodyProfile, compatibleSubstrate);
    const compatible2 = await isCompatible(bodyProfile, incompatibleSubstrate);

    expect(compatible1).toBe(true);
    expect(compatible2).toBe(false);
  });
});