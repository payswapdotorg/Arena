/**
 * Identity tests (Work Order A006) — neutral expert ids (PII minimization),
 * identity string forms, declared identity refs and content-addressed
 * version refs. Positive and negative per validator.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPERT_ID_PATTERN_SOURCE,
  EXPERT_IDENTITY_PATTERN_SOURCE,
  EXPERT_IDENTITY_PREFIX,
  EXPERT_VERSION_REF_PATTERN_SOURCE,
  IDENTITY_REF_KINDS,
  IDENTITY_REF_VERSION,
  formatExpertIdentity,
  formatExpertVersionRef,
  toIdentityRefView,
  isExpertIdentity,
  isExpertId,
  isExpertVersionRef,
  isIdentityRefView,
  isSameExpertIdentity,
  parseExpertIdentity,
  toExpertIdentity,
  toExpertId,
  toExpertVersionRef,
} from './identity.js';
import { ExpertRegistryError } from './errors.js';
import { DIGEST_A, DIGEST_B } from './test-support.js';

describe('neutral expert ids (positive + negative)', () => {
  it('accepts expert- prefixed neutral slugs', () => {
    expect(isExpertId('expert-invoice-reconciliation')).toBe(true);
    expect(isExpertId('expert-e3f1a9')).toBe(true);
    expect(toExpertId('expert-x')).toBe('expert-x');
  });

  it('rejects bare personal-name-shaped and malformed ids (PII minimization)', () => {
    expect(isExpertId('john-smith')).toBe(false); // no expert- prefix
    expect(isExpertId('Expert-X')).toBe(false);
    expect(isExpertId('expert-')).toBe(false);
    expect(isExpertId('expert_underscore')).toBe(false);
    expect(() => toExpertId('jane-doe')).toThrow(/invalid expert id/);
  });

  it('exposes the pattern source for contract parity', () => {
    expect(EXPERT_ID_PATTERN_SOURCE).toBe('^expert-[a-z0-9][a-z0-9-]{0,61}$');
  });
});

describe('expert identity (positive + negative)', () => {
  it('validates, freezes and round-trips string forms', () => {
    const identity = toExpertIdentity({
      tenant: 'tenant-a',
      expertId: 'expert-invoice-reconciliation',
    });
    expect(isExpertIdentity(identity)).toBe(true);
    expect(Object.isFrozen(identity)).toBe(true);
    expect(formatExpertIdentity(identity)).toBe(
      'arena:expert/tenant-a/expert-invoice-reconciliation',
    );
    expect(parseExpertIdentity(formatExpertIdentity(identity))).toEqual(identity);
    expect(isSameExpertIdentity(identity, identity)).toBe(true);
    expect(EXPERT_IDENTITY_PREFIX).toBe('arena:expert');
  });

  it('rejects malformed identities and identity strings', () => {
    expect(() => toExpertIdentity({ tenant: 'BAD', expertId: 'expert-x' })).toThrow(
      ExpertRegistryError,
    );
    expect(() => parseExpertIdentity('arena:expert/tenant-a/john-smith')).toThrow(
      /invalid expert identity string/,
    );
    expect(() => parseExpertIdentity('expert:tenant-a/expert-x')).toThrow(
      ExpertRegistryError,
    );
    expect(isExpertIdentity({ tenant: 'tenant-a' })).toBe(false);
  });

  it('exposes the identity pattern source for contract parity', () => {
    expect(EXPERT_IDENTITY_PATTERN_SOURCE).toBe(
      '^arena:expert/[a-z][a-z0-9-]{1,62}/expert-[a-z0-9][a-z0-9-]{0,61}$',
    );
  });
});

describe('declared identity refs (positive + negative)', () => {
  it('accepts digest-addressed attestations with neutral locators', () => {
    const ref = toIdentityRefView({
      kind: 'identity-attestation',
      digest: DIGEST_A,
      locator: 'did:arena:expert:01',
      note: 'onboarding attestation',
    });
    expect(isIdentityRefView(ref)).toBe(true);
    expect(ref.refVersion).toBe(IDENTITY_REF_VERSION);
    expect(IDENTITY_REF_KINDS).toContain('identity-attestation');
    expect(IDENTITY_REF_KINDS).toContain('external-identifier');
  });

  it('rejects unknown kinds, bad digests and PII-shaped locators', () => {
    expect(() => toIdentityRefView({ kind: 'passport', digest: DIGEST_A })).toThrow(
      /unknown identity ref kind/,
    );
    expect(() => toIdentityRefView({ kind: 'identity-attestation', digest: 'x' })).toThrow(
      /invalid identity ref digest/,
    );
    expect(() =>
      toIdentityRefView({
        kind: 'contact-attestation',
        digest: DIGEST_A,
        locator: 'john@example.com',
      }),
    ).toThrow(/neutral identifier charset/);
    expect(() =>
      toIdentityRefView({ kind: 'contact-attestation', digest: DIGEST_A, note: '' }),
    ).toThrow(/non-empty/);
    expect(isIdentityRefView({ kind: 'identity-attestation', digest: 'x' })).toBe(false);
  });
});

describe('expert version refs (positive + negative)', () => {
  it('validates, freezes and formats full content-addressed refs', () => {
    const ref = toExpertVersionRef({
      tenant: 'tenant-a',
      expertId: 'expert-invoice-reconciliation',
      version: '1.2.0',
      digest: DIGEST_A,
    });
    expect(isExpertVersionRef(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(formatExpertVersionRef(ref)).toBe(
      `arena:expert/tenant-a/expert-invoice-reconciliation@1.2.0#${DIGEST_A}`,
    );
  });

  it('rejects malformed refs', () => {
    expect(() =>
      toExpertVersionRef({ tenant: 'x', expertId: 'expert-x', version: '1.0.0', digest: DIGEST_B }),
    ).toThrow(/invalid expert version reference/);
    expect(
      isExpertVersionRef({ tenant: 'tenant-a', expertId: 'expert-x', version: '1', digest: DIGEST_A }),
    ).toBe(false);
    expect(isExpertVersionRef(null)).toBe(false);
  });

  it('exposes the version ref pattern source for contract parity', () => {
    expect(EXPERT_VERSION_REF_PATTERN_SOURCE).toContain('#[0-9a-f]{64}$');
  });
});
