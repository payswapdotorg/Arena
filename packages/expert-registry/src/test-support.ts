/**
 * Shared test fixtures for the @arena/expert-registry suites (Work Order
 * A006). NOT exported from the package index — this module exists so
 * every test file builds profiles from ONE canonical valid input (the
 * convention of @arena/capability-case's src/test-support.ts).
 */

import type { CreateExpertProfileInput } from './profile.js';
import type { CreateExpertDomainPackInput } from './domain-pack.js';
import { defaultExpertProfilePolicy } from './privacy-policy.js';
import { ExpertRegistryError } from './errors.js';
import { expect } from 'vitest';

/**
 * Assert that a sync function throws an ExpertRegistryError with the exact
 * code (toThrow(string) only substring-matches messages; codes need this).
 */
export function expectThrowsCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ExpertRegistryError);
    expect((error as ExpertRegistryError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected ExpertRegistryError with code ${code}, but nothing was thrown`);
}

/** Async variant of expectThrowsCode. */
export async function expectRejectsCode(
  fn: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ExpertRegistryError);
    expect((error as ExpertRegistryError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected ExpertRegistryError with code ${code}, but nothing was thrown`);
}

export const DIGEST_A =
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_B =
  'b1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_C =
  'c1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_D =
  'd1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_E =
  'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
export const DIGEST_F =
  'f1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

export const AT = '2026-09-28T10:00:00.000Z';
export const AT_LATER = '2026-09-28T11:00:00.000Z';
export const AT_EVEN_LATER = '2026-09-28T12:00:00.000Z';

export const DECLARER = {
  type: 'user',
  tenant: 'tenant-a',
  principalId: 'expert-intake',
} as const;

export const RECORDER = {
  type: 'service',
  tenant: 'tenant-a',
  principalId: 'registry-orchestrator',
} as const;

/** The canonical valid createExpertProfile input every test starts from. */
export function validProfileInput(): CreateExpertProfileInput {
  return {
    identity: { tenant: 'tenant-a', expertId: 'expert-invoice-reconciliation' },
    identityRefs: [
      {
        kind: 'identity-attestation',
        digest: DIGEST_A,
        locator: 'did:arena:expert:01',
        note: 'Onboarding identity attestation (digest-addressed; no inline PII).',
      },
    ],
    version: '1.0.0',
    competencies: [
      {
        capability: {
          kind: 'expert-competency',
          id: 'accounts-payable-reconciliation',
          version: '1.2.0',
          digest: DIGEST_B,
        },
        proficiency: 'proficient',
        proficiencyEvidence: [
          {
            digest: DIGEST_C,
            description: 'Annotated trajectory set of 40 reconciliation runs (2026 Q2).',
          },
        ],
      },
      {
        capability: {
          kind: 'skill',
          id: 'erp-export-analysis',
          version: '1.0.0',
          digest: DIGEST_D,
        },
        proficiency: 'working',
        proficiencyEvidence: [
          {
            digest: DIGEST_E,
            description: 'Skill drill results: ERP export parsing (2026-08).',
          },
        ],
      },
    ],
    qualifications: [
      {
        credential: {
          kind: 'certification',
          reference: 'CERT-AP-7741',
          issuer: 'Institute of Certified Accountants',
        },
        evidence: [DIGEST_F],
        status: 'verified',
        validFrom: '2024-03-01T00:00:00.000Z',
        validUntil: '2027-03-01T00:00:00.000Z',
        jurisdiction: { country: 'DE' },
        note: 'Professional certification record — data, not an authorization grant.',
      },
    ],
    evidence: [
      {
        digest: DIGEST_A,
        description: 'Expert onboarding dossier (identity + CV-of-record, digest-addressed).',
      },
    ],
    taskHistory: [],
    reliability: [],
    availability: {
      windows: [
        { recurrence: 'weekly', dayOfWeek: 2, startUtc: '09:00', endUtc: '17:00' },
        { recurrence: 'weekly', dayOfWeek: 4, startUtc: '09:00', endUtc: '13:00' },
      ],
    },
    domainScope: {
      domains: [
        { kind: 'domain', id: 'accounts-payable', version: '1.0.0', digest: DIGEST_B },
      ],
      jurisdictions: [{ country: 'DE' }, { country: 'FR' }],
      limitations: [
        {
          class: 'professional-scope',
          statement:
            'Provides reconciliation analysis only; does not issue financial statements or tax filings.',
        },
        {
          class: 'licensing',
          statement:
            'Not a licensed tax advisor in any jurisdiction; certification data is informational.',
          jurisdiction: { country: 'DE' },
        },
        {
          class: 'privacy',
          statement: 'Processes only tenant-scoped ERP exports; no cross-tenant data reuse.',
        },
      ],
    },
    privacyPolicy: defaultExpertProfilePolicy(),
    declaredBy: DECLARER,
    declaredAt: AT,
  };
}

/** A minimal variant: no identity refs, no qualifications, empty history/ledger. */
export function minimalProfileInput(): CreateExpertProfileInput {
  const input = validProfileInput();
  return {
    ...input,
    identityRefs: [],
    qualifications: [],
  };
}

/** A canonical valid domain-pack input (R37). */
export function validDomainPackInput(): CreateExpertDomainPackInput {
  return {
    id: 'structural-engineering',
    version: '1.0.0',
    description:
      'Structural-engineering domain competency types and metadata (R39 demonstration domain).',
    competencyTypes: [
      {
        type: 'structural.load-analysis',
        description: 'Load analysis competency for structural members.',
      },
      {
        type: 'structural.seismic-design',
        description: 'Seismic design review competency.',
      },
    ],
    metadataFields: [
      {
        field: 'stampEligibility',
        valueType: 'string',
        required: true,
        description: 'Jurisdictional stamp eligibility statement (explicit metadata).',
      },
      {
        field: 'yearsOfPractice',
        valueType: 'number',
        required: false,
        description: 'Years of domain practice (measurement data).',
      },
    ],
  };
}

/** A cross-tenant variant (tenant-b). */
export function otherTenantProfileInput(): CreateExpertProfileInput {
  const input = validProfileInput();
  return {
    ...input,
    identity: { tenant: 'tenant-b', expertId: 'expert-load-analysis' },
    declaredBy: { type: 'user', tenant: 'tenant-b', principalId: 'expert-intake' },
    taskHistory: [],
    reliability: [],
  };
}
