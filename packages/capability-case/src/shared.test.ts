/**
 * Shared-component suite (Work Order A005 gate 11): positive and negative
 * tests for tenant scopes, digests, semver, principals, the cross-protocol
 * view refs, evidence refs and provenance refs.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_NODE_KINDS,
  PUBLIC_TENANT,
  assertNoDuplicateEvidence,
  compareCaseVersions,
  isBodyVersionRefView,
  isCapabilityNodeKindView,
  isCapabilityNodeRefView,
  isCaseVersion,
  isContentDigest,
  isEvidenceRef,
  isPrincipalRefView,
  isPrincipalType,
  isProvenanceRefView,
  isSubstrateRefView,
  isTenantScope,
  isTenantVisible,
  isVersionedArtifactRefView,
  toBodyVersionRefView,
  toCapabilityNodeRefView,
  toCaseVersion,
  toContentDigest,
  toEvidenceRef,
  toPrincipalRefView,
  toProvenanceRefView,
  toSubstrateRefView,
  toTenantScope,
  toVersionedArtifactRefView,
  versionedArtifactRefViewKey,
} from './shared.js';
import { CapabilityCaseError } from './errors.js';
import { DIGEST_A, DIGEST_B } from './test-support.js';

describe('tenant scopes (lock rule 11)', () => {
  it('accepts valid tenants and the reserved public namespace (positive)', () => {
    expect(isTenantScope('tenant-a')).toBe(true);
    expect(isTenantScope(PUBLIC_TENANT)).toBe(true);
    expect(toTenantScope('acme')).toBe('acme');
  });

  it('rejects invalid tenants (negative)', () => {
    expect(isTenantScope('Tenant-A')).toBe(false); // uppercase
    expect(isTenantScope('a')).toBe(false); // too short (2-63)
    expect(isTenantScope('-abc')).toBe(false);
    expect(isTenantScope('')).toBe(false);
    expect(isTenantScope(42)).toBe(false);
    expect(() => toTenantScope('Bad Tenant')).toThrow(CapabilityCaseError);
  });

  it('tenant visibility: own tenant and public only (lock rule 11)', () => {
    expect(isTenantVisible('tenant-a', 'tenant-a')).toBe(true);
    expect(isTenantVisible('public', 'tenant-a')).toBe(true);
    expect(isTenantVisible('tenant-a', 'tenant-b')).toBe(false);
  });
});

describe('content digests', () => {
  it('accepts lowercase sha256 hex (positive)', () => {
    expect(isContentDigest(DIGEST_A)).toBe(true);
    expect(toContentDigest(DIGEST_B)).toBe(DIGEST_B);
  });

  it('rejects malformed digests (negative)', () => {
    expect(isContentDigest(DIGEST_A.toUpperCase())).toBe(false);
    expect(isContentDigest(`z${DIGEST_A.slice(1)}`)).toBe(false);
    expect(isContentDigest(DIGEST_A.slice(1))).toBe(false); // 63 chars
    expect(isContentDigest('')).toBe(false);
    expect(() => toContentDigest('nope')).toThrow(CapabilityCaseError);
  });
});

describe('semver case versions', () => {
  it('accepts semver without build metadata (positive)', () => {
    expect(isCaseVersion('1.0.0')).toBe(true);
    expect(isCaseVersion('0.2.3')).toBe(true);
    expect(isCaseVersion('2.1.0-rc.1')).toBe(true);
    expect(toCaseVersion('1.2.3')).toBe('1.2.3');
  });

  it('rejects build metadata and malformed versions (negative)', () => {
    expect(isCaseVersion('1.0.0+build.1')).toBe(false);
    expect(isCaseVersion('1.0')).toBe(false);
    expect(isCaseVersion('v1.0.0')).toBe(false);
    expect(isCaseVersion('01.0.0')).toBe(false);
    expect(() => toCaseVersion('1.0.0+meta')).toThrow(CapabilityCaseError);
  });

  it('semver precedence comparison (spec 2.0.0)', () => {
    expect(compareCaseVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareCaseVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareCaseVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareCaseVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareCaseVersions('1.0.0-alpha.1', '1.0.0-alpha')).toBeGreaterThan(0);
    expect(compareCaseVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
  });
});

describe('principals (spec CC1.0 "source"; lock rule 10)', () => {
  it('accepts the closed principal types (positive)', () => {
    for (const type of ['agent-body', 'expert', 'user', 'service', 'system']) {
      expect(isPrincipalType(type)).toBe(true);
    }
    const principal = toPrincipalRefView({
      type: 'user',
      tenant: 'tenant-a',
      principalId: 'analyst-1',
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(isPrincipalRefView(principal)).toBe(true);
  });

  it('rejects unknown types and provider-shaped ids (negative)', () => {
    expect(isPrincipalType('model')).toBe(false);
    expect(isPrincipalType('openai-user')).toBe(false);
    expect(() =>
      toPrincipalRefView({ type: 'model', tenant: 't-x', principalId: 'x' }),
    ).toThrow(/unknown principal type/);
    expect(() =>
      toPrincipalRefView({ type: 'user', tenant: 'tenant-a', principalId: 'user@example.com' }),
    ).toThrow(/invalid principal id/);
    expect(() =>
      toPrincipalRefView({ type: 'user', tenant: 'Bad', principalId: 'x' }),
    ).toThrow(/tenant/);
  });
});

describe('versioned artifact ref views (A002 structural views)', () => {
  it('accepts and freezes valid refs (positive)', () => {
    const ref = toVersionedArtifactRefView({
      namespace: 'tenant-a',
      name: 'erp-close-sandbox',
      version: '1.4.0',
      digest: DIGEST_A,
    });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(isVersionedArtifactRefView(ref)).toBe(true);
    expect(versionedArtifactRefViewKey(ref)).toBe(
      `tenant-a/erp-close-sandbox@1.4.0#${DIGEST_A}`,
    );
  });

  it('rejects malformed refs (negative)', () => {
    expect(
      isVersionedArtifactRefView({
        namespace: 'Tenant-A',
        name: 'x',
        version: '1.0.0',
        digest: DIGEST_A,
      }),
    ).toBe(false);
    expect(() =>
      toVersionedArtifactRefView({
        namespace: 'tenant-a',
        name: 'Bad Name',
        version: '1.0.0',
        digest: DIGEST_A,
      }),
    ).toThrow(CapabilityCaseError);
    expect(() =>
      toVersionedArtifactRefView({
        namespace: 'tenant-a',
        name: 'ok',
        version: '1.0.0',
        digest: 'not-a-digest',
      }),
    ).toThrow(CapabilityCaseError);
  });
});

describe('capability node ref views (A004 structural views)', () => {
  it('enumerates exactly the eleven graph node kinds (parity with A004)', () => {
    expect(CAPABILITY_NODE_KINDS.length).toBe(11);
    expect(CAPABILITY_NODE_KINDS).toContain('observed-failure');
    expect(CAPABILITY_NODE_KINDS).toContain('expert-competency');
  });

  it('accepts valid refs and enforces allowed-kind constraints (positive)', () => {
    const ref = toCapabilityNodeRefView(
      { kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: DIGEST_A },
      ['domain'],
    );
    expect(Object.isFrozen(ref)).toBe(true);
    expect(isCapabilityNodeRefView(ref)).toBe(true);
    expect(isCapabilityNodeKindView('evaluator')).toBe(true);
  });

  it('rejects unknown kinds, wrong kinds and malformed parts (negative)', () => {
    expect(() =>
      toCapabilityNodeRefView({ kind: 'planet', id: 'x', version: '1.0.0', digest: DIGEST_A }),
    ).toThrow(/unknown capability node kind/);
    expect(() =>
      toCapabilityNodeRefView(
        { kind: 'domain', id: 'x', version: '1.0.0', digest: DIGEST_A },
        ['capability'],
      ),
    ).toThrow(/is not allowed here/);
    expect(() =>
      toCapabilityNodeRefView({
        kind: 'domain',
        id: 'Bad Id',
        version: '1.0.0',
        digest: DIGEST_A,
      }),
    ).toThrow(/invalid capability node id/);
    expect(() =>
      toCapabilityNodeRefView({
        kind: 'domain',
        id: 'x',
        version: '1.0.0+meta',
        digest: DIGEST_A,
      }),
    ).toThrow(/invalid capability node version/);
    expect(() =>
      toCapabilityNodeRefView({
        kind: 'domain',
        id: 'x',
        version: '1.0.0',
        digest: 'short',
      }),
    ).toThrow(/invalid capability node digest/);
    expect(isCapabilityNodeRefView({ kind: 'domain' })).toBe(false);
  });
});

describe('body version ref views (A003 structural views, optional field)', () => {
  it('accepts valid body refs (positive)', () => {
    const ref = toBodyVersionRefView({
      tenant: 'tenant-a',
      name: 'invoicing-agent',
      version: '3.2.1',
      digest: DIGEST_B,
    });
    expect(isBodyVersionRefView(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects malformed body refs (negative)', () => {
    expect(
      isBodyVersionRefView({ tenant: 'tenant-a', name: 'x', version: '1.0.0', digest: 'no' }),
    ).toBe(false);
    expect(() =>
      toBodyVersionRefView({ tenant: 'public', name: 'Bad', version: '1.0.0', digest: DIGEST_A }),
    ).toThrow(CapabilityCaseError);
  });
});

describe('substrate ref views (A016 structural views, optional field)', () => {
  it('accepts neutral substrate refs (positive)', () => {
    const ref = toSubstrateRefView({
      adapterId: 'neutral-adapter',
      modelFamily: 'reasoning-family',
      modelId: 'large-reasoner',
      modelRevision: 'rev-2',
      contentDigest: DIGEST_A,
    });
    expect(isSubstrateRefView(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects malformed substrate refs (negative)', () => {
    expect(
      isSubstrateRefView({
        adapterId: 'Neutral Adapter',
        modelFamily: 'f',
        modelId: 'm',
        modelRevision: 'r',
        contentDigest: DIGEST_A,
      }),
    ).toBe(false);
    expect(() =>
      toSubstrateRefView({
        adapterId: 'a',
        modelFamily: 'f',
        modelId: 'm',
        modelRevision: 'r',
        contentDigest: 'nope',
      }),
    ).toThrow(CapabilityCaseError);
  });
});

describe('evidence refs (lock rule 6)', () => {
  it('accepts digest+description refs (positive)', () => {
    const ref = toEvidenceRef({ digest: DIGEST_A, description: 'trajectory export' });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(isEvidenceRef(ref)).toBe(true);
    expect(assertNoDuplicateEvidence([ref])).toBeUndefined();
  });

  it('rejects missing descriptions and bad digests (negative)', () => {
    expect(isEvidenceRef({ digest: DIGEST_A, description: '' })).toBe(false);
    expect(isEvidenceRef({ digest: 'nope', description: 'x' })).toBe(false);
    expect(() => toEvidenceRef({ digest: DIGEST_A, description: '' })).toThrow(
      /non-empty description/,
    );
    expect(() => toEvidenceRef({ digest: 'nope', description: 'x' })).toThrow(
      /sha256 content digest/,
    );
    expect(() =>
      assertNoDuplicateEvidence([
        toEvidenceRef({ digest: DIGEST_A, description: 'x' }),
        toEvidenceRef({ digest: DIGEST_A, description: 'x again' }),
      ]),
    ).toThrow(/attached more than once/);
  });
});

describe('provenance ref views (A002 structural views)', () => {
  it('accepts digest-addressed provenance refs (positive)', () => {
    const ref = toProvenanceRefView({ recordDigest: DIGEST_B });
    expect(isProvenanceRefView(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects malformed provenance refs (negative)', () => {
    expect(isProvenanceRefView({ recordDigest: 'x' })).toBe(false);
    expect(() => toProvenanceRefView({ recordDigest: '' })).toThrow(CapabilityCaseError);
  });
});
