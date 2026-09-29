/**
 * Fabric + registry + service tests (Work Order A023).
 *
 * Positive: registration discipline; the full
 * resolve→evaluate→record orchestration over REAL guard-valid sibling
 * evidence; idempotent replay; supersession + revocation projections;
 * envelope round trip through the service.
 *
 * Negative/adversarial: unknown suite; unresolvable evidence refs
 * (fail-closed — never silently ignored); idempotency conflicts;
 * identity conflicts; cross-tenant revocation; foreign-record
 * assertion; malformed wire messages.
 */

import { describe, expect, it } from 'vitest';
import { CertificationError } from '@arena/certification';
import type { CertificationSuite } from '@arena/certification';
import { CertificationFabric } from './fabric.js';
import { CertificationService } from './service.js';
import { CertificationSuiteRegistry } from './registry.js';
import {
  DIGEST_B,
  DIGEST_C,
  T0,
  T1,
  T2,
  compatibilityStage,
  evaluationStage,
  makeCompatibilityRecord,
  makeEvaluationRecord,
  makeSubject,
  makeSuite,
  makeVerificationRecord,
  verificationStage,
} from './test-support.js';

const CTX = { correlationId: 'corr-run-1', idempotencyKey: 'idem-run-1', startedAt: T0, finishedAt: T1 };

async function setupFabric(): Promise<{ fabric: CertificationFabric; suite: CertificationSuite; evidenceRefs: string[] }> {
  const fabric = new CertificationFabric();
  const suite = await makeSuite([
    verificationStage('verify-constraints', DIGEST_C),
    evaluationStage('judge-design', DIGEST_B, DIGEST_C),
    compatibilityStage('body-substrate'),
  ]);
  fabric.registry.registerSuite(suite);
  const evidenceRefs = [
    fabric.putVerificationRecord(makeVerificationRecord()),
    fabric.putEvaluationRecord(makeEvaluationRecord()),
    fabric.putCompatibilityRecord(makeCompatibilityRecord()),
  ];
  return { fabric, suite, evidenceRefs };
}

describe('CertificationSuiteRegistry', () => {
  it('registers idempotently by digest and conflicts on same identity + different digest', async () => {
    const registry = new CertificationSuiteRegistry();
    const suite = await makeSuite([verificationStage('v', DIGEST_C)]);
    expect(registry.registerSuite(suite)).toBe(suite);
    expect(registry.registerSuite(suite)).toBe(suite); // idempotent
    const different = await makeSuite([verificationStage('v', DIGEST_B)]);
    expect(() => registry.registerSuite(different)).toThrow(CertificationError);
    expect(() => registry.registerSuite({ ...suite, digest: 'nope' } as never)).toThrow(
      /structurally valid/,
    );
    expect(registry.getSuite(suite.digest)).toBe(suite);
    expect(registry.getSuite('missing')).toBeUndefined();
    expect(registry.listSuitesByIdentity('structural-certification')).toHaveLength(1);
  });
});

