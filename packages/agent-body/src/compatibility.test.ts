/**
 * SubstrateCompatibilityProfile tests: closed shape, per-profile
 * compatibility evaluation (never identity), declarative constraints, and
 * the anti-aliasing tripwire (gate 5 negative).
 */

import { describe, expect, it } from 'vitest';
import { AgentBodyError } from './errors.js';
import { AGENT_BODY_ERROR_CODES } from './errors.js';
import {
  SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS,
  evaluateSubstrateCompatibility,
  isSubstrateCompatible,
  isSubstrateCompatibilityProfile,
  toSubstrateCompatibilityProfile,
} from './compatibility.js';
import { makeProfile, makeProfileInput, makeSubstrate } from './test-support.js';

describe('SubstrateCompatibilityProfile (positive)', () => {
  it('declares required modalities, tool semantics, context characteristics, suites, prohibited conditions and adaptations', () => {
    const profile = makeProfile();
    expect(profile.requiredModalities).toEqual(['text-input', 'text-output']);
    expect(profile.requiredToolCalling).toBe('json-schema');
    expect(profile.contextRequirements).toEqual({ minContextUnits: 100000 });
    expect(profile.requiredEvaluationSuites).toHaveLength(1);
    expect(profile.prohibitedConditions).toEqual(['deprecated']);
    expect(profile.substrateAdaptations).toEqual([]);
    expect(isSubstrateCompatibilityProfile(profile)).toBe(true);
  });

  it('is deeply frozen', () => {
    const profile = makeProfile();
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.requiredModalities)).toBe(true);
    expect(Object.isFrozen(profile.requiredEvaluationSuites)).toBe(true);
  });

  it('accepts optional cost constraints and substrate adaptations keyed by content digest', () => {
    const profile = toSubstrateCompatibilityProfile(
      makeProfileInput({
        costConstraints: { maxCostPerMillionRequests: 12.5, maxP95LatencyMs: 4000 },
        substrateAdaptations: [
          {
            substrateDigest: 'a'.repeat(64),
            adaptation: {
              namespace: 'tenant-a',
              name: 'adaptation-prompting',
              version: '1.0.0',
              digest: 'b'.repeat(64),
            },
          },
        ],
      }),
    );
    expect(profile.costConstraints).toBeDefined();
    expect(profile.substrateAdaptations[0]?.substrateDigest).toBe('a'.repeat(64));
  });

  it('the declared field set is closed and enumerable', () => {
    expect(SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS).toContain('requiredModalities');
    expect(SUBSTRATE_COMPATIBILITY_PROFILE_FIELDS).not.toContain('equivalentModels');
  });
});

describe('compatibility evaluation (positive — a capability predicate, never identity)', () => {
  it('a capable substrate is compatible', async () => {
    const profile = makeProfile();
    const substrate = await makeSubstrate(); // function-calling >= json-schema
    const result = evaluateSubstrateCompatibility(profile, substrate);
    expect(result.compatible).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(isSubstrateCompatible(profile, substrate)).toBe(true);
  });

  it('TWO DIFFERENT substrates can both be compatible — without any equivalence claim', async () => {
    // The core spec point: a Body can be compatible with multiple substrates
    // without implying the substrates are equivalent models (docs/architecture.md
    // §13). Compatibility is per-profile, never identity.
    const profile = makeProfile();
    const substrateA = await makeSubstrate({ modelId: 'reasoner-general-2' });
    const substrateB = await makeSubstrate({
      modelId: 'planner-heavy-9',
      modelFamily: 'planner',
      adapterId: 'adapter-planning-2',
      adapterVersion: '2.0.0',
    });
    expect(isSubstrateCompatible(profile, substrateA)).toBe(true);
    expect(isSubstrateCompatible(profile, substrateB)).toBe(true);
    expect(substrateA.integrity.contentDigest).not.toBe(substrateB.integrity.contentDigest);
  });

  it('reasons are human-readable for every failed requirement', async () => {
    const profile = toSubstrateCompatibilityProfile(
      makeProfileInput({
        requiredModalities: ['image-input'],
        requiredToolCalling: 'function-calling',
        contextRequirements: { minContextUnits: 500000 },
        prohibitedConditions: ['stable'],
      }),
    );
    const substrate = await makeSubstrate({ toolCallingProfile: 'text-protocol' });
    const result = evaluateSubstrateCompatibility(profile, substrate);
    expect(result.compatible).toBe(false);
    expect(result.reasons.some((reason) => reason.includes('image-input'))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('tool-calling'))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('context limit'))).toBe(true);
    expect(result.reasons.some((reason) => reason.includes('prohibited condition'))).toBe(true);
  });
});

