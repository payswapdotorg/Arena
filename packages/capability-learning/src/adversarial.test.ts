/**
 * Adversarial minimum suite (Work Order C022) — the five adversarial
 * cases the work order names, each proven against the REAL compiler:
 *
 *   1. an ungated improvement adopted without a verification audit —
 *      MUST fail closed;
 *   2. an evaluator-change masquerading as capability lift — the score
 *      improved but the evaluator version changed: NEVER an adoption;
 *   3. a historical-trajectory rewrite attempt — a program output
 *      colliding with a historical digest the compilation consumed;
 *   4. a rights-free candidate compiled into a globally reusable
 *      artifact — impossible at compilation AND at proposal time;
 *   5. cross-tenant candidate leakage — a tenant-B run record can never
 *      adopt a tenant-A program.
 */

import { describe, expect, it } from 'vitest';
import { compilePrograms } from './program.js';
import { assembleProgramExperiment } from './experiment.js';
import { evaluateAdoptionGate } from './gate.js';
import { createGatedImprovementProposal } from './proposal.js';
import { checkProgramBoundary, enforceCompilerBoundary, historicalDigestsOfCompilation } from './boundary.js';
import type { ImprovementProgram } from './program.js';
import { makeCandidate, makeRunRecord } from './test-support.js';

type Compilable = { program: ImprovementProgram };

async function compiled(options: Parameters<typeof makeCandidate>[0] = {}) {
  const candidates = await Promise.all([
    makeCandidate({ candidateId: 'candidate-adversarial', changedSurface: 'skills', ...options }),
  ]);
  const outcomes = await compilePrograms(candidates, { compiledBy: 'arena-adversarial-test' });
  return { candidates, outcomes };
}

