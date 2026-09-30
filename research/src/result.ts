/**
 * BenchmarkResultRecord -- the APPEND-ONCE scored result of one
 * DETERMINISTIC benchmark run (Work Order A030; requirements R43, R44).
 *
 * The record is the leaderboard entry: content-addressed, versioned and
 * immutable once constructed. It binds:
 *
 *   - `benchmark` -- the A002 artifact ref of the BenchmarkDescriptor it
 *     ran under (identity + digest);
 *   - `subject` -- the COMPOSITION under test (R43: never a model in
 *     isolation): the A003 BodyVersion artifact ref, the A016
 *     substrate artifact ref, the A003 possession digest, and the A009
 *     environment ref -- every version a consumer needs to interpret the
 *     score (R44);
 *   - `run` -- the fixed run inputs: seed, started/finished timestamps,
 *     correlation id, idempotency key and runner id (lock rule 17 -
 *     reproducibility is addressed, never implied);
 *   - `criteria` / `evaluator` / `verifier` -- the RUN-BOUND A012/A013
 *     artifact refs actually used (the descriptor pins identities; the
 *     record pins the materialized digests);
 *   - `scores` -- one per criterion, in criteria order, each in the
 *     score domain of the referenced methodology;
 *   - `aggregate` -- the DERIVED aggregate: score plus outcome
 *     (pass | fail | indeterminate), computed PURELY from the scores
 *     and the methodology's aggregation policy and pass bar -- callers
 *     never supply the outcome;
 *   - `methodology` -- the artifact ref of the ScoringMethodology used;
 *   - `evidence` -- the verification-checked chain: the A012
 *     EvaluationRecord artifact ref, the A013 VerificationRecord
 *     artifact ref and the optional A023 CertificationRecord artifact
 *     ref;
 *   - `confidence` + `limitations` -- stated, never implied;
 *   - `provenance` -- who recorded the result, when, notes.
 *
 * Determinism discipline: two runs with the same fixed inputs produce
 * byte-identical digests (asserted by the benchmarks/ reproducibility
 * suite); the record carries NO wall-clock reads -- all timestamps are
 * caller-supplied fixed values.
 */

import { digestCanonical } from '@arena/protocol-core';
import { RESEARCH_ERROR_CODES, ResearchError } from './errors.js';
import { researchSchemaRef } from './schemas.js';
import { scoreDomainFor } from './methodology.js';
import { toArtifactRef as toArenaArtifactRef } from '@arena/artifact-protocol';
import type { ArtifactRef } from '@arena/artifact-protocol';
import { isArtifactRef } from '@arena/artifact-protocol';
import {
  deepFreeze,
  expectFields,
  expectNumberInRange,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isResearchId,
  isResearchSeed,
  isResearchTimestamp,
  toContentDigest,
  toNeutralText,
  toResearchId,
  toResearchSeed,
  toResearchTimestamp,
} from './shared.js';
import type {
  ResearchContentDigest,
  ResearchId,
  ResearchNeutralText,
  ResearchSeed,
  ResearchTimestamp,
} from './shared.js';

/** Wire version of the benchmark-result shape. */
export const BENCHMARK_RESULT_VERSION = 1 as const;

/** The closed aggregate outcomes (verification-aware: indeterminate is first-class). */
export const BENCHMARK_OUTCOMES = Object.freeze(['pass', 'fail', 'indeterminate'] as const);
export type BenchmarkOutcome = (typeof BENCHMARK_OUTCOMES)[number];

/** Stable field lists (tests mirror them). */
export const BENCHMARK_SUBJECT_FIELDS = Object.freeze([
  'bodyVersionRef',
  'substrateRef',
  'possessionDigest',
  'environmentRef',
] as const) as readonly string[];
export const BENCHMARK_RUN_FIELDS = Object.freeze([
  'seed',
  'startedAt',
  'finishedAt',
  'correlationId',
  'idempotencyKey',
  'runner',
] as const) as readonly string[];
export const CRITERION_SCORE_FIELDS = Object.freeze(['criterionId', 'score'] as const) as readonly string[];
export const RESULT_EVIDENCE_FIELDS = Object.freeze([
  'evaluationRecord',
  'verificationRecord',
  'certificationRecord',
] as const) as readonly string[];
export const RESULT_PROVENANCE_FIELDS = Object.freeze([
  'recordedBy',
  'recordedAt',
  'notes',
] as const) as readonly string[];

