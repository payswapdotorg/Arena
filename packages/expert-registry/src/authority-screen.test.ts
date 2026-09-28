/**
 * Separation-of-concerns screen tests (Work Order A006 gate 3 — THE
 * critical gate; architecture-lock rule 9; §8 identity PII minimization).
 *
 * Positive: protocol vocabulary passes clean.
 * Negative: every authority-shaped and PII-shaped field — at the TOP
 * level, NESTED at any depth, in arrays, under camelCase/snake_case/kebab
 * spellings — is rejected. Declared names (pack types, metadata keys) are
 * screened identically.
 */

import { describe, expect, it } from 'vitest';
import {
  assertScreenedDeclaredName,
  assertScreenedInput,
  normalizeScreenKey,
  screenProbeKey,
} from './authority-screen.js';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import { validProfileInput } from './test-support.js';

describe('screen key normalization (positive)', () => {
  it('normalizes spellings to a single canonical form', () => {
    expect(normalizeScreenKey('systemRole')).toBe('systemrole');
    expect(normalizeScreenKey('system_role')).toBe('systemrole');
    expect(normalizeScreenKey('System-Role')).toBe('systemrole');
    expect(normalizeScreenKey('grantedScopes')).toBe('grantedscopes');
  });

  it('protocol vocabulary probes clean (no false positives)', () => {
    for (const key of [
      'identity',
      'identityRefs',
      'expertId',
      'version',
      'status',
      'competencies',
      'qualifications',
      'proficiency',
      'proficiencyEvidence',
      'evidence',
      'taskHistory',
      'reliability',
      'availability',
      'domainScope',
      'privacyPolicy',
      'lifecycle',
      'supersedes',
      'supersededBy',
      'declaredAt',
      'declaredBy',
      'recordedBy',
      'actor',
      'jurisdiction',
      'limitations',
      'statement',
      'domains',
      'windows',
      'locator',
      'issuer',
      'reference',
      'field',
      'valueType',
      'required',
      'description',
      'note',
      'kind',
      'digest',
      'sequence',
      'occurredAt',
    ]) {
      expect(screenProbeKey(key)).toBe('clean');
    }
  });
});

describe('authority screen — lock rule 9 (negative, the critical gate)', () => {
  it('rejects systemRole / authority / adminOf at the top level', () => {
    for (const field of ['systemRole', 'authority', 'adminOf']) {
      const input = { ...validProfileInput(), [field]: 'administrator' };
      expect(() => assertScreenedInput(input, 'expert profile input')).toThrow(
        ExpertRegistryError,
      );
      try {
        assertScreenedInput(input, 'expert profile input');
      } catch (error) {
        expect((error as ExpertRegistryError).code).toBe(
          EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED,
        );
      }
    }
  });

  it('rejects permissions / roles / grants / scopes under any spelling', () => {
    for (const field of [
      'permissions',
      'grantedPermissions',
      'roles',
      'grants',
      'scopes',
      'authorizedFor',
      'accessLevel',
      'isAdmin',
      'privileges',
      'entitlements',
      'systemRights',
      'securityClearance',
      'mayImpersonate',
      'system_role',
      'Admin-Of',
    ]) {
      expect(() =>
        assertScreenedInput({ [field]: 'x' }, 'expert profile input'),
      ).toThrow(/authority-shaped/);
    }
  });

  it('rejects authority fields NESTED at any depth (arrays included)', () => {
    const nestedCompetency = {
      ...validProfileInput().competencies[0]!,
      adminOf: 'tenant-a',
    };
    expect(() =>
      assertScreenedInput(
        { ...validProfileInput(), competencies: [nestedCompetency] },
        'expert profile input',
      ),
    ).toThrow(/competencies\[0\]\.adminOf/);

    const nestedQualification = {
      ...validProfileInput().qualifications[0]!,
      credential: {
        ...validProfileInput().qualifications[0]!.credential,
        scopes: ['read:all'],
      },
    };
    expect(() =>
      assertScreenedInput(
        { ...validProfileInput(), qualifications: [nestedQualification] },
        'expert profile input',
      ),
    ).toThrow(/authority-shaped/);

    expect(() =>
      assertScreenedInput(
        { ...validProfileInput(), domainScope: { ...validProfileInput().domainScope, limitations: [{ class: 'safety', statement: 'x', systemRole: 'root' }] } },
        'expert profile input',
      ),
    ).toThrow(/authority-shaped/);
  });

  it('the canonical valid input passes the screen clean (positive control)', () => {
    expect(() => assertScreenedInput(validProfileInput(), 'expert profile input')).not.toThrow();
  });

  it('cycle-safe: circular structures do not hang or crash', () => {
    const circular: Record<string, unknown> = { self: null };
    circular['self'] = circular;
    expect(() => assertScreenedInput(circular, 'test input')).not.toThrow();
    const circularBad: Record<string, unknown> = { systemRole: 'x', self: null };
    circularBad['self'] = circularBad;
    expect(() => assertScreenedInput(circularBad, 'test input')).toThrow(
      ExpertRegistryError,
    );
  });
});

describe('PII screen — §8 identity minimization (negative)', () => {
  it('rejects personal-data fields at the top level', () => {
    for (const field of [
      'name',
      'fullName',
      'legalName',
      'displayName',
      'email',
      'emailAddress',
      'phone',
      'phoneNumber',
      'dateOfBirth',
      'nationalId',
      'ssn',
      'taxId',
      'bankAccount',
      'photo',
    ]) {
      const input = { ...validProfileInput(), [field]: 'personal data' };
      try {
        assertScreenedInput(input, 'expert profile input');
        expect.unreachable(`PII field ${field} was not rejected`);
      } catch (error) {
        expect((error as ExpertRegistryError).code).toBe(
          EXPERT_ERROR_CODES.PII_FIELD_REJECTED,
        );
      }
    }
  });

  it('rejects PII fields nested inside identity refs', () => {
    expect(() =>
      assertScreenedInput(
        {
          ...validProfileInput(),
          identityRefs: [
            { ...validProfileInput().identityRefs[0]!, email: 'john@example.com' },
          ],
        },
        'expert profile input',
      ),
    ).toThrow(/personal-data-shaped/);
  });

  it('screen probe negative controls', () => {
    expect(screenProbeKey('email')).toBe('pii');
    expect(screenProbeKey('legal_name')).toBe('pii');
    expect(screenProbeKey('adminOf')).toBe('authority');
    expect(screenProbeKey('authorityLevel')).toBe('authority');
  });
});

describe('declared-name screening (gate 8 defense in depth)', () => {
  it('rejects authority-shaped declared names', () => {
    for (const name of ['adminOf', 'roles', 'systemRole', 'grantedScopes', 'clearance']) {
      expect(() => assertScreenedDeclaredName(name, 'domain competency type')).toThrow(
        /authority-shaped/,
      );
    }
  });

  it('rejects PII-shaped declared names', () => {
    for (const name of ['email', 'phoneNumber', 'legalName']) {
      expect(() => assertScreenedDeclaredName(name, 'domain metadata field')).toThrow(
        /personal-data-shaped/,
      );
    }
  });

  it('accepts honest domain names (positive)', () => {
    for (const name of ['structural.load-analysis', 'stampEligibility', 'yearsOfPractice']) {
      expect(() => assertScreenedDeclaredName(name, 'domain name')).not.toThrow();
    }
  });
});
