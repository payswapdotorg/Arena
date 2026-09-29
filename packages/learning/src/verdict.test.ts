/**
 * Verdict tests - the Q1.0 five conditions, the closed vocabulary and
 * the precedence rules (confounds → regression → lift →
 * not-demonstrated). Verdicts are NEVER scores.
 */

import { describe, expect, it } from 'vitest';
import type { MetricComparison, ProtectedCapabilityCheck } from './comparison.js';
import { decideCapabilityLift } from './verdict.js';
import { CAPABILITY_LIFT_VERDICTS } from './verdict.js';
import { createExperimentDescriptor } from './descriptor.js';
import { attributeExperiment } from './attribution.js';
import { computeUncertaintyReport } from './comparison.js';
import { LEARNING_ERROR_CODES } from './errors.js';
import {
  makeEvaluationRecord,
  makeExperimentInput,
  makeTrajectoryRecord,
  makeVerificationRecord,
} from './test-support.js';

async function makeFixture(options: {
  improved?: boolean;
  baselineValue?: number;
  interventionValue?: number;
  interventionVerificationMode?: 'pass' | 'fail';
  evaluatorRefs?: [string, string];
  protectedMeasured?: boolean;
  protectedRegressed?: boolean;
  protectedBaseline?: number;
  protectedIntervention?: number;
  variance?: number | null;
  protectedCapabilities?: readonly { ref: { kind: string; id: string; version: string; digest: string }; metricId: string; direction: string }[];
} = {}) {
  const descriptor = await createExperimentDescriptor(
    makeExperimentInput({
      ...(options.protectedCapabilities === undefined
        ? {}
        : { protectedCapabilities: options.protectedCapabilities }),
    }),
  );
  const baselineTrajectory = await makeTrajectoryRecord();
  const interventionTrajectory = await makeTrajectoryRecord({
    trajectoryId: 'trajectory-learning-0002',
    runId: 'tenant-a/run-learning-0002',
  });
  const [baselineEvaluatorRef, interventionEvaluatorRef] = options.evaluatorRefs ?? [
    '1111111111111111111111111111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111111111111111111111111111',
  ];
  const baselineEvaluation = await makeEvaluationRecord(
    baselineTrajectory.chainHead as string,
    { evaluatorRef: baselineEvaluatorRef },
  );
  const interventionEvaluation = await makeEvaluationRecord(
    interventionTrajectory.chainHead as string,
    { evaluatorRef: interventionEvaluatorRef },
  );
  const baselineVerification = await makeVerificationRecord(
    baselineTrajectory.chainHead as string,
  );
  const interventionVerification = await makeVerificationRecord(
    interventionTrajectory.chainHead as string,
    { mode: options.interventionVerificationMode ?? 'pass' },
  );
  const arms = {
    baseline: {
      trajectories: [baselineTrajectory],
      evaluations: [baselineEvaluation],
      verifications: [baselineVerification],
    },
    intervention: {
      trajectories: [interventionTrajectory],
      evaluations: [interventionEvaluation],
      verifications: [interventionVerification],
    },
  };
  const baselineValue = options.baselineValue ?? 0.8;
  const interventionValue =
    options.interventionValue ?? (options.improved === false ? 0.7 : 0.9);
  const variance = options.variance === undefined ? 0.01 : options.variance;
  const uncertainty = computeUncertaintyReport(
    descriptor.uncertainty,
    [{ metricId: 'reconciliation-accuracy', value: baselineValue, variance }],
    [{ metricId: 'reconciliation-accuracy', value: interventionValue, variance }],
  );
  const attribution = attributeExperiment(
    descriptor,
    arms.baseline,
    arms.intervention,
    uncertainty,
  );
  const comparison = [
    {
      metricId: 'reconciliation-accuracy',
      direction: 'higher-is-better' as const,
      baselineValue,
      interventionValue,
      delta: interventionValue - baselineValue,
      improved: interventionValue > baselineValue,
      regressed: interventionValue < baselineValue,
    },
  ] as unknown as readonly MetricComparison[];
  const protectedRef = descriptor.protectedCapabilities[0]?.ref;
  const protectedChecks =
    protectedRef === undefined
      ? []
      : [
          {
            capabilityRef: protectedRef.digest,
            metricId: 'audit-trail-completeness',
            direction: 'higher-is-better' as const,
            baselineValue: options.protectedMeasured === false ? null : (options.protectedBaseline ?? 0.9),
            interventionValue:
              options.protectedMeasured === false
                ? null
                : (options.protectedIntervention ?? (options.protectedRegressed ? 0.5 : 0.9)),
            delta:
              options.protectedMeasured === false
                ? null
                : (options.protectedIntervention ?? (options.protectedRegressed ? 0.5 : 0.9)) -
                  (options.protectedBaseline ?? 0.9),
            regressed:
              options.protectedMeasured !== false &&
              (options.protectedIntervention ?? (options.protectedRegressed ? 0.5 : 0.9)) <
                (options.protectedBaseline ?? 0.9),
            measured: options.protectedMeasured !== false,
          },
        ] as unknown as readonly ProtectedCapabilityCheck[];
  return {
    descriptor,
    arms,
    uncertainty,
    attribution,
    comparison,
    protectedChecks,
    interventionVerifications: arms.intervention.verifications,
  };
}

