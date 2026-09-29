/**
 * Property suite - randomized invariants over the pure core:
 * determinism of content addressing, closed vocabularies under
 * arbitrary valid inputs, comparison math invariants, and the
 * confound ⇒ verdict invariant.
 */

import { describe, expect, it } from 'vitest';
import { createExperimentDescriptor } from './descriptor.js';
import type { UncertaintyReport } from './comparison.js';
import { compareOutcomeMetrics, checkProtectedCapabilities } from './comparison.js';
import { attributeExperiment } from './attribution.js';
import { decideCapabilityLift } from './verdict.js';
import { createCalibrationRecord, summarizeCalibration } from './calibration.js';
import { CAPABILITY_LIFT_VERDICTS, isCapabilityLiftVerdict } from './verdict.js';
import { INTERVENTION_SURFACES } from './intervention-surface.js';
import { ATTRIBUTION_SOURCES } from './attribution-source.js';
import {
  ENVIRONMENT_VERSION,
  PROTECTED_CAPABILITY,
  TASK_POPULATION,
  TestLcg,
  T8,
  makeEvaluationRecord,
  makeExperimentInput,
  makeTrajectoryRecord,
  makeVerificationRecord,
} from './test-support.js';

const EVALUATOR_A = '1111111111111111111111111111111111111111111111111111111111111111';
const EVALUATOR_B = '2222222222222222222222222222222222222222222222222222222222222222';

