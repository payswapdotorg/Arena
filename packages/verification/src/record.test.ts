/**
 * VerificationRecord tests (Work Order A013): construction with DERIVED
 * outcome + unknown cause and COMPUTED input digest, requirement
 * set-equality, evidence-consistency rules, timestamp regression,
 * replayability, tamper detection — and the construction-level
 * score-impossibility negatives.
 */

import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import { VERIFICATION_ERROR_CODES } from './errors.js';
import {
  VERIFICATION_RECORD_FIELDS,
  VERIFICATION_RECORD_PROVENANCE_FIELDS,
  computeVerificationInputDigest,
  createVerificationRecord,
  isVerificationRecord,
  isVerificationRecordView,
  recomputeVerificationRecordDigest,
  replayVerificationRecord,
  verificationRecordView,
} from './record.js';
import { createVerifierDescriptor } from './descriptor.js';
import {
  DIGEST_A,
  T1,
  T2,
  evidenceFor,
  makeArtifact,
  makeDescriptorInput,
  makeRecordInput,
  support,
} from './test-support.js';

async function fixture() {
  const descriptor = await createVerifierDescriptor(makeDescriptorInput());
  const report = await makeArtifact(1);
  const balance = await makeArtifact(2);
  const evidence = [
    evidenceFor(report, 'test-report'),
    evidenceFor(balance, 'balance-proof', 'erp-close-sandbox'),
  ];
  return { descriptor, report, balance, evidence };
}

describe('createVerificationRecord (positive paths)', () => {
  it('derives outcome pass from an all-supported summary and computes the input digest', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const record = await createVerificationRecord(
      makeRecordInput(
        descriptor.digest,
        evidence,
        [
          support('requirement-001', 'present-supported', report.digest),
          support('requirement-002', 'present-supported', balance.digest),
        ],
      ),
      descriptor,
    );
    expect([...VERIFICATION_RECORD_FIELDS]).toEqual([
      'recordVersion',
      'verifierRef',
      'evidence',
      'evidenceSupport',
      'outcome',
      'unknownCause',
      'correlationId',
      'idempotencyKey',
      'inputDigest',
      'startedAt',
      'finishedAt',
      'provenance',
    ]);
    expect([...VERIFICATION_RECORD_PROVENANCE_FIELDS]).toEqual([
      'executedBy',
      'recordedAt',
      'notes',
    ]);
    expect(record.outcome).toBe('pass');
    expect(record.unknownCause).toBe(null);
    expect(record.correlationId).toBe('corr-verification-0001');
    expect(record.idempotencyKey).toBe('idem-verification-0001');
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(isVerificationRecord(record)).toBe(true);
    expect(isVerificationRecordView(verificationRecordView(record))).toBe(true);
    // the input digest commits to verifier + evidence
    const expectedInputDigest = await computeVerificationInputDigest(
      descriptor.digest,
      record.evidence as never,
    );
    expect(record.inputDigest).toBe(expectedInputDigest);
  });

  it('derives fail when verified evidence does not support', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const record = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [
        support('requirement-001', 'present-supported', report.digest),
        support('requirement-002', 'present-unsupported', balance.digest, 'the netted total diverges'),
      ]),
      descriptor,
    );
    expect(record.outcome).toBe('fail');
    expect(record.unknownCause).toBe(null);
  });

  it('derives unknown + structured cause for every unknown class', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const missing = await createVerificationRecord(
      makeRecordInput(descriptor.digest, [evidence[0]!], [
        support('requirement-001', 'present-supported', report.digest),
        support('requirement-002', 'missing'),
      ]),
      descriptor,
    );
    expect(missing.outcome).toBe('unknown');
    expect(missing.unknownCause?.reason).toBe('missing-evidence');
    expect(missing.unknownCause?.detail).toContain('requirement-002');

    const unverified = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [
        support('requirement-001', 'present-unverified', report.digest, 'digest-mismatch: tampered'),
        support('requirement-002', 'present-supported', balance.digest),
      ]),
      descriptor,
    );
    expect(unverified.outcome).toBe('unknown');
    expect(unverified.unknownCause?.reason).toBe('unverifiable-provenance');

    const indeterminate = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [
        support('requirement-001', 'present-indeterminate', report.digest, 'inconclusive run'),
        support('requirement-002', 'present-supported', balance.digest),
      ]),
      descriptor,
    );
    expect(indeterminate.outcome).toBe('unknown');
    expect(indeterminate.unknownCause?.reason).toBe('method-limitation');
  });

  it('construction is pure: identical inputs ⇒ identical digest', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const input = makeRecordInput(descriptor.digest, evidence, [
      support('requirement-001', 'present-supported', report.digest),
      support('requirement-002', 'present-supported', balance.digest),
    ]);
    const a = await createVerificationRecord(input, descriptor);
    const b = await createVerificationRecord(input, descriptor);
    expect(a.digest).toBe(b.digest);
  });

  it('support order is canonicalized to descriptor order (digest stability)', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const ordered = [
      support('requirement-001', 'present-supported', report.digest),
      support('requirement-002', 'present-supported', balance.digest),
    ];
    const a = await createVerificationRecord(makeRecordInput(descriptor.digest, evidence, ordered), descriptor);
    const b = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [ordered[1]!, ordered[0]!]),
      descriptor,
    );
    expect(b.digest).toBe(a.digest);
    expect(b.evidenceSupport[0]?.requirementId).toBe('requirement-001');
  });

  it('replayVerificationRecord reconstructs byte-identically', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const record = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [
        support('requirement-001', 'present-unsupported', report.digest),
        support('requirement-002', 'present-supported', balance.digest),
      ]),
      descriptor,
    );
    const replayed = await replayVerificationRecord(record, descriptor);
    expect(replayed.digest).toBe(record.digest);
    expect(replayed.outcome).toBe('fail');
  });

  it('recomputeVerificationRecordDigest passes on honest records', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const record = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [
        support('requirement-001', 'present-supported', report.digest),
        support('requirement-002', 'present-supported', balance.digest),
      ]),
      descriptor,
    );
    await expect(recomputeVerificationRecordDigest(record)).resolves.toBe(record.digest);
  });
});