export interface BenchmarkSubject {
  readonly bodyVersionRef: ArtifactRef;
  readonly substrateRef: ArtifactRef;
  readonly possessionDigest: ResearchContentDigest;
  readonly environmentRef: ArtifactRef;
}

export interface BenchmarkRun {
  readonly seed: ResearchSeed;
  readonly startedAt: ResearchTimestamp;
  readonly finishedAt: ResearchTimestamp;
  readonly correlationId: ResearchId;
  readonly idempotencyKey: ResearchId;
  readonly runner: ResearchId;
}

export interface CriterionScore {
  readonly criterionId: ResearchId;
  readonly score: number;
}

export interface BenchmarkAggregate {
  readonly score: number;
  readonly outcome: BenchmarkOutcome;
}

export interface BenchmarkEvidence {
  readonly evaluationRecord: ArtifactRef;
  readonly verificationRecord: ArtifactRef;
  readonly certificationRecord: ArtifactRef | null;
}

export interface ResultProvenance {
  readonly recordedBy: ResearchId;
  readonly recordedAt: ResearchTimestamp;
  readonly notes: ResearchNeutralText | null;
}

/** The digest-free view -- exactly what the result digest commits to. */
export interface BenchmarkResultView {
  readonly recordVersion: typeof BENCHMARK_RESULT_VERSION;
  readonly benchmark: ArtifactRef;
  readonly subject: BenchmarkSubject;
  readonly run: BenchmarkRun;
  readonly criteria: readonly ArtifactRef[];
  readonly evaluator: ArtifactRef;
  readonly verifier: ArtifactRef;
  readonly scores: readonly CriterionScore[];
  readonly aggregate: BenchmarkAggregate;
  readonly methodology: ArtifactRef;
  readonly evidence: BenchmarkEvidence;
  readonly confidence: number;
  readonly limitations: ResearchNeutralText;
  readonly provenance: ResultProvenance;
}

/** A frozen, content-addressed benchmark result: the view plus its digest. */
export interface BenchmarkResult extends BenchmarkResultView {
  readonly digest: ResearchContentDigest;
}

/** Stable field list for the result view. */
export const BENCHMARK_RESULT_FIELDS = Object.freeze([
  'recordVersion',
  'benchmark',
  'subject',
  'run',
  'criteria',
  'evaluator',
  'verifier',
  'scores',
  'aggregate',
  'methodology',
  'evidence',
  'confidence',
  'limitations',
  'provenance',
] as const) as readonly string[];

export interface CreateBenchmarkResultInput {
  readonly benchmark: { namespace: string; name: string; version: string; digest: string };
  readonly subject: {
    readonly bodyVersionRef: { namespace: string; name: string; version: string; digest: string };
    readonly substrateRef: { namespace: string; name: string; version: string; digest: string };
    readonly possessionDigest: string;
    readonly environmentRef: { namespace: string; name: string; version: string; digest: string };
  };
  readonly run: {
    readonly seed: string;
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly runner: string;
  };
  readonly criteria: readonly { namespace: string; name: string; version: string; digest: string }[];
  readonly evaluator: { namespace: string; name: string; version: string; digest: string };
  readonly verifier: { namespace: string; name: string; version: string; digest: string };
  readonly scores: readonly { criterionId: string; score: number }[];
  readonly methodology: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
    readonly aggregation: string;
    readonly passAt: number;
  };
  readonly evidence: {
    readonly evaluationRecord: { namespace: string; name: string; version: string; digest: string };
    readonly verificationRecord: { namespace: string; name: string; version: string; digest: string };
    readonly certificationRecord: {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    } | null;
  };
  readonly confidence: number;
  readonly limitations: string;
  readonly provenance: {
    readonly recordedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

function toRef(value: unknown, field: string): ArtifactRef {
  if (typeof value !== 'object' || value === null) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: `${field}: expected an artifact ref object`,
    });
  }
  try {
    // REUSE the A002 artifact-protocol guard (never reimplement identity
    // validation): namespace/name/version charset + sha256 digest.
    return toArenaArtifactRef(value as {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    });
  } catch (error) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: `${field}: invalid artifact ref (${error instanceof Error ? error.message : String(error)})`,
    });
  }
}

