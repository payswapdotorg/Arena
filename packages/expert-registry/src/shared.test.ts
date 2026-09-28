/**
 * Shared structural component tests (Work Order A006) — positive and
 * negative for tenant scopes, digests, semver, principals, evidence refs,
 * capability node refs and the neutral locator charset.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_NODE_ID_PATTERN_SOURCE,
  CAPABILITY_NODE_KINDS,
} from './shared.js';
import {
  PUBLIC_TENANT,
  assertNoDuplicateEvidence,
  capabilityNodeRefViewKey,
  compareExpertVersions,
  deepFreeze,
  isCapabilityNodeRefView,
  isContentDigest,
  isEvidenceRef,
  isNeutralLocator,
  isPrincipalRefView,
  isTenantScope,
  isTenantVisible,
  isExpertVersion,
  toCapabilityNodeRefView,
  toEvidenceRef,
  toPrincipalRefView,
  toTenantScope,
} from './shared.js';
import { ExpertRegistryError } from './errors.js';

const GOOD_DIGEST = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('deepFreeze (positive + negative)', () => {
  it('freezes nested objects and arrays recursively', () => {
    const value = deepFreeze({ list: [{ inner: 1 }], scalar: 'x' });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.list)).toBe(true);
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(() => {
      (value as { scalar: string }).scalar = 'y';
    }).toThrow(TypeError);
    expect(() => {
      (value.list as unknown[]).push(2);
    }).toThrow(TypeError);
  });

  it('passes primitives and already-frozen values through', () => {
    expect(deepFreeze(42)).toBe(42);
    const frozen = Object.freeze({ a: 1 });
    expect(deepFreeze(frozen)).toBe(frozen);
  });
});

describe('tenant scope (positive + negative)', () => {
  it('accepts lowercase kebab tenants and the reserved public namespace', () => {
    expect(isTenantScope('tenant-a')).toBe(true);
    expect(isTenantScope('public')).toBe(true);
    expect(toTenantScope('acme')).toBe('acme');
  });

  it('rejects malformed tenants', () => {
    expect(isTenantScope('')).toBe(false);
    expect(isTenantScope('Tenant-A')).toBe(false);
    expect(isTenantScope('1abc')).toBe(false);
    expect(isTenantScope('a')).toBe(false);
    expect(isTenantScope('x'.repeat(64))).toBe(false);
    expect(() => toTenantScope('Bad Tenant')).toThrow(ExpertRegistryError);
  });

  it('tenant visibility: own tenant and public only (lock rule 11)', () => {
    expect(isTenantVisible('tenant-a', 'tenant-a')).toBe(true);
    expect(isTenantVisible(PUBLIC_TENANT, 'tenant-a')).toBe(true);
    expect(isTenantVisible('tenant-a', 'tenant-b')).toBe(false);
  });
});

describe('content digest (positive + negative)', () => {
  it('accepts lowercase 64-char hex', () => {
    expect(isContentDigest(GOOD_DIGEST)).toBe(true);
  });

  it('rejects malformed digests', () => {
    expect(isContentDigest('ABC')).toBe(false);
    expect(isContentDigest(`${GOOD_DIGEST}00`)).toBe(false);
    expect(isContentDigest(GOOD_DIGEST.toUpperCase())).toBe(false);
    expect(isContentDigest(null)).toBe(false);
  });
});

describe('semver versions (positive + negative)', () => {
  it('accepts exact semver without build metadata', () => {
    expect(isExpertVersion('1.0.0')).toBe(true);
    expect(isExpertVersion('0.2.15')).toBe(true);
    expect(isExpertVersion('2.1.0-rc.1')).toBe(true);
  });

  it('rejects malformed versions', () => {
    expect(isExpertVersion('1.0')).toBe(false);
    expect(isExpertVersion('v1.0.0')).toBe(false);
    expect(isExpertVersion('1.0.0+build.5')).toBe(false);
    expect(isExpertVersion('01.0.0')).toBe(false);
  });

  it('compares semver precedence correctly (including prereleases)', () => {
    expect(compareExpertVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareExpertVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareExpertVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareExpertVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareExpertVersions('1.0.0-alpha.1', '1.0.0-alpha.2')).toBeLessThan(0);
    expect(compareExpertVersions('1.0.0-2', '1.0.0-10')).toBeLessThan(0);
  });
});

describe('principal refs (positive + negative)', () => {
  it('accepts typed tenant-scoped principals', () => {
    const principal = toPrincipalRefView({
      type: 'user',
      tenant: 'tenant-a',
      principalId: 'intake-1',
    });
    expect(isPrincipalRefView(principal)).toBe(true);
    expect(Object.isFrozen(principal)).toBe(true);
  });

  it('rejects unknown types, bad tenants, bad ids', () => {
    expect(() =>
      toPrincipalRefView({ type: 'provider', tenant: 'tenant-a', principalId: 'x' }),
    ).toThrow(/unknown principal type/);
    expect(() =>
      toPrincipalRefView({ type: 'user', tenant: 'BAD', principalId: 'x' }),
    ).toThrow(/invalid principal tenant scope/);
    expect(() =>
      toPrincipalRefView({ type: 'user', tenant: 'tenant-a', principalId: 'has space' }),
    ).toThrow(/invalid principal id/);
    expect(isPrincipalRefView(null)).toBe(false);
    expect(isPrincipalRefView({ type: 'user' })).toBe(false);
  });
});

describe('evidence refs (positive + negative)', () => {
  it('accepts digest + non-empty description', () => {
    const ref = toEvidenceRef({ digest: GOOD_DIGEST, description: 'dossier' });
    expect(isEvidenceRef(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects bad digests and empty descriptions', () => {
    expect(() => toEvidenceRef({ digest: 'zz', description: 'x' })).toThrow(
      ExpertRegistryError,
    );
    expect(() => toEvidenceRef({ digest: GOOD_DIGEST, description: '' })).toThrow(
      /non-empty/,
    );
  });

  it('duplicate detection: assertNoDuplicateEvidence throws on repeats', () => {
    const ref = toEvidenceRef({ digest: GOOD_DIGEST, description: 'x' });
    expect(() => assertNoDuplicateEvidence([ref, ref])).toThrow(
      ExpertRegistryError,
    );
    const other = toEvidenceRef({
      digest: 'b'.repeat(64),
      description: 'y',
    });
    expect(() => assertNoDuplicateEvidence([ref, other])).not.toThrow();
  });
});

describe('capability node refs (positive + negative)', () => {
  const input = {
    kind: 'expert-competency',
    id: 'accounts-payable-reconciliation',
    version: '1.2.0',
    digest: GOOD_DIGEST,
  };

  it('accepts graph node refs and constrains kinds', () => {
    const ref = toCapabilityNodeRefView(input);
    expect(isCapabilityNodeRefView(ref)).toBe(true);
    expect(capabilityNodeRefViewKey(ref)).toBe(
      `expert-competency:accounts-payable-reconciliation@1.2.0#${GOOD_DIGEST}`,
    );
    // Endpoint discipline: competencies may not reference domain nodes.
    expect(() =>
      toCapabilityNodeRefView({ ...input, kind: 'domain' }, ['capability', 'skill']),
    ).toThrow(/not allowed here/);
  });

  it('rejects malformed node refs', () => {
    expect(() => toCapabilityNodeRefView({ ...input, kind: 'node' })).toThrow(
      /unknown capability node kind/,
    );
    expect(() => toCapabilityNodeRefView({ ...input, id: 'Bad Id' })).toThrow(
      /invalid capability node id/,
    );
    expect(() => toCapabilityNodeRefView({ ...input, version: '1.0' })).toThrow(
      /invalid capability node version/,
    );
    expect(() => toCapabilityNodeRefView({ ...input, digest: 'x' })).toThrow(
      /invalid capability node digest/,
    );
    expect(isCapabilityNodeRefView(null)).toBe(false);
  });

  it('mirrors the eleven §4 node kinds (parity probe)', () => {
    expect(CAPABILITY_NODE_KINDS).toHaveLength(11);
    expect(CAPABILITY_NODE_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,127}$');
  });
});

describe('neutral locator charset (PII minimization, positive + negative)', () => {
  it('accepts DID-like and registry-handle locators', () => {
    expect(isNeutralLocator('did:arena:expert:01')).toBe(true);
    expect(isNeutralLocator('CERT-AP-7741')).toBe(true);
    expect(isNeutralLocator('urn:uuid:1234')).toBe(true);
  });

  it('structurally rejects email and phone shapes', () => {
    expect(isNeutralLocator('john.doe@example.com')).toBe(false);
    expect(isNeutralLocator('+491701234567')).toBe(false);
    expect(isNeutralLocator('')).toBe(false);
    expect(isNeutralLocator('has space')).toBe(false);
  });
});