describe('record negative gates (adversarial)', () => {
  it('verifierRef must bind the exact descriptor (EVIDENCE_MISMATCH)', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    await expect(
      createVerificationRecord(
        makeRecordInput(DIGEST_A, evidence, [
          support('requirement-001', 'present-supported', report.digest),
          support('requirement-002', 'present-supported', balance.digest),
        ]),
        descriptor,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.EVIDENCE_MISMATCH }),
    );
  });

  it('the support summary must cover EXACTLY the declared requirements', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    // missing one declared requirement
    await expect(
      createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, [
          support('requirement-001', 'present-supported', report.digest),
        ]),
        descriptor,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.REQUIREMENT_MISMATCH }),
    );
    // speaking for an undeclared requirement
    await expect(
      createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, [
          support('requirement-001', 'present-supported', report.digest),
          support('requirement-002', 'present-supported', balance.digest),
          support('requirement-999', 'present-supported', report.digest),
        ]),
        descriptor,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.REQUIREMENT_MISMATCH }),
    );
  });

  it('missing statuses cannot name evidence; present statuses MUST', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    await expect(
      createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, [
          support('requirement-001', 'missing', report.digest), // missing but names evidence — rejected
          support('requirement-002', 'present-supported', balance.digest),
        ]),
        descriptor,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
    await expect(
      createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, [
          support('requirement-001', 'present-supported', null), // present without evidence — rejected
          support('requirement-002', 'present-supported', balance.digest),
        ]),
        descriptor,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_EVIDENCE }),
    );
  });

  it('a present status cannot name evidence outside the bundle', async () => {
    const { descriptor, balance, evidence } = await fixture();
    await expect(
      createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, [
          support('requirement-001', 'present-supported', DIGEST_A), // not in the bundle
          support('requirement-002', 'present-supported', balance.digest),
        ]),
        descriptor,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.EVIDENCE_MISMATCH }),
    );
  });

  it('timestamp regression is rejected', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    await expect(
      createVerificationRecord(
        makeRecordInput(
          descriptor.digest,
          evidence,
          [
            support('requirement-001', 'present-supported', report.digest),
            support('requirement-002', 'present-supported', balance.digest),
          ],
          { startedAt: T2, finishedAt: T1 },
        ),
        descriptor,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.TIMESTAMP_REGRESSION }),
    );
  });

  it('correlation id and idempotency key are REQUIRED and validated', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const supports = [
      support('requirement-001', 'present-supported', report.digest),
      support('requirement-002', 'present-supported', balance.digest),
    ];
    await expect(
      createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, supports, { correlationId: 'not valid!' }),
        descriptor,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_IDENTITY }));
    await expect(
      createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, supports, { idempotencyKey: '' }),
        descriptor,
      ),
    ).rejects.toThrowError(expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_IDENTITY }));
  });

  it('tamper detection: view-level and input-level mutations both fail closed', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const record = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [
        support('requirement-001', 'present-supported', report.digest),
        support('requirement-002', 'present-supported', balance.digest),
      ]),
      descriptor,
    );
    // view-level tamper (outcome flipped, digest unchanged): caught by
    // digest recomputation over the view.
    const viewTampered = { ...record, outcome: 'fail' } as typeof record;
    await expect(recomputeVerificationRecordDigest(viewTampered)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.TAMPERED }),
    );
    // input-level tamper (a support note rewritten, digest unchanged):
    // caught by BOTH recomputation and pure replay reconstruction.
    const inputTampered = {
      ...record,
      evidenceSupport: record.evidenceSupport.map((entry, index) =>
        index === 0 ? { ...entry, notes: 'rewritten note' } : entry,
      ),
    } as typeof record;
    await expect(recomputeVerificationRecordDigest(inputTampered)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.TAMPERED }),
    );
    await expect(replayVerificationRecord(inputTampered, descriptor)).rejects.toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.TAMPERED }),
    );
  });

  it('unknown record fields are rejected (strict shape)', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const input = makeRecordInput(descriptor.digest, evidence, [
      support('requirement-001', 'present-supported', report.digest),
      support('requirement-002', 'present-supported', balance.digest),
    ]) as unknown as Record<string, unknown>;
    input['aggregate'] = { score: 0.9 }; // the OTHER protocol's field — must not sneak in
    await expect(createVerificationRecord(input as never, descriptor)).rejects.toThrowError(
      /unknown field 'aggregate'/,
    );
  });
});

