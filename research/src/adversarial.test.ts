/**
 * Negative/adversarial tests for @arena/research (Work Order A030):
 * invalid benchmark descriptors, tampered scoring inputs, malformed
 * methodology / result shapes, non-monotonic supersession, and
 * tampered dataset bundles -- all must be REJECTED with typed errors.
 */

import { describe, expect, it } from 'vitest';
import { ResearchError, RESEARCH_ERROR_CODES, isResearchError } from './errors.js';
import { createScoringMethodology } from './methodology.js';
import { createBenchmarkDescriptor } from './descriptor.js';
import { createBenchmarkResult } from './result.js';
import { LeaderboardLedger } from './leaderboard.js';
import { createResearchDataset, resolveResearchDataset, verifyResearchDataset } from './publication.js';

const T0 = '2026-10-01T10:00:00.000Z';
const T1 = '2026-10-01T10:05:00.000Z';
const T2 = '2026-10-01T10:10:00.000Z';
const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);

const BASE_METHODOLOGY = {
  methodologyId: 'methodology-se-repair',
  version: '1.0.0',
  aggregation: 'weighted-sum',
  passAt: 0.75,
  tieBreaking: 'digest-asc',
  knownLimitations: 'reference only',
  contaminationPolicy: 'synthetic population only',
  provenance: { authoredBy: 'arena-research', submittedAt: T0, notes: null },
};

const BASE_DESCRIPTOR = {
  benchmarkId: 'benchmark-se-repair',
  version: '1.0.0',
  domain: 'software-engineering',
  title: 'Software Engineer Repair Benchmark',
  description: 'Reference benchmark over the A028 software-engineer body.',
  status: 'published',
  criteriaPins: [{ criteriaId: 'criteria-se-test-repair', version: '1.0.0' }],
  evaluatorPins: [{ evaluatorId: 'se-test-suite-evaluator', version: '1.0.0', kind: 'deterministic-test' }],
  verifierPins: [{ verifierId: 'se-evidence-verifier', version: '1.0.0' }],
  methodologyRef: { namespace: 'public', name: 'scoring-methodology', version: '1.0.0', digest: DIGEST_A },
  datasetRef: { namespace: 'public', name: 'dataset-se-repair-v1', version: '1.0.0', digest: DIGEST_C },
  subjectScope: {
    bodyRefs: [{ namespace: 'public', name: 'body-software-engineer', version: '1.1.0', digest: DIGEST_A }],
    environmentRef: { namespace: 'public', name: 'environment-se-sandbox', version: '1.0.0', digest: DIGEST_B },
    runtimeNote: 'reference runtime profile',
  },
  taskPopulation: { scenarioCount: 1, seedPolicy: 'fixed-seed', notes: 'the A028 reference scenario' },
  provenance: { authoredBy: 'arena-research', submittedAt: T0, notes: null },
};

const BASE_RESULT = {
  benchmark: { namespace: 'public', name: 'benchmark-descriptor', version: '1.0.0', digest: DIGEST_A },
  subject: {
    bodyVersionRef: { namespace: 'public', name: 'body-software-engineer', version: '1.1.0', digest: DIGEST_A },
    substrateRef: { namespace: 'public', name: 'substrate-reference-reasoner', version: '1.0.0', digest: DIGEST_B },
    possessionDigest: DIGEST_C,
    environmentRef: { namespace: 'public', name: 'environment-se-sandbox', version: '1.0.0', digest: DIGEST_A },
  },
  run: {
    seed: 'seed-reference-0001',
    startedAt: T1,
    finishedAt: T2,
    correlationId: 'corr-bench-0001',
    idempotencyKey: 'idem-bench-0001',
    runner: 'arena-benchmark-runner',
  },
  criteria: [{ namespace: 'public', name: 'criteria-se-test-repair', version: '1.0.0', digest: DIGEST_B }],
  evaluator: { namespace: 'public', name: 'evaluator-se-test-suite', version: '1.0.0', digest: DIGEST_A },
  verifier: { namespace: 'public', name: 'verifier-se-evidence', version: '1.0.0', digest: DIGEST_B },
  scores: [
    { criterionId: 'criterion-tests-green', score: 1 },
    { criterionId: 'criterion-reproduction-shown', score: 1 },
    { criterionId: 'criterion-no-prohibited-shortcuts', score: 1 },
  ],
  methodology: {
    namespace: 'public',
    name: 'scoring-methodology',
    version: '1.0.0',
    digest: DIGEST_A,
    aggregation: 'weighted-sum',
    passAt: 0.75,
  },
  evidence: {
    evaluationRecord: { namespace: 'public', name: 'evaluation-record', version: '1.0.0', digest: DIGEST_A },
    verificationRecord: { namespace: 'public', name: 'verification-record', version: '1.0.0', digest: DIGEST_B },
    certificationRecord: null,
  },
  confidence: 0.9,
  limitations: 'reference-fabric result',
  provenance: { recordedBy: 'arena-benchmark-runner', recordedAt: T2, notes: null },
};

