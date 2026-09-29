/**
 * Shared view/guard tests (Work Order A007) — pattern sources, tenant
 * scoping, proficiency ordering, capability/credential/jurisdiction/
 * availability views, strict shape enforcement.
 */

import { describe, expect, it } from 'vitest';
import {
  AVAILABILITY_RECURRENCES,
  CREDENTIAL_KINDS,
  DOMAIN_NODE_KIND,
  COMPETENCY_NODE_KINDS,
  PROFICIENCY_LEVELS,
  PROFICIENCY_RANK,
  PUBLIC_TENANT,
  capabilityNodeRefViewKey,
  deepFreeze,
  expectEnumMember,
  expectFields,
  expectPositiveInteger,
  isAvailabilityWindowView,
  isCapabilityNodeRefView,
  isContentDigest,
  isJurisdictionView,
  isProficiencyLevel,
  isTenantScope,
  isTenantVisible,
  proficiencyMeets,
  toAvailabilityWindowView,
  toCapabilityNodeRefView,
  toCredentialRefView,
  toJurisdictionView,
  toProficiencyLevel,
  toTenantScope,
} from './shared.js';
import { ExpertQualificationError } from './errors.js';
import { DIGEST_A, DOMAIN_SOFTWARE, SKILL_RUST_REVIEW } from './test-support.js';

describe('pattern guards', () => {
  it('accepts valid digests/ids/tenants and rejects malformed ones', () => {
    expect(isContentDigest(DIGEST_A)).toBe(true);
    expect(isContentDigest('ZZZ')).toBe(false);
    expect(isContentDigest('111')).toBe(false);
    expect(isContentDigest(64)).toBe(false);
    expect(isTenantScope('tenant-alpha')).toBe(true);
    expect(isTenantScope('public')).toBe(true);
    expect(isTenantScope('A')).toBe(false);
    expect(isTenantScope('x')).toBe(false);
    expect(toTenantScope('tenant-alpha', 'f')).toBe('tenant-alpha');
    expect(() => toTenantScope('Bad Tenant', 'f')).toThrow(ExpertQualificationError);
  });

  it('tenant visibility follows lock rule 11 (same tenant or public)', () => {
    expect(isTenantVisible('tenant-alpha', 'tenant-alpha')).toBe(true);
    expect(isTenantVisible(PUBLIC_TENANT, 'tenant-alpha')).toBe(true);
    expect(isTenantVisible('tenant-beta', 'tenant-alpha')).toBe(false);
  });

  it('proficiency vocabulary matches A006 parity and ranks monotonically', () => {
    expect([...PROFICIENCY_LEVELS]).toEqual([
      'introductory',
      'working',
      'proficient',
      'advanced',
      'distinguished',
    ]);
    expect(isProficiencyLevel('proficient')).toBe(true);
    expect(isProficiencyLevel('guru')).toBe(false);
    expect(() => toProficiencyLevel('expert', 'ctx')).toThrow(/unknown proficiency level/);
    let previous = 0;
    for (const level of PROFICIENCY_LEVELS) {
      const rank = PROFICIENCY_RANK[level] ?? 0;
      expect(rank).toBeGreaterThan(previous);
      previous = rank;
    }
    expect(proficiencyMeets('proficient', 'proficient')).toBe(true);
    expect(proficiencyMeets('introductory', 'working')).toBe(false);
    expect(proficiencyMeets('distinguished', 'working')).toBe(true);
  });
});

describe('capability node ref view', () => {
  it('accepts competency and domain kinds; rejects others and malformed fields', () => {
    expect(isCapabilityNodeRefView(SKILL_RUST_REVIEW)).toBe(true);
    expect(isCapabilityNodeRefView(DOMAIN_SOFTWARE)).toBe(true);
    expect(isCapabilityNodeRefView({ kind: 'tool', id: 'x', version: '1.0.0', digest: DIGEST_A })).toBe(false);
    expect(isCapabilityNodeRefView({ kind: 'skill', id: 'Bad Id', version: '1.0.0', digest: DIGEST_A })).toBe(false);
    expect(isCapabilityNodeRefView(null)).toBe(false);

    const ref = toCapabilityNodeRefView(SKILL_RUST_REVIEW, COMPETENCY_NODE_KINDS);
    expect(Object.isFrozen(ref)).toBe(true);
    expect(capabilityNodeRefViewKey(ref)).toBe(`skill:rust-code-review@2.1.0#${DIGEST_A}`);
  });

  it('enforces the allowed-kinds subset', () => {
    expect(() => toCapabilityNodeRefView(DOMAIN_SOFTWARE, COMPETENCY_NODE_KINDS)).toThrow(
      /is not allowed here/,
    );
    expect(() => toCapabilityNodeRefView(SKILL_RUST_REVIEW, [DOMAIN_NODE_KIND])).toThrow(
      /is not allowed here/,
    );
    expect(toCapabilityNodeRefView(DOMAIN_SOFTWARE, [DOMAIN_NODE_KIND]).kind).toBe('domain');
    expect(() => toCapabilityNodeRefView({ ...SKILL_RUST_REVIEW, digest: 'nope' })).toThrow(
      ExpertQualificationError,
    );
  });
});