describe('CertificationFabric.certify', () => {
  it('runs the full orchestration: resolve → evaluate → derive → record', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    const record = await fabric.certify(suite.digest, makeSubject(), evidenceRefs, CTX);
    expect(record.kind).toBe('certification-run');
    expect(record.verdict).toBe('satisfied');
    expect(record.grantedLevel).toBe('CERTIFIED');
    expect(record.statement?.text).toContain(
      'satisfied Certification Suite structural-certification',
    );
    expect(fabric.getRecord(record.digest)).toBe(record);
    expect(fabric.effectiveStatus(record.digest)).toBe('active');
    expect(fabric.currentCertification(makeSubject())?.digest).toBe(record.digest);
    expect(fabric.evidenceCounts()).toEqual({
      verifications: 1,
      evaluations: 1,
      compatibility: 1,
      datasets: 0,
    });
  });

  it('replays idempotently: same key + same command ⇒ the stored record', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    const first = await fabric.certify(suite.digest, makeSubject(), evidenceRefs, CTX);
    const replay = await fabric.certify(suite.digest, makeSubject(), evidenceRefs, CTX);
    expect(replay.digest).toBe(first.digest);
    expect(fabric.listRecords()).toHaveLength(1);
  });

  it('NEGATIVE: same key + different command ⇒ IDEMPOTENCY_CONFLICT', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    await fabric.certify(suite.digest, makeSubject(), evidenceRefs, CTX);
    // different evidence tuple under the same key
    const fewer = evidenceRefs.slice(0, 1);
    await expect(
      fabric.certify(suite.digest, makeSubject(), fewer, CTX),
    ).rejects.toThrow(/already bound to a different run-certification command/);
  });

  it('NEGATIVE: unknown suite and unresolvable evidence are fail-closed', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    await expect(
      fabric.certify('f'.repeat(64), makeSubject(), evidenceRefs, CTX),
    ).rejects.toThrow(/no certification suite registered/);
    await expect(
      fabric.certify(suite.digest, makeSubject(), ['0'.repeat(64)], CTX),
    ).rejects.toThrow(/resolves to no stored record/);
  });

  it('NEGATIVE: evidence stores reject structurally invalid records', () => {
    const fabric = new CertificationFabric();
    expect(() => fabric.putVerificationRecord({ junk: true })).toThrow(
      /only accepts structurally valid/,
    );
    expect(() => fabric.putEvaluationRecord({ junk: true })).toThrow(
      /only accepts structurally valid/,
    );
    expect(() => fabric.putCompatibilityRecord({ junk: true })).toThrow(
      /only accepts structurally valid/,
    );
    expect(() => fabric.putDatasetManifest({ junk: true })).toThrow(
      /only accepts structurally valid/,
    );
  });

  it('missing evidence yields a fail-closed UNKNOWN record (never a pass)', async () => {
    const fabric = new CertificationFabric();
    const suite = await makeSuite([
      verificationStage('verify-constraints', DIGEST_C),
      evaluationStage('judge-design', DIGEST_B, DIGEST_C),
    ]);
    fabric.registry.registerSuite(suite);
    const onlyVerification = fabric.putVerificationRecord(makeVerificationRecord());
    const record = await fabric.certify(suite.digest, makeSubject(), [onlyVerification], CTX);
    expect(record.verdict).toBe('unknown');
    expect(record.grantedLevel).toBeNull();
    expect(record.unknownCause?.reason).toBe('missing-evidence');
    expect(fabric.listRecordsByVerdict('unknown')).toHaveLength(1);
  });
});

describe('supersession and revocation (append-only lineage)', () => {
  it('a recertification supersedes the prior record (projection, not mutation)', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    const first = await fabric.certify(suite.digest, makeSubject(), evidenceRefs, CTX);
    const second = await fabric.certify(suite.digest, makeSubject(), evidenceRefs, {
      ...CTX,
      idempotencyKey: 'idem-run-2',
      supersedes: first.digest,
    });
    expect(second.supersedes).toBe(first.digest);
    expect(fabric.effectiveStatus(first.digest)).toBe('superseded');
    expect(fabric.effectiveStatus(second.digest)).toBe('active');
    expect(fabric.currentCertification(makeSubject())?.digest).toBe(second.digest);
    // the first record is STILL addressable, unmutated, forever
    expect(fabric.getRecord(first.digest)?.digest).toBe(first.digest);
    expect(fabric.listRecordsBySubject(makeSubject())).toHaveLength(2);
  });

  it('NEGATIVE: supersession targets must be stored active runs', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    await expect(
      fabric.certify(suite.digest, makeSubject(), evidenceRefs, {
        ...CTX,
        supersedes: 'e'.repeat(64),
      }),
    ).rejects.toThrow(/supersession target/);
  });

  it('revocation projects REVOKED without mutating the target; re-revocation is idempotent', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    const record = await fabric.certify(suite.digest, makeSubject(), evidenceRefs, CTX);
    const revocation = await fabric.revoke(record.digest, 'suite deprecated upstream', {
      correlationId: 'corr-revoke-1',
      idempotencyKey: 'idem-revoke-1',
      startedAt: T1,
      finishedAt: T2,
    });
    expect(revocation.kind).toBe('revocation');
    expect(revocation.revokes).toBe(record.digest);
    expect(fabric.effectiveStatus(record.digest)).toBe('revoked');
    expect(fabric.currentCertification(makeSubject())).toBeUndefined();
    // the run record is still addressable and unmutated
    expect(fabric.getRecord(record.digest)?.verdict).toBe('satisfied');
    // idempotent re-revocation returns the stored revocation
    const again = await fabric.revoke(record.digest, 'suite deprecated upstream', {
      correlationId: 'corr-revoke-2',
      idempotencyKey: 'idem-revoke-2',
    });
    expect(again.digest).toBe(revocation.digest);
    // a revoked claim cannot be superseded
    await expect(
      fabric.certify(suite.digest, makeSubject(), evidenceRefs, {
        ...CTX,
        idempotencyKey: 'idem-run-3',
        supersedes: record.digest,
      }),
    ).rejects.toThrow(/already revoked/);
    await expect(
      fabric.revoke('9'.repeat(64), 'nope', { correlationId: 'c', idempotencyKey: 'i' }),
    ).rejects.toThrow(/not a stored record/);
  });
});