async function expectResearchError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable(`expected a ResearchError with code ${code}`);
  } catch (error) {
    expect(isResearchError(error)).toBe(true);
    const researchError = error as ResearchError;
    expect(researchError.code).toBe(code);
  }
}

describe('methodology adversarial cases', () => {
  it('rejects unknown aggregation policies', async () => {
    await expectResearchError(
      createScoringMethodology({ ...BASE_METHODOLOGY, aggregation: 'vibe-based' }),
      RESEARCH_ERROR_CODES.INVALID_METHODOLOGY,
    );
  });

  it('rejects pass bars outside the aggregation domain', async () => {
    await expectResearchError(
      createScoringMethodology({ ...BASE_METHODOLOGY, passAt: 1.5 }),
      RESEARCH_ERROR_CODES.INVALID_METHODOLOGY,
    );
    await expectResearchError(
      createScoringMethodology({ ...BASE_METHODOLOGY, aggregation: 'rubric-level', passAt: 0.75 }),
      RESEARCH_ERROR_CODES.INVALID_METHODOLOGY,
    );
  });

  it('rejects unknown tie-break policies, empty hygiene statements and unknown fields', async () => {
    await expectResearchError(
      createScoringMethodology({ ...BASE_METHODOLOGY, tieBreaking: 'coin-flip' }),
      RESEARCH_ERROR_CODES.INVALID_METHODOLOGY,
    );
    await expectResearchError(
      createScoringMethodology({ ...BASE_METHODOLOGY, knownLimitations: '' }),
      RESEARCH_ERROR_CODES.INVALID_TEXT,
    );
    await expectResearchError(
      createScoringMethodology({ ...BASE_METHODOLOGY, contaminationPolicy: '' }),
      RESEARCH_ERROR_CODES.INVALID_TEXT,
    );
    await expectResearchError(
      createScoringMethodology({ ...BASE_METHODOLOGY, secretField: 'nope' } as unknown as Parameters<typeof createScoringMethodology>[0]),
      RESEARCH_ERROR_CODES.INVALID_METHODOLOGY,
    );
  });
});

