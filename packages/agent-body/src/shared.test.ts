/**
 * Shared view-type tests: pattern validators, principal/rights/timestamp
 * views, versioned artifact refs, policy documents, credential-field
 * screening (negative) and provider-name screening (negative).
 */

import { describe, expect, it } from 'vitest';
import { AgentBodyError } from './errors.js';
import { AGENT_BODY_ERROR_CODES } from './errors.js';
import {
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isPrincipalRefView,
  isRightsMetadataView,
  isTimestampView,
  isVersionedArtifactRef,
  toPolicyDocument,
  toPrincipalRefView,
  toRightsMetadataView,
  toTimestampView,
  toVersionedArtifactRef,
} from './shared.js';
import { CREATOR, DIGEST_A, RIGHTS } from './test-support.js';

describe('shared views (positive)', () => {
  it('validates and freezes principal views', () => {
    const principal = toPrincipalRefView(CREATOR);
    expect(isPrincipalRefView(principal)).toBe(true);
    expect(Object.isFrozen(principal)).toBe(true);
    expect(isPrincipalRefView({ type: 'model', tenant: 't', principalId: 'x' })).toBe(false);
    expect(isPrincipalRefView(null)).toBe(false);
  });

  it('validates and freezes rights views', () => {
    const rights = toRightsMetadataView(RIGHTS);
    expect(isRightsMetadataView(rights)).toBe(true);
    expect(Object.isFrozen(rights)).toBe(true);
    expect(Object.isFrozen(rights.professionalLimitations)).toBe(true);
  });

  it('validates timestamps with calendar round-trip', () => {
    expect(isTimestampView('2026-02-30T00:00:00.000Z')).toBe(false); // impossible date
    expect(isTimestampView('2026-01-15T09:30:00Z')).toBe(false); // no milliseconds
    expect(isTimestampView('2026-01-15T09:30:00+00:00')).toBe(false); // offset, not Z
    expect(toTimestampView('2026-01-15T09:30:00.000Z')).toBe('2026-01-15T09:30:00.000Z');
  });

  it('validates and freezes versioned artifact refs', () => {
    const ref = toVersionedArtifactRef({
      namespace: 'tenant-a',
      name: 'skill-load-analysis',
      version: '2.0.0',
      digest: DIGEST_A,
    });
    expect(isVersionedArtifactRef(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(
      isVersionedArtifactRef({ namespace: 'tenant-a', name: 'x', version: '2.0.0', digest: 'zz' }),
    ).toBe(false);
    expect(
      isVersionedArtifactRef({ namespace: 'tenant-a', name: 'x', version: '2.0.0+build', digest: DIGEST_A }),
    ).toBe(false); // build metadata rejected
  });

  it('validates and freezes policy documents', () => {
    const policy = toPolicyDocument({
      policyId: 'safety-policy',
      statements: ['refuse-unsafe-approvals'],
    });
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.statements)).toBe(true);
  });
});

describe('shared views (negative — malformed inputs throw)', () => {
  it('rejects unknown principal types with the known list', () => {
    expect(() => toPrincipalRefView({ type: 'model', tenant: 't', principalId: 'x' })).toThrow(
      /unknown principal type/,
    );
    // 'model' is deliberately absent: a substrate is not an actor.
  });

  it('rejects raw provider-identity-shaped principal ids', () => {
    expect(() =>
      toPrincipalRefView({ type: 'user', tenant: 't', principalId: 'user at example dot com' }),
    ).toThrow(/invalid agent body principal/);
  });

  it('rejects missing rights (mandatory, lock rule 23)', () => {
    expect(() => toRightsMetadataView(undefined)).toThrow(AgentBodyError);
    try {
      toRightsMetadataView(null);
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.MISSING_RIGHTS);
    }
  });

  it('rejects malformed rights', () => {
    try {
      toRightsMetadataView({ ...RIGHTS, commercialUse: 'sure' });
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.INVALID_RIGHTS);
    }
  });

  it('rejects malformed refs with pattern details', () => {
    try {
      toVersionedArtifactRef({ namespace: 'Bad_NS', name: 'x', version: '1.0.0', digest: DIGEST_A });
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.INVALID_REF);
    }
  });

  it('rejects policy documents without statements', () => {
    try {
      toPolicyDocument({ policyId: 'p', statements: [] });
    } catch (error) {
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.INVALID_POLICY);
    }
  });
});

describe('credential-field screening (spec AB1.0: credentials never enter canonical objects)', () => {
  it('rejects credential-shaped field names anywhere in the tree', () => {
    const cases: unknown[] = [
      { apiKey: 'x' },
      { api_key: 'x' },
      { accessToken: 'x' },
      { modelId: 'ok', credentials: { password: 'x' } },
      { nested: [{ clientSecret: 'x' }] },
      { authorization: 'x' },
    ];
    for (const value of cases) {
      expect(() => assertNoCredentialFields(value)).toThrow(AgentBodyError);
    }
  });

  it('the specific gate-4 shapes (apiKey, token, password, secret) all throw', () => {
    for (const field of ['apiKey', 'token', 'password', 'secret']) {
      let thrown: unknown;
      try {
        assertNoCredentialFields({ [field]: 'value' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AgentBodyError);
      expect((thrown as AgentBodyError).code).toBe(
        AGENT_BODY_ERROR_CODES.SUBSTRATE_CREDENTIAL_REJECTED,
      );
    }
  });

  it('clean trees pass', () => {
    expect(() =>
      assertNoCredentialFields({ modelId: 'reasoner-2', limits: { maxContextUnits: 10 } }),
    ).not.toThrow();
  });
});

describe('provider-name screening (lock rule 10)', () => {
  it('rejects provider brand names in identifiers', () => {
    for (const value of [
      'gpt-4o-something',
      'claude-3-sonnet',
      'openai-adapter',
      'anthropic-model',
      'gemini-pro',
      'mistral-x',
      'bedrock-runtime',
    ]) {
      expect(() => assertProviderNeutralString(value, 'modelId')).toThrow(AgentBodyError);
    }
  });

  it('neutral identifiers pass', () => {
    expect(() => assertProviderNeutralString('reasoner-general-2', 'modelId')).not.toThrow();
    expect(() => assertProviderNeutralString('adapter-reasoning-1', 'adapterId')).not.toThrow();
  });
});

describe('deepFreeze', () => {
  it('freezes recursively', () => {
    const value = deepFreeze({ a: { b: [{ c: 1 }] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b[0])).toBe(true);
    expect(() => {
      (value.a as Record<string, unknown>)['b'] = 'x';
    }).toThrow(TypeError);
  });
});
