/**
 * Experiment assembly + adoption gate + gated proposal + feedback tests.
 * Gate: the Q1.0 five-condition mapping, the typed closed verdicts and
 * the fail-closed behaviors (verification audit missing, evaluator
 * masquerade, program binding, insufficient sample).
 */

import { describe, expect, it } from 'vitest';
import { assembleExperimentDescriptorInput, assembleProgramExperiment } from './experiment.js';
import { evaluateAdoptionGate } from './gate.js';
import { createGatedImprovementProposal, routeGatedProposals } from './proposal.js';
import { compilePrograms } from './program.js';
import { createFeedbackRecord, rankByExpectedInformationValue } from './feedback.js';
import { makeCandidate, makeRunRecord } from './test-support.js';
import { DIGEST_C } from './test-support.js';

async function compiledFixture() {
  const candidates = await Promise.all([
    makeCandidate({ candidateId: 'candidate-skills-1', changedSurface: 'skills', artifactDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    makeCandidate({ candidateId: 'candidate-skills-2', changedSurface: 'skills', artifactDigest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
  ]);
  const outcomes = await compilePrograms(candidates, { compiledBy: 'arena-capability-learning-test' });
  const program = (outcomes.find(
    (outcome) => outcome.kind === 'compilable' && outcome.program.interventionClass === 'skills',
  ) as { program: import('./program.js').ImprovementProgram }).program;
  return { candidates, program };
}

describe('experiment assembly (LE1.0 minimum field list)', () => {
  it('assembles a descriptor input carrying EVERY LE1.0 minimum field', async () => {
    const { program } = await compiledFixture();
    const input = assembleExperimentDescriptorInput(program, { experimentId: 'experiment-cl-0001' });
    expect(input.experimentId).toBe('experiment-cl-0001');
    expect(input.targetCapability.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(input.baseline.bodyRef).toMatch(/^[0-9a-f]{64}$/);
    expect(input.interventions.length).toBe(2);
    expect(input.interventions.every((entry) => entry.changedSurface === 'skills')).toBe(true);
    expect(input.taskPopulation.length).toBeGreaterThan(0);
    expect(input.evaluationSuiteRefs.length).toBeGreaterThan(0);
    expect(input.verificationSuiteRefs.length).toBeGreaterThan(0);
    expect(input.environmentVersions.length).toBeGreaterThan(0);
    expect(input.outcomeMetrics.length).toBeGreaterThan(0);
    expect(input.uncertainty.method).toBe('analytic-variance');
    expect(input.protectedCapabilities.length).toBeGreaterThan(0);
    expect(typeof input.provenance.authoredBy).toBe('string');
  });

  it('constructs a REAL A020 ExperimentDescriptor (deterministic)', async () => {
    const { program } = await compiledFixture();
    const first = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const second = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    expect(first.digest).toBe(second.digest);
    expect(first.interventions.every((entry) => entry.changedSurface === 'skills')).toBe(true);
  });
});

describe('Q1.0 capability-lift adoption gate', () => {
  it('adopted-with-evidence when the A020 verdict is lift-demonstrated and bound', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const verdict = await evaluateAdoptionGate({
      program,
      experiment,
      runRecord,
      candidates,
    });
    expect(verdict.kind).toBe('adopted-with-evidence');
    expect(verdict.reasons).toEqual([]);
    expect(verdict.measuredLift.length).toBe(1);
    expect(verdict.measuredLift[0]?.improved).toBe(true);
    expect(verdict.conditions.pinnedPopulationImprovement).toBe(true);
    expect(verdict.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is PURE: same program + same run record ⇒ same verdict digest', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const first = await evaluateAdoptionGate({ program, experiment, runRecord, candidates });
    const second = await evaluateAdoptionGate({ program, experiment, runRecord, candidates });
    expect(first.digest).toBe(second.digest);
  });

  it('rejected-with-reasons when the verification audit is missing (fail-closed)', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'not-demonstrated',
      conditions: { survivesVerificationAudit: false, uncertaintyReported: true },
      variance: 0.01,
    });
    const verdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(verdict.kind).toBe('rejected-with-reasons');
    expect(verdict.reasons).toContain('verification-audit-not-survived');
  });

  it('rejected-with-reasons on an evaluator-version confound (an evaluator change is NEVER a capability improvement)', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'inconclusive-unless-controlled',
      confounds: ['evaluator-version-confound'],
      conditions: { evaluatorVersionChangesAccounted: false },
    });
    const verdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(verdict.kind).toBe('rejected-with-reasons');
    expect(verdict.reasons).toContain('evaluator-version-confound');
    expect(verdict.attributionConfounds).toContain('evaluator-version-confound');
  });

  it('rejected-with-reasons on a verifier-version confound', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'inconclusive-unless-controlled',
      confounds: ['verifier-version-confound'],
      conditions: { evaluatorVersionChangesAccounted: false },
    });
    const verdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(verdict.kind).toBe('rejected-with-reasons');
    expect(verdict.reasons).toContain('verifier-version-confound');
  });

  it('rejected-with-reasons on protected-capability regression', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'regression-detected',
      protectedRegressed: true,
      variance: 0.01,
    });
    const verdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(verdict.kind).toBe('rejected-with-reasons');
    expect(verdict.reasons).toContain('protected-capability-regression');
  });

  it('unknown-insufficient-sample when the ONLY unmet condition is unreported variance', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'not-demonstrated',
      conditions: { uncertaintyReported: false },
      variance: null,
    });
    const verdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(verdict.kind).toBe('unknown-insufficient-sample');
    expect(verdict.reasons).toEqual([]);
  });

  it('rejected (NOT unknown) when unreported variance accompanies other failures', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'not-demonstrated',
      conditions: { uncertaintyReported: false, survivesVerificationAudit: false },
      variance: null,
    });
    const verdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(verdict.kind).toBe('rejected-with-reasons');
    expect(verdict.reasons).toContain('verification-audit-not-survived');
  });

  it('rejected program-experiment-mismatch: a run of a DIFFERENT experiment cannot adopt this program', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({ descriptorRef: DIGEST_C });
    const verdict = await evaluateAdoptionGate({
      program,
      experiment,
      runRecord,
      candidates,
    });
    expect(verdict.kind).toBe('rejected-with-reasons');
    expect(verdict.reasons).toContain('program-experiment-mismatch');
  });

  it('never emits a bare boolean (the verdict is a typed closed vocabulary)', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const verdict = await evaluateAdoptionGate({
      program,
      experiment,
      runRecord,
      candidates,
    });
    expect(typeof verdict.kind).toBe('string');
    expect(['adopted-with-evidence', 'rejected-with-reasons', 'unknown-insufficient-sample']).toContain(
      verdict.kind,
    );
  });
});

