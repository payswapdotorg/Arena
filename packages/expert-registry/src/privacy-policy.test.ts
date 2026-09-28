/**
 * Privacy-policy tests (Work Order A006 gate 6; lock rule 23 — privacy is
 * explicit metadata). Positive and negative for the per-group visibility
 * marking, including the missing-group and unknown-group negatives.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPERT_PRIVACY_POLICY_VERSION,
  FIELD_VISIBILITIES,
  PUBLIC_VIEW_FIELD_GROUPS,
  defaultExpertProfilePolicy,
  isExpertProfilePrivacyPolicy,
  isFieldVisibility,
  toExpertProfilePrivacyPolicy,
} from './privacy-policy.js';
import { ExpertRegistryError } from './errors.js';

const FULL_VISIBILITY: Record<string, string> = {
  identityRefs: 'public',
  competencies: 'public',
  qualifications: 'public',
  evidence: 'tenant-internal',
  taskHistory: 'tenant-internal',
  reliability: 'tenant-internal',
  availability: 'public',
  domainScope: 'public',
};

describe('expert privacy policy (positive)', () => {
  it('exposes the eight governed §8 content groups', () => {
    expect(PUBLIC_VIEW_FIELD_GROUPS).toEqual([
      'identityRefs',
      'competencies',
      'qualifications',
      'evidence',
      'taskHistory',
      'reliability',
      'availability',
      'domainScope',
    ]);
    expect(FIELD_VISIBILITIES).toEqual(['public', 'tenant-internal']);
  });

  it('the default policy marks measurement/identity internals tenant-internal', () => {
    const policy = defaultExpertProfilePolicy();
    expect(isExpertProfilePrivacyPolicy(policy)).toBe(true);
    expect(policy.policyVersion).toBe(EXPERT_PRIVACY_POLICY_VERSION);
    expect(policy.visibility.reliability).toBe('tenant-internal');
    expect(policy.visibility.taskHistory).toBe('tenant-internal');
    expect(policy.visibility.evidence).toBe('tenant-internal');
    expect(policy.visibility.identityRefs).toBe('tenant-internal');
    expect(policy.visibility.competencies).toBe('public');
    expect(policy.visibility.availability).toBe('public');
    expect(policy.visibility.domainScope).toBe('public');
    expect(policy.visibility.qualifications).toBe('public');
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.visibility)).toBe(true);
  });

  it('an explicit all-groups policy validates and freezes', () => {
    const policy = toExpertProfilePrivacyPolicy({
      visibility: {
        identityRefs: 'public',
        competencies: 'public',
        qualifications: 'public',
        evidence: 'tenant-internal',
        taskHistory: 'tenant-internal',
        reliability: 'tenant-internal',
        availability: 'public',
        domainScope: 'public',
      },
    });
    expect(isExpertProfilePrivacyPolicy(policy)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(isFieldVisibility('public')).toBe(true);
    expect(isFieldVisibility('private')).toBe(false);
  });
});

describe('expert privacy policy (negative)', () => {
  it('rejects missing groups — every group must be EXPLICITLY marked', () => {
    for (const group of Object.keys(FULL_VISIBILITY)) {
      const partial = { ...FULL_VISIBILITY };
      delete partial[group];
      expect(() => toExpertProfilePrivacyPolicy({ visibility: partial })).toThrow(
        /missing explicit visibility/,
      );
    }
  });

  it('rejects unknown groups and unknown markings', () => {
    expect(() =>
      toExpertProfilePrivacyPolicy({
        visibility: { ...FULL_VISIBILITY, role: 'public' },
      }),
    ).toThrow(/unknown privacy policy group/);
    expect(() =>
      toExpertProfilePrivacyPolicy({
        visibility: { ...FULL_VISIBILITY, evidence: 'secret' },
      }),
    ).toThrow(/unknown visibility marking/);
    expect(() =>
      toExpertProfilePrivacyPolicy({ visibility: 'nope' as unknown as Record<string, string> }),
    ).toThrow(ExpertRegistryError);
    expect(isExpertProfilePrivacyPolicy({ visibility: FULL_VISIBILITY })).toBe(false);
  });
});
