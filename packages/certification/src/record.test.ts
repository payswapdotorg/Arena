/**
 * Certification record tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import { CertificationError } from './errors.js';
import {
  CERTIFICATION_RECORD_FIELDS,
  CERTIFICATION_RECORD_PROVENANCE_FIELDS,
  CERTIFICATION_RECORD_VERSION,
  certificationRecordView,
  computeCertificationInputDigest,
  createCertificationRecord,
  isCertificationRecord,
  isCertificationRecordView,
  recomputeCertificationRecordDigest,
  replayCertificationRecord,
} from './record.js';
import { createCertificationSuite } from './suite.js';
import {
  allFailSummary,
  allPassSummary,
  allUnknownSummary,
  conditionalPassSummary,
  digestOf,
  makeRecordInput,
  makeSuiteInput,
  makeThreeComponentSuiteInput,
  T1,
  T2,
} from './test-support.js';

describe('record — happy path', () => {
  it('builds a content-addressed record with a sha256 digest', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.recordVersion).toBe(CERTIFICATION_RECORD_VERSION);
    expect(record.suiteRef).toBe(suite.digest);
    expect(record.verdict).toBe('pass');
    expect(record.unknownCause).toBeNull();
    expect(record.constraints).toEqual([]);
  });

  it('identical inputs produce identical digests (content-addressed determinism)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const a = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    const b = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(a.digest).toBe(b.digest);
  });

  it('the record is deep-frozen at creation', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.statement)).toBe(true);
    expect(Object.isFrozen(record.componentVerdicts[0])).toBe(true);
    expect(Object.isFrozen(record.provenance)).toBe(true);
  });

  it('recomputeCertificationRecordDigest returns the same digest', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    const recomputed = await recomputeCertificationRecordDigest(record);
    expect(recomputed).toBe(record.digest);
  });

  it('replayCertificationRecord rebuilds a byte-identical record', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    const replayed = await replayCertificationRecord(record, suite);
    expect(replayed.digest).toBe(record.digest);
  });

  it('the statement is DERIVED from the record (never caller-supplied)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(record.statement.verdict).toBe(record.verdict);
    expect(record.statement.suiteRef).toBe(record.suiteRef);
    expect(record.statement.suiteRevision).toBe(suite.digest);
    expect(record.statement.bodyVersionRef).toBe(record.bodyVersionRef);
    expect(record.statement.substrateRef).toBe(record.substrateRef);
    expect(record.statement.environmentRef).toBe(record.environmentRef);
    expect(record.statement.runtimeProfileRef).toBe(record.runtimeProfileRef);
  });

  it('the component summary is canonicalized to suite declaration order (digest stability)', async () => {
    const suite = await createCertificationSuite(await makeThreeComponentSuiteInput());
    const summary = await allPassSummary(suite);
    // Reverse the order before submission — the record should canonicalize it.
    const reversed = [...summary].reverse();
    const record = await createCertificationRecord(
      await makeRecordInput(suite, reversed as never),
      suite,
    );
    // Canonicalized order: evaluation, verification, compatibility (suite order)
    expect(record.componentVerdicts[0]?.refKind).toBe('evaluation');
    expect(record.componentVerdicts[1]?.refKind).toBe('verification');
    expect(record.componentVerdicts[2]?.refKind).toBe('compatibility');
  });

  it('the record view fields mirror the contract field list', () => {
    expect([...CERTIFICATION_RECORD_FIELDS]).toEqual([
      'recordVersion',
      'suiteRef',
      'possessionRef',
      'bodyVersionRef',
      'substrateRef',
      'environmentRef',
      'runtimeProfileRef',
      'componentVerdicts',
      'verdict',
      'unknownCause',
      'constraints',
      'statement',
      'correlationId',
      'idempotencyKey',
      'inputDigest',
      'startedAt',
      'finishedAt',
      'provenance',
    ]);
  });

  it('the provenance field list mirrors the contract', () => {
    expect([...CERTIFICATION_RECORD_PROVENANCE_FIELDS]).toEqual([
      'executedBy',
      'recordedAt',
      'notes',
    ]);
  });

  it('certificationRecordView strips the digest', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    const view = certificationRecordView(record);
    expect(Object.keys(view).sort()).toEqual(
      [...CERTIFICATION_RECORD_FIELDS].sort(),
    );
  });
});

describe('record — verdict derivation (the pure heart)', () => {
  it('all pass + no constraints ⇒ pass', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(record.verdict).toBe('pass');
    expect(record.constraints).toEqual([]);
  });

  it('all pass + at least one constraint ⇒ conditional-pass + carries the constraints', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await conditionalPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(record.verdict).toBe('conditional-pass');
    expect(record.constraints.length).toBe(2); // one per component, suite has 2 refs
    expect(record.statement.verdict).toBe('conditional-pass');
    expect(record.statement.constraints).toEqual([...record.constraints]);
  });

  it('any component fail ⇒ fail', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allFailSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(record.verdict).toBe('fail');
    expect(record.unknownCause).toBeNull();
    expect(record.constraints).toEqual([]);
  });

  it('any component unknown ⇒ unknown / unverifiable-component', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allUnknownSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    expect(record.verdict).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('unverifiable-component');
    expect(record.unknownCause?.detail).toContain('unverifiable-component');
  });

  it('the verdict is derived — the record input has NO verdict field', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = await makeRecordInput(suite, summary);
    // The input never carries a verdict field — the verdict is DERIVED.
    expect('verdict' in input).toBe(false);
    const record = await createCertificationRecord(input, suite);
    expect(record.verdict).toBe('pass');
  });
});

describe('record — adversarial / negative (fail-closed)', () => {
  it('rejects a suiteRef that does not match the descriptor digest (scope violation)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = await makeRecordInput(suite, summary);
    (input as { suiteRef: string }).suiteRef = '0'.repeat(64); // bogus
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects a malformed possessionRef', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = await makeRecordInput(suite, summary);
    (input as { possessionRef: string }).possessionRef = 'bad';
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects a malformed body/substrate/environment/runtime-profile ref', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = await makeRecordInput(suite, summary);
    (input as { bodyVersionRef: string }).bodyVersionRef = 'bad';
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects a component summary that does not match the suite declaration (missing ref)', async () => {
    const suite = await createCertificationSuite(await makeThreeComponentSuiteInput());
    // Build a summary missing the compatibility ref.
    const summary = (await allPassSummary(suite)).filter(
      (entry) => entry.refKind !== 'compatibility',
    );
    const input = await makeRecordInput(suite, summary as never);
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects a component summary that speaks for an undeclared ref', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    // Inject an extra entry that's not in the suite declaration.
    (summary as unknown as Array<{ refKind: string; refDigest: string; verdict: string; constraints: readonly string[]; notes: string | null }>).push({
      refKind: 'compatibility', // suite doesn't declare compatibility
      refDigest: await digestOf(99),
      verdict: 'pass',
      constraints: [],
      notes: null,
    });
    const input = await makeRecordInput(suite, summary as never);
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects finishedAt preceding startedAt', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = await makeRecordInput(suite, summary, {
      startedAt: T2,
      finishedAt: T1,
    });
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects a malformed correlation id', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = await makeRecordInput(suite, summary, {
      correlationId: 'bad correlation id with spaces',
    });
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects a malformed idempotency key', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = await makeRecordInput(suite, summary, {
      idempotencyKey: 'bad idem key with spaces',
    });
    await expect(createCertificationRecord(input, suite)).rejects.toThrowError(
      CertificationError,
    );
  });

  it('rejects an unknown field in the input (strict shape)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const input = (await makeRecordInput(suite, summary)) as unknown as Record<string, unknown>;
    input['rogueField'] = 'no';
    await expect(createCertificationRecord(input as never, suite)).rejects.toThrowError(
      CertificationError,
    );
  });
});

describe('record — structural guards', () => {
  it('isCertificationRecordView rejects non-objects', async () => {
    expect(isCertificationRecordView(null)).toBe(false);
    expect(isCertificationRecordView('bad')).toBe(false);
    expect(isCertificationRecordView({})).toBe(false);
  });
  it('isCertificationRecord rejects view-only objects (no digest)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(await makeRecordInput(suite, summary), suite);
    const view = certificationRecordView(record);
    expect(isCertificationRecord(view)).toBe(false);
    expect(isCertificationRecord(record)).toBe(true);
  });
});

describe('computeCertificationInputDigest (the reproducibility anchor)', () => {
  it('returns a sha256-hex digest over the canonical inputs', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const digest = await computeCertificationInputDigest(suite.digest, await digestOf(104), summary);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes when the evidence changes (digest stability property)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const d1 = await computeCertificationInputDigest(suite.digest, await digestOf(104), summary);
    const d2 = await computeCertificationInputDigest(suite.digest, await digestOf(105), summary);
    expect(d1).not.toBe(d2);
  });
});

// re-export references for the parity test references
export { suiteComponentRefs } from './suite.js';
export { T1, T2 } from './test-support.js';