describe('decideCapabilityLift - the happy path and the five conditions', () => {
  it('all five conditions hold ⇒ lift-demonstrated, with every condition explicitly true', async () => {
    const fixture = await makeFixture();
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('lift-demonstrated');
    expect(verdict.conditions.pinnedPopulationImprovement).toBe(true);
    expect(verdict.conditions.survivesVerificationAudit).toBe(true);
    expect(verdict.conditions.evaluatorVersionChangesAccounted).toBe(true);
    expect(verdict.conditions.protectedCapabilityRegressionMeasured).toBe(true);
    expect(verdict.conditions.uncertaintyReported).toBe(true);
    expect(verdict.basis).toContain('all five Q1.0 conditions hold');
    expect(Object.isFrozen(verdict)).toBe(true);
  });

  it('condition 1 fails (no improvement, tied values) ⇒ not-demonstrated (not a regression)', async () => {
    const fixture = await makeFixture({ interventionValue: 0.8 });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('not-demonstrated');
    expect(verdict.conditions.pinnedPopulationImprovement).toBe(false);
    expect(verdict.basis).toContain('pinnedPopulationImprovement');
  });

  it('condition 2 fails (failed verification audit) ⇒ not-demonstrated', async () => {
    const fixture = await makeFixture({ interventionVerificationMode: 'fail' });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('not-demonstrated');
    expect(verdict.conditions.survivesVerificationAudit).toBe(false);
  });

  it('condition 2 fails (NO verification in the intervention arm) ⇒ not-demonstrated', async () => {
    const fixture = await makeFixture();
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      [],
    );
    expect(verdict.verdict).toBe('not-demonstrated');
    expect(verdict.conditions.survivesVerificationAudit).toBe(false);
  });

  it('condition 4 fails (unmeasured protected capability) ⇒ not-demonstrated (fails closed)', async () => {
    const fixture = await makeFixture({ protectedMeasured: false });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('not-demonstrated');
    expect(verdict.conditions.protectedCapabilityRegressionMeasured).toBe(false);
  });

  it('condition 4 fails vacuously (no protected capabilities declared) ⇒ not-demonstrated', async () => {
    const fixture = await makeFixture({ protectedCapabilities: [] });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('not-demonstrated');
    expect(verdict.conditions.protectedCapabilityRegressionMeasured).toBe(false);
  });

  it('condition 5 fails (variance unreported) ⇒ not-demonstrated (fails closed)', async () => {
    const fixture = await makeFixture({ variance: null });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('not-demonstrated');
    expect(verdict.conditions.uncertaintyReported).toBe(false);
  });
});

