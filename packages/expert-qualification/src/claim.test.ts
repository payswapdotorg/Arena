/**
 * CompetencyClaim tests (Work Order A007 §3.2) — content addressing,
 * immutability, append-only claim supersession, negative inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  COMPETENCY_CLAIM_FIELDS,
  competencyClaimIdentityKey,
  competencyClaimView,
  createCompetencyClaim,
  isCompetencyClaim,
  isCompetencyClaimView,
  recomputeCompetencyClaimDigest,
} from './claim.js';
import { ExpertQualificationError } from './errors.js';
import {
  DIGEST_A,
  DIGEST_B,
  SKILL_RUST_REVIEW,
  SKILL_SCENARIO_MODELING,
  T1,
  makeClaim,
  makeCredentialEvidence,
  makeWorkProductEvidence,
} from './test-support.js';

describe('claim construction', () => {
  it('creates a content-addressed, deep-frozen claim', async () => {
    const claim = await makeClaim([DIGEST_A]);
    expect(claim.expertId).toBe('expert-ada');
    expect(claim.tenant).toBe('tenant-alpha');
    expect(claim.capability.id).toBe('rust-code-review');
    expect(claim.proficiency).toBe('proficient');
    expect(claim.evidence).toEqual([DIGEST_A]);
    expect(claim.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(claim)).toBe(true);
    expect(Object.isFrozen(claim.evidence)).toBe(true);
    expect(isCompetencyClaim(claim)).toBe(true);
    expect(isCompetencyClaimView(competencyClaimView(claim))).toBe(true);
  });

  it('is deterministic: same inputs ⇒ same digest; changes diverge', async () => {
    const a = await makeClaim([DIGEST_A, DIGEST_B]);
    const b = await makeClaim([DIGEST_A, DIGEST_B]);
    expect(a.digest).toBe(b.digest);
    const higher = await makeClaim([DIGEST_A, DIGEST_B], { proficiency: 'advanced' });
    expect(higher.digest).not.toBe(a.digest);
    const otherExpert = await makeClaim([DIGEST_A, DIGEST_B], { expertId: 'expert-grace' });
    expect(otherExpert.digest).not.toBe(a.digest);
  });

  it('tamper detection: digest recomputation fails closed', async () => {
    const claim = await makeClaim([DIGEST_A]);
    await expect(recomputeCompetencyClaimDigest(claim, claim.digest)).resolves.toBe(claim.digest);
    const tampered = { ...claim, proficiency: 'distinguished' } as typeof claim;
    await expect(recomputeCompetencyClaimDigest(tampered)).rejects.toThrow(
      /digest mismatch/,
    );
  });

  it('append-only supersession: a re-claim supersedes, never edits', async () => {
    const first = await makeClaim([DIGEST_A]);
    const second = await makeClaim([DIGEST_A, DIGEST_B], {
      proficiency: 'advanced',
      supersedes: first.digest,
    });
    expect(second.supersedes).toBe(first.digest);
    expect(first.supersedes).toBeUndefined();
    expect(competencyClaimIdentityKey(second)).toBe(competencyClaimIdentityKey(first));
  });

  it('the identity key is expert+tenant+capability (not proficiency)', async () => {
    const a = await makeClaim([DIGEST_A]);
    const b = await makeClaim([DIGEST_A], { proficiency: 'advanced' });
    expect(competencyClaimIdentityKey(a)).toBe(competencyClaimIdentityKey(b));
    const c = await makeClaim([DIGEST_A], { tenant: 'tenant-beta' });
    expect(competencyClaimIdentityKey(c)).not.toBe(competencyClaimIdentityKey(a));
    const d = await makeClaim([DIGEST_A], { });
    const e = await createCompetencyClaim({
      expertId: 'expert-ada',
      tenant: 'tenant-alpha',
      capability: SKILL_SCENARIO_MODELING,
      proficiency: 'proficient',
      evidence: [DIGEST_A],
      declaredAt: d.declaredAt,
    });
    expect(competencyClaimIdentityKey(e)).not.toBe(competencyClaimIdentityKey(d));
  });
});

describe('negative/adversarial claim inputs', () => {
  it('rejects evidence-free claims (R7)', async () => {
    await expect(makeClaim([])).rejects.toThrow(
      /requires at least one digest-addressed evidence ref/,
    );
  });

  it('rejects duplicate evidence digests', async () => {
    await expect(makeClaim([DIGEST_A, DIGEST_A])).rejects.toThrow(/duplicate claim evidence/);
  });

  it('rejects unknown proficiency levels', async () => {
    await expect(makeClaim([DIGEST_A], { proficiency: 'wizard' })).rejects.toThrow(
      /unknown proficiency level/,
    );
  });

  it('rejects non-competency capability node kinds', async () => {
    await expect(
      createCompetencyClaim({
        expertId: 'expert-ada',
        tenant: 'tenant-alpha',
        capability: { kind: 'domain', id: 'software-engineering', version: '1.0.0', digest: DIGEST_A },
        proficiency: 'proficient',
        evidence: [DIGEST_B],
        declaredAt: T1,
      }),
    ).rejects.toThrow(/is not allowed here/);
  });

  it('rejects malformed expert ids, tenants, timestamps and digests', async () => {
    await expect(makeClaim([DIGEST_A], { expertId: 'ada@example.org' })).rejects.toThrow(
      ExpertQualificationError,
    );
    await expect(makeClaim([DIGEST_A], { tenant: 'X' })).rejects.toThrow(/invalid tenant/);
    await expect(makeClaim([DIGEST_A], { declaredAt: 'not-a-time' })).rejects.toThrow(
      /ms-precision UTC/,
    );
    await expect(makeClaim(['short'])).rejects.toThrow(/invalid content digest/);
  });

  it('rejects unknown fields (strict shape)', async () => {
    await expect(
      createCompetencyClaim({
        expertId: 'expert-ada',
        tenant: 'tenant-alpha',
        capability: SKILL_RUST_REVIEW,
        proficiency: 'proficient',
        evidence: [DIGEST_A],
        declaredAt: T1,
        authorization: 'admin',
      } as never),
    ).rejects.toThrow(/unknown field 'authorization'/);
  });
});

describe('evidence wiring (integration with evidence records)', () => {
  it('a claim can be built from real evidence record digests', async () => {
    const credential = await makeCredentialEvidence();
    const work = await makeWorkProductEvidence(1);
    const claim = await makeClaim([credential.digest, work.digest]);
    expect(claim.evidence).toEqual([credential.digest, work.digest]);
    expect([...COMPETENCY_CLAIM_FIELDS]).toContain('supersedes');
  });
});