describe('SubstrateCompatibilityProfile (negative — closed shape, fail closed)', () => {
  it('rejects unknown fields', () => {
    const input = { ...makeProfileInput(), weather: 'sunny' } as never;
    expect(() => toSubstrateCompatibilityProfile(input)).toThrow(/unknown compatibility profile field/);
  });

  it('rejects alias-shaped fields with SUBSTRATE_ALIAS_FORBIDDEN (gate 5)', () => {
    for (const field of [
      'equivalentModels',
      'identicalToBody',
      'modelAliases',
      'sameModelAs',
      'equivalent-models',
      'BODY_ALIAS',
    ]) {
      const input = { ...makeProfileInput(), [field]: ['some-model'] } as never;
      let thrown: unknown;
      try {
        toSubstrateCompatibilityProfile(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AgentBodyError);
      expect((thrown as AgentBodyError).code).toBe(
        AGENT_BODY_ERROR_CODES.SUBSTRATE_ALIAS_FORBIDDEN,
      );
    }
  });

  it('rejects empty requiredModalities and duplicates', () => {
    expect(() =>
      toSubstrateCompatibilityProfile(makeProfileInput({ requiredModalities: [] })),
    ).toThrow(/non-empty array/);
    expect(() =>
      toSubstrateCompatibilityProfile(
        makeProfileInput({ requiredModalities: ['text-input', 'text-input'] }),
      ),
    ).toThrow(/duplicate required modality/);
  });

  it('rejects unknown tool-calling levels and malformed context requirements', () => {
    expect(() =>
      toSubstrateCompatibilityProfile(makeProfileInput({ requiredToolCalling: 'best' })),
    ).toThrow(/tool-calling level/);
    expect(() =>
      toSubstrateCompatibilityProfile(makeProfileInput({ contextRequirements: { minContextUnits: 0 } })),
    ).toThrow(/context requirements/);
  });

  it('rejects malformed cost constraints (must declare at least one positive bound)', () => {
    expect(() =>
      toSubstrateCompatibilityProfile(makeProfileInput({ costConstraints: {} })),
    ).toThrow(/cost constraints/);
    expect(() =>
      toSubstrateCompatibilityProfile(
        makeProfileInput({ costConstraints: { maxP95LatencyMs: -1 } }),
      ),
    ).toThrow(/cost constraints/);
  });

  it('rejects unknown prohibited conditions and duplicate adaptation targets', () => {
    expect(() =>
      toSubstrateCompatibilityProfile(makeProfileInput({ prohibitedConditions: ['exploded'] })),
    ).toThrow(/prohibited substrate condition/);
    const adaptation = {
      substrateDigest: 'a'.repeat(64),
      adaptation: {
        namespace: 'tenant-a',
        name: 'adaptation-prompting',
        version: '1.0.0',
        digest: 'b'.repeat(64),
      },
    };
    expect(() =>
      toSubstrateCompatibilityProfile(
        makeProfileInput({ substrateAdaptations: [adaptation, adaptation] }),
      ),
    ).toThrow(/duplicate substrate adaptation/);
  });
});