describe('credential ref view (A006 parity)', () => {
  it('accepts the six A006 credential kinds', () => {
    expect([...CREDENTIAL_KINDS]).toEqual([
      'professional-license',
      'certification',
      'degree',
      'training-certificate',
      'credential-attestation',
      'external-credential',
    ]);
    const ref = toCredentialRefView({
      kind: 'certification',
      reference: 'cert-123',
      issuer: 'Board',
    });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(ref.issuer).toBe('Board');
  });

  it('rejects unknown kinds and malformed references/issuers', () => {
    expect(() =>
      toCredentialRefView({ kind: 'driver-license', reference: 'x' }),
    ).toThrow(/unknown credential kind/);
    expect(() =>
      toCredentialRefView({ kind: 'certification', reference: 'a@b.c' }),
    ).toThrow(ExpertQualificationError);
    expect(() =>
      toCredentialRefView({ kind: 'certification', reference: 'x', issuer: '' }),
    ).toThrow(/non-empty organization/);
    expect(() =>
      toCredentialRefView({ kind: 'certification', reference: 'x', issuer: 'i'.repeat(256) }),
    ).toThrow(/at most 255 characters/);
  });
});

describe('jurisdiction view', () => {
  it('accepts country / country+region; rejects malformed codes', () => {
    expect(isJurisdictionView({ jurisdictionVersion: 1, country: 'US' })).toBe(true);
    expect(isJurisdictionView({ jurisdictionVersion: 1, country: 'US', region: 'CA' })).toBe(true);
    expect(isJurisdictionView({ jurisdictionVersion: 1, country: 'usa' })).toBe(false);
    expect(isJurisdictionView({ jurisdictionVersion: 1, country: 'US', region: 'toolongregion' })).toBe(false);
    expect(toJurisdictionView({ country: 'GH' }).country).toBe('GH');
    expect(() => toJurisdictionView({ country: 'usa' })).toThrow(ExpertQualificationError);
  });
});

describe('availability window view', () => {
  it('accepts the three recurrences with their required extras', () => {
    expect([...AVAILABILITY_RECURRENCES]).toEqual(['daily', 'weekly', 'one-time']);
    expect(
      isAvailabilityWindowView({ windowVersion: 1, recurrence: 'daily', startUtc: '08:00', endUtc: '16:00' }),
    ).toBe(true);
    expect(
      isAvailabilityWindowView({
        windowVersion: 1,
        recurrence: 'weekly',
        dayOfWeek: 3,
        startUtc: '08:00',
        endUtc: '16:00',
      }),
    ).toBe(true);
    expect(
      isAvailabilityWindowView({
        windowVersion: 1,
        recurrence: 'one-time',
        date: '2026-04-01',
        startUtc: '08:00',
        endUtc: '16:00',
      }),
    ).toBe(true);
    // negative: inverted window
    expect(
      isAvailabilityWindowView({ windowVersion: 1, recurrence: 'daily', startUtc: '16:00', endUtc: '08:00' }),
    ).toBe(false);
    // negative: weekly without day
    expect(
      isAvailabilityWindowView({ windowVersion: 1, recurrence: 'weekly', startUtc: '08:00', endUtc: '16:00' }),
    ).toBe(false);
    // negative: daily carrying date
    expect(
      isAvailabilityWindowView({
        windowVersion: 1,
        recurrence: 'daily',
        date: '2026-04-01',
        startUtc: '08:00',
        endUtc: '16:00',
      }),
    ).toBe(false);
    // negative: impossible calendar date
    expect(
      isAvailabilityWindowView({
        windowVersion: 1,
        recurrence: 'one-time',
        date: '2026-02-30',
        startUtc: '08:00',
        endUtc: '16:00',
      }),
    ).toBe(false);
  });

  it('toAvailabilityWindowView throws typed errors on bad shapes', () => {
    expect(() =>
      toAvailabilityWindowView({ recurrence: 'hourly', startUtc: '08:00', endUtc: '16:00' }),
    ).toThrow(/unknown availability recurrence/);
    expect(() =>
      toAvailabilityWindowView({ recurrence: 'daily', startUtc: '8:00', endUtc: '16:00' }),
    ).toThrow(/invalid availability startUtc/);
    expect(() =>
      toAvailabilityWindowView({ recurrence: 'daily', startUtc: '08:00', endUtc: '08:00' }),
    ).toThrow(/window is empty/);
    expect(() =>
      toAvailabilityWindowView({ recurrence: 'weekly', startUtc: '08:00', endUtc: '16:00' }),
    ).toThrow(/ISO day number/);
    expect(() =>
      toAvailabilityWindowView({ recurrence: 'one-time', startUtc: '08:00', endUtc: '16:00' }),
    ).toThrow(/calendar date/);
  });
});

describe('strict shape enforcement', () => {
  it('expectFields rejects non-objects, missing required and unknown fields', () => {
    expect(() => expectFields(null, ['a'], [], 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx')).toThrow(
      /expected a plain object/,
    );
    expect(() => expectFields({ a: 1 }, ['a', 'b'], [], 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx')).toThrow(
      /missing required field 'b'/,
    );
    expect(() => expectFields({ a: 1, z: 2 }, ['a'], [], 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx')).toThrow(
      /unknown field 'z'/,
    );
    expect(expectFields({ a: 1, o: 2 }, ['a'], ['o'], 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx')['a']).toBe(1);
  });

  it('expectPositiveInteger and expectEnumMember reject bad values', () => {
    expect(() => expectPositiveInteger(0, 'n', 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx')).toThrow(
      /positive integer/,
    );
    expect(() => expectPositiveInteger(1.5, 'n', 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx')).toThrow(
      /positive integer/,
    );
    expect(
      expectEnumMember('skill', COMPETENCY_NODE_KINDS, 'k', 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx'),
    ).toBe('skill');
    expect(() =>
      expectEnumMember('tool', COMPETENCY_NODE_KINDS, 'k', 'EXPERT_QUALIFICATION_INVALID_CLAIM', 'ctx'),
    ).toThrow(/must be one of/);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays', () => {
    const frozen = deepFreeze({ a: [1, { b: 2 }] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a?.[1])).toBe(true);
    expect(deepFreeze(42)).toBe(42);
  });
});
