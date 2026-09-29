/**
 * VerificationFabric tests (Work Order A013): the full runner pipeline
 * (resolve → validate → hook → merge → derive → record) over REAL A002
 * artifacts, idempotent replay/conflict, negative probes (unknown
 * verifier, tampered evidence, missing evidence, illegal hook
 * verdicts), the artifact store and the pure query projections.
 */

import { describe, expect, it } from 'vitest';
import { createMaterialArtifact } from '@arena/artifact-protocol';
import type { MaterialArtifact } from '@arena/artifact-protocol';
import { VERIFICATION_ERROR_CODES, verificationRecordView } from '@arena/verification';
import { createVerifierDescriptor } from '@arena/verification';
import { VerificationFabric, createVerificationFabric } from './fabric.js';
import { makeConstraintCheckVerifier, makeEvidenceProvenanceValidationVerifier } from './verifiers.js';
import type { RequirementVerdictInput } from './verifiers.js';
import {
  CORR,
  IDEM,
  T1,
  T2,
  T3,
  evidenceInput,
  makeBalanceProof,
  makeConstraintDescriptorInput,
  makeConstraintReport,
  runOptions,
} from './test-support.js';

async function wiredFabric() {
  const fabric = createVerificationFabric();
  const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
  fabric.registry.registerVerifier(descriptor, makeConstraintCheckVerifier());
  const report = await makeConstraintReport(1, [
    { requirementId: 'requirement-001', satisfied: true, detail: 'suite 12/12 green' },
  ]);
  const source = await makeBalanceProof(80, undefined, { export: 'erp-close-2026-02' });
  const balance = await makeBalanceProof(2, source, {
    netted: 1180.4,
    expected: 1180.4,
    constraints: [
      { requirementId: 'requirement-002', satisfied: true, detail: 'netted total matches the ERP expected balance' },
    ],
  });
  fabric.putArtifact(report);
  fabric.putArtifact(source);
  fabric.putArtifact(balance);
  const evidence = [
    evidenceInput(report, 'test-report'),
    evidenceInput(balance, 'balance-proof', 'erp-close-sandbox'),
  ];
  return { fabric, descriptor, report, source, balance, evidence };
}