describe('gated proposals', () => {
  it('adopts → proposes into body-forge with the adoption evidence verbatim', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    const proposal = await createGatedImprovementProposal(program, gateVerdict, {
      destination: 'body-forge',
      proposedBy: 'arena-capability-learning-test',
    });
    expect(proposal.destination).toBe('body-forge');
    expect(proposal.adoptionEvidence.gateVerdictRef).toBe(gateVerdict.digest);
    expect(proposal.programRef).toBe(program.digest);
    expect(proposal.proposedArtifactRef).toBe(program.proposedArtifactRef);
  });

  it('REFUSES a rejected gate verdict (adoption of an ungated improvement is structurally impossible)', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'not-demonstrated',
      conditions: { survivesVerificationAudit: false },
      variance: 0.01,
    });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    await expect(
      createGatedImprovementProposal(program, gateVerdict, {
        destination: 'body-forge',
        proposedBy: 'x',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_NOT_ADOPTED' });
  });

  it('REFUSES an unknown-insufficient-sample verdict (honest unknown is still not adoption)', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'not-demonstrated',
      conditions: { uncertaintyReported: false },
      variance: null,
    });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(gateVerdict.kind).toBe('unknown-insufficient-sample');
    await expect(
      createGatedImprovementProposal(program, gateVerdict, {
        destination: 'body-forge',
        proposedBy: 'x',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_NOT_ADOPTED' });
  });

  it('REFUSES a gate verdict bound to a DIFFERENT program', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    const otherCandidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-other', changedSurface: 'procedures' }),
    ]);
    const otherOutcomes = await compilePrograms(otherCandidates, { compiledBy: 'x' });
    const otherProgram = (otherOutcomes[0] as { program: import('./program.js').ImprovementProgram }).program;
    await expect(
      createGatedImprovementProposal(otherProgram, gateVerdict, {
        destination: 'body-forge',
        proposedBy: 'x',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_INVALID_PROPOSAL' });
  });

  it('routes: every adopted program proposes body-forge; substrate classes add compatibility-retest', async () => {
    const substrateCandidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-substrate', changedSurface: 'substrate' }),
    ]);
    const outcomes = await compilePrograms(substrateCandidates, { compiledBy: 'x' });
    const program = (outcomes[0] as { program: import('./program.js').ImprovementProgram }).program;
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-substrate' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      experiment,
      runRecord,
      candidates: substrateCandidates,
    });
    const proposals = await routeGatedProposals(program, gateVerdict, { proposedBy: 'x' });
    const destinations = proposals.map((proposal) => proposal.destination);
    expect(destinations).toContain('body-forge');
    expect(destinations).toContain('compatibility-retest');
    expect(destinations).not.toContain('recertification-trigger');
  });

  it('routes: superseding programs add the recertification trigger', async () => {
    const prior = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-superseding', changedSurface: 'skills', supersedes: prior }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const program = (outcomes[0] as { program: import('./program.js').ImprovementProgram }).program;
    expect(program.supersedes).toBe(prior);
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-supersede' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    const proposals = await routeGatedProposals(program, gateVerdict, { proposedBy: 'x' });
    const destinations = proposals.map((proposal) => proposal.destination);
    expect(destinations).toContain('body-forge');
    expect(destinations).toContain('recertification-trigger');
    expect(destinations).not.toContain('compatibility-retest');
  });
});

