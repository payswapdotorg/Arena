/**
 * Reproducible benchmark evidence (PERF1.0): the frozen record a
 * release cites. The digest covers ONLY the deterministic parts —
 * counts, verdicts, ratios — never wall-clock measurements, so the
 * same (shape, seed, fabric) yields the same evidence digest on every
 * machine, in CI and out.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SloEvaluation } from '@arena/observability';
import type { LoadRunResult } from './harness.js';
import { PERF_ERROR_CODES, PerfError } from './shared.js';
import type { PerfSuiteVerdict } from './shared.js';

/** One frozen per-SLO assertion record. */
export interface SloAssertionRecord {
  readonly sloId: string;
  readonly verdict: SloEvaluation['verdict'];
  readonly sampleCount: number;
  readonly goodCount: number;
  readonly achievedRatio: number;
  readonly budgetExhausted: boolean;
  readonly asserted: 'met' | 'not-met';
}

/** The frozen performance-evidence record. */
export interface PerformanceEvidence {
  readonly evidenceVersion: 1;
  readonly suiteId: 'arena-v1-performance-suite';
  readonly shapeId: string;
  readonly seed: number;
  readonly requestCount: number;
  readonly goodCount: number;
  readonly badCount: number;
  readonly verdict: PerfSuiteVerdict;
  readonly assertions: readonly SloAssertionRecord[];
  /** sha256 over the canonical record WITHOUT measurements. */
  readonly digest: string;
  /** Wall-clock measurements — evidence only, never asserted. */
  readonly measurements: {
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maxMs: number;
  };
}

/** Build the evidence record for one run + its SLO evaluations. */
export async function buildPerformanceEvidence(
  run: LoadRunResult,
  evaluations: readonly { sloId: string; evaluation: SloEvaluation }[],
): Promise<PerformanceEvidence> {
  const assertions: SloAssertionRecord[] = evaluations.map(({ sloId, evaluation }) => ({
    sloId,
    verdict: evaluation.verdict,
    sampleCount: evaluation.sampleCount,
    goodCount: evaluation.goodCount,
    achievedRatio: evaluation.achievedRatio,
    budgetExhausted: evaluation.errorBudget.exhausted,
    asserted: evaluation.verdict === 'met' ? 'met' : 'not-met',
  }));
  const verdict: PerfSuiteVerdict = assertions.every(
    (assertion) => assertion.asserted === 'met' && !assertion.budgetExhausted,
  )
    ? 'pass'
    : 'fail';
  const deterministic = {
    evidenceVersion: 1 as const,
    suiteId: 'arena-v1-performance-suite' as const,
    shapeId: run.shapeId,
    seed: run.seed,
    requestCount: run.requestCount,
    goodCount: run.goodCount,
    badCount: run.badCount,
    verdict,
    assertions,
  };
  const digest = await digestCanonical(deterministic);
  if (typeof digest !== 'string' || digest.length !== 64) {
    throw new PerfError(PERF_ERROR_CODES.INVALID_EVIDENCE, 'evidence digest malformed');
  }
  return {
    ...deterministic,
    digest,
    measurements: run.measurements,
  };
}

/** The reference run the release train cites (steady baseline). */
export function suiteVerdictOf(evidence: PerformanceEvidence): PerfSuiteVerdict {
  return evidence.verdict;
}
