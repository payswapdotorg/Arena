/**
 * Deterministic protocol-fixture tests (Work Order B012; issue #87).
 *
 * The demo corpus is built EXCLUSIVELY through the PUBLIC APIs of the
 * sibling protocol packages — these tests pin:
 *   - DETERMINISM: two constructions yield byte-identical objects
 *     (identical digests, identical corpus hash);
 *   - PROTOCOL VALIDITY: every fixture is a structurally valid A012/
 *     A013/A023 object with the DERIVED fields computed by the package
 *     (aggregate, outcome, verdict, granted level, statement);
 *   - the truth POSTURES the corpus demonstrates (superseded/revoked/
 *     active certification lineage).
 */

import { describe, expect, it } from 'vitest';

import { isEvaluationRecord } from '../../../../packages/evaluation/src/index.js';
import { isVerificationRecord } from '../../../../packages/verification/src/index.js';
import { isCertificationRecord } from '../../../../packages/certification/src/index.js';
import { buildEvaluationDemoCorpus, certificationPosture } from './fixtures.js';

describe('evaluation demo corpus determinism (positive)', () => {
  it('two constructions yield identical protocol digests and corpus hash', async () => {
    const one = await buildEvaluationDemoCorpus();
    const two = await buildEvaluationDemoCorpus();
    expect(one.criteria.digest).toBe(two.criteria.digest);
    expect(one.evaluator.digest).toBe(two.evaluator.digest);
    expect(one.evaluationRecord.digest).toBe(two.evaluationRecord.digest);
    expect(one.verifier.digest).toBe(two.verifier.digest);
    expect(one.verificationRecord.digest).toBe(two.verificationRecord.digest);
    expect(one.suite.digest).toBe(two.suite.digest);
    expect(one.certificationRunA.digest).toBe(two.certificationRunA.digest);
    expect(one.certificationRunB.digest).toBe(two.certificationRunB.digest);
    expect(one.revocation.digest).toBe(two.revocation.digest);
    expect(one.corpusHash).toBe(two.corpusHash);
  });

  it('carries no wall-clock drift: all timestamps are the fixed narrative constants', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const stamps = [
      corpus.evaluationRecord.startedAt,
      corpus.evaluationRecord.finishedAt,
      corpus.verificationRecord.startedAt,
      corpus.certificationRunA.startedAt,
      corpus.certificationRunB.finishedAt,
      corpus.revocation.finishedAt,
    ];
    for (const stamp of stamps) {
      expect(stamps[0]).toBeTruthy();
      expect(stamp.startsWith('2026-10-01T08:')).toBe(true);
    }
  });
});

describe('evaluation demo corpus protocol validity (positive)', () => {
  it('the A012 evaluation record is structurally valid with a COMPUTED aggregate', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    expect(isEvaluationRecord(corpus.evaluationRecord)).toBe(true);
    // weighted mean of (0.9, 0.85, 1.0) at equal weights, 6-dp rounded.
    expect(corpus.evaluationRecord.aggregate.score).toBeCloseTo(0.916667, 6);
    expect(corpus.evaluationRecord.aggregate.outcome).toBe('meets-criteria');
    expect(corpus.evaluationRecord.verdicts).toHaveLength(3);
  });

  it('the A013 verification record is structurally valid with a DERIVED pass outcome', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    expect(isVerificationRecord(corpus.verificationRecord)).toBe(true);
    expect(corpus.verificationRecord.outcome).toBe('pass');
    expect(corpus.verificationRecord.unknownCause).toBeNull();
    expect(corpus.verificationRecord.evidence).toHaveLength(2);
    expect(corpus.verificationRecord.evidenceSupport).toHaveLength(2);
  });

  it('the A023 runs are structurally valid, satisfied, and honestly CONDITIONAL (declared constraint)', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    for (const run of [corpus.certificationRunA, corpus.certificationRunB]) {
      expect(isCertificationRecord(run)).toBe(true);
      expect(run.kind).toBe('certification-run');
      expect(run.verdict).toBe('satisfied');
      // The suite declares one constraint => the DERIVED grant is CONDITIONAL, never CERTIFIED.
      expect(run.grantedLevel).toBe('CONDITIONAL');
      expect(run.statement).not.toBeNull();
      expect(run.stages).toHaveLength(3);
      for (const stage of run.stages) {
        expect(stage.outcome).toBe('satisfied');
      }
    }
  });

  it('the derived statement scopes the claim to the full composition (never the model alone)', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    const statement = corpus.certificationRunB.statement;
    expect(statement).not.toBeNull();
    const scope = statement?.scope;
    expect(scope?.body).toBe('arena-reference/software-engineer-body');
    expect(scope?.bodyVersion).toBe('1.1.0');
    expect(scope?.substrate).toBe('workspace-mount');
    expect(scope?.environment).toBe('sandboxed-workspace');
    expect(scope?.runtime).toBe('arena-runtime');
    expect(scope?.suite).toBe('suite-payments-reliability');
  });

  it('run B supersedes run A; the revocation revokes run A', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    expect(corpus.certificationRunB.supersedes).toBe(corpus.certificationRunA.digest);
    expect(corpus.revocation.kind).toBe('revocation');
    expect(corpus.revocation.revokes).toBe(corpus.certificationRunA.digest);
    expect(corpus.revocation.grounds).toBeTruthy();
  });
});

describe('certification ledger posture projection (positive)', () => {
  it('revoked beats superseded beats active', () => {
    expect(
      certificationPosture({ runDigest: 'x', supersededBy: ['x'], revoked: ['x'] }),
    ).toBe('revoked');
    expect(certificationPosture({ runDigest: 'x', supersededBy: ['x'], revoked: [] })).toBe(
      'superseded',
    );
    expect(certificationPosture({ runDigest: 'x', supersededBy: [], revoked: [] })).toBe('active');
    expect(
      certificationPosture({ runDigest: 'x', supersededBy: ['other'], revoked: ['other'] }),
    ).toBe('active');
  });

  it('the demo corpus projects run A revoked and run B active', async () => {
    const corpus = await buildEvaluationDemoCorpus();
    expect(
      certificationPosture({
        runDigest: corpus.certificationRunA.digest,
        supersededBy: [corpus.certificationRunA.digest],
        revoked: [corpus.certificationRunA.digest],
      }),
    ).toBe('revoked');
    expect(
      certificationPosture({
        runDigest: corpus.certificationRunB.digest,
        supersededBy: [corpus.certificationRunA.digest],
        revoked: [corpus.certificationRunA.digest],
      }),
    ).toBe('active');
  });
});