describe('adversarial — ungated improvement adopted without verification audit', () => {
  it('MUST fail closed: no proposal object is ever produced', async () => {
    const { candidates, outcomes } = await compiled();
    const program = (outcomes[0] as Compilable).program;
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-adversarial-1' });
    // The intervention arm carried ZERO passing verifications.
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'not-demonstrated',
      conditions: { survivesVerificationAudit: false, uncertaintyReported: true },
      variance: 0.01,
    });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(gateVerdict.kind).toBe('rejected-with-reasons');
    expect(gateVerdict.reasons).toContain('verification-audit-not-survived');
    await expect(
      createGatedImprovementProposal(program, gateVerdict, {
        destination: 'body-forge',
        proposedBy: 'attacker',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_NOT_ADOPTED' });
  });
});

describe('adversarial — evaluator change masquerading as capability lift', () => {
  it('MUST NOT adopt: the confound outranks the improved score', async () => {
    const { candidates, outcomes } = await compiled();
    const program = (outcomes[0] as Compilable).program;
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-adversarial-2' });
    // The score improved 0.8 → 0.95, BUT the evaluator digest changed between arms.
    const runRecord = await makeRunRecord({
      descriptorRef: experiment.digest as string,
      verdictKind: 'inconclusive-unless-controlled',
      baselineValue: 0.8,
      interventionValue: 0.95,
      confounds: ['evaluator-version-confound'],
      conditions: { evaluatorVersionChangesAccounted: false },
      variance: 0.01,
    });
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(gateVerdict.kind).toBe('rejected-with-reasons');
    expect(gateVerdict.reasons).toContain('evaluator-version-confound');
    expect(gateVerdict.measuredLift[0]?.improved).toBe(true); // the score DID improve — and it still does not adopt
    expect(gateVerdict.basis).toContain('NOT automatically a capability improvement');
    await expect(
      createGatedImprovementProposal(program, gateVerdict, { destination: 'body-forge', proposedBy: 'attacker' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_NOT_ADOPTED' });
  });
});

describe('adversarial — historical-trajectory rewrite attempt', () => {
  it('MUST be rejected: a program output colliding with a consumed historical digest', async () => {
    const { candidates, outcomes } = await compiled();
    const program = (outcomes[0] as Compilable).program;
    const historical = historicalDigestsOfCompilation(candidates);
    // The attacker forges a "program" whose proposed artifact IS the
    // historical trajectory digest the compilation consumed.
    const forged = { ...program, proposedArtifactRef: historical[0] } as ImprovementProgram;
    expect(() => enforceCompilerBoundary(historical, forged)).toThrowError(
      /learning boundary violation/i,
    );
    expect(() => checkProgramBoundary(forged, candidates)).toThrowError(/learning boundary violation/i);
  });

  it('the gate ALSO refuses a boundary-violating program (defense in depth)', async () => {
    const { candidates, outcomes } = await compiled();
    const program = (outcomes[0] as Compilable).program;
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-adversarial-3' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const historical = historicalDigestsOfCompilation(candidates);
    const forged = { ...program, proposedArtifactRef: historical[0] } as ImprovementProgram;
    const gateVerdict = await evaluateAdoptionGate({
      program: forged,
      runRecord,
      experiment,
      candidates,
    });
    expect(gateVerdict.kind).toBe('rejected-with-reasons');
    expect(gateVerdict.reasons).toContain('boundary-violation');
  });
});

describe('adversarial — rights-free candidate into a globally reusable artifact', () => {
  it('MUST be blocked at compilation with rights-insufficient', async () => {
    const { outcomes } = await compiled({
      rightsStatus: 'insufficient',
      globalReuseRequested: true,
    });
    const blocked = outcomes[0];
    expect(blocked?.kind).toBe('blocked');
    if (blocked?.kind === 'blocked') {
      expect(blocked.reasons.map((reason) => reason.reason)).toContain('rights-insufficient');
    }
  });

  it('a tenant-scoped candidate compiles but NEVER produces a globally reusable program', async () => {
    const { outcomes } = await compiled({
      rightsStatus: 'granted-tenant-scoped',
      globalReuseRequested: false,
    });
    const program = (outcomes[0] as Compilable).program;
    expect(program.globalReuse).toBe(false);
    expect(program.rights.status).toBe('granted-tenant-scoped');
    // Even an adopted tenant-scoped program proposes WITHOUT global reuse.
    const experiment = await assembleProgramExperiment(program, { experimentId: 'experiment-adversarial-4' });
    const runRecord = await makeRunRecord({ descriptorRef: experiment.digest as string });
    const candidates = await Promise.all([
      makeCandidate({
        candidateId: 'candidate-adversarial',
        changedSurface: 'skills',
        rightsStatus: 'granted-tenant-scoped',
        globalReuseRequested: false,
      }),
    ]);
    const gateVerdict = await evaluateAdoptionGate({
      program,
      runRecord,
      experiment,
      candidates,
    });
    expect(gateVerdict.kind).toBe('adopted-with-evidence');
    const proposal = await createGatedImprovementProposal(program, gateVerdict, {
      destination: 'body-forge',
      proposedBy: 'x',
    });
    expect(proposal.globalReuse).toBe(false);
  });
});

describe('adversarial — cross-tenant candidate leakage', () => {
  it('tenant-B run evidence can NEVER adopt a tenant-A program (binding by digest)', async () => {
    const tenantACandidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-tenant-a', tenantId: 'tenant-a', changedSurface: 'skills' }),
    ]);
    const outcomes = await compilePrograms(tenantACandidates, { compiledBy: 'x' });
    const programA = (outcomes[0] as Compilable).program;
    expect(programA.tenantId).toBe('tenant-a');
    const experimentA = await assembleProgramExperiment(programA, { experimentId: 'experiment-tenant-a' });
    const runRecordA = await makeRunRecord({ descriptorRef: experimentA.digest as string });
    // Tenant B replays tenant A's evidence against ITS OWN program.
    const tenantBCandidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-tenant-b', tenantId: 'tenant-b', changedSurface: 'skills' }),
    ]);
    const outcomesB = await compilePrograms(tenantBCandidates, { compiledBy: 'x' });
    const programB = (outcomesB[0] as Compilable).program;
    const gateVerdictA = await evaluateAdoptionGate({
      program: programB,
      experiment: experimentA,
      runRecord: runRecordA,
      candidates: tenantACandidates,
    });
    // The verdict binds to programB but the run record belongs to
    // programA's experiment — the digest binding refuses the adoption.
    expect(gateVerdictA.kind).toBe('rejected-with-reasons');
    expect(gateVerdictA.reasons).toContain('program-experiment-mismatch');
    await expect(
      createGatedImprovementProposal(programB, gateVerdictA, { destination: 'body-forge', proposedBy: 'tenant-b' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_NOT_ADOPTED' });
  });

  it('compilePrograms never merges candidates across tenants into one program', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-a', tenantId: 'tenant-a' }),
      makeCandidate({ candidateId: 'candidate-b', tenantId: 'tenant-b' }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const tenants = outcomes.map((outcome) =>
      outcome.kind === 'compilable' ? (outcome.program.tenantId as string) : 'blocked',
    );
    expect(tenants).toContain('tenant-a');
    expect(tenants).toContain('tenant-b');
    expect(outcomes.length).toBe(2);
  });
});
