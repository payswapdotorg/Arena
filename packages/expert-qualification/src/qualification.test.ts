/**
 * Qualification engine tests (Work Order A007 §3.3-3.4) — status
 * derivation (qualified / unqualified / stale / revoked / expired),
 * freshness math, renewal/decay append-only chains, in-force queries,
 * adversarial inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  QUALIFICATION_RECORD_FIELDS,
  QUALIFICATION_STATUSES,
  computeValidUntil,
  evaluateCompetencyClaim,
  isQualificationInForce,
  isQualificationStatus,
  recomputeQualificationRecordDigest,
  recordQualificationExpiry,
  replayQualificationRecord,
  isEvidenceFresh,
} from './qualification.js';
import { ExpertQualificationError } from './errors.js';
import { toContentDigest } from './shared.js';
import {
  T0,
  T_FRESH,
  T_STALE,
  makeClaim,
  makeQualificationPolicy,
  makeVerificationEvidence,
  makeWorkProductEvidence,
} from './test-support.js';

const DIGEST_A = toContentDigest(
  '1111111111111111111111111111111111111111111111111111111111111111',
  'test digest',
);

describe('status vocabulary and freshness math', () => {
  it('the closed status vocabulary has exactly five members', () => {
    expect([...QUALIFICATION_STATUSES]).toEqual([
      'qualified',
      'unqualified',
      'stale',
      'expired',
      'revoked',
    ]);
    expect(isQualificationStatus('qualified')).toBe(true);
    expect(isQualificationStatus('certified')).toBe(false);
  });

  it('freshness math: 30-day window boundaries', () => {
    expect(isEvidenceFresh(T0, T0, 30)).toBe(true);
    // exactly 30 days old is fresh (inclusive)
    const exactly30 = new Date(Date.parse(T0) - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(isEvidenceFresh(exactly30, T0, 30)).toBe(true);
    const beyond30 = new Date(Date.parse(T0) - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(isEvidenceFresh(beyond30, T0, 30)).toBe(false);
    // future evidence is NOT fresh (clock-skew discipline)
    expect(isEvidenceFresh(T_FRESH, T_STALE, 30)).toBe(false);
  });

  it('validUntil = evaluatedAt + validityWindowDays', () => {
    expect(computeValidUntil(T0, 180)).toBe('2026-07-14T09:30:00.000Z');
    expect(computeValidUntil(T0, 1)).toBe('2026-01-16T09:30:00.000Z');
  });
});

describe('evaluateCompetencyClaim — the four derivation paths', () => {
  it('QUALIFIED: sufficient fresh evidence ⇒ qualified + validity window', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    expect(record.status).toBe('qualified');
    expect(record.validFrom).toBe(T0);
    expect(record.validUntil).toBe(computeValidUntil(T0, 180));
    expect(record.requirementOutcomes).toHaveLength(2);
    expect(record.requirementOutcomes[0]).toMatchObject({
      requirementId: 'work-products',
      presentCount: 2,
      freshCount: 2,
      satisfied: true,
      reason: null,
    });
    expect(record.requirementOutcomes[1]).toMatchObject({
      requirementId: 'verification',
      freshCount: 1,
      satisfied: true,
    });
    expect(record.qualifyingEvidence).toEqual(
      [work1.digest, work2.digest, verify.digest].sort(),
    );
    expect(record.conflictEvidence).toEqual([]);
    expect(isQualificationInForce(record, T0)).toBe(true);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('UNQUALIFIED: insufficient count regardless of freshness', async () => {
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([verify.digest]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [verify],
      evaluatedAt: T0,
    });
    expect(record.status).toBe('unqualified');
    expect(record.requirementOutcomes[0]).toMatchObject({
      presentCount: 0,
      freshCount: 0,
      satisfied: false,
    });
    expect(record.validFrom).toBeUndefined();
    expect(isQualificationInForce(record, T0)).toBe(false);
  });

  it('STALE: counts suffice but evidence is not fresh', async () => {
    const work1 = await makeWorkProductEvidence(1, { observedAt: T_STALE });
    const work2 = await makeWorkProductEvidence(2, { observedAt: T_STALE });
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    expect(record.status).toBe('stale');
    expect(record.requirementOutcomes[0]).toMatchObject({
      presentCount: 2,
      freshCount: 0,
      satisfied: false,
    });
    // the reason text explains the freshness shortfall
    expect(record.requirementOutcomes[0]?.reason).toContain('freshness window');
  });

  it('REVOKED: conflict evidence wins over sufficient positive evidence', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const passing = await makeVerificationEvidence('pass');
    const failing = await makeVerificationEvidence('fail');
    const claim = await makeClaim([work1.digest, work2.digest, passing.digest, failing.digest]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, passing, failing],
      evaluatedAt: T0,
    });
    expect(record.status).toBe('revoked');
    expect(record.conflictEvidence).toEqual([failing.digest]);
    expect(record.qualifyingEvidence).toEqual([]);
    expect(record.requirementOutcomes.every((outcome) => !outcome.satisfied)).toBe(true);
  });

  it('determinism: identical inputs ⇒ identical record digest', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const a = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    // different input order, same content
    const b = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [verify, work2, work1],
      evaluatedAt: T0,
    });
    expect(a.digest).toBe(b.digest);
    await expect(recomputeQualificationRecordDigest(a, a.digest)).resolves.toBe(a.digest);
    const tampered = { ...a, status: 'unqualified' } as typeof a;
    await expect(recomputeQualificationRecordDigest(tampered)).rejects.toThrow(/digest mismatch/);
  });
});

describe('supersession resolution inside the engine', () => {
  it('superseded evidence does not count toward requirements', async () => {
    const stale1 = await makeWorkProductEvidence(1, { observedAt: T_STALE });
    const stale2 = await makeWorkProductEvidence(2, { observedAt: T_STALE });
    const fresh1 = await makeWorkProductEvidence(3, { supersedes: stale1.digest });
    const fresh2 = await makeWorkProductEvidence(4, { supersedes: stale2.digest });
    const verify = await makeVerificationEvidence('pass');
    // claim references all five; supersession resolves stale1 AND stale2 out
    const claim = await makeClaim([
      stale1.digest,
      stale2.digest,
      fresh1.digest,
      fresh2.digest,
      verify.digest,
    ]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [stale1, stale2, fresh1, fresh2, verify],
      evaluatedAt: T0,
    });
    // active: fresh1, fresh2, verify → 2 FRESH work products → qualified
    expect(record.status).toBe('qualified');
    expect(record.requirementOutcomes[0]).toMatchObject({ presentCount: 2, freshCount: 2 });
    expect(record.qualifyingEvidence).not.toContain(stale1.digest);
    expect(record.qualifyingEvidence).not.toContain(stale2.digest);
  });
});

describe('renewal and decay (append-only chains)', () => {
  it('renewal appends a new qualified record superseding the prior one', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const first = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    const later = '2026-01-20T12:00:00.000Z'; // 10 days after T_FRESH — still fresh
    const renewal = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: later,
      priorRecord: first,
    });
    expect(renewal.status).toBe('qualified');
    expect(renewal.supersedes).toBe(first.digest);
    expect(renewal.validFrom).toBe(later);
    expect(renewal.validUntil).toBe(computeValidUntil(later, 180));
    // the prior record is untouched
    expect(first.validFrom).toBe(T0);
    expect(isQualificationInForce(first, T0)).toBe(true);
    expect(isQualificationInForce(first, renewal.validUntil as string)).toBe(false);
  });

  it('EXPIRY appends a decay record and never rewrites the prior one', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const qualified = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    const afterExpiry = new Date(
      Date.parse(qualified.validUntil as string) + 24 * 60 * 60 * 1000,
    ).toISOString();
    const decay = await recordQualificationExpiry(qualified, afterExpiry, 'lapsed');
    expect(decay.status).toBe('expired');
    expect(decay.supersedes).toBe(qualified.digest);
    expect(decay.requirementOutcomes).toEqual([]);
    expect(decay.validFrom).toBeUndefined();
    // the prior record keeps its own qualified status and window forever
    expect(qualified.status).toBe('qualified');
    expect(qualified.validUntil).toBe(computeValidUntil(T0, 180));
    expect(isQualificationInForce(qualified, afterExpiry)).toBe(false);
    // decay records replay strictly
    await expect(replayQualificationRecord(decay)).resolves.toBe(decay);
  });

  it('recordQualificationExpiry fails loudly on non-qualified or still-in-force records', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const unqualified = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, verify],
      evaluatedAt: T0,
    });
    await expect(recordQualificationExpiry(unqualified, T0)).rejects.toThrow(
      /only a qualified record can decay/,
    );

    const qualified = await evaluateCompetencyClaim({
      claim: await makeClaim(
        [work1.digest, (await makeWorkProductEvidence(2)).digest, verify.digest],
      ),
      policy,
      evidence: [work1, await makeWorkProductEvidence(2), verify],
      evaluatedAt: T0,
    });
    await expect(recordQualificationExpiry(qualified, T0)).rejects.toThrow(/still in force/);
  });
});

describe('adversarial engine inputs', () => {
  it('fails loudly when claim evidence records are missing', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    await expect(
      evaluateCompetencyClaim({
        claim,
        policy,
        evidence: [work1, work2], // verify record missing
        evaluatedAt: T0,
      }),
    ).rejects.toThrow(ExpertQualificationError);
    await expect(
      evaluateCompetencyClaim({
        claim,
        policy,
        evidence: [work1, work2, { ...verify, digest: DIGEST_A }],
        evaluatedAt: T0,
      }),
    ).rejects.toThrow(/missing.*evidence record/);
  });

  it('fails loudly when a renewal record supersedes a DIFFERENT claim', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claimA = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const claimB = await makeClaim([work1.digest, work2.digest, verify.digest], {
      proficiency: 'advanced',
    });
    const policy = await makeQualificationPolicy();
    const recordForA = await evaluateCompetencyClaim({
      claim: claimA,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    await expect(
      evaluateCompetencyClaim({
        claim: claimB,
        policy,
        evidence: [work1, work2, verify],
        evaluatedAt: T0,
        priorRecord: recordForA,
      }),
    ).rejects.toThrow(/SAME claim/);
  });

  it('replay rejects tampered and malformed wire records', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verify = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verify.digest]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verify],
      evaluatedAt: T0,
    });
    await expect(replayQualificationRecord(record)).resolves.toBe(record);
    await expect(replayQualificationRecord({ ...record, recordVersion: 2 })).rejects.toThrow(
      /unsupported qualification record wire version/,
    );
    await expect(replayQualificationRecord({ ...record, status: 'bogus' })).rejects.toThrow(
      /must be one of/,
    );
    // a qualified record without its window is rejected
    const noWindow = { ...record } as typeof record;
    delete (noWindow as { validFrom?: string }).validFrom;
    await expect(replayQualificationRecord(noWindow)).rejects.toThrow(
      /must carry validFrom and validUntil/,
    );
    // a non-qualified record carrying a window is rejected
    await expect(
      replayQualificationRecord({ ...record, status: 'stale' as const }),
    ).rejects.toThrow(/only qualified records carry/);
    // digest tampering
    await expect(replayQualificationRecord({ ...record, note: 'x' })).rejects.toThrow(
      ExpertQualificationError,
    );
  });

  it('exports the stable field list used by the contracts parity test', () => {
    for (const field of [
      'claimDigest',
      'policyDigest',
      'status',
      'evaluatedAt',
      'requirementOutcomes',
      'qualifyingEvidence',
      'conflictEvidence',
      'validFrom',
      'validUntil',
      'supersedes',
    ]) {
      expect([...QUALIFICATION_RECORD_FIELDS]).toContain(field);
    }
  });
});
