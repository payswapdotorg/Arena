/**
 * CertificationRecord tests (Work Order A023).
 *
 * Positive: append-once content-addressed records; DERIVED verdict /
 * unknown cause / granted level / scoped statement; COMPUTED input
 * digest; set-equality with the suite stages; revocation records;
 * replay determinism; tamper tripwire.
 *
 * Negative: caller-supplied verdicts impossible (there is no field);
 * stage/suite mismatches; timestamp regressions; tenant contradictions;
 * malformed inputs.
 */

import { describe, expect, it } from 'vitest';
import {
  certificationRecordView,
  computeCertificationInputDigest,
  createCertificationRecord,
  createRevocationRecord,
  isCertificationRecord,
  isCertificationRecordView,
  recomputeCertificationRecordDigest,
  replayCertificationRecord,
} from './record.js';
import { CertificationError } from './errors.js';
import {
  DIGEST_A,
  T0,
  T1,
  T2,
  makeSuite,
  makeSubject,
  verificationStage,
  evaluationStage,
} from './test-support.js';
import type { StageResult } from './outcome.js';

function satisfied(stageId: string): StageResult {
  return { stageId, outcome: 'satisfied', reason: 'stage-satisfied', evidenceDigest: null, unknownCause: null };
}
function failed(stageId: string): StageResult {
  return { stageId, outcome: 'not-satisfied', reason: 'stage-failed', evidenceDigest: null, unknownCause: null };
}
function unknown(stageId: string): StageResult {
  return {
    stageId,
    outcome: 'unknown',
    reason: 'missing-evidence',
    evidenceDigest: null,
    unknownCause: { reason: 'missing-evidence', detail: 'nothing supplied' },
  };
}

function recordInput(stages: readonly StageResult[], overrides: Record<string, unknown> = {}) {
  return {
    subject: makeSubject(),
    suiteRef: '',
    stages,
    supersedes: null,
    correlationId: 'corr-cert-1',
    idempotencyKey: 'idem-cert-1',
    tenantId: 'tenant-acme',
    workspaceId: 'ws-main',
    startedAt: T0,
    finishedAt: T1,
    provenance: { executedBy: 'cert-engine', recordedAt: T1, notes: null },
    ...overrides,
  };
}

