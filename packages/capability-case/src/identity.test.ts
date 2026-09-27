/**
 * Identity suite (Work Order A005 gate 11 + R3-style addressability):
 * CaseIdentity, string forms and CaseVersionRef — positive and negative.
 */

import { describe, expect, it } from 'vitest';
import {
  CASE_ID_PATTERN_SOURCE,
  CASE_IDENTITY_PATTERN_SOURCE,
  caseLogicalKey,
  caseVersionKey,
  formatCaseIdentity,
  formatCaseVersionRef,
  isCaseIdentity,
  isCaseId,
  isCaseVersionRef,
  isSameCaseIdentity,
  parseCaseIdentity,
  toCaseId,
  toCaseIdentity,
  toCaseVersionRef,
} from './identity.js';
import { CapabilityCaseError } from './errors.js';
import { DIGEST_A } from './test-support.js';

describe('CaseIdentity (positive)', () => {
  it('validates, freezes and formats identities', () => {
    const identity = toCaseIdentity({ tenant: 'tenant-a', caseId: 'case-x' });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(isCaseIdentity(identity)).toBe(true);
    expect(formatCaseIdentity(identity)).toBe('arena:case/tenant-a/case-x');
    expect(
      isSameCaseIdentity(identity, toCaseIdentity({ tenant: 'tenant-a', caseId: 'case-x' })),
    ).toBe(true);
    expect(caseLogicalKey(identity)).toBe('tenant-a/case-x');
  });

  it('parses identity string forms round-trip', () => {
    const identity = parseCaseIdentity('arena:case/tenant-a/case-x');
    expect(identity.tenant).toBe('tenant-a');
    expect(identity.caseId).toBe('case-x');
    expect(formatCaseIdentity(parseCaseIdentity(formatCaseIdentity(identity)))).toBe(
      'arena:case/tenant-a/case-x',
    );
  });

  it('accepts the reserved public tenant', () => {
    const identity = toCaseIdentity({ tenant: 'public', caseId: 'shared-case' });
    expect(identity.tenant).toBe('public');
    expect(formatCaseIdentity(identity)).toBe('arena:case/public/shared-case');
  });
});

describe('CaseIdentity (negative)', () => {
  it('rejects invalid ids and tenants', () => {
    expect(isCaseId('Bad_Id')).toBe(false);
    expect(isCaseId('')).toBe(false);
    expect(() => toCaseId('UPPER')).toThrow(CapabilityCaseError);
    expect(() => toCaseIdentity({ tenant: 'x', caseId: 'case-x' })).toThrow(
      CapabilityCaseError,
    );
    expect(isCaseIdentity({ tenant: 'tenant-a' })).toBe(false);
    expect(isCaseIdentity(null)).toBe(false);
  });

  it('rejects malformed identity strings', () => {
    expect(() => parseCaseIdentity('case/tenant-a/case-x')).toThrow(
      /invalid case identity string/,
    );
    expect(() => parseCaseIdentity('arena:case/tenant-a/case-x@1.0.0')).toThrow(
      CapabilityCaseError,
    );
    expect(() => parseCaseIdentity('')).toThrow(CapabilityCaseError);
  });
});

describe('CaseVersionRef (positive)', () => {
  it('validates, freezes and formats full refs', () => {
    const ref = toCaseVersionRef({
      tenant: 'tenant-a',
      caseId: 'case-x',
      version: '1.2.0',
      digest: DIGEST_A,
    });
    expect(Object.isFrozen(ref)).toBe(true);
    expect(isCaseVersionRef(ref)).toBe(true);
    expect(formatCaseVersionRef(ref)).toBe(
      `arena:case/tenant-a/case-x@1.2.0#${DIGEST_A}`,
    );
    expect(caseVersionKey(ref)).toBe('tenant-a/case-x@1.2.0');
  });
});

describe('CaseVersionRef (negative)', () => {
  it('rejects malformed refs', () => {
    expect(isCaseVersionRef({ tenant: 'tenant-a', caseId: 'x', version: '1.0.0' })).toBe(
      false,
    );
    expect(
      isCaseVersionRef({ tenant: 'tenant-a', caseId: 'x', version: '1.0.0', digest: 'z' }),
    ).toBe(false);
    expect(() =>
      toCaseVersionRef({ tenant: 'tenant-a', caseId: 'x', version: '1.0.0+meta', digest: DIGEST_A }),
    ).toThrow(CapabilityCaseError);
    expect(() =>
      toCaseVersionRef({ tenant: 'tenant-a', caseId: 'x', version: '1.0.0', digest: 'x' }),
    ).toThrow(CapabilityCaseError);
  });
});

describe('pattern sources (parity anchors)', () => {
  it('exposes the canonical pattern sources', () => {
    expect(CASE_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,127}$');
    expect(CASE_IDENTITY_PATTERN_SOURCE).toBe(
      '^arena:case/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{0,127}$',
    );
  });
});