describe('score-impossibility at the record level (lock rule 7 regression proof)', () => {
  it('the canonical record form contains NO numeric field except recordVersion', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    const record = await createVerificationRecord(
      makeRecordInput(descriptor.digest, evidence, [
        support('requirement-001', 'present-supported', report.digest),
        support('requirement-002', 'present-unsupported', balance.digest),
      ]),
      descriptor,
    );
    const numericFields: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'number') {
        numericFields.push(`${path}=${String(value)}`);
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      }
    };
    walk(verificationRecordView(record), 'record');
    expect(numericFields).toEqual(['record.recordVersion=1']);
  });

  it('the outcome is DERIVED, never accepted: a caller cannot inject any outcome', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    // The CreateVerificationRecordInput type has NO outcome field; supplying
    // one anyway is an unknown-field rejection (strict shape).
    const input = makeRecordInput(descriptor.digest, evidence, [
      support('requirement-001', 'present-supported', report.digest),
      support('requirement-002', 'present-supported', balance.digest),
    ]) as unknown as Record<string, unknown>;
    input['outcome'] = 'excellent';
    await expect(createVerificationRecord(input as never, descriptor)).rejects.toThrowError(
      /unknown field 'outcome'/,
    );
    input['outcome'] = 0.87;
    await expect(createVerificationRecord(input as never, descriptor)).rejects.toThrowError(
      /unknown field 'outcome'/,
    );
  });

  it('the canonical JSON of a record carries only the closed outcome vocabulary', async () => {
    const { descriptor, report, balance, evidence } = await fixture();
    for (const status of ['present-supported', 'present-unsupported'] as const) {
      const record = await createVerificationRecord(
        makeRecordInput(descriptor.digest, evidence, [
          support('requirement-001', status, report.digest),
          support('requirement-002', 'present-supported', balance.digest),
        ]),
        descriptor,
      );
      const canonical = canonicalJson(record);
      expect(canonical).toContain(`"outcome":"${record.outcome}"`);
      expect(['pass', 'fail', 'unknown']).toContain(record.outcome);
      expect(canonical).not.toMatch(/"score"/);
      expect(canonical).not.toMatch(/"rating"/);
      expect(canonical).not.toMatch(/"grade"/);
    }
  });
});

describe('computeVerificationInputDigest (reproducibility anchor)', () => {
  it('commits to verifier + evidence: any evidence change changes the digest', async () => {
    const { descriptor, balance, evidence } = await fixture();
    const a = await computeVerificationInputDigest(descriptor.digest, evidence as never);
    const b = await computeVerificationInputDigest(descriptor.digest, evidence as never);
    expect(a).toBe(b);
    const changedEvidence = [
      evidence[0],
      evidenceFor(balance, 'balance-proof', 'different-producer'),
    ];
    const c = await computeVerificationInputDigest(descriptor.digest, changedEvidence as never);
    expect(c).not.toBe(a);
    const d = await computeVerificationInputDigest(DIGEST_A, evidence as never);
    expect(d).not.toBe(a);
  });
});
