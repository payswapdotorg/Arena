/**
 * Fabric engine + ledger tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import { CertificationError } from '@arena/certification';
import { createCertificationFabric } from './fabric.js';
import {
  allFailSummary,
  allPassSummary,
  allUnknownSummary,
  conditionalPassSummary,
  digestOf,
  makeScopeRefs,
  makeSuite,
  runOptions,
  T1,
  T2,
  CORR,
  IDEM,
} from './test-support.js';

describe('CertificationFabric.certify — happy path', () => {
  it('produces a content-addressed CertificationRecord (pass path)', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-happy');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    const record = await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions(),
    );
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.suiteRef).toBe(suite.digest);
    expect(record.verdict).toBe('pass');
    expect(record.unknownCause).toBeNull();
    expect(record.constraints).toEqual([]);
    expect(record.statement.statementText).toContain(suite.digest);
  });

  it('produces a conditional-pass record when a pass component declares a constraint', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-cp');
    fabric.registry.registerSuite(suite);
    const summary = await conditionalPassSummary(suite);
    const scope = await makeScopeRefs();
    const record = await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions(),
    );
    expect(record.verdict).toBe('conditional-pass');
    expect(record.constraints.length).toBe(2); // 2 components, each with a constraint
  });

  it('produces a fail record when any component fails', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-fail');
    fabric.registry.registerSuite(suite);
    const summary = await allFailSummary(suite);
    const scope = await makeScopeRefs();
    const record = await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions(),
    );
    expect(record.verdict).toBe('fail');
    expect(record.unknownCause).toBeNull();
  });

  it('produces an unknown record with structured unknown cause when any component is unknown', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-unknown');
    fabric.registry.registerSuite(suite);
    const summary = await allUnknownSummary(suite);
    const scope = await makeScopeRefs();
    const record = await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions(),
    );
    expect(record.verdict).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('unverifiable-component');
  });

  it('idempotent replay returns the stored record (no duplicate in ledger)', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-idem');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    const options = runOptions();
    const first = await fabric.certify(suite.digest, scope.possessionRef, scope, summary, options);
    const second = await fabric.certify(suite.digest, scope.possessionRef, scope, summary, options);
    expect(second.digest).toBe(first.digest);
    expect(fabric.listRecords()).toHaveLength(1);
  });

  it('rejects the same idempotency key with a different command tuple', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-conflict');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    const scope2 = {
      bodyVersionRef: await digestOf(200),
      substrateRef: await digestOf(201),
      environmentRef: await digestOf(202),
      runtimeProfileRef: await digestOf(203),
      possessionRef: await digestOf(204),
    };
    const options = runOptions();
    await fabric.certify(suite.digest, scope.possessionRef, scope, summary, options);
    // Same key, different possession — IDEMPOTENCY_CONFLICT
    await expect(
      fabric.certify(suite.digest, scope2.possessionRef, scope2, summary, options),
    ).rejects.toThrowError(CertificationError);
  });

  it('rejects a suiteRef that does not resolve (NOT_FOUND)', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-not-found');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    await expect(
      fabric.certify(
        '0'.repeat(64),
        scope.possessionRef,
        scope,
        summary,
        runOptions(),
      ),
    ).rejects.toThrowError(CertificationError);
  });

  it('rejects a component-verdict summary not set-equal to the suite declaration (COMPONENT_MISMATCH)', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-mismatch');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    // Drop one entry so the summary is missing a declared ref
    const partial = summary.slice(0, summary.length - 1);
    const scope = await makeScopeRefs();
    await expect(
      fabric.certify(suite.digest, scope.possessionRef, scope, partial as never, runOptions()),
    ).rejects.toThrowError(CertificationError);
  });

  it('rejects an invalid correlation id (lock rule 17)', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-bad-corr');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    await expect(
      fabric.certify(
        suite.digest,
        scope.possessionRef,
        scope,
        summary,
        runOptions({ correlationId: 'bad correlation id with spaces' }),
      ),
    ).rejects.toThrow(); // ProtocolError from toCorrelationId (not CertificationError)
  });
});

describe('CertificationFabric queries (pure projections)', () => {
  it('getRecord returns the stored record by digest', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-get');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    const record = await fabric.certify(suite.digest, scope.possessionRef, scope, summary, runOptions());
    expect(fabric.getRecord(record.digest)?.digest).toBe(record.digest);
    expect(fabric.getRecord('0'.repeat(64))).toBeUndefined();
  });

  it('listRecordsBySuite filters by suite digest', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-by-suite');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    await fabric.certify(suite.digest, scope.possessionRef, scope, summary, runOptions());
    const records = fabric.listRecordsBySuite(suite.digest);
    expect(records).toHaveLength(1);
    expect(records[0]?.suiteRef).toBe(suite.digest);
  });

  it('listRecordsByCorrelation filters by correlation id', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-by-corr');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions({ correlationId: 'corr-unique-1' }),
    );
    const records = fabric.listRecordsByCorrelation('corr-unique-1');
    expect(records).toHaveLength(1);
    expect(records[0]?.correlationId).toBe('corr-unique-1');
  });

  it('listRecordsByVerdict filters by verdict', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-by-verdict');
    fabric.registry.registerSuite(suite);
    const passSummary = await allPassSummary(suite);
    const failSummary = await allFailSummary(suite);
    const scope = await makeScopeRefs();
    await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      passSummary,
      runOptions({ correlationId: 'corr-pass', idempotencyKey: 'idem-pass' }),
    );
    await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      failSummary,
      runOptions({ correlationId: 'corr-fail', idempotencyKey: 'idem-fail' }),
    );
    expect(fabric.listRecordsByVerdict('pass')).toHaveLength(1);
    expect(fabric.listRecordsByVerdict('fail')).toHaveLength(1);
    expect(fabric.listRecordsByVerdict('unknown')).toHaveLength(0);
  });

  it('listRecordsByTimeRange filters by finishedAt', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-time');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions({ startedAt: T1, finishedAt: T2 }),
    );
    const allInRange = fabric.listRecordsByTimeRange({ from: T1, to: T2 });
    expect(allInRange).toHaveLength(1);
    const noneBefore = fabric.listRecordsByTimeRange({ to: T1 });
    expect(noneBefore).toHaveLength(0);
  });

  it('listRecords returns insertion-order records', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-list');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions({ correlationId: 'corr-1', idempotencyKey: 'idem-1' }),
    );
    await fabric.certify(
      suite.digest,
      scope.possessionRef,
      scope,
      summary,
      runOptions({ correlationId: 'corr-2', idempotencyKey: 'idem-2' }),
    );
    expect(fabric.listRecords()).toHaveLength(2);
  });
});

describe('CertificationFabric — adversarial / negative', () => {
  it('rejects a missing correlation id', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-missing-corr');
    fabric.registry.registerSuite(suite);
    const summary = await allPassSummary(suite);
    const scope = await makeScopeRefs();
    await expect(
      fabric.certify(
        suite.digest,
        scope.possessionRef,
        scope,
        summary,
        // @ts-expect-error: deliberate invalid options
        { idempotencyKey: IDEM },
      ),
    ).rejects.toThrowError(CertificationError);
  });

  it('rejects an empty component-verdict summary', async () => {
    const fabric = createCertificationFabric();
    const suite = await makeSuite('suite-fabric-empty-summary');
    fabric.registry.registerSuite(suite);
    const scope = await makeScopeRefs();
    await expect(
      fabric.certify(suite.digest, scope.possessionRef, scope, [], runOptions()),
    ).rejects.toThrowError(CertificationError);
  });
});

// re-export to satisfy unused-import lint
export const _digestOf = digestOf;
export const _CORR = CORR;
export const _IDEM = IDEM;
