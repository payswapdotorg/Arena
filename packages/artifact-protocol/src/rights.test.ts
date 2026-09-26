import { describe, expect, it } from 'vitest';
import {
  COMMERCIAL_USE_POLICIES,
  CUSTOMER_DATA_POLICIES,
  LICENSE_PATTERN_SOURCE,
  REDISTRIBUTION_POLICIES,
  isRightsMetadata,
  toRightsMetadata,
} from './rights.js';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';

const VALID = {
  license: 'Apache-2.0',
  commercialUse: 'allowed',
  redistribution: 'tenant-only',
  customerData: 'derived',
};

describe('RightsMetadata (positive)', () => {
  it('validates and freezes explicit rights metadata', () => {
    const rights = toRightsMetadata(VALID);
    expect(rights.license).toBe('Apache-2.0');
    expect(rights.commercialUse).toBe('allowed');
    expect(rights.redistribution).toBe('tenant-only');
    expect(rights.customerData).toBe('derived');
    expect(Object.isFrozen(rights)).toBe(true);
    expect(isRightsMetadata(rights)).toBe(true);
  });

  it('accepts optional professional limitations (lock rule 23)', () => {
    const rights = toRightsMetadata({
      ...VALID,
      professionalLimitations: ['Not a professional engineering license'],
    });
    expect(rights.professionalLimitations).toEqual(['Not a professional engineering license']);
  });

  it('accepts every closed policy value', () => {
    for (const policy of COMMERCIAL_USE_POLICIES) {
      expect(isRightsMetadata({ ...VALID, commercialUse: policy })).toBe(true);
    }
    for (const policy of REDISTRIBUTION_POLICIES) {
      expect(isRightsMetadata({ ...VALID, redistribution: policy })).toBe(true);
    }
    for (const policy of CUSTOMER_DATA_POLICIES) {
      expect(isRightsMetadata({ ...VALID, customerData: policy })).toBe(true);
    }
  });
});

describe('RightsMetadata (negative)', () => {
  it('rejects MISSING rights metadata outright', () => {
    for (const missing of [undefined, null]) {
    try {
        toRightsMetadata(missing);
        expect.unreachable('rights metadata is required');
      } catch (error) {
        expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.MISSING_RIGHTS);
      }
    }
  });

  it('rejects malformed rights', () => {
    const cases: unknown[] = [
      'all-rights-reserved',
      42,
      [],
      { ...VALID, license: '' },
      { ...VALID, license: 'x'.repeat(65) },
      { ...VALID, license: 'MIT\n<script>' },
      { ...VALID, commercialUse: 'maybe' },
      { ...VALID, redistribution: 'anyone' },
      { ...VALID, customerData: 'raw' },
      { ...VALID, professionalLimitations: 'not-an-array' },
      { ...VALID, professionalLimitations: [''] },
    ];
    for (const bad of cases) {
      expect(() => toRightsMetadata(bad)).toThrow(ArtifactError);
      expect(isRightsMetadata(bad)).toBe(false);
    }
    try {
      toRightsMetadata({ ...VALID, commercialUse: 'maybe' });
    } catch (error) {
      expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.INVALID_RIGHTS);
    }
  });

  it('pattern source anchors contract parity', () => {
    expect(LICENSE_PATTERN_SOURCE).toBe('^[A-Za-z0-9][A-Za-z0-9 .+()\\-]{0,63}$');
  });
});
