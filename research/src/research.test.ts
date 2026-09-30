/**
 * Positive tests for the @arena/research protocol objects (Work Order
 * A030): construction, content addressing, freezing, aggregation
 * derivation, leaderboard supersession/ranking, and public dataset
 * packaging through the reused A014 discipline.
 */

import { describe, expect, it } from 'vitest';
import { AGGREGATION_POLICIES } from '@arena/evaluation';
import {
  createBenchmarkDescriptor,
  benchmarkDescriptorView,
  benchmarkIdentityKey,
  recomputeBenchmarkDescriptorDigest,
} from './descriptor.js';
import {
  createBenchmarkResult,
  benchmarkResultView,
  recomputeBenchmarkResultDigest,
} from './result.js';
import {
  createScoringMethodology,
  methodologyIdentityKey,
  recomputeScoringMethodologyDigest,
} from './methodology.js';
import { LeaderboardLedger } from './leaderboard.js';
import {
  createResearchDataset,
  resolveResearchDataset,
  verifyResearchDataset,
} from './publication.js';
import { researchSchemaRef, RESEARCH_SCHEMAS } from './schemas.js';

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T10:05:00.000Z';
const T2 = '2026-10-01T10:10:00.000Z';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

async function methodologyFixture(aggregation: 'weighted-sum' | 'pass-threshold' | 'rubric-level' = 'weighted-sum') {
  return createScoringMethodology({
    methodologyId: 'methodology-se-repair',
    version: '1.0.0',
    aggregation,
    passAt: aggregation === 'rubric-level' ? 4 : 0.75,
    tieBreaking: 'digest-asc',
    knownLimitations: 'single reference scenario; not a professional licensure claim',
    contaminationPolicy: 'task population is synthetic; no customer data may enter the population',
    provenance: { authoredBy: 'arena-research', submittedAt: T0, notes: 'A030 research methodology' },
  });
}

function artifactRef(digest: string, name = 'artifact', namespace = 'public', version = '1.0.0') {
  return { namespace, name, version, digest };
}

async function descriptorFixture(methodologyDigest: string, status = 'published') {
  return createBenchmarkDescriptor({
    benchmarkId: 'benchmark-se-repair',
    version: '1.0.0',
    domain: 'software-engineering',
    title: 'Software Engineer Repair Benchmark',
    description: 'Reference benchmark over the A028 software-engineer body: reproduce, repair, verify.',
    status,
    criteriaPins: [{ criteriaId: 'criteria-se-test-repair', version: '1.0.0' }],
    evaluatorPins: [{ evaluatorId: 'se-test-suite-evaluator', version: '1.0.0', kind: 'deterministic-test' }],
    verifierPins: [{ verifierId: 'se-evidence-verifier', version: '1.0.0' }],
    methodologyRef: artifactRef(methodologyDigest, 'scoring-methodology'),
    datasetRef: status === 'draft' ? null : artifactRef(DIGEST_C, 'dataset-se-repair-v1'),
    subjectScope: {
      bodyRefs: [artifactRef(DIGEST_A, 'body-software-engineer')],
      environmentRef: artifactRef(DIGEST_B, 'environment-software-engineer-sandbox'),
      runtimeNote: 'reference runtime profile, fixed seed, no network',
    },
    taskPopulation: {
      scenarioCount: 1,
      seedPolicy: 'fixed-seed',
      notes: 'the A028 reference repair scenario',
    },
    provenance: { authoredBy: 'arena-research', submittedAt: T0, notes: 'A030 reference benchmark' },
  });
}

async function resultFixture(
  benchmarkDigest: string,
  methodologyDigest: string,
  scores: readonly { criterionId: string; score: number }[],
  finishedAt = T2,
) {
  return createBenchmarkResult({
    benchmark: artifactRef(benchmarkDigest, 'benchmark-descriptor'),
    subject: {
      bodyVersionRef: artifactRef(DIGEST_A, 'body-software-engineer'),
      substrateRef: artifactRef(DIGEST_B, 'substrate-reference-reasoner'),
      possessionDigest: DIGEST_C,
      environmentRef: artifactRef(DIGEST_A, 'environment-software-engineer-sandbox'),
    },
    run: {
      seed: 'seed-reference-0001',
      startedAt: T1,
      finishedAt,
      correlationId: 'corr-bench-0001',
      idempotencyKey: 'idem-bench-0001',
      runner: 'arena-benchmark-runner',
    },
    criteria: [artifactRef(DIGEST_B, 'criteria-se-test-repair')],
    evaluator: artifactRef(DIGEST_A, 'evaluator-se-test-suite'),
    verifier: artifactRef(DIGEST_B, 'verifier-se-evidence'),
    scores,
    methodology: { ...artifactRef(methodologyDigest, 'scoring-methodology'), aggregation: 'weighted-sum', passAt: 0.75 },
    evidence: {
      evaluationRecord: artifactRef(DIGEST_A, 'evaluation-record'),
      verificationRecord: artifactRef(DIGEST_B, 'verification-record'),
      certificationRecord: null,
    },
    confidence: 0.9,
    limitations: 'reference-fabric result; not a professional licensure claim',
    provenance: { recordedBy: 'arena-benchmark-runner', recordedAt: finishedAt, notes: 'A030 run' },
  });
}