describe('VerificationFabric.verify (the runner pipeline)', () => {
  it('full happy path: all constraints satisfied ⇒ outcome pass', async () => {
    const { fabric, descriptor, evidence } = await wiredFabric();
    const record = await fabric.verify(descriptor.digest, evidence, runOptions());
    expect(record.outcome).toBe('pass');
    expect(record.unknownCause).toBe(null);
    expect(record.verifierRef).toBe(descriptor.digest);
    expect(record.correlationId).toBe(CORR);
    expect(record.idempotencyKey).toBe(IDEM);
    expect(record.evidenceSupport).toHaveLength(2);
    expect(record.evidenceSupport[0]?.status).toBe('present-supported');
    expect(record.evidenceSupport[0]?.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.provenance.executedBy).toBe(descriptor.verifierId);
    expect(Object.isFrozen(record)).toBe(true);
    expect(fabric.getRecord(record.digest)?.digest).toBe(record.digest);
  });

  it('a contradicted constraint ⇒ outcome fail with the unsupported requirement named', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    fabric.registry.registerVerifier(descriptor, makeConstraintCheckVerifier());
    const report = await makeConstraintReport(3, [
      { requirementId: 'requirement-001', satisfied: false, detail: 'suite 11/12, one regression' },
    ]);
    const balance = await makeBalanceProof(4, undefined, {
      constraints: [{ requirementId: 'requirement-002', satisfied: true }],
    });
    fabric.putArtifact(report);
    fabric.putArtifact(balance);
    const record = await fabric.verify(
      descriptor.digest,
      [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
      runOptions(),
    );
    expect(record.outcome).toBe('fail');
    expect(record.evidenceSupport[0]?.status).toBe('present-unsupported');
    expect(record.evidenceSupport[0]?.notes).toContain('regression');
  });

  it('missing evidence ⇒ outcome unknown with cause missing-evidence (never fail-by-default)', async () => {
    const { fabric, descriptor, report } = await wiredFabric();
    const record = await fabric.verify(
      descriptor.digest,
      [evidenceInput(report, 'test-report')], // balance-proof absent
      runOptions(),
    );
    expect(record.outcome).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('missing-evidence');
    expect(record.unknownCause?.detail).toContain('requirement-002');
    expect(record.evidenceSupport[1]?.status).toBe('missing');
    expect(record.evidenceSupport[1]?.evidenceDigest).toBe(null);
  });

  it('TAMPERED evidence ⇒ present-unverified ⇒ outcome unknown / unverifiable-provenance (adversarial)', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    fabric.registry.registerVerifier(descriptor, makeConstraintCheckVerifier());
    const report = await makeConstraintReport(5, [{ requirementId: 'requirement-001', satisfied: true }]);
    const balance = await makeBalanceProof(6);
    // Tamper the stored artifact AFTER digest computation.
    const tampered = {
      ...report,
      content: { constraints: [{ requirementId: 'requirement-001', satisfied: true, detail: 'FORGED' }] },
    } as MaterialArtifact<unknown>;
    fabric.putArtifact(tampered);
    fabric.putArtifact(balance);
    const record = await fabric.verify(
      descriptor.digest,
      [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
      runOptions(),
    );
    expect(record.evidenceSupport[0]?.status).toBe('present-unverified');
    expect(record.evidenceSupport[0]?.notes).toContain('digest-mismatch');
    expect(record.outcome).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('unverifiable-provenance');
  });

  it('declared-but-unstored evidence ⇒ missing (dangling refs establish nothing)', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    fabric.registry.registerVerifier(descriptor, makeConstraintCheckVerifier());
    const report = await makeConstraintReport(7, [{ requirementId: 'requirement-001', satisfied: true }]);
    // NOT stored: fabric.putArtifact(report) deliberately omitted
    const balance = await makeBalanceProof(8);
    fabric.putArtifact(balance);
    const record = await fabric.verify(
      descriptor.digest,
      [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
      runOptions(),
    );
    expect(record.evidenceSupport[0]?.status).toBe('missing');
    expect(record.evidenceSupport[0]?.notes).toContain('unresolvable');
    expect(record.outcome).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('missing-evidence');
  });

  it('broken lineage ⇒ present-unverified (provenance-chain-broken)', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    fabric.registry.registerVerifier(descriptor, makeConstraintCheckVerifier());
    const report = await makeConstraintReport(9, [{ requirementId: 'requirement-001', satisfied: true }]);
    const missingSource = await makeBalanceProof(81, undefined, { export: 'dangling' });
    const balance = await makeBalanceProof(10, missingSource);
    fabric.putArtifact(report);
    fabric.putArtifact(balance);
    // missingSource NOT stored: the lineage ref dangles
    const record = await fabric.verify(
      descriptor.digest,
      [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
      runOptions(),
    );
    expect(record.evidenceSupport[1]?.status).toBe('present-unverified');
    expect(record.evidenceSupport[1]?.notes).toContain('provenance-chain-broken');
    expect(record.outcome).toBe('unknown');
  });

  it('the provenance-validation verifier produces method-limitation unknowns for lineage-free evidence', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(
      makeConstraintDescriptorInput({ verifierId: 'verifier-provenance-0002', method: 'evidence_provenance_validation' }),
    );
    fabric.registry.registerVerifier(descriptor, makeEvidenceProvenanceValidationVerifier());
    const report = await makeBalanceProof(11, undefined); // lineage-free "test report"
    const source = await makeBalanceProof(82, undefined, { export: 'erp' });
    const balance = await makeBalanceProof(12, source);
    fabric.putArtifact(report);
    fabric.putArtifact(source);
    fabric.putArtifact(balance);
    const record = await fabric.verify(
      descriptor.digest,
      [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
      runOptions(),
    );
    expect(record.evidenceSupport[0]?.status).toBe('present-indeterminate');
    expect(record.evidenceSupport[1]?.status).toBe('present-supported');
    expect(record.outcome).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('method-limitation');
  });

  it('illegal hook verdicts are rejected with INVALID_OUTCOME (closed vocabulary)', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    fabric.registry.registerVerifier(descriptor, () => [
      { requirementId: 'requirement-001', verdict: 'excellent', notes: null },
    ]);
    const report = await makeConstraintReport(13, [{ requirementId: 'requirement-001', satisfied: true }]);
    const balance = await makeBalanceProof(14);
    fabric.putArtifact(report);
    fabric.putArtifact(balance);
    await expect(
      fabric.verify(
        descriptor.digest,
        [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
        runOptions(),
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_OUTCOME }),
    );
  });

  it('a hook emitting a NUMERIC member is rejected by construction (lock rule 7 regression)', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    const rogueHook = (): RequirementVerdictInput[] => {
      const rogue = {
        requirementId: 'requirement-001',
        verdict: 'supported',
        notes: null,
        score: 0.87, // quantitative member — must be rejected
      } as unknown as RequirementVerdictInput;
      return [rogue];
    };
    fabric.registry.registerVerifier(descriptor, rogueHook);
    const report = await makeConstraintReport(15, [{ requirementId: 'requirement-001', satisfied: true }]);
    const balance = await makeBalanceProof(16);
    fabric.putArtifact(report);
    fabric.putArtifact(balance);
    await expect(
      fabric.verify(
        descriptor.digest,
        [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
        runOptions(),
      ),
    ).rejects.toThrowError(/unknown field 'score'/);
  });

  it('a hook that skips a verified requirement yields method-limitation (recorded, never guessed)', async () => {
    const fabric = createVerificationFabric();
    const descriptor = await createVerifierDescriptor(makeConstraintDescriptorInput());
    fabric.registry.registerVerifier(descriptor, () => []); // speaks for nothing
    const report = await makeConstraintReport(17, [{ requirementId: 'requirement-001', satisfied: true }]);
    const balance = await makeBalanceProof(18);
    fabric.putArtifact(report);
    fabric.putArtifact(balance);
    const record = await fabric.verify(
      descriptor.digest,
      [evidenceInput(report, 'test-report'), evidenceInput(balance, 'balance-proof', 'erp-close-sandbox')],
      runOptions(),
    );
    expect(record.outcome).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('method-limitation');
    expect(record.evidenceSupport.every((entry) => entry.status === 'present-indeterminate')).toBe(true);
  });

  it('unknown verifier digest ⇒ NOT_FOUND (fail loud)', async () => {
    const { fabric, evidence } = await wiredFabric();
    await expect(fabric.verify('0'.repeat(64), evidence, runOptions())).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.NOT_FOUND }),
    );
  });

  it('malformed evidence bundles are rejected before any run', async () => {
    const { fabric, descriptor } = await wiredFabric();
    await expect(fabric.verify(descriptor.digest, [], runOptions())).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
    await expect(
      fabric.verify(descriptor.digest, ['nope' as never], runOptions()),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
  });
});