describe('CertificationRecord (certification-run kind)', () => {
  it('derives verdict, level, statement and input digest — never caller-supplied', async () => {
    const suite = await makeSuite([verificationStage('verify', 'c'.repeat(64))]);
    const record = await createCertificationRecord(
      recordInput([satisfied('verify')], { suiteRef: suite.digest }),
      suite,
    );
    expect(record.kind).toBe('certification-run');
    expect(record.verdict).toBe('satisfied');
    expect(record.grantedLevel).toBe('CERTIFIED');
    expect(record.unknownCause).toBeNull();
    expect(record.statement?.text).toContain('satisfied Certification Suite structural-certification');
    expect(record.statement?.scope.substrate).toBe('substrate-x');
    expect(record.inputDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isCertificationRecord(record)).toBe(true);
    expect(isCertificationRecordView(certificationRecordView(record))).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
  });

  it('a failed run grants NOTHING and names the failing stage', async () => {
    const suite = await makeSuite([
      verificationStage('verify', 'c'.repeat(64)),
      evaluationStage('judge', 'b'.repeat(64), 'c'.repeat(64)),
    ]);
    const record = await createCertificationRecord(
      recordInput([satisfied('verify'), failed('judge')], { suiteRef: suite.digest }),
      suite,
    );
    expect(record.verdict).toBe('not-satisfied');
    expect(record.grantedLevel).toBeNull();
    expect(record.statement?.verdictQualifier).toBe('did not satisfy');
  });

  it('an unknown run carries the structured unknown cause (required iff unknown)', async () => {
    const suite = await makeSuite([verificationStage('verify', 'c'.repeat(64))]);
    const record = await createCertificationRecord(
      recordInput([unknown('verify')], { suiteRef: suite.digest }),
      suite,
    );
    expect(record.verdict).toBe('unknown');
    expect(record.grantedLevel).toBeNull();
    expect(record.unknownCause?.reason).toBe('missing-evidence');
    expect(record.unknownCause?.detail).toContain('stages verify');
  });

  it('reorders stage results into suite order for digest stability', async () => {
    const suite = await makeSuite([
      verificationStage('verify', 'c'.repeat(64)),
      evaluationStage('judge', 'b'.repeat(64), 'c'.repeat(64)),
    ]);
    const a = await createCertificationRecord(
      recordInput([satisfied('judge'), satisfied('verify')], { suiteRef: suite.digest }),
      suite,
    );
    const b = await createCertificationRecord(
      recordInput([satisfied('verify'), satisfied('judge')], { suiteRef: suite.digest }),
      suite,
    );
    expect(a.digest).toBe(b.digest);
    expect(a.stages.map((stage) => stage.stageId)).toEqual(['verify', 'judge']);
  });

  it('pure replay reconstructs the byte-identical record', async () => {
    const suite = await makeSuite([verificationStage('verify', 'c'.repeat(64))]);
    const record = await createCertificationRecord(
      recordInput(
        [satisfied('verify')],
        { suiteRef: suite.digest, supersedes: 'd'.repeat(64), finishedAt: T2 },
      ),
      suite,
    );
    const replayed = await replayCertificationRecord(record, suite);
    expect(replayed.digest).toBe(record.digest);
    await expect(recomputeCertificationRecordDigest(record)).resolves.toBe(record.digest);
    expect(record.supersedes).toBe('d'.repeat(64));
  });

  it('NEGATIVE: suiteRef must bind the exact suite; stages must be set-equal', async () => {
    const suite = await makeSuite([verificationStage('verify', 'c'.repeat(64))]);
    await expect(
      createCertificationRecord(recordInput([satisfied('verify')], { suiteRef: 'e'.repeat(64) }), suite),
    ).rejects.toThrow(/does not match the supplied suite/);
    await expect(
      createCertificationRecord(
        recordInput([satisfied('verify'), satisfied('rogue')], { suiteRef: suite.digest }),
        suite,
      ),
    ).rejects.toThrow(/undeclared stage/);
    await expect(
      createCertificationRecord(recordInput([], { suiteRef: suite.digest }), suite),
    ).rejects.toThrow(/at least one stage result/);
  });

  it('NEGATIVE: timestamp regressions, tenant contradictions, bad ids reject', async () => {
    const suite = await makeSuite([verificationStage('verify', 'c'.repeat(64))]);
    await expect(
      createCertificationRecord(
        recordInput([satisfied('verify')], { suiteRef: suite.digest, finishedAt: '2020-01-01T00:00:00.000Z' }),
        suite,
      ),
    ).rejects.toThrow(/precedes startedAt/);
    await expect(
      createCertificationRecord(
        recordInput([satisfied('verify')], { suiteRef: suite.digest, tenantId: 'tenant-other' }),
        suite,
      ),
    ).rejects.toThrow(/contradicts the subject's tenant/);
    await expect(
      createCertificationRecord(
        recordInput([satisfied('verify')], { suiteRef: suite.digest, idempotencyKey: '' }),
        suite,
      ),
    ).rejects.toThrow(/invalid idempotency key/);
  });

  it('NEGATIVE: tamper tripwire — a mutated record fails digest recomputation', async () => {
    const suite = await makeSuite([verificationStage('verify', 'c'.repeat(64))]);
    const record = await createCertificationRecord(
      recordInput([satisfied('verify')], { suiteRef: suite.digest }),
      suite,
    );
    const tampered = { ...record, grantedLevel: 'CANDIDATE' as const };
    await expect(recomputeCertificationRecordDigest(tampered as never)).rejects.toThrow(
      /digest mismatch/,
    );
  });

  it('the input digest commits to suite + subject + stages (R22 anchor)', async () => {
    const subject = makeSubject();
    const stages = [satisfied('verify')];
    const digestOne = await computeCertificationInputDigest('a'.repeat(64), subject, stages);
    const digestTwo = await computeCertificationInputDigest('a'.repeat(64), subject, stages);
    const digestThree = await computeCertificationInputDigest('b'.repeat(64), subject, stages);
    expect(digestOne).toBe(digestTwo);
    expect(digestOne).not.toBe(digestThree);
  });
});

describe('CertificationRecord (revocation kind)', () => {
  it('records the append-only revocation fact without mutating the target', async () => {
    const revocation = await createRevocationRecord({
      revokes: DIGEST_A,
      grounds: 'environment digest invalidated upstream',
      correlationId: 'corr-revoke-1',
      idempotencyKey: 'idem-revoke-1',
      tenantId: 'tenant-acme',
      workspaceId: 'ws-main',
      startedAt: T1,
      finishedAt: T2,
      provenance: { executedBy: 'arena-architect', recordedAt: T2, notes: null },
    });
    expect(revocation.kind).toBe('revocation');
    expect(revocation.revokes).toBe(DIGEST_A);
    expect(revocation.grounds).toBe('environment digest invalidated upstream');
    expect(revocation.subject).toBeNull();
    expect(revocation.verdict).toBeNull();
    expect(isCertificationRecord(revocation)).toBe(true);
    await expect(recomputeCertificationRecordDigest(revocation)).resolves.toBe(revocation.digest);
  });

  it('NEGATIVE: malformed revocations reject', async () => {
    await expect(
      createRevocationRecord({
        revokes: 'not-a-digest',
        grounds: 'x',
        correlationId: 'c',
        idempotencyKey: 'i',
        tenantId: null,
        workspaceId: null,
        startedAt: T0,
        finishedAt: T1,
        provenance: { executedBy: 'a', recordedAt: T1, notes: null },
      }),
    ).rejects.toThrow(CertificationError);
  });
});
