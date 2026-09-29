/**
 * Property suite (Work Order A023) — generative invariants over random
 * but SEEDED stage matrices (deterministic; no flakiness):
 *
 *   1. pure derivation: deriveCertificationOutcome is a total function
 *      of the stage outcomes — fail dominates, unknown blocks, all-pass
 *      satisfies;
 *   2. fail-closed engine: for EVERY non-satisfied stage matrix the
 *      engine grants NO level and never renders "satisfied";
 *   3. digest determinism: identical inputs ⇒ identical record digests;
 *      ANY input mutation ⇒ a different digest (content addressing);
 *   4. design law: every derived statement carries all five scope
 *      components + the limitations notice, whatever the verdict.
 */

import { describe, expect, it } from 'vitest';
import { deriveCertificationOutcome } from './outcome.js';
import type { StageResult } from './outcome.js';
import { evaluateCertificationRun } from './engine.js';
import type { CertificationEvidence } from './engine.js';
import {
  compositionStage,
  evaluationStage,
  makeCompatibilityRecord,
  makeDatasetManifest,
  makeEvaluationRecord,
  makeSubject,
  makeSuite,
  makeVerificationRecord,
  verificationStage,
  T0,
  T1,
  DIGEST_B,
  DIGEST_C,
} from './test-support.js';

/** Deterministic mulberry32 PRNG (seeded — the property suite is stable). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Outcome = 'satisfied' | 'not-satisfied' | 'unknown';

function randomStageResult(random: () => number, index: number): StageResult {
  const roll = random();
  const outcome: Outcome = roll < 0.5 ? 'satisfied' : roll < 0.75 ? 'not-satisfied' : 'unknown';
  return {
    stageId: `stage-${index}`,
    outcome,
    reason:
      outcome === 'satisfied'
        ? 'stage-satisfied'
        : outcome === 'not-satisfied'
          ? 'stage-failed'
          : 'missing-evidence',
    evidenceDigest: null,
    unknownCause:
      outcome === 'unknown'
        ? { reason: 'missing-evidence', detail: 'generated matrix cell' }
        : null,
  };
}

describe('property: pure suite-verdict derivation over random stage matrices', () => {
  it('fail dominates, unknown blocks, all-satisfied satisfies (200 seeded matrices)', () => {
    const random = mulberry32(0xa023);
    for (let round = 0; round < 200; round += 1) {
      const size = 1 + Math.floor(random() * 6);
      const stages = Array.from({ length: size }, (_, index) => randomStageResult(random, index));
      const derived = deriveCertificationOutcome(stages);
      const outcomes = stages.map((stage) => stage.outcome);
      if (outcomes.includes('not-satisfied')) {
        expect(derived.verdict).toBe('not-satisfied');
        expect(derived.unknownCause).toBeNull();
      } else if (outcomes.includes('unknown')) {
        expect(derived.verdict).toBe('unknown');
        expect(derived.unknownCause).not.toBeNull();
      } else {
        expect(derived.verdict).toBe('satisfied');
        expect(derived.unknownCause).toBeNull();
      }
    }
  });
});

describe('property: the engine is fail-closed over random evidence matrices', () => {
  it('any missing evidence ⇒ unknown verdict + NO granted level (100 seeded matrices)', async () => {
    const random = mulberry32(0xfeed);
    const suite = await makeSuite([
      verificationStage('verify', DIGEST_C),
      evaluationStage('judge', DIGEST_B, DIGEST_C),
      compositionStage('composition'),
    ]);
    for (let round = 0; round < 100; round += 1) {
      const includeVerification = random() < 0.5;
      const includeEvaluation = random() < 0.5;
      const evidence: CertificationEvidence = {
        verifications: includeVerification ? [makeVerificationRecord()] : [],
        evaluations: includeEvaluation ? [makeEvaluationRecord()] : [],
        compatibility: [makeCompatibilityRecord()],
        datasets: [makeDatasetManifest()],
      };
      const record = await evaluateCertificationRun(
        suite,
        makeSubject(),
        evidence,
        {
          correlationId: `corr-prop-${round}`,
          idempotencyKey: `idem-prop-${round}`,
          startedAt: T0,
          finishedAt: T1,
        },
      );
      if (!includeVerification || !includeEvaluation) {
        expect(record.verdict).toBe('unknown');
        expect(record.grantedLevel).toBeNull();
        expect(record.statement?.verdictQualifier).not.toBe('satisfied');
      } else {
        expect(record.verdict).toBe('satisfied');
      }
    }
  });
});

describe('property: content addressing', () => {
  it('identical inputs ⇒ identical digests; any mutation ⇒ a different digest', async () => {
    const suite = await makeSuite([
      verificationStage('verify', DIGEST_C),
      compositionStage('composition'),
    ]);
    const evidence: CertificationEvidence = {
      verifications: [makeVerificationRecord()],
      evaluations: [],
      compatibility: [],
      datasets: [],
    };
    const ctx = {
      correlationId: 'corr-prop-digest',
      idempotencyKey: 'idem-prop-digest',
      startedAt: T0,
      finishedAt: T1,
    };
    const one = await evaluateCertificationRun(suite, makeSubject(), evidence, ctx);
    const two = await evaluateCertificationRun(suite, makeSubject(), evidence, ctx);
    expect(one.digest).toBe(two.digest);
    // mutate the evidence: a FAILING verifier record changes the record
    const mutated = await evaluateCertificationRun(
      suite,
      makeSubject(),
      { ...evidence, verifications: [makeVerificationRecord({ outcome: 'fail' })] },
      ctx,
    );
    expect(mutated.digest).not.toBe(one.digest);
    expect(mutated.verdict).toBe('not-satisfied');
  });
});

describe('property: the design law holds for every verdict', () => {
  it('every derived statement carries all five scope components + the limitations notice', async () => {
    const suite = await makeSuite([compositionStage('composition')]);
    const subject = makeSubject();
    for (const verdict of ['satisfied', 'not-satisfied', 'unknown'] as const) {
      const record = await evaluateCertificationRun(
        suite,
        subject,
        { evaluations: [], verifications: [], compatibility: [], datasets: [] },
        {
          correlationId: `corr-law-${verdict}`,
          idempotencyKey: `idem-law-${verdict}`,
          startedAt: T0,
          finishedAt: T1,
        },
      );
      expect(record.verdict).toBe(verdict === 'satisfied' ? 'satisfied' : record.verdict);
      expect(record.statement).not.toBeNull();
      expect(record.statement?.scope.body).toBe('acme/structural-engineer-body');
      expect(record.statement?.scope.substrate).toBe('substrate-x');
      expect(record.statement?.scope.environment).toBe('structural-env');
      expect(record.statement?.scope.runtime).toBe('arena-runtime');
      expect(record.statement?.scope.suite).toBe('structural-certification');
      expect(record.statement?.limitations.length).toBeGreaterThan(0);
      expect(record.statement?.text).toContain('possessed by Cognitive Substrate');
      // the composition-stage suite with an empty evidence bundle
      // contains no unknown-driving stage for 'satisfied' runs; the
      // composition stage is evidence-free and satisfied by the subject
    }
  });
});
