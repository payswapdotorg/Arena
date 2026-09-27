/**
 * Shared tripwire tests: provider-neutrality screening, credential
 * rejection, substrate-alias rejection, possession-rebind rejection,
 * scalar validators and deep freeze.
 */

import { describe, expect, it } from 'vitest';
import {
  MODEL_SUBSTRATE_ID_PATTERN_SOURCE,
  MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE,
  MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE,
  SUBSTRATE_CONDITIONS,
  SUBSTRATE_MODALITIES,
  TOOL_CALLING_LEVELS,
  assertNoCredentialFields,
  assertNoPossessionRebindFields,
  assertNoSubstrateAliasFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isModelSubstrateSemver,
  isNeutralId,
  isTimestampView,
  isVersionedArtifactRefView,
  nowTimestampView,
  toolCallingLevelIndex,
  toContentDigest,
  toModelSubstrateSemver,
  toNeutralId,
  toTimestampView,
  toVersionedArtifactRefView,
} from './shared.js';
import { ModelSubstrateError } from './errors.js';

describe('scalar validators (positive)', () => {
  it('accepts valid digests, neutral ids, semvers and timestamps', () => {
    expect(isContentDigest('a'.repeat(64))).toBe(true);
    expect(toContentDigest('b'.repeat(64))).toBe('b'.repeat(64));
    expect(isNeutralId('neutral-mock')).toBe(true);
    expect(toNeutralId('adapter-x')).toBe('adapter-x');
    expect(isModelSubstrateSemver('1.0.0')).toBe(true);
    expect(isModelSubstrateSemver('0.2.3-beta.1')).toBe(true);
    expect(toModelSubstrateSemver('2.1.0')).toBe('2.1.0');
    expect(isTimestampView('2026-01-15T09:30:00.000Z')).toBe(true);
    expect(toTimestampView('2026-01-15T09:30:00.000Z')).toBe('2026-01-15T09:30:00.000Z');
    expect(nowTimestampView()).toMatch(new RegExp(MODEL_SUBSTRATE_TIMESTAMP_PATTERN_SOURCE));
  });

  it('tool-calling levels are ordered by capability', () => {
    expect(toolCallingLevelIndex('none')).toBe(0);
    expect(toolCallingLevelIndex('function-calling')).toBe(3);
    expect(toolCallingLevelIndex('text-protocol')).toBeLessThan(toolCallingLevelIndex('json-schema'));
  });

  it('versioned artifact ref views validate and freeze', () => {
    const ref = toVersionedArtifactRefView({
      namespace: 'tenant-a',
      name: 'eval-suite',
      version: '1.0.0',
      digest: '1'.repeat(64),
    });
    expect(isVersionedArtifactRefView(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(toVersionedArtifactRefView(ref)).toEqual(ref); // validated copy
  });
});

describe('scalar validators (negative)', () => {
  it('rejects malformed digests, ids, semvers and timestamps', () => {
    expect(isContentDigest('XYZ')).toBe(false);
    expect(() => toContentDigest('short')).toThrow(ModelSubstrateError);
    expect(isNeutralId('Bad_ID')).toBe(false);
    expect(() => toNeutralId('Bad_ID')).toThrow(ModelSubstrateError);
    expect(isModelSubstrateSemver('1.0')).toBe(false);
    expect(() => toModelSubstrateSemver('1.0')).toThrow(ModelSubstrateError);
    expect(() => toModelSubstrateSemver('1.0.0+build')).toThrow(ModelSubstrateError);
    expect(isTimestampView('2026-01-15T09:30:00Z')).toBe(false); // missing ms
    expect(isTimestampView('not-a-time')).toBe(false);
    expect(() => toTimestampView('2026-01-15T09:30:00')).toThrow(ModelSubstrateError);
    expect(
      isVersionedArtifactRefView({ namespace: 'X', name: 'y', version: '1', digest: 'z' }),
    ).toBe(false);
    expect(() =>
      toVersionedArtifactRefView({
        namespace: 'tenant-a',
        name: 'eval-suite',
        version: '1.0.0',
        digest: 'nothex',
      }),
    ).toThrow(ModelSubstrateError);
  });

  it('the vendored vocabularies are the closed AB1.0 sets', () => {
    expect(SUBSTRATE_MODALITIES).toHaveLength(9);
    expect(TOOL_CALLING_LEVELS).toHaveLength(4);
    expect(SUBSTRATE_CONDITIONS).toHaveLength(7);
    expect(MODEL_SUBSTRATE_VERSION_PATTERN_SOURCE).toContain('prerelease'.replace(/./g, ''));
    expect(MODEL_SUBSTRATE_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
  });
});

describe('credential screening (negative — gate 2)', () => {
  it('rejects credential-shaped field names at any depth', () => {
    expect(() => assertNoCredentialFields({ apiKey: 'sk-000' }, 'input')).toThrow(
      /credential-shaped field/,
    );
    expect(() => assertNoCredentialFields({ nested: { client_secret: 'x' } }, 'input')).toThrow(
      /credential-shaped field "client_secret" at input.nested/,
    );
    expect(() => assertNoCredentialFields([{ password: 'x' }], 'input')).toThrow(
      /credential-shaped field "password" at input\[0\]/,
    );
    for (const field of ['api_key', 'accessToken', 'bearer', 'authorization', 'token', 'privateKey']) {
      expect(() => assertNoCredentialFields({ [field]: 'x' }, 'input')).toThrow(
        ModelSubstrateError,
      );
    }
  });

  it('accepts clean values (positive control)', () => {
    expect(() =>
      assertNoCredentialFields({ modelId: 'reasoner-1', limits: { maxContextUnits: 10 } }, 'input'),
    ).not.toThrow();
  });
});

describe('provider-name screening (negative — gate 2, lock rule 10)', () => {
  it('rejects provider brand names in canonical strings', () => {
    for (const bad of [
      'adapter-openai-1',
      'claude-family',
      'gpt-4o-mini',
      'anthropic-r1',
      'gemini-flash',
      'mistral-x',
      'groq-y',
      'ollama-z',
      'deepseek-r',
      'bedrock-b',
      'copilot-c',
    ]) {
      expect(() => assertProviderNeutralString(bad, 'modelId')).toThrow(
        /provider brand name/,
      );
    }
  });

  it('accepts neutral identifiers (positive control)', () => {
    expect(() => assertProviderNeutralString('reasoner-general-2', 'modelId')).not.toThrow();
    expect(() => assertProviderNeutralString('neutral-mock', 'adapterId')).not.toThrow();
  });
});

describe('substrate-alias screening (negative — spec AB1.0 hard rule)', () => {
  it('rejects identity-alias-shaped fields in normalized form', () => {
    for (const field of [
      'equivalentModels',
      'equivalent-models',
      'EQUIVALENT_MODELS',
      'identicalToBody',
      'modelAliases',
      'modelIdentity',
      'sameModelAs',
      'sameSubstrateAs',
      'semanticEquivalents',
      'bodyAlias',
      'aliases',
    ]) {
      expect(() => assertNoSubstrateAliasFields({ [field]: 'x' })).toThrow(
        /identity alias/,
      );
    }
  });

  it('accepts capability-shaped fields (positive control)', () => {
    expect(() =>
      assertNoSubstrateAliasFields({ requiredModalities: ['text-input'], testId: 't-1' }),
    ).not.toThrow();
  });
});

describe('possession-rebind screening (negative — R45)', () => {
  it('rejects possession-shaped / rebind-shaped fields in normalized form', () => {
    for (const field of [
      'possession',
      'possessionDigest',
      'possessionId',
      'possessionRef',
      'targetPossession',
      'rebind',
      'rebinds',
      'rebindPossession',
      'silentlyRebind',
      'updatePossession',
      'replacePossession',
      'mutatePossession',
    ]) {
      expect(() => assertNoPossessionRebindFields({ [field]: 'x' })).toThrow(
        /never rebinds a Possession/,
      );
    }
  });

  it('accepts declaration-shaped fields (positive control)', () => {
    expect(() =>
      assertNoPossessionRebindFields({ upgradeId: 'u-1', toSubstrateDigest: 'a'.repeat(64) }),
    ).not.toThrow();
  });
});

describe('deepFreeze', () => {
  it('freezes recursively and is idempotent', () => {
    const value = deepFreeze({ a: { b: [1, { c: 'd' }] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
    expect(deepFreeze(value)).toBe(value);
    expect(() => {
      (value as Record<string, unknown>)['x'] = 1;
    }).toThrow(TypeError);
  });
});
