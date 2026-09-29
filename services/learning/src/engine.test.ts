/**
 * ExperimentEngine tests — the reference runner: the happy path
 * (lift-demonstrated), determinism, idempotency, confounds
 * (inconclusive-unless-controlled), regressions, unmeasured
 * protected capabilities, and proposals.
 */

import { describe, expect, it } from 'vitest';
import { ExperimentEngine } from './engine.js';
import { LEARNING_ERROR_CODES } from '@arena/learning';
import {
  CORR_ID,
  DIGEST_A,
  DIGEST_B,
  T7,
  makeArms,
  makeDescriptor,
} from './test-support.js';

describe('ExperimentEngine — the happy path', () => {
  it('runs a clean experiment and emits lift-demonstrated with the full record', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-fabric-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.verdict.verdict).toBe('lift-demonstrated');
    expect(record.verdict.conditions.pinnedPopulationImprovement).toBe(true);
    expect(record.verdict.conditions.survivesVerificationAudit).toBe(true);
    expect(record.verdict.conditions.evaluatorVersionChangesAccounted).toBe(true);
    expect(record.verdict.conditions.protectedCapabilityRegressionMeasured).toBe(true);
    expect(record.verdict.conditions.uncertaintyReported).toBe(true);
    expect(record.attribution.findings).toHaveLength(6);
    expect(record.attribution.confounds).toEqual([]);
    expect(record.comparison[0]?.improved).toBe(true);
    expect(record.descriptorRef).toBe(descriptor.digest);
    expect(record.baseline.trajectories).toHaveLength(1);
    expect(engine.getRunRecord(record.digest as string)).toBe(record);
    expect(engine.listRuns()).toHaveLength(1);
    expect(engine.listRunsByDescriptor(descriptor.digest as string)).toHaveLength(1);
    expect(engine.listRunsByCorrelation(CORR_ID)).toHaveLength(1);
  });

  it('is DETERMINISTIC: same descriptor + same arms + same clock ⇒ the same record digest', async () => {
    const engineA = new ExperimentEngine();
    const engineB = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engineA.registerExperiment(descriptor);
    await engineB.registerExperiment(descriptor);
    const arms = await makeArms();
    const a = await engineA.run(descriptor.digest as string, arms, {
      experimentKey: 'run-det-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const b = await engineB.run(descriptor.digest as string, arms, {
      experimentKey: 'run-det-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(a.digest).toBe(b.digest);
    expect(a).toEqual(b);
  });

  it('idempotent replay: the same experiment key + the same command ⇒ the STORED record', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const first = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-idem-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const replay = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-idem-0001',
      correlationId: CORR_ID,
      recordedAt: '2026-04-01T09:00:00.000Z', // different clock — replay must ignore it
    });
    expect(replay).toBe(first);
    expect(engine.listRuns()).toHaveLength(1);
  });

  it('IDEMPOTENCY_CONFLICT: the same key + a different command tuple', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-conflict-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const otherArms = await makeArms({}, { metricValue: 0.95 });
    await expect(
      engine.run(descriptor.digest as string, otherArms, {
        experimentKey: 'run-conflict-0001',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });

  it('content-addressed dedup: identical runs under different keys collapse to one record', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const a = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-dedup-a',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const b = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-dedup-b',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    // Same content (except key) — different record digests (key is content), both stored.
    expect(a.digest).not.toBe(b.digest);
    expect(engine.listRuns()).toHaveLength(2);
  });
});

describe('ExperimentEngine — verdict paths', () => {
  it('evaluator digests differing between arms ⇒ inconclusive-unless-controlled', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms(
      { evaluatorRef: DIGEST_A },
      { evaluatorRef: DIGEST_B },
    );
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-confound-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.attribution.confounds).toEqual(['evaluator-version-confound']);
    expect(record.verdict.verdict).toBe('inconclusive-unless-controlled');
    expect(record.verdict.basis).toContain('measurement validity not established');
  });

  it('verifier digests differing between arms ⇒ inconclusive-unless-controlled', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms(
      { verifierId: 'verifier-fabric-0001' },
      { verifierId: 'verifier-fabric-0002' },
    );
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-confound-0002',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.attribution.confounds).toEqual(['verifier-version-confound']);
    expect(record.verdict.verdict).toBe('inconclusive-unless-controlled');
  });

  it('protected-capability regression ⇒ regression-detected', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms({}, { protectedValue: 0.4 });
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-regression-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.verdict.verdict).toBe('regression-detected');
    expect(record.protectedCapabilityChecks[0]?.regressed).toBe(true);
  });

  it('unmeasured protected capability ⇒ not-demonstrated (fails closed)', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms({}, { omitProtected: true });
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-unmeasured-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.verdict.verdict).toBe('not-demonstrated');
    expect(record.verdict.conditions.protectedCapabilityRegressionMeasured).toBe(false);
    expect(record.protectedCapabilityChecks[0]?.measured).toBe(false);
  });

  it('failed verification audit ⇒ not-demonstrated', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms({}, { verificationMode: 'fail' });
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-audit-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.verdict.verdict).toBe('not-demonstrated');
    expect(record.verdict.conditions.survivesVerificationAudit).toBe(false);
  });

  it('unreported variance ⇒ not-demonstrated (fails closed)', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms(
      { metricVariance: null },
      { metricVariance: null },
    );
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-variance-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.verdict.verdict).toBe('not-demonstrated');
    expect(record.verdict.conditions.uncertaintyReported).toBe(false);
    expect(record.uncertainty.entries[0]?.baselineVariance).toBeNull();
  });
});