describe('decideCapabilityLift - precedence', () => {
  it('evaluator-version-confound ⇒ inconclusive-unless-controlled EVEN WHEN everything else looks like lift', async () => {
    const fixture = await makeFixture({
      evaluatorRefs: [
        '1111111111111111111111111111111111111111111111111111111111111111',
        '2222222222222222222222222222222222222222222222222222222222222222',
      ],
    });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(fixture.attribution.confounds).toEqual(['evaluator-version-confound']);
    expect(verdict.verdict).toBe('inconclusive-unless-controlled');
    expect(verdict.conditions.evaluatorVersionChangesAccounted).toBe(false);
    expect(verdict.basis).toContain('a changed evaluator score is not automatically a capability improvement');
  });

  it('verifier-version-confound ⇒ inconclusive-unless-controlled', async () => {
    const fixture = await makeFixture();
    const confoundedAttribution = {
      ...fixture.attribution,
      confounds: ['verifier-version-confound' as const],
    };
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      confoundedAttribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('inconclusive-unless-controlled');
  });

  it('confound outranks an apparent protected regression (the measurement itself is unestablished)', async () => {
    const fixture = await makeFixture({
      evaluatorRefs: [
        '1111111111111111111111111111111111111111111111111111111111111111',
        '2222222222222222222222222222222222222222222222222222222222222222',
      ],
      protectedRegressed: true,
    });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('inconclusive-unless-controlled');
    // The regression finding is still carried in the checks - not silently absorbed.
    expect(fixture.protectedChecks[0]?.regressed).toBe(true);
  });

  it('protected capability regression (no confound) ⇒ regression-detected', async () => {
    const fixture = await makeFixture({ protectedRegressed: true });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('regression-detected');
    expect(verdict.basis).toContain('protected capabilities regressed');
  });

  it('outcome-metric regression (no confound) ⇒ regression-detected', async () => {
    const fixture = await makeFixture({ interventionValue: 0.5, protectedIntervention: 0.95 });
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(verdict.verdict).toBe('regression-detected');
    expect(verdict.basis).toContain('outcome metrics regressed: reconciliation-accuracy');
  });
});

describe('verdict vocabulary - closed, never a score', () => {
  it('CAPABILITY_LIFT_VERDICTS is the closed four-member vocabulary', () => {
    expect([...CAPABILITY_LIFT_VERDICTS]).toEqual([
      'lift-demonstrated',
      'not-demonstrated',
      'inconclusive-unless-controlled',
      'regression-detected',
    ]);
  });

  it('verdict objects are never numeric (never a score)', async () => {
    const fixture = await makeFixture();
    const verdict = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(typeof verdict.verdict).toBe('string');
    expect(CAPABILITY_LIFT_VERDICTS).toContain(verdict.verdict);
    for (const value of Object.values(verdict.conditions)) {
      expect(typeof value).toBe('boolean');
    }
  });

  it('REJECTS an empty comparison', async () => {
    const fixture = await makeFixture();
    expect(() =>
      decideCapabilityLift(
        fixture.descriptor,
        [],
        fixture.uncertainty,
        fixture.attribution,
        fixture.protectedChecks,
        fixture.interventionVerifications,
      ),
    ).toThrowError(
      expect.objectContaining({ code: LEARNING_ERROR_CODES.INVALID_VERDICT }),
    );
  });

  it('is deterministic: same inputs ⇒ same verdict', async () => {
    const fixture = await makeFixture();
    const a = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    const b = decideCapabilityLift(
      fixture.descriptor,
      fixture.comparison,
      fixture.uncertainty,
      fixture.attribution,
      fixture.protectedChecks,
      fixture.interventionVerifications,
    );
    expect(a).toEqual(b);
  });
});
