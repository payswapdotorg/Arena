/**
 * Qualification tests (Work Order A006; §8 qualifications; lock rule 9 —
 * qualification is DATA, never authorization). Positive and negative for
 * credential refs, statuses, validity windows and evidence discipline.
 */

import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_KINDS,
  EXPERT_QUALIFICATION_VERSION,
  QUALIFICATION_STATUSES,
  isCredentialKind,
  isCredentialRefView,
  isExpertQualification,
  isQualificationStatus,
  toCredentialRefView,
  toExpertQualification,
  toExpertQualificationList,
} from './qualifications.js';
import { ExpertRegistryError } from './errors.js';
import { DIGEST_F } from './test-support.js';

const valid = () => ({
  credential: {
    kind: 'certification',
    reference: 'CERT-AP-7741',
    issuer: 'Institute of Certified Accountants',
  },
  evidence: [DIGEST_F],
  status: 'verified',
});

describe('credential refs (positive + negative)', () => {
  it('accepts professional credential kinds and neutral references', () => {
    for (const kind of CREDENTIAL_KINDS) {
      expect(isCredentialKind(kind)).toBe(true);
    }
    const ref = toCredentialRefView({
      kind: 'professional-license',
      reference: 'PE-1234567',
      issuer: 'State Board',
    });
    expect(isCredentialRefView(ref)).toBe(true);
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects unknown kinds and malformed references', () => {
    expect(() =>
      toCredentialRefView({ kind: 'api-token', reference: 'x' }),
    ).toThrow(/unknown credential kind/);
    expect(() =>
      toCredentialRefView({ kind: 'certification', reference: 'has space' }),
    ).toThrow(/neutral identifier charset/);
    expect(() =>
      toCredentialRefView({ kind: 'certification', reference: 'x', issuer: '' }),
    ).toThrow(/non-empty organization string/);
    expect(isCredentialRefView({ kind: 'certification' })).toBe(false);
  });
});

describe('expert qualifications (positive)', () => {
  it('accepts an evidenced qualification and freezes it', () => {
    const qualification = toExpertQualification({
      ...valid(),
      validFrom: '2024-03-01T00:00:00.000Z',
      validUntil: '2027-03-01T00:00:00.000Z',
      jurisdiction: { country: 'DE' },
      note: 'Professional certification record — data, not an authorization grant.',
    });
    expect(isExpertQualification(qualification)).toBe(true);
    expect(qualification.qualificationVersion).toBe(EXPERT_QUALIFICATION_VERSION);
    expect(Object.isFrozen(qualification)).toBe(true);
  });

  it('accepts every status in the closed vocabulary (statuses are DATA)', () => {
    expect(QUALIFICATION_STATUSES).toEqual([
      'claimed',
      'attested',
      'verified',
      'expired',
      'revoked',
      'disputed',
    ]);
    for (const status of QUALIFICATION_STATUSES) {
      const qualification = toExpertQualification({ ...valid(), status });
      expect(qualification.status).toBe(status);
      expect(isQualificationStatus(status)).toBe(true);
    }
    expect(isQualificationStatus('authorized')).toBe(false);
  });

  it('the list may be empty (a draft expert may have no credentials yet)', () => {
    expect(toExpertQualificationList([])).toEqual([]);
  });
});

describe('expert qualifications (negative)', () => {
  it('rejects evidence-free credential claims (R7)', () => {
    expect(() => toExpertQualification({ ...valid(), evidence: [] })).toThrow(
      /at least one evidence digest/,
    );
    expect(() => toExpertQualification({ ...valid(), evidence: ['bad'] })).toThrow(
      ExpertRegistryError,
    );
  });

  it('rejects duplicate evidence digests', () => {
    expect(() =>
      toExpertQualification({ ...valid(), evidence: [DIGEST_F, DIGEST_F] }),
    ).toThrow(/duplicate qualification evidence digest/);
  });

  it('rejects unknown statuses', () => {
    expect(() => toExpertQualification({ ...valid(), status: 'approved' })).toThrow(
      /unknown qualification status/,
    );
  });

  it('rejects empty validity windows and malformed fields', () => {
    expect(() =>
      toExpertQualification({
        ...valid(),
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2025-01-01T00:00:00.000Z',
      }),
    ).toThrow(/validity window is empty/);
    expect(() =>
      toExpertQualification({ ...valid(), validFrom: '2026-01-01' }),
    ).toThrow(ExpertRegistryError);
    expect(() =>
      toExpertQualification({ ...valid(), jurisdiction: { country: 'de' } }),
    ).toThrow(/ISO 3166-1 alpha-2/);
    expect(() => toExpertQualification({ ...valid(), note: '' })).toThrow(/non-empty/);
  });

  it('rejects non-array qualification lists', () => {
    expect(() =>
      toExpertQualificationList(undefined as unknown as Parameters<typeof toExpertQualificationList>[0]),
    ).toThrow(/must be an array/);
  });
});
