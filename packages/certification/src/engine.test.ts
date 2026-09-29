/**
 * CertificationEngine tests (Work Order A023).
 *
 * Positive: the deterministic Body×Substrate×Environment×RuntimeProfile×
 * Suite evaluation over REAL sibling-protocol evidence shapes — every
 * stage kind satisfied, failed and unknown; fail-closed rollup;
 * determinism (identical inputs ⇒ identical record digest).
 *
 * Negative/adversarial: missing evidence, wrong-digest evidence
 * (mismatch), invalid evidence, cross-tenant compatibility evidence,
 * composition mismatches, compatibility unknowns — NONE of them can
 * produce a satisfied verdict.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateCertificationRun,
  subjectBodyVersionRefKey,
  subjectSubstrateRefKey,
} from './engine.js';
import {
  compatibilityStage,
  compositionStage,
  datasetStage,
  evaluationStage,
  makeCompatibilityRecord,
  makeDatasetManifest,
  makeEvaluationRecord,
  makeSubject,
  makeSuite,
  makeVerificationRecord,
  verificationStage,
  BODY_REF,
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  SUBSTRATE_REF,
  T0,
  T1,
} from './test-support.js';
import type { CertificationEvidence } from './engine.js';

const EMPTY: CertificationEvidence = {
  evaluations: [],
  verifications: [],
  compatibility: [],
  datasets: [],
};

const CTX = {
  correlationId: 'corr-run-1',
  idempotencyKey: 'idem-run-1',
  startedAt: T0,
  finishedAt: T1,
};

describe('stage evaluation — verification (A013 consumption)', () => {
  it('satisfied ⇔ the pinned verifier record outcome is pass', async () => {
    const suite = await makeSuite([verificationStage('verify', DIGEST_C)]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, verifications: [makeVerificationRecord()] },
      CTX,
    );
    expect(record.verdict).toBe('satisfied');
    expect(record.grantedLevel).toBe('CERTIFIED');
    expect(record.stages[0]?.evidenceDigest).toBe(DIGEST_A);
  });

  it('a pinned verifier FAIL fails the suite (machine reason names the stage)', async () => {
    const suite = await makeSuite([verificationStage('verify', DIGEST_C)]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, verifications: [makeVerificationRecord({ outcome: 'fail' })] },
      CTX,
    );
    expect(record.verdict).toBe('not-satisfied');
    expect(record.stages[0]?.reason).toBe('stage-failed');
  });

  it('a pinned verifier UNKNOWN is a method limitation (fail-closed, never a pass)', async () => {
    const suite = await makeSuite([verificationStage('verify', DIGEST_C)]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      {
        ...EMPTY,
        verifications: [
          makeVerificationRecord({
            outcome: 'unknown',
            unknownCause: { reason: 'missing-evidence', detail: 'no evidence' },
          }),
        ],
      },
      CTX,
    );
    expect(record.verdict).toBe('unknown');
    expect(record.stages[0]?.reason).toBe('method-limitation');
    expect(record.unknownCause?.reason).toBe('method-limitation');
  });

  it('NEGATIVE: absent / mismatched / invalid verification evidence all yield unknown', async () => {
    const suite = await makeSuite([verificationStage('verify', DIGEST_C)]);
    const missing = await evaluateCertificationRun(suite, makeSubject(), EMPTY, CTX);
    expect(missing.verdict).toBe('unknown');
    expect(missing.stages[0]?.reason).toBe('missing-evidence');
    const mismatched = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, verifications: [makeVerificationRecord({ verifierRef: DIGEST_D })] },
      CTX,
    );
    expect(mismatched.verdict).toBe('unknown');
    expect(mismatched.stages[0]?.reason).toBe('evidence-mismatch');
    const invalid = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, verifications: [{ junk: true }] },
      CTX,
    );
    expect(invalid.verdict).toBe('unknown');
    expect(invalid.stages[0]?.reason).toBe('invalid-evidence');
  });
});

describe('stage evaluation — evaluation (A012 consumption)', () => {
  it('satisfied ⇔ the pinned evaluator+criteria record is meets-criteria', async () => {
    const suite = await makeSuite([evaluationStage('judge', DIGEST_B, DIGEST_C)]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, evaluations: [makeEvaluationRecord()] },
      CTX,
    );
    expect(record.verdict).toBe('satisfied');
  });

  it('below-criteria fails the suite; missing evidence is unknown (fail-closed)', async () => {
    const suite = await makeSuite([evaluationStage('judge', DIGEST_B, DIGEST_C)]);
    const failed = await evaluateCertificationRun(
      suite,
      makeSubject(),
      {
        ...EMPTY,
        evaluations: [
          makeEvaluationRecord({ aggregate: { score: 0.2, outcome: 'below-criteria' } }),
        ],
      },
      CTX,
    );
    expect(failed.verdict).toBe('not-satisfied');
    const unknown = await evaluateCertificationRun(suite, makeSubject(), EMPTY, CTX);
    expect(unknown.verdict).toBe('unknown');
    expect(unknown.unknownCause?.reason).toBe('missing-evidence');
    // wrong criteria pin: evidence exists but does not match
    const mismatch = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, evaluations: [makeEvaluationRecord({ criteriaRef: DIGEST_A })] },
      CTX,
    );
    expect(mismatch.verdict).toBe('unknown');
    expect(mismatch.stages[0]?.reason).toBe('evidence-mismatch');
  });
});

describe('stage evaluation — compatibility (A022 consumption)', () => {
  it('satisfied ⇔ the subject pair is compatible', async () => {
    const subject = makeSubject();
    expect(subjectBodyVersionRefKey(subject)).toBe(
      `acme/structural-engineer-body@1.4.0#${BODY_REF.digest}`,
    );
    expect(subjectSubstrateRefKey(subject)).toBe(`substrate-x@6.0.1#${SUBSTRATE_REF.digest}`);
    const suite = await makeSuite([compatibilityStage('compat')]);
    const record = await evaluateCertificationRun(
      suite,
      subject,
      { ...EMPTY, compatibility: [makeCompatibilityRecord()] },
      CTX,
    );
    expect(record.verdict).toBe('satisfied');
  });

  it('incompatible-with-reasons fails; unknown-with-structured-causes is a method limitation', async () => {
    const suite = await makeSuite([compatibilityStage('compat')]);
    const failed = await evaluateCertificationRun(
      suite,
      makeSubject(),
      {
        ...EMPTY,
        compatibility: [
          makeCompatibilityRecord({
            verdict: 'incompatible-with-reasons',
            reasons: ['missing required modalities: vision'],
          }),
        ],
      },
      CTX,
    );
    expect(failed.verdict).toBe('not-satisfied');
    const unknown = await evaluateCertificationRun(
      suite,
      makeSubject(),
      {
        ...EMPTY,
        compatibility: [
          makeCompatibilityRecord({
            verdict: 'unknown-with-structured-causes',
            reasons: ['adapter unavailable'],
          }),
        ],
      },
      CTX,
    );
    expect(unknown.verdict).toBe('unknown');
    expect(unknown.stages[0]?.reason).toBe('method-limitation');
  });

  it('NEGATIVE (adversarial): cross-tenant compatibility evidence can NEVER certify', async () => {
    const suite = await makeSuite([compatibilityStage('compat')]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      {
        ...EMPTY,
        compatibility: [makeCompatibilityRecord({ tenantId: 'tenant-evil' })],
      },
      CTX,
    );
    expect(record.verdict).toBe('unknown');
    expect(record.stages[0]?.reason).toBe('tenant-mismatch');
  });

  it('NEGATIVE: evidence for a DIFFERENT body/substrate pair is a mismatch', async () => {
    const suite = await makeSuite([compatibilityStage('compat')]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      {
        ...EMPTY,
        compatibility: [
          makeCompatibilityRecord({ bodyVersionRef: 'other/body@9.9.9#deadbeef' }),
        ],
      },
      CTX,
    );
    expect(record.verdict).toBe('unknown');
    expect(record.stages[0]?.reason).toBe('evidence-mismatch');
  });
});

describe('stage evaluation — dataset (A014 consumption)', () => {
  it('satisfied ⇔ the pinned dataset manifest resolves by digest + identity', async () => {
    const suite = await makeSuite([
      datasetStage('benchmark', {
        namespace: 'arena',
        name: 'structural-benchmark',
        version: '1.2.0',
        digest: DIGEST_C,
      }),
    ]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, datasets: [makeDatasetManifest()] },
      CTX,
    );
    expect(record.verdict).toBe('satisfied');
  });

  it('NEGATIVE: absent manifest, wrong digest and wrong identity are all unknown', async () => {
    const suite = await makeSuite([
      datasetStage('benchmark', {
        namespace: 'arena',
        name: 'structural-benchmark',
        version: '1.2.0',
        digest: DIGEST_C,
      }),
    ]);
    const missing = await evaluateCertificationRun(suite, makeSubject(), EMPTY, CTX);
    expect(missing.stages[0]?.reason).toBe('missing-evidence');
    const wrongDigest = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, datasets: [makeDatasetManifest({ digest: DIGEST_A })] },
      CTX,
    );
    expect(wrongDigest.stages[0]?.reason).toBe('evidence-mismatch');
    const wrongIdentity = await evaluateCertificationRun(
      suite,
      makeSubject(),
      {
        ...EMPTY,
        datasets: [
          makeDatasetManifest({
            identity: { namespace: 'arena', name: 'other-benchmark', version: '1.2.0' },
          }),
        ],
      },
      CTX,
    );
    expect(wrongIdentity.stages[0]?.reason).toBe('evidence-mismatch');
    expect(wrongIdentity.verdict).toBe('unknown');
  });
});

describe('stage evaluation — composition (the E and R pins)', () => {
  it('satisfied ⇔ the subject matches the pinned environment/runtime', async () => {
    const suite = await makeSuite([compositionStage('composition')]);
    const record = await evaluateCertificationRun(suite, makeSubject(), EMPTY, CTX);
    expect(record.verdict).toBe('satisfied');
  });

  it('a subject on a different environment is not-satisfied (composition-mismatch)', async () => {
    const suite = await makeSuite([compositionStage('composition')]);
    const otherEnv = makeSubject({
      environmentRef: {
        environmentId: 'other-env',
        environmentVersion: '1.0.0',
        constraints: ['offline'],
      },
    });
    const record = await evaluateCertificationRun(suite, otherEnv, EMPTY, CTX);
    expect(record.verdict).toBe('not-satisfied');
    expect(record.stages[0]?.reason).toBe('composition-mismatch');
  });
});

describe('engine determinism and the full composition', () => {
  it('identical tuples yield the byte-identical record digest (R22)', async () => {
    const suite = await makeSuite([
      verificationStage('verify', DIGEST_C),
      evaluationStage('judge', DIGEST_B, DIGEST_C),
      compatibilityStage('compat'),
      compositionStage('composition'),
    ]);
    const evidence: CertificationEvidence = {
      evaluations: [makeEvaluationRecord()],
      verifications: [makeVerificationRecord()],
      compatibility: [makeCompatibilityRecord()],
      datasets: [],
    };
    const one = await evaluateCertificationRun(suite, makeSubject(), evidence, CTX);
    const two = await evaluateCertificationRun(suite, makeSubject(), evidence, CTX);
    expect(one.digest).toBe(two.digest);
    expect(one.verdict).toBe('satisfied');
    expect(one.statement?.text).toContain(
      'satisfied Certification Suite structural-certification',
    );
    expect(one.stages.map((stage) => stage.stageId)).toEqual([
      'verify',
      'judge',
      'compat',
      'composition',
    ]);
  });

  it('any unknown stage blocks certification even with every other stage satisfied', async () => {
    const suite = await makeSuite([
      verificationStage('verify', DIGEST_C),
      evaluationStage('judge', DIGEST_B, DIGEST_C),
    ]);
    const record = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...EMPTY, verifications: [makeVerificationRecord()] },
      CTX,
    );
    expect(record.verdict).toBe('unknown');
    expect(record.grantedLevel).toBeNull();
    expect(record.statement?.verdictQualifier).toBe('could not be determined against');
  });

  it('carries the supersedes lineage of a recertification run', async () => {
    const suite = await makeSuite([compositionStage('composition')]);
    const first = await evaluateCertificationRun(suite, makeSubject(), EMPTY, CTX);
    const second = await evaluateCertificationRun(suite, makeSubject(), EMPTY, {
      ...CTX,
      supersedes: first.digest,
    });
    expect(second.supersedes).toBe(first.digest);
    expect(second.digest).not.toBe(first.digest);
  });
});