describe('property - content addressing is deterministic under randomized inputs', () => {
  it('P1: random valid descriptors ⇒ deterministic digests + valid structure', async () => {
    const lcg = new TestLcg(0x51A7);
    for (let index = 0; index < 24; index += 1) {
      const input = makeExperimentInput({
        experimentId: `experiment-prop-${String(index).padStart(4, '0')}`,
        changedSurface: INTERVENTION_SURFACES[lcg.int(INTERVENTION_SURFACES.length)],
        metricDirection: lcg.bool() ? 'higher-is-better' : 'lower-is-better',
      });
      const a = await createExperimentDescriptor(input);
      const b = await createExperimentDescriptor(input);
      expect(a.digest).toBe(b.digest);
      expect(a.interventions).toHaveLength(1);
      expect(a.taskPopulation.length).toBeGreaterThan(0);
    }
  });

  it('P2: random measurements ⇒ delta = intervention - baseline, improved XOR regressed only via direction', () => {
    const lcg = new TestLcg(0xD31A);
    for (let index = 0; index < 48; index += 1) {
      const baseline = lcg.next() * 100;
      const intervention = lcg.next() * 100;
      const direction = lcg.bool() ? 'higher-is-better' : 'lower-is-better';
      const comparison = compareOutcomeMetrics(
        [{ metricId: 'm', description: 'random metric', direction }] as never,
        [{ metricId: 'm', value: baseline, variance: null }],
        [{ metricId: 'm', value: intervention, variance: null }],
      );
      const entry = comparison[0];
      expect(entry?.delta).toBeCloseTo(intervention - baseline, 10);
      const improved = direction === 'higher-is-better' ? intervention > baseline : intervention < baseline;
      expect(entry?.improved).toBe(improved);
      expect(entry?.regressed).toBe(!improved && intervention !== baseline);
      // improved and regressed are mutually exclusive.
      expect(entry?.improved && entry?.regressed).toBe(false);
    }
  });

  it('P3: randomized arms ⇒ attribution always emits the six closed sources and a closed verdict', async () => {
    const lcg = new TestLcg(0xA020A);
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    for (let index = 0; index < 16; index += 1) {
      const baselineTrajectory = await makeTrajectoryRecord({
        trajectoryId: `trajectory-prop-b-${index}`,
        runId: `tenant-a/run-prop-b-${index}`,
      });
      const interventionTrajectory = await makeTrajectoryRecord({
        trajectoryId: `trajectory-prop-i-${index}`,
        runId: `tenant-a/run-prop-i-${index}`,
      });
      const baseline = {
        trajectories: [baselineTrajectory],
        evaluations: [
          await makeEvaluationRecord(baselineTrajectory.chainHead as string, {
            evaluatorRef: EVALUATOR_A,
          }),
        ],
        verifications: [
          await makeVerificationRecord(baselineTrajectory.chainHead as string),
        ],
      };
      const intervention = {
        trajectories: [interventionTrajectory],
        evaluations: [
          await makeEvaluationRecord(interventionTrajectory.chainHead as string, {
            evaluatorRef: lcg.bool() ? EVALUATOR_B : EVALUATOR_A,
          }),
        ],
        verifications: [
          await makeVerificationRecord(interventionTrajectory.chainHead as string),
        ],
      };
      const uncertainty = {
        method: 'analytic-variance' as const,
        entries: [
          { metricId: 'reconciliation-accuracy', baselineVariance: 0.01, interventionVariance: 0.01 },
        ],
      } as unknown as UncertaintyReport;
      const attribution = attributeExperiment(descriptor, baseline, intervention, uncertainty);
      expect(attribution.findings.map((f) => f.source)).toEqual([...ATTRIBUTION_SOURCES]);
      // KEY RULE invariant: evaluator digest sets differ ⇒ confound flagged.
      if (attribution.evaluatorDigestsBaseline.join(',') !== attribution.evaluatorDigestsIntervention.join(',')) {
        expect(attribution.confounds).toContain('evaluator-version-confound');
      } else {
        expect(attribution.confounds).not.toContain('evaluator-version-confound');
      }
      const baselineValue = 0.5 + lcg.next() * 0.4;
      const interventionValue = 0.5 + lcg.next() * 0.4;
      const comparison = compareOutcomeMetrics(
        descriptor.outcomeMetrics,
        [{ metricId: 'reconciliation-accuracy', value: baselineValue, variance: 0.01 }],
        [{ metricId: 'reconciliation-accuracy', value: interventionValue, variance: 0.01 }],
      );
      const protectedChecks = checkProtectedCapabilities(
        descriptor.protectedCapabilities,
        [{ capabilityRef: PROTECTED_CAPABILITY.digest, value: 0.9 }],
        [{ capabilityRef: PROTECTED_CAPABILITY.digest, value: lcg.bool() ? 0.5 : 0.95 }],
      );
      const verdict = decideCapabilityLift(
        descriptor,
        comparison,
        uncertainty,
        attribution,
        protectedChecks,
        intervention.verifications,
      );
      expect(CAPABILITY_LIFT_VERDICTS).toContain(verdict.verdict);
      expect(isCapabilityLiftVerdict(verdict)).toBe(true);
      // THE invariant: confound ⇒ inconclusive-unless-controlled.
      if (attribution.confounds.length > 0) {
        expect(verdict.verdict).toBe('inconclusive-unless-controlled');
      }
    }
  });

  it('P4: randomized calibration records ⇒ summary counts add up + Brier in [0,1]', async () => {
    const lcg = new TestLcg(0xCA1B);
    const outcomes = ['improved', 'not-improved', 'regressed', 'inconclusive'] as const;
    const records = [];
    for (let index = 0; index < 20; index += 1) {
      records.push(
        await createCalibrationRecord({
          calibrationId: `calibration-prop-${String(index).padStart(4, '0')}`,
          experimentRef: 'e'.repeat(64),
          metricId: 'reconciliation-accuracy',
          predicted: { confidence: lcg.next(), delta: null },
          observed: { outcome: outcomes[lcg.int(outcomes.length)] ?? "improved", delta: null },
          applicability: {
            targetCapability: { ...PROTECTED_CAPABILITY },
            taskPopulation: TASK_POPULATION.map((entry) => ({ ...entry })),
            environmentVersions: [{ ...ENVIRONMENT_VERSION }],
          },
          observedAt: T8,
          provenance: { recordedBy: 'arena-learning-test', recordedAt: T8, notes: null },
        }),
      );
    }
    const summary = summarizeCalibration(records);
    expect(summary.recordCount).toBe(20);
    expect(
      summary.improvedCount +
        summary.notImprovedCount +
        summary.regressedCount +
        summary.inconclusiveCount,
    ).toBe(20);
    if (summary.brierScore !== null) {
      expect(summary.brierScore).toBeGreaterThanOrEqual(0);
      expect(summary.brierScore).toBeLessThanOrEqual(1);
    }
  });
});