function toSubject(value: unknown): BenchmarkSubject {
  const record = expectFields(
    value,
    ['bodyVersionRef', 'substrateRef', 'possessionDigest', 'environmentRef'],
    [],
    RESEARCH_ERROR_CODES.INVALID_RESULT,
    'benchmark subject',
  );
  const possessionDigest = record['possessionDigest'];
  if (typeof possessionDigest !== 'string' || !isContentDigest(possessionDigest)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark subject: possessionDigest must be a sha256 content digest',
    });
  }
  return deepFreeze({
    bodyVersionRef: toRef(record['bodyVersionRef'], 'subject bodyVersionRef'),
    substrateRef: toRef(record['substrateRef'], 'subject substrateRef'),
    possessionDigest: possessionDigest as ResearchContentDigest,
    environmentRef: toRef(record['environmentRef'], 'subject environmentRef'),
  });
}

function toRun(value: unknown): BenchmarkRun {
  const record = expectFields(
    value,
    ['seed', 'startedAt', 'finishedAt', 'correlationId', 'idempotencyKey', 'runner'],
    [],
    RESEARCH_ERROR_CODES.INVALID_RESULT,
    'benchmark run',
  );
  const seed = record['seed'];
  if (typeof seed !== 'string' || !isResearchSeed(seed)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark run: seed is required and must use the neutral seed charset (a deterministic benchmark never runs unseeded)',
    });
  }
  const startedAt = record['startedAt'];
  const finishedAt = record['finishedAt'];
  if (typeof startedAt !== 'string' || !isResearchTimestamp(startedAt)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark run: startedAt must be a ms-precision UTC timestamp',
    });
  }
  if (typeof finishedAt !== 'string' || !isResearchTimestamp(finishedAt)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark run: finishedAt must be a ms-precision UTC timestamp',
    });
  }
  if (Date.parse(finishedAt) < Date.parse(startedAt)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark run: finishedAt precedes startedAt (non-monotonic run window)',
      details: { startedAt, finishedAt },
    });
  }
  const correlationId = record['correlationId'];
  const idempotencyKey = record['idempotencyKey'];
  const runner = record['runner'];
  if (typeof correlationId !== 'string' || !isResearchId(correlationId)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark run: correlationId must be a neutral research id',
    });
  }
  if (typeof idempotencyKey !== 'string' || !isResearchId(idempotencyKey)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark run: idempotencyKey must be a neutral research id (lock rule 17)',
    });
  }
  if (typeof runner !== 'string' || !isResearchId(runner)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark run: runner must be a neutral research id',
    });
  }
  return deepFreeze({
    seed,
    startedAt,
    finishedAt,
    correlationId,
    idempotencyKey,
    runner,
  });
}

function toScores(
  value: unknown,
  aggregation: string,
  passAt: number,
): { scores: readonly CriterionScore[]; aggregate: BenchmarkAggregate } {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark result: at least one criterion score is required',
    });
  }
  const seen = new Set<string>();
  const scores: CriterionScore[] = [];
  for (const raw of value) {
    const record = expectFields(
      raw,
      ['criterionId', 'score'],
      [],
      RESEARCH_ERROR_CODES.INVALID_RESULT,
      'criterion score',
    );
    const criterionId = record['criterionId'];
    if (typeof criterionId !== 'string' || !isResearchId(criterionId)) {
      throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
        message: 'criterion score: criterionId must be a neutral research id',
      });
    }
    if (seen.has(criterionId)) {
      throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
        message: `criterion score: duplicate criterionId ${JSON.stringify(criterionId)} (one verdict per criterion, in criteria order)`,
      });
    }
    seen.add(criterionId);
    const score = record['score'];
    const domain = scoreDomainFor(aggregation as 'weighted-sum');
    if (domain === 'rubric-levels') {
      if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
        throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
          message: `criterion score: rubric-level scores must be integers in [1,5] (got ${JSON.stringify(score)})`,
        });
      }
    } else if (
      typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 1
    ) {
      throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
        message: `criterion score: unit-interval scores must lie in [0,1] (got ${JSON.stringify(score)})`,
      });
    }
    scores.push(Object.freeze({ criterionId, score }));
  }

  // The aggregate is DERIVED purely from the scores + the methodology.
  let aggregateScore: number;
  if (aggregation === 'weighted-sum') {
    let sum = 0;
    for (const entry of scores) sum += entry.score;
    aggregateScore = sum / scores.length;
  } else if (aggregation === 'pass-threshold') {
    let passing = 0;
    for (const entry of scores) if (entry.score >= 1) passing += 1;
    aggregateScore = passing / scores.length;
  } else if (aggregation === 'rubric-level') {
    let min = Number.POSITIVE_INFINITY;
    for (const entry of scores) min = Math.min(min, entry.score);
    aggregateScore = min;
  } else {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: `benchmark result: unknown methodology aggregation ${JSON.stringify(aggregation)} (the A012 closed enum is reused)`,
    });
  }
  const outcome: BenchmarkOutcome =
    aggregation === 'rubric-level'
      ? aggregateScore >= passAt
        ? 'pass'
        : 'fail'
      : aggregateScore >= passAt
        ? 'pass'
        : 'fail';
  return {
    scores: deepFreeze(scores),
    aggregate: Object.freeze({
      score: aggregateScore,
      outcome,
    }),
  };
}