describe('idempotency (lock rule 17)', () => {
  it('same key + same command replays the stored record (no new ledger entry)', async () => {
    const { fabric, descriptor, evidence } = await wiredFabric();
    const first = await fabric.verify(descriptor.digest, evidence, runOptions());
    const replayed = await fabric.verify(descriptor.digest, evidence, runOptions());
    expect(replayed.digest).toBe(first.digest);
    expect(fabric.listRecords()).toHaveLength(1);
  });

  it('same key + DIFFERENT command is an idempotency conflict', async () => {
    const { fabric, descriptor, report, evidence } = await wiredFabric();
    await fabric.verify(descriptor.digest, evidence, runOptions());
    await expect(
      fabric.verify(descriptor.digest, [evidenceInput(report, 'test-report')], runOptions()),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.IDEMPOTENCY_CONFLICT }),
    );
  });

  it('different keys record distinct ledger entries', async () => {
    const { fabric, descriptor, evidence } = await wiredFabric();
    await fabric.verify(descriptor.digest, evidence, runOptions());
    const second = await fabric.verify(
      descriptor.digest,
      evidence,
      runOptions({ correlationId: 'corr-fabric-0002', idempotencyKey: 'idem-fabric-0002' }),
    );
    expect(second.correlationId).toBe('corr-fabric-0002');
    expect(fabric.listRecords()).toHaveLength(2);
    expect(fabric.listRecordsByCorrelation(CORR)).toHaveLength(1);
    expect(fabric.listRecordsByCorrelation('corr-fabric-0002')).toHaveLength(1);
  });
});