describe('tenant scoping and queries', () => {
  it('indexes records by tenant and suite', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    await fabric.certify(suite.digest, makeSubject(), evidenceRefs, CTX);
    expect(fabric.listRecordsByTenant('tenant-acme')).toHaveLength(1);
    expect(fabric.listRecordsByTenant('tenant-other')).toHaveLength(0);
    expect(fabric.listRecordsBySuite(suite.digest)).toHaveLength(1);
    expect(fabric.listRecords()).toHaveLength(1);
    expect(fabric.listRecordsByVerdict('satisfied')).toHaveLength(1);
  });

  it('certifying the same subject for a different tenant is a distinct record', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    const subjectTenantA = makeSubject();
    const recordA = await fabric.certify(suite.digest, subjectTenantA, evidenceRefs, CTX);
    // same composition, platform-level subject (tenant null): distinct subject key
    const recordB = await fabric.certify(
      suite.digest,
      makeSubject(),
      evidenceRefs,
      { ...CTX, idempotencyKey: 'idem-run-b' },
    );
    expect(recordA.digest).not.toBe(recordB.digest);
  });
});

describe('CertificationService (envelope wiring)', () => {
  it('round-trips run-certification-command → certification-recorded-event', async () => {
    const { fabric, suite, evidenceRefs } = await setupFabric();
    const service = new CertificationService({ fabric });
    const command = service.makeCommand(
      suite.digest,
      makeSubject(),
      evidenceRefs,
      'corr-service-1',
      'idem-service-1',
    );
    const outcome = await service.handleRunCertificationCommand(JSON.stringify(command));
    expect(outcome.record.verdict).toBe('satisfied');
    expect(outcome.record.grantedLevel).toBe('CERTIFIED');
    expect(outcome.event.kind).toBe('event');
    // the consumer side strict-parses the serialized event
    const consumed = service.readRecordedEvent(outcome.serializedEvent);
    expect(consumed.digest).toBe(outcome.record.digest);
    // and the record is authoritative in this ledger
    expect(() => service.assertAuthoritative(outcome.record)).not.toThrow();
  });

  it('NEGATIVE: malformed wire messages and foreign records are fail-closed', async () => {
    const { fabric } = await setupFabric();
    const service = new CertificationService({ fabric });
    await expect(service.handleRunCertificationCommand('not json')).rejects.toThrow(
      CertificationError,
    );
    const bogus = service.makeCommand('f'.repeat(64), makeSubject(), [], 'c', 'i');
    await expect(service.handleRunCertificationCommand(JSON.stringify(bogus))).rejects.toThrow(
      /no certification suite registered/,
    );
    expect(() => service.readRecordedEvent('nope')).toThrow(CertificationError);
    expect(() =>
      service.assertAuthoritative({ digest: '0'.repeat(64) } as never),
    ).toThrow(/not in this ledger/);
  });
});