describe('descriptor adversarial cases', () => {
  it('rejects unknown statuses', async () => {
    await expectResearchError(
      createBenchmarkDescriptor({ ...BASE_DESCRIPTOR, status: 'live' }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  });

  it('rejects a published benchmark without a public dataset', async () => {
    await expectResearchError(
      createBenchmarkDescriptor({ ...BASE_DESCRIPTOR, datasetRef: null }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  });

  it('rejects empty criteria/evaluator/verifier pin sets', async () => {
    await expectResearchError(
      createBenchmarkDescriptor({ ...BASE_DESCRIPTOR, criteriaPins: [] }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
    await expectResearchError(
      createBenchmarkDescriptor({ ...BASE_DESCRIPTOR, evaluatorPins: [] }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
    await expectResearchError(
      createBenchmarkDescriptor({ ...BASE_DESCRIPTOR, verifierPins: [] }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  });

  it('rejects evaluator pins with unknown A012 kinds', async () => {
    await expectResearchError(
      createBenchmarkDescriptor({
        ...BASE_DESCRIPTOR,
        evaluatorPins: [{ evaluatorId: 'se-test-suite-evaluator', version: '1.0.0', kind: 'psychic' }],
      }),
      RESEARCH_ERROR_CODES.INVALID_PINS,
    );
  });

  it('rejects a model-only subject scope (no body population)', async () => {
    await expectResearchError(
      createBenchmarkDescriptor({
        ...BASE_DESCRIPTOR,
        subjectScope: { ...BASE_DESCRIPTOR.subjectScope, bodyRefs: [] },
      }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  });

  it('rejects malformed artifact refs and non-positive scenario counts', async () => {
    await expectResearchError(
      createBenchmarkDescriptor({
        ...BASE_DESCRIPTOR,
        methodologyRef: { namespace: 'public', name: 'scoring-methodology', version: '1.0.0', digest: 'not-a-digest' },
      }),
      RESEARCH_ERROR_CODES.INVALID_PINS,
    );
    await expectResearchError(
      createBenchmarkDescriptor({
        ...BASE_DESCRIPTOR,
        taskPopulation: { scenarioCount: 0, seedPolicy: 'fixed-seed', notes: 'x' },
      }),
      RESEARCH_ERROR_CODES.INVALID_DESCRIPTOR,
    );
  });
});

describe('result adversarial cases', () => {
  it('rejects out-of-domain scores', async () => {
    await expectResearchError(
      createBenchmarkResult({ ...BASE_RESULT, scores: [{ criterionId: 'criterion-a', score: 1.5 }] }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
  });

  it('rejects duplicate criterion scores', async () => {
    await expectResearchError(
      createBenchmarkResult({
        ...BASE_RESULT,
        scores: [
          { criterionId: 'criterion-a', score: 1 },
          { criterionId: 'criterion-a', score: 0.5 },
        ],
      }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
  });

  it('rejects unseeded and non-monotonic runs', async () => {
    await expectResearchError(
      createBenchmarkResult({
        ...BASE_RESULT,
        run: { ...BASE_RESULT.run, seed: '' },
      }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
    await expectResearchError(
      createBenchmarkResult({
        ...BASE_RESULT,
        run: { ...BASE_RESULT.run, finishedAt: '2026-10-01T10:04:00.000Z' },
      }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
  });

  it('rejects missing evidence and out-of-range confidence', async () => {
    await expectResearchError(
      createBenchmarkResult({
        ...BASE_RESULT,
        evidence: { ...BASE_RESULT.evidence, verificationRecord: null as never },
      }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
    await expectResearchError(
      createBenchmarkResult({ ...BASE_RESULT, confidence: 1.2 }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
  });

  it('rejects rubric scores under a rubric methodology', async () => {
    await expectResearchError(
      createBenchmarkResult({
        ...BASE_RESULT,
        scores: [{ criterionId: 'criterion-a', score: 0.7 }],
        methodology: { ...BASE_RESULT.methodology, aggregation: 'rubric-level', passAt: 4 },
      }),
      RESEARCH_ERROR_CODES.INVALID_RESULT,
    );
  });
});

describe('leaderboard adversarial cases', () => {
  it('rejects tampered scoring inputs (digest mismatch)', async () => {
    const result = await createBenchmarkResult(BASE_RESULT);
    const tampered = { ...result, aggregate: { score: 0.42, outcome: 'pass' as const } };
    const ledger = new LeaderboardLedger();
    await expectResearchError(ledger.append(tampered), RESEARCH_ERROR_CODES.TAMPERED);
    // The honest record still appends cleanly afterwards.
    await expect(ledger.append(result)).resolves.toBe(result);
    expect(ledger.size).toBe(1);
  });

  it('rejects non-monotonic supersession', async () => {
    const methodology = await createScoringMethodology(BASE_METHODOLOGY);
    const first = await createBenchmarkResult({
      ...BASE_RESULT,
      run: { ...BASE_RESULT.run, finishedAt: '2026-10-01T10:20:00.000Z' },
    });
    const late = await createBenchmarkResult({
      ...BASE_RESULT,
      scores: [{ criterionId: 'criterion-a', score: 0.5 }],
      run: { ...BASE_RESULT.run, finishedAt: '2026-10-01T10:10:00.000Z' },
      provenance: { recordedBy: 'arena-benchmark-runner', recordedAt: '2026-10-01T10:10:00.000Z', notes: null },
    });
    const ledger = new LeaderboardLedger();
    await ledger.append(first);
    await expectResearchError(ledger.append(late), RESEARCH_ERROR_CODES.NON_MONOTONIC);
    expect(methodology.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects structurally invalid appends', async () => {
    const ledger = new LeaderboardLedger();
    await expectResearchError(ledger.append({} as never), RESEARCH_ERROR_CODES.INVALID_RESULT);
  });
});

describe('dataset adversarial cases', () => {
  it('rejects an empty entry set', async () => {
    await expectResearchError(
      createResearchDataset({
        name: 'dataset-empty',
        version: '1.0.0',
        entries: [],
        notes: 'invalid',
        createdAt: T0,
        creatorId: 'arena-research',
      }),
      RESEARCH_ERROR_CODES.INVALID_PINS,
    );
  });

  it('rejects a tampered bundle through the reused A014 verify chain', async () => {
    const { manifest, artifacts } = await createResearchDataset({
      name: 'dataset-se-repair-v1',
      version: '1.0.0',
      entries: [
        { role: 'input', name: 'scenario-se-repair-reference', version: '1.0.0', content: { scenario: 'reference-repair' } },
      ],
      notes: 'A030 dataset',
      createdAt: T0,
      creatorId: 'arena-research',
    });
    const bundle = await resolveResearchDataset(manifest, artifacts);
    // Tamper: drop the artifact so resolution fails closed.
    await expect(verifyResearchDataset(bundle, [])).rejects.toBeTruthy();
    // Tamper: mutate the manifest entries.
    const tamperedManifest = { ...manifest, entries: [] };
    await expect(verifyResearchDataset({ ...bundle, manifest: tamperedManifest }, artifacts)).rejects.toBeTruthy();
  });
});