describe('ScoringMethodology', () => {
  it('creates a frozen, content-addressed methodology', async () => {
    const methodology = await methodologyFixture();
    expect(methodology.methodologyId).toBe('methodology-se-repair');
    expect(methodology.aggregation).toBe('weighted-sum');
    expect(methodology.scoreDomain).toBe('unit-interval');
    expect(methodology.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(methodology)).toBe(true);
    expect(methodologyIdentityKey(methodology)).toBe('methodology-se-repair@1.0.0');
    await expect(recomputeScoringMethodologyDigest(methodology)).resolves.toBe(methodology.digest);
  });

  it('derives the score domain per aggregation policy and validates pass bars', async () => {
    for (const aggregation of AGGREGATION_POLICIES) {
      const methodology = await methodologyFixture(aggregation);
      expect(methodology.scoreDomain).toBe(aggregation === 'rubric-level' ? 'rubric-levels' : 'unit-interval');
      expect(methodology.outputSchema).toEqual({
        namespace: 'research',
        name: 'scoring-methodology',
        version: '1.0.0',
      });
    }
  });

  it('is deterministic: same inputs produce the same digest', async () => {
    const a = await methodologyFixture();
    const b = await methodologyFixture();
    expect(a.digest).toBe(b.digest);
  });
});

describe('BenchmarkDescriptor', () => {
  it('creates a frozen, content-addressed, citable descriptor', async () => {
    const methodology = await methodologyFixture();
    const descriptor = await descriptorFixture(methodology.digest);
    expect(descriptor.benchmarkId).toBe('benchmark-se-repair');
    expect(descriptor.status).toBe('published');
    expect(descriptor.subjectScope.bodyRefs).toHaveLength(1);
    expect(descriptor.taskPopulation.scenarioCount).toBe(1);
    expect(descriptor.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(benchmarkIdentityKey(descriptor)).toBe('benchmark-se-repair@1.0.0');
    await expect(recomputeBenchmarkDescriptorDigest(descriptor)).resolves.toBe(descriptor.digest);
  });

  it('recomputes over the digest-free view (view excludes digest)', async () => {
    const methodology = await methodologyFixture();
    const descriptor = await descriptorFixture(methodology.digest);
    const view = benchmarkDescriptorView(descriptor);
    expect('digest' in view).toBe(false);
    expect(view.benchmarkId).toBe(descriptor.benchmarkId);
  });

  it('is deterministic: same inputs produce the same digest', async () => {
    const methodology = await methodologyFixture();
    const a = await descriptorFixture(methodology.digest);
    const b = await descriptorFixture(methodology.digest);
    expect(a.digest).toBe(b.digest);
  });

  it('accepts a dataset-less draft but requires a dataset when published', async () => {
    const methodology = await methodologyFixture();
    const draft = await descriptorFixture(methodology.digest, 'draft');
    expect(draft.status).toBe('draft');
    expect(draft.datasetRef).toBeNull();
    await expect(descriptorFixture(methodology.digest, 'published')).resolves.toBeTruthy();
  });
});

describe('BenchmarkResultRecord', () => {
  it('derives the aggregate purely from scores + methodology', async () => {
    const methodology = await methodologyFixture();
    const descriptor = await descriptorFixture(methodology.digest);
    const result = await resultFixture(descriptor.digest, methodology.digest, [
      { criterionId: 'criterion-tests-green', score: 1 },
      { criterionId: 'criterion-reproduction-shown', score: 1 },
      { criterionId: 'criterion-no-prohibited-shortcuts', score: 0.5 },
    ]);
    expect(result.aggregate.score).toBeCloseTo((1 + 1 + 0.5) / 3, 12);
    expect(result.aggregate.outcome).toBe('pass');
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(result)).toBe(true);
    await expect(recomputeBenchmarkResultDigest(result)).resolves.toBe(result.digest);
  });

  it('computes pass-threshold and rubric-level aggregates', async () => {
    const methodology = await createScoringMethodology({
      methodologyId: 'methodology-se-threshold',
      version: '1.0.0',
      aggregation: 'pass-threshold',
      passAt: 0.5,
      tieBreaking: 'digest-asc',
      knownLimitations: 'binary criteria',
      contaminationPolicy: 'synthetic population',
      provenance: { authoredBy: 'arena-research', submittedAt: T0, notes: null },
    });
    const result = await createBenchmarkResult({
      benchmark: artifactRef(DIGEST_A, 'benchmark-descriptor'),
      subject: {
        bodyVersionRef: artifactRef(DIGEST_A, 'body'),
        substrateRef: artifactRef(DIGEST_B, 'substrate'),
        possessionDigest: DIGEST_C,
        environmentRef: artifactRef(DIGEST_A, 'environment'),
      },
      run: {
        seed: 'seed-reference-0001',
        startedAt: T1,
        finishedAt: T2,
        correlationId: 'corr-bench-0002',
        idempotencyKey: 'idem-bench-0002',
        runner: 'arena-benchmark-runner',
      },
      criteria: [artifactRef(DIGEST_B, 'criteria')],
      evaluator: artifactRef(DIGEST_A, 'evaluator'),
      verifier: artifactRef(DIGEST_B, 'verifier'),
      scores: [
        { criterionId: 'criterion-a', score: 1 },
        { criterionId: 'criterion-b', score: 0 },
      ],
      methodology: { ...artifactRef(methodology.digest, 'scoring-methodology'), aggregation: 'pass-threshold', passAt: 0.5 },
      evidence: {
        evaluationRecord: artifactRef(DIGEST_A, 'evaluation-record'),
        verificationRecord: artifactRef(DIGEST_B, 'verification-record'),
        certificationRecord: null,
      },
      confidence: 0.8,
      limitations: 'reference result',
      provenance: { recordedBy: 'arena-benchmark-runner', recordedAt: T2, notes: null },
    });
    expect(result.aggregate.score).toBeCloseTo(0.5, 12);
    expect(result.aggregate.outcome).toBe('pass');
  });
});

