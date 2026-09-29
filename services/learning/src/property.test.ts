/**
 * Property suite — randomized engine runs: every run either completes
 * with a closed verdict or throws a typed LearningError; determinism
 * holds across engine instances; the confound invariant always holds.
 */

import { describe, expect, it } from 'vitest';
import { ExperimentEngine } from './engine.js';
import { CAPABILITY_LIFT_VERDICTS, isLearningError } from '@arena/learning';
import { CORR_ID, T7, TestLcg, makeArms, makeDescriptor } from './test-support.js';

const EVALUATOR_A = '1111111111111111111111111111111111111111111111111111111111111111';
const EVALUATOR_B = '2222222222222222222222222222222222222222222222222222222222222222';

describe('engine property suite', () => {
  it('P1: randomized arms ⇒ closed verdicts or typed errors, never crashes', async () => {
    const lcg = new TestLcg(0xFAB20);
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    for (let index = 0; index < 16; index += 1) {
      const arms = await makeArms(
        {
          evaluatorRef: lcg.bool() ? EVALUATOR_A : EVALUATOR_B,
          metricValue: 0.5 + lcg.next() * 0.4,
          metricVariance: lcg.bool() ? 0.01 : null,
          protectedValue: lcg.bool() ? 0.5 : 0.95,
        },
        {
          evaluatorRef: lcg.bool() ? EVALUATOR_A : EVALUATOR_B,
          metricValue: 0.5 + lcg.next() * 0.4,
          metricVariance: lcg.bool() ? 0.01 : null,
          protectedValue: lcg.bool() ? 0.5 : 0.95,
        },
      );
      try {
        const record = await engine.run(descriptor.digest as string, arms, {
          experimentKey: `run-prop-${String(index).padStart(4, '0')}`,
          correlationId: CORR_ID,
          recordedAt: T7,
        });
        expect(CAPABILITY_LIFT_VERDICTS).toContain(record.verdict.verdict);
        expect(record.attribution.findings).toHaveLength(6);
      } catch (error) {
        expect(isLearningError(error)).toBe(true);
      }
    }
  });

  it('P2: the confound invariant holds under randomized evaluator/verifier variation', async () => {
    const lcg = new TestLcg(0xC0FC);
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    for (let index = 0; index < 12; index += 1) {
      const arms = await makeArms(
        { evaluatorRef: EVALUATOR_A },
        { evaluatorRef: lcg.bool() ? EVALUATOR_B : EVALUATOR_A },
      );
      const record = await engine.run(descriptor.digest as string, arms, {
        experimentKey: `run-confound-prop-${String(index).padStart(4, '0')}`,
        correlationId: CORR_ID,
        recordedAt: T7,
      });
      if (record.attribution.confounds.length > 0) {
        expect(record.verdict.verdict).toBe('inconclusive-unless-controlled');
      } else {
        expect(record.verdict.verdict).not.toBe('inconclusive-unless-controlled');
      }
    }
  });

  it('P3: determinism across independent engine instances', async () => {
    const lcg = new TestLcg(0x0E7E7);
    const engineA = new ExperimentEngine();
    const engineB = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engineA.registerExperiment(descriptor);
    await engineB.registerExperiment(descriptor);
    for (let index = 0; index < 4; index += 1) {
      const arms = await makeArms(
        { metricValue: 0.6 + lcg.next() * 0.2 },
        { metricValue: 0.7 + lcg.next() * 0.2 },
      );
      const a = await engineA.run(descriptor.digest as string, arms, {
        experimentKey: `run-det-prop-${index}`,
        correlationId: CORR_ID,
        recordedAt: T7,
      });
      const b = await engineB.run(descriptor.digest as string, arms, {
        experimentKey: `run-det-prop-${index}`,
        correlationId: CORR_ID,
        recordedAt: T7,
      });
      expect(a.digest).toBe(b.digest);
    }
  });
});