describe('ExperimentEngine — proposals (learning boundary)', () => {
  it('proposes a NEW artifact from a completed run and stores it', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-propose-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const proposal = await engine.proposeArtifact(
      record,
      {
        proposalId: 'proposal-fabric-0001',
        version: '1.0.0',
        proposedArtifactRef: 'a'.repeat(64),
        changedSurface: 'skills',
        supersedes: null,
        provenance: { proposedBy: 'arena-learning-fabric-test', proposedAt: T7, notes: null },
      },
      arms,
    );
    expect(proposal.basisExperimentRef).toBe(record.digest);
    expect(engine.getProposal(proposal.digest as string)).toBe(proposal);
    expect(engine.listProposals()).toHaveLength(1);
  });

  it('REJECTS a rewrite attempt (proposing a historical digest) with LEARNING_REWRITE_ATTEMPT', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-propose-0002',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    // Adversarial: propose the BASELINE TRAJECTORY ITSELF as the learning output.
    await expect(
      engine.proposeArtifact(
        record,
        {
          proposalId: 'proposal-rewrite-0001',
          version: '1.0.0',
          proposedArtifactRef: arms.baseline.trajectories[0]?.chainHead as string,
          changedSurface: 'body-composition',
          supersedes: null,
          provenance: { proposedBy: 'arena-learning-fabric-test', proposedAt: T7, notes: null },
        },
        arms,
      ),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.REWRITE_ATTEMPT });
    expect(engine.listProposals()).toHaveLength(0);
  });

  it('REJECTS proposals when the motivating descriptor cannot be resolved', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-propose-0003',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const orphanRecord = {
      ...record,
      descriptorRef: '0'.repeat(64),
    } as typeof record;
    await expect(
      engine.proposeArtifact(
        orphanRecord,
        {
          proposalId: 'proposal-orphan-0001',
          version: '1.0.0',
          proposedArtifactRef: 'a'.repeat(64),
          changedSurface: 'skills',
          supersedes: null,
          provenance: { proposedBy: 'arena-learning-fabric-test', proposedAt: T7, notes: null },
        },
        arms,
      ),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.NOT_FOUND });
  });
});

describe('ExperimentEngine — input record identity preserved', () => {
  it('run() leaves every input record bit-identical (read-only over the evidence tier)', async () => {
    const engine = new ExperimentEngine();
    const descriptor = await makeDescriptor();
    await engine.registerExperiment(descriptor);
    const arms = await makeArms();
    const sourceDigestsBefore = [
      ...arms.baseline.trajectories.map((t) => t.chainHead),
      ...arms.baseline.evaluations.map((e) => e.digest),
      ...arms.baseline.verifications.map((v) => v.digest),
      ...arms.intervention.trajectories.map((t) => t.chainHead),
      ...arms.intervention.evaluations.map((e) => e.digest),
      ...arms.intervention.verifications.map((v) => v.digest),
    ];
    await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-readonly-0001',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    const sourceDigestsAfter = [
      ...arms.baseline.trajectories.map((t) => t.chainHead),
      ...arms.baseline.evaluations.map((e) => e.digest),
      ...arms.baseline.verifications.map((v) => v.digest),
      ...arms.intervention.trajectories.map((t) => t.chainHead),
      ...arms.intervention.evaluations.map((e) => e.digest),
      ...arms.intervention.verifications.map((v) => v.digest),
    ];
    expect(sourceDigestsAfter).toEqual(sourceDigestsBefore);
    // every input record frozen
    for (const record of [
      ...arms.baseline.trajectories,
      ...arms.baseline.evaluations,
      ...arms.baseline.verifications,
      ...arms.intervention.trajectories,
      ...arms.intervention.evaluations,
      ...arms.intervention.verifications,
    ]) {
      expect(Object.isFrozen(record)).toBe(true);
    }
  });
});