function toEvidence(value: unknown): BenchmarkEvidence {
  const record = expectFields(
    value,
    ['evaluationRecord', 'verificationRecord', 'certificationRecord'],
    [],
    RESEARCH_ERROR_CODES.INVALID_RESULT,
    'benchmark evidence',
  );
  const certificationRecord = record['certificationRecord'];
  return deepFreeze({
    evaluationRecord: toRef(record['evaluationRecord'], 'evidence evaluationRecord'),
    verificationRecord: toRef(record['verificationRecord'], 'evidence verificationRecord'),
    certificationRecord:
      certificationRecord === null || certificationRecord === undefined
        ? null
        : toRef(certificationRecord, 'evidence certificationRecord'),
  });
}

// ---------------------------------------------------------------------------
// Structural guards
// ---------------------------------------------------------------------------

export function isBenchmarkResultView(value: unknown): value is BenchmarkResultView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === BENCHMARK_RESULT_VERSION &&
    isArtifactRef(candidate['benchmark']) &&
    typeof candidate['subject'] === 'object' &&
    candidate['subject'] !== null &&
    typeof candidate['run'] === 'object' &&
    candidate['run'] !== null &&
    Array.isArray(candidate['criteria']) &&
    (candidate['criteria'] as unknown[]).length > 0 &&
    isArtifactRef(candidate['evaluator']) &&
    isArtifactRef(candidate['verifier']) &&
    Array.isArray(candidate['scores']) &&
    (candidate['scores'] as unknown[]).length > 0 &&
    typeof candidate['aggregate'] === 'object' &&
    candidate['aggregate'] !== null &&
    isArtifactRef(candidate['methodology']) &&
    typeof candidate['evidence'] === 'object' &&
    candidate['evidence'] !== null &&
    typeof candidate['confidence'] === 'number' &&
    candidate['confidence'] >= 0 &&
    candidate['confidence'] <= 1 &&
    isNeutralText(candidate['limitations']) &&
    typeof candidate['provenance'] === 'object' &&
    candidate['provenance'] !== null
  );
}