describe('feedback record + expected-information-value selection', () => {
  it('records which interventions produced which improvement with what measured lift', async () => {
    const { candidates, program } = await compiledFixture();
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-cl-0001' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    const feedback = await createFeedbackRecord({
      feedbackId: 'feedback-0001',
      tenantId: 'tenant-a',
      interventionClass: program.interventionClass,
      programRef: program.digest as string,
      candidateRefs: candidates.map((entry) => entry.digest as string),
      gateVerdict: gateVerdict.kind,
      measuredLift: [...(gateVerdict.measuredLift as { metricId: string; baselineValue: number; interventionValue: number; delta: number; improved: boolean }[])],
      runRecordRef: runRecord.digest as string,
      recordedAt: '2026-10-08T00:00:00.000Z',
    });
    expect(feedback.interventionClass).toBe('skills');
    expect(feedback.candidateRefs.length).toBe(2);
    expect(feedback.gateVerdict).toBe('adopted-with-evidence');
    expect(feedback.measuredLift[0]?.delta).toBeCloseTo(0.1, 10);
  });

  it('ranks unexplored classes above explored ones, with an inspectable rationale', async () => {
    const history = [
      await createFeedbackRecord({
        feedbackId: 'feedback-skills-0001',
        tenantId: 'tenant-a',
        interventionClass: 'skills',
        programRef: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        candidateRefs: ['cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
        gateVerdict: 'adopted-with-evidence',
        measuredLift: [{ metricId: 'reconciliation-accuracy', baselineValue: 0.8, interventionValue: 0.9, delta: 0.1, improved: true }],
        runRecordRef: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        recordedAt: '2026-10-08T00:00:00.000Z',
      }),
    ];
    const ranking = rankByExpectedInformationValue(history, [
      { tenantId: 'tenant-a', interventionClass: 'skills' },
      { tenantId: 'tenant-a', interventionClass: 'substrate' },
    ]);
    expect(ranking[0]?.interventionClass).toBe('substrate');
    expect(ranking[0]?.rationale).toContain('no prior feedback');
    expect(ranking[1]?.rationale).toContain('1 prior outcome');
    expect(typeof ranking[0]?.expectedInformationValue).toBe('number');
  });

  it('is deterministic: same history ⇒ same ranking', async () => {
    const history = [
      await createFeedbackRecord({
        feedbackId: 'feedback-0001',
        tenantId: 'tenant-a',
        interventionClass: 'procedures',
        programRef: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        candidateRefs: ['cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'],
        gateVerdict: 'rejected-with-reasons',
        measuredLift: [],
        runRecordRef: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        recordedAt: '2026-10-08T00:00:00.000Z',
      }),
    ];
    const selections = [
      { tenantId: 'tenant-a', interventionClass: 'procedures' as const },
      { tenantId: 'tenant-a', interventionClass: 'memory-policy' as const },
    ];
    const first = rankByExpectedInformationValue(history, selections);
    const second = rankByExpectedInformationValue(history, selections);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
