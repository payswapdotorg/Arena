/**
 * QualificationPolicy tests (Work Order A007 §3.3) — requirements,
 * windows, conflict rules, content addressing, negative inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  POLICY_CONFLICT_RULE_FIELDS,
  POLICY_EVIDENCE_REQUIREMENT_FIELDS,
  QUALIFICATION_POLICY_FIELDS,
  createQualificationPolicy,
  isQualificationPolicy,
  isQualificationPolicyView,
  qualificationPolicyIdentityKey,
  qualificationPolicyView,
  recomputeQualificationPolicyDigest,
} from './policy.js';
import { ExpertQualificationError } from './errors.js';
import { makeQualificationPolicy } from './test-support.js';

describe('policy construction', () => {
  it('creates a content-addressed, deep-frozen policy', async () => {
    const policy = await makeQualificationPolicy();
    expect(policy.policyId).toBe('policy-rust-review');
    expect(policy.requirements).toHaveLength(2);
    expect(policy.requirements[0]?.evidenceKind).toBe('work-product-ref');
    expect(policy.freshnessWindowDays).toBe(30);
    expect(policy.validityWindowDays).toBe(180);
    expect(policy.conflictEvidence).toEqual([
      { evidenceKind: 'verification-ref', outcome: 'fail' },
      { evidenceKind: 'credential-ref', outcome: null },
    ]);
    expect(policy.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.requirements)).toBe(true);
    expect(isQualificationPolicy(policy)).toBe(true);
    expect(isQualificationPolicyView(qualificationPolicyView(policy))).toBe(true);
  });

  it('is deterministic and tamper-detecting', async () => {
    const a = await makeQualificationPolicy();
    const b = await makeQualificationPolicy();
    expect(a.digest).toBe(b.digest);
    const stricter = await makeQualificationPolicy({ freshnessWindowDays: 60 });
    expect(stricter.digest).not.toBe(a.digest);
    await expect(recomputeQualificationPolicyDigest(a, a.digest)).resolves.toBe(a.digest);
    const tampered = { ...a, maxCandidates: 5 } as typeof a & { maxCandidates?: number };
    delete (tampered as Partial<typeof tampered>).maxCandidates;
    await expect(recomputeQualificationPolicyDigest(tampered)).resolves.toBe(a.digest);
    const reallyTampered = { ...a, validityWindowDays: 999 } as typeof a;
    await expect(recomputeQualificationPolicyDigest(reallyTampered)).rejects.toThrow(
      /digest mismatch/,
    );
  });

  it('the identity key is policyId@version (version discipline)', async () => {
    const a = await makeQualificationPolicy();
    const v2 = await createQualificationPolicy({
      policyId: 'policy-rust-review',
      version: '1.5.0',
      description: a.description,
      requirements: [
        { requirementId: 'work-products', evidenceKind: 'work-product-ref', minimumCount: 2 },
        { requirementId: 'verification', evidenceKind: 'verification-ref', minimumCount: 1 },
      ],
      freshnessWindowDays: 30,
      validityWindowDays: 180,
      conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'fail' }],
    });
    expect(qualificationPolicyIdentityKey(a)).toBe('policy-rust-review@1.4.0');
    expect(qualificationPolicyIdentityKey(v2)).toBe('policy-rust-review@1.5.0');
  });
});

describe('negative/adversarial policy inputs', () => {
  const base = {
    policyId: 'policy-x',
    version: '1.0.0',
    description: 'test policy',
    requirements: [
      { requirementId: 'r1', evidenceKind: 'work-product-ref', minimumCount: 1 },
    ],
    freshnessWindowDays: 30,
    validityWindowDays: 180,
    conflictEvidence: [],
  };

  it('rejects empty requirements', async () => {
    await expect(
      createQualificationPolicy({ ...base, requirements: [] }),
    ).rejects.toThrow(/at least one evidence requirement/);
  });

  it('rejects duplicate requirement ids', async () => {
    await expect(
      createQualificationPolicy({
        ...base,
        requirements: [
          { requirementId: 'r1', evidenceKind: 'work-product-ref', minimumCount: 1 },
          { requirementId: 'r1', evidenceKind: 'verification-ref', minimumCount: 1 },
        ],
      }),
    ).rejects.toThrow(/duplicate policy requirement id/);
  });

  it('rejects non-positive minimum counts and windows', async () => {
    await expect(
      createQualificationPolicy({
        ...base,
        requirements: [{ requirementId: 'r1', evidenceKind: 'work-product-ref', minimumCount: 0 }],
      }),
    ).rejects.toThrow(/minimumCount must be a positive integer/);
    await expect(
      createQualificationPolicy({ ...base, freshnessWindowDays: 0 }),
    ).rejects.toThrow(/freshnessWindowDays must be a positive integer/);
    await expect(
      createQualificationPolicy({ ...base, validityWindowDays: -5 }),
    ).rejects.toThrow(/validityWindowDays must be a positive integer/);
  });

  it('rejects unknown evidence kinds and malformed conflict rules', async () => {
    await expect(
      createQualificationPolicy({
        ...base,
        requirements: [{ requirementId: 'r1', evidenceKind: 'peer-review', minimumCount: 1 }],
      }),
    ).rejects.toThrow(/must be one of/);
    await expect(
      createQualificationPolicy({
        ...base,
        conflictEvidence: [{ evidenceKind: 'verification-ref', outcome: 'maybe' }],
      }),
    ).rejects.toThrow(/outcome must be null or one of/);
    await expect(
      createQualificationPolicy({
        ...base,
        conflictEvidence: [
          { evidenceKind: 'verification-ref', outcome: 'fail' },
          { evidenceKind: 'verification-ref', outcome: 'fail' },
        ],
      }),
    ).rejects.toThrow(/duplicate conflict rule/);
  });

  it('rejects malformed ids, versions, descriptions and unknown fields', async () => {
    await expect(createQualificationPolicy({ ...base, policyId: 'Bad Id' })).rejects.toThrow(
      ExpertQualificationError,
    );
    await expect(createQualificationPolicy({ ...base, version: '1.0.0+build' })).rejects.toThrow(
      /semver without build metadata/,
    );
    await expect(createQualificationPolicy({ ...base, description: '' })).rejects.toThrow(
      /invalid neutral text/,
    );
    await expect(
      createQualificationPolicy({ ...base, reputation: true } as never),
    ).rejects.toThrow(/unknown field/);
  });

  it('exports the stable field lists used by the contracts parity test', () => {
    expect([...QUALIFICATION_POLICY_FIELDS]).toContain('freshnessWindowDays');
    expect([...POLICY_EVIDENCE_REQUIREMENT_FIELDS]).toEqual([
      'requirementId',
      'evidenceKind',
      'minimumCount',
    ]);
    expect([...POLICY_CONFLICT_RULE_FIELDS]).toEqual(['evidenceKind', 'outcome']);
  });
});