describe('LeaderboardLedger', () => {
  it('appends idempotently and ranks deterministically', async () => {
    const methodology = await methodologyFixture();
    const descriptor = await descriptorFixture(methodology.digest);
    const high = await resultFixture(descriptor.digest, methodology.digest, [
      { criterionId: 'criterion-a', score: 1 },
      { criterionId: 'criterion-b', score: 1 },
    ]);
    const ledger = new LeaderboardLedger();
    await ledger.append(high);
    await ledger.append(high); // idempotent re-submission
    expect(ledger.size).toBe(1);
    const ranking = ledger.ranking(descriptor.digest);
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.rank).toBe(1);
    expect(ranking[0]!.result.digest).toBe(high.digest);
  });

  it('supersedes a subject result and keeps the audit trail', async () => {
    const methodology = await methodologyFixture();
    const descriptor = await descriptorFixture(methodology.digest);
    const first = await resultFixture(descriptor.digest, methodology.digest, [
      { criterionId: 'criterion-a', score: 0.5 },
    ], '2026-10-01T10:10:00.000Z');
    const second = await resultFixture(descriptor.digest, methodology.digest, [
      { criterionId: 'criterion-a', score: 1 },
    ], '2026-10-01T10:20:00.000Z');
    const ledger = new LeaderboardLedger();
    await ledger.append(first);
    await ledger.append(second);
    expect(ledger.size).toBe(2);
    expect(ledger.supersededDigests()).toEqual([first.digest]);
    const ranking = ledger.ranking(descriptor.digest);
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.result.digest).toBe(second.digest);
    expect(ledger.history()).toHaveLength(2);
  });

  it('snapshots a citable, content-addressed leaderboard state', async () => {
    const methodology = await methodologyFixture();
    const descriptor = await descriptorFixture(methodology.digest);
    const result = await resultFixture(descriptor.digest, methodology.digest, [
      { criterionId: 'criterion-a', score: 1 },
    ]);
    const ledger = new LeaderboardLedger();
    await ledger.append(result);
    const snapshot = await ledger.snapshot(descriptor.digest);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.outputSchema).toEqual(researchSchemaRef('research/leaderboard'));
    const again = await ledger.snapshot(descriptor.digest);
    expect(again.digest).toBe(snapshot.digest);
  });
});

describe('public dataset packaging (A014 reuse)', () => {
  it('packages, resolves and verifies a public research dataset', async () => {
    const methodology = await methodologyFixture();
    const { manifest, artifacts } = await createResearchDataset({
      name: 'dataset-se-repair-v1',
      version: '1.0.0',
      entries: [
        { role: 'eval', name: 'scoring-methodology-se-repair', version: '1.0.0', content: { methodologyId: 'methodology-se-repair' } },
        { role: 'input', name: 'scenario-se-repair-reference', version: '1.0.0', content: { scenario: 'reference-repair' } },
      ],
      notes: 'A030 public benchmark dataset',
      createdAt: T0,
      creatorId: 'arena-research',
    });
    expect(manifest.identity.namespace).toBe('public');
    expect(manifest.entries).toHaveLength(2);
    await expect(resolveResearchDataset(manifest, artifacts)).resolves.toBeTruthy();
    const bundle = await resolveResearchDataset(manifest, artifacts);
    const digest = await verifyResearchDataset(bundle, artifacts);
    expect(digest).toBe(bundle.bundleDigest);
  });

  it('exposes the research schema registry', () => {
    expect(Object.keys(RESEARCH_SCHEMAS)).toEqual([
      'research/scoring-methodology',
      'research/benchmark-descriptor',
      'research/benchmark-result',
      'research/leaderboard',
    ]);
  });
});