describe('determinism of the runner', () => {
  it('same verifier + same evidence + fixed timestamps ⇒ identical record digest', async () => {
    const a = await wiredFabric();
    const b = await wiredFabric();
    const first = await a.fabric.verify(a.descriptor.digest, a.evidence, runOptions());
    const second = await b.fabric.verify(b.descriptor.digest, b.evidence, runOptions());
    expect(second.digest).toBe(first.digest);
    expect(second.outcome).toBe('pass');
  });
});

describe('the artifact store', () => {
  it('puts and gets REAL A002 artifacts; rejects non-artifacts', async () => {
    const fabric = new VerificationFabric();
    const artifact = await createMaterialArtifact({
      identity: { namespace: 'tenant-a', name: 'plain-artifact', version: '1.0.0' },
      content: { x: 1 },
    });
    fabric.putArtifact(artifact);
    expect(fabric.getArtifact(artifact.digest)?.digest).toBe(artifact.digest);
    expect(fabric.listArtifacts()).toHaveLength(1);
    expect(() => fabric.putArtifact({ digest: 'x' } as never)).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
  });
});

describe('queries (pure projections)', () => {
  it('by verifier, by correlation, by outcome, by time range', async () => {
    const { fabric, descriptor, evidence } = await wiredFabric();
    const failingDescriptor = await createVerifierDescriptor(
      makeConstraintDescriptorInput({ verifierId: 'verifier-constraint-fail' }),
    );
    fabric.registry.registerVerifier(failingDescriptor, makeConstraintCheckVerifier());
    const badReport = await makeConstraintReport(30, [{ requirementId: 'requirement-001', satisfied: false }]);
    const balance2 = await makeBalanceProof(31, undefined, {
      constraints: [{ requirementId: 'requirement-002', satisfied: true }],
    });
    fabric.putArtifact(badReport);
    fabric.putArtifact(balance2);
    await fabric.verify(descriptor.digest, evidence, runOptions()); // pass @ T2
    const failRecord = await fabric.verify(
      failingDescriptor.digest,
      [evidenceInput(badReport, 'test-report'), evidenceInput(balance2, 'balance-proof', 'erp-close-sandbox')],
      runOptions({ correlationId: 'corr-fabric-0003', idempotencyKey: 'idem-fabric-0003', finishedAt: T3 }),
    ); // fail @ T3
    expect(failRecord.outcome).toBe('fail');

    expect(fabric.listRecordsByVerifier(descriptor.digest)).toHaveLength(1);
    expect(fabric.listRecordsByVerifier(failingDescriptor.digest)).toHaveLength(1);
    expect(fabric.listRecordsByOutcome('pass')).toHaveLength(1);
    expect(fabric.listRecordsByOutcome('fail')).toHaveLength(1);
    expect(fabric.listRecordsByOutcome('unknown')).toHaveLength(0);
    expect(fabric.listRecordsByTimeRange({ from: T1, to: T2 })).toHaveLength(1);
    expect(fabric.listRecordsByTimeRange({ from: T1, to: T3 })).toHaveLength(2);
    expect(fabric.listRecordsByTimeRange({})).toHaveLength(2);
    expect(() => fabric.listRecordsByTimeRange({ from: 'not-a-time' })).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP }),
    );
    expect(fabric.listRecords()).toHaveLength(2);
  });

  it('the full ledger dump carries the evidence-outcome vocabulary only', async () => {
    const { fabric, evidence, descriptor } = await wiredFabric();
    await fabric.verify(descriptor.digest, evidence, runOptions());
    for (const record of fabric.listRecords()) {
      const view = verificationRecordView(record);
      expect(['pass', 'fail', 'unknown']).toContain(view.outcome);
      expect('aggregate' in view).toBe(false);
      expect('score' in view).toBe(false);
    }
  });
});