export function isBenchmarkResult(value: unknown): value is BenchmarkResult {
  if (!isBenchmarkResultView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return isContentDigest(candidate['digest']);
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create a validated, deep-frozen, content-addressed benchmark result.
 * The aggregate outcome is DERIVED from the scores and the referenced
 * methodology's aggregation policy + pass bar -- callers never supply
 * it. Rejects: unseeded runs, non-monotonic run windows, duplicate
 * criterion scores, out-of-domain scores, missing evidence refs,
 * out-of-range confidence, unknown fields.
 */
export async function createBenchmarkResult(
  input: CreateBenchmarkResultInput,
): Promise<BenchmarkResult> {
  const record = expectFields(
    input,
    [
      'benchmark',
      'subject',
      'run',
      'criteria',
      'evaluator',
      'verifier',
      'scores',
      'methodology',
      'evidence',
      'confidence',
      'limitations',
      'provenance',
    ],
    [],
    RESEARCH_ERROR_CODES.INVALID_RESULT,
    'benchmark result',
  );

  const methodology = record['methodology'] as { aggregation?: unknown; passAt?: unknown };
  const aggregation = methodology['aggregation'];
  const passAtRaw = methodology['passAt'];
  if (typeof aggregation !== 'string' || !['weighted-sum', 'pass-threshold', 'rubric-level'].includes(aggregation)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: `benchmark result: methodology.aggregation must be one of the A012 closed enum (got ${JSON.stringify(aggregation)})`,
    });
  }
  if (typeof passAtRaw !== 'number' || !Number.isFinite(passAtRaw)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark result: methodology.passAt must be a finite number',
    });
  }
  const { scores, aggregate } = toScores(record['scores'], aggregation, passAtRaw);

  const provenance = expectFields(
    record['provenance'],
    ['recordedBy', 'recordedAt', 'notes'],
    [],
    RESEARCH_ERROR_CODES.INVALID_PROVENANCE,
    'benchmark result provenance',
  );
  const recordedAt = provenance['recordedAt'];
  if (typeof recordedAt !== 'string' || !isResearchTimestamp(recordedAt)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_PROVENANCE, {
      message: 'benchmark result provenance: recordedAt must be a ms-precision UTC timestamp',
    });
  }
  const notes = provenance['notes'];
  const criteria = record['criteria'];
  if (!Array.isArray(criteria) || criteria.length === 0) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'benchmark result: at least one criteria ref is required',
    });
  }

  const view: BenchmarkResultView = {
    recordVersion: BENCHMARK_RESULT_VERSION,
    benchmark: toRef(record['benchmark'], 'result benchmark'),
    subject: toSubject(record['subject']),
    run: toRun(record['run']),
    criteria: deepFreeze(criteria.map((ref, index) => toRef(ref, `result criteria[${index}]`))),
    evaluator: toRef(record['evaluator'], 'result evaluator'),
    verifier: toRef(record['verifier'], 'result verifier'),
    scores,
    aggregate,
    methodology: toRef(record['methodology'], 'result methodology'),
    evidence: toEvidence(record['evidence']),
    confidence: expectNumberInRange(
      record['confidence'],
      'confidence',
      0,
      1,
      RESEARCH_ERROR_CODES.INVALID_RESULT,
      'benchmark result',
    ),
    limitations: toNeutralText(
      typeof record['limitations'] === 'string' ? record['limitations'] : '',
      'benchmark result limitations',
    ),
    provenance: deepFreeze({
      recordedBy: toResearchId(
        typeof provenance['recordedBy'] === 'string' ? provenance['recordedBy'] : '',
        'result provenance recordedBy',
      ),
      recordedAt,
      notes: typeof notes === 'string' ? toNeutralText(notes, 'result provenance notes') : null,
    }),
  };
  const digest = toContentDigest(await digestCanonical(view), 'benchmark result digest');
  return deepFreeze({ ...view, digest }) as BenchmarkResult;
}

/** The digest-free view of a result. */
export function benchmarkResultView(result: BenchmarkResult): BenchmarkResultView {
  const { digest: _digest, ...view } = result;
  return deepFreeze({ ...view }) as BenchmarkResultView;
}

/**
 * Recompute the result digest over the digest-free view and compare.
 * Throws RESEARCH_TAMPERED on any mismatch (tampered scoring inputs
 * are detected here and by the ledger).
 */
export async function recomputeBenchmarkResultDigest(
  result: BenchmarkResult,
  expectedDigest?: string,
): Promise<ResearchContentDigest> {
  if (!isBenchmarkResult(result)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: 'result digest recomputation requires a structurally valid benchmark result',
    });
  }
  const actual = await digestCanonical(benchmarkResultView(result));
  if (actual !== result.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.TAMPERED, {
      message: `benchmark result digest mismatch: expected ${expectedDigest ?? result.digest}, got ${actual}`,
      details: { expected: expectedDigest ?? result.digest, actual },
    });
  }
  return toContentDigest(actual, 'recomputed result digest');
}

/** The leaderboard subject key: benchmark digest + body version ref key. */
export function resultSubjectKey(result: BenchmarkResult): string {
  const body = result.subject.bodyVersionRef;
  return `${result.benchmark.digest}|${body.namespace}/${body.name}@${body.version}#${body.digest}`;
}

/** Structural helper used by the ledger's neutral checks. */
export function hasNeutralResultIds(result: BenchmarkResult): boolean {
  return (
    isNeutralId(result.run.correlationId) &&
    isNeutralId(result.run.idempotencyKey) &&
    isNeutralId(result.run.runner) &&
    isNeutralId(result.provenance.recordedBy)
  );
}
