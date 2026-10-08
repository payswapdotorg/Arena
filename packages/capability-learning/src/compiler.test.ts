/**
 * Compiler core tests — determinism, the one-program-per-class closure,
 * the typed blocked outcomes (rights-insufficient, evidence-insufficient,
 * scope-conflict) and the rights roll-up (global reuse requires explicit
 * rights on EVERY candidate — lock rules 31/32).
 */

import { describe, expect, it } from 'vitest';
import { compilePrograms } from './program.js';
import type { CompilationOutcome } from './program.js';
import { COMPILER_INTERVENTION_CLASSES } from './program.js';
import { makeCandidate } from './test-support.js';
import { OTHER_TARGET_CAPABILITY } from './test-support.js';

describe('compilePrograms — determinism', () => {
  it('identical candidates ⇒ byte-identical programs (same digests)', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-a' }),
      makeCandidate({ candidateId: 'candidate-b', changedSurface: 'retrieval-knowledge' }),
    ]);
    const first = await compilePrograms(candidates, { compiledBy: 'arena-capability-learning-test' });
    const second = await compilePrograms(
      [...candidates].reverse(),
      { compiledBy: 'arena-capability-learning-test' },
    );
    expect(first.length).toBe(second.length);
    for (let index = 0; index < first.length; index += 1) {
      expect(first[index]?.kind).toBe(second[index]?.kind);
      if (first[index]?.kind === 'compilable' && second[index]?.kind === 'compilable') {
        expect((first[index] as { program: { digest: string } }).program.digest).toBe(
          (second[index] as { program: { digest: string } }).program.digest,
        );
      }
    }
  });

  it('candidate input ORDER never changes the outcome order (canonical sorting)', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-z', changedSurface: 'substrate' }),
      makeCandidate({ candidateId: 'candidate-a', changedSurface: 'skills' }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const classes = outcomes.map((outcome) =>
      outcome.kind === 'compilable' ? outcome.program.interventionClass : 'blocked',
    );
    expect(classes).toEqual(['skills', 'substrate']);
  });

  it('duplicate candidates deduplicate (same digest counted once)', async () => {
    const candidate = await makeCandidate();
    const outcomes = await compilePrograms([candidate, candidate], { compiledBy: 'x' });
    expect(outcomes.length).toBe(1);
    const outcome = outcomes[0] as Extract<CompilationOutcome, { kind: 'compilable' }>;
    expect(outcome.program.candidateRefs.length).toBe(1);
  });
});

describe('compilePrograms — one program per LE1.0 intervention class', () => {
  it('emits exactly one program per (tenant, class) with the class EXPLICIT', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-skills-1', changedSurface: 'skills' }),
      makeCandidate({ candidateId: 'candidate-skills-2', changedSurface: 'skills' }),
      makeCandidate({ candidateId: 'candidate-memory', changedSurface: 'memory-policy' }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    expect(outcomes.length).toBe(2);
    const skills = outcomes.find(
      (outcome) => outcome.kind === 'compilable' && outcome.program.interventionClass === 'skills',
    ) as Extract<CompilationOutcome, { kind: 'compilable' }>;
    expect(skills.program.candidateRefs.length).toBe(2);
    expect(skills.program.interventions.every((entry) => entry.changedSurface === 'skills')).toBe(true);
  });

  it('separates tenants (tenant isolation at the domain level)', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-a', tenantId: 'tenant-a' }),
      makeCandidate({ candidateId: 'candidate-b', tenantId: 'tenant-b' }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    expect(outcomes.length).toBe(2);
    const tenants = outcomes.map((outcome) =>
      outcome.kind === 'compilable' ? outcome.program.tenantId : 'blocked',
    );
    expect(new Set(tenants).size).toBe(2);
  });

  it('covers the full LE1.0 nine-class closure (parity with @arena/learning)', () => {
    expect(COMPILER_INTERVENTION_CLASSES).toEqual([
      'skills',
      'procedures',
      'retrieval-knowledge',
      'tool-configuration',
      'memory-policy',
      'evaluator-verifier',
      'substrate',
      'model-specific-adaptation',
      'body-composition',
    ]);
    expect(COMPILER_INTERVENTION_CLASSES.length).toBe(9);
  });
});

describe('compilePrograms — typed blocked outcomes', () => {
  it('blocks rights-insufficient: global reuse requested without granted rights', async () => {
    const candidates = await Promise.all([
      makeCandidate({
        candidateId: 'candidate-rights-free',
        globalReuseRequested: true,
        rightsStatus: 'insufficient',
      }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    expect(outcomes.length).toBe(1);
    const blocked = outcomes[0] as Extract<CompilationOutcome, { kind: 'blocked' }>;
    expect(blocked.kind).toBe('blocked');
    expect(blocked.reasons.some((reason) => reason.reason === 'rights-insufficient')).toBe(true);
  });

  it('a tenant-scoped grant requesting global reuse is ALSO blocked (rights roll-up is weakest-grant)', async () => {
    const candidates = await Promise.all([
      makeCandidate({
        candidateId: 'candidate-global',
        globalReuseRequested: true,
        rightsStatus: 'granted-tenant-scoped',
      }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const blocked = outcomes[0] as Extract<CompilationOutcome, { kind: 'blocked' }>;
    expect(blocked.kind).toBe('blocked');
    expect(blocked.reasons.some((reason) => reason.reason === 'rights-insufficient')).toBe(true);
  });

  it('blocks scope-conflict: same class, different target capabilities', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-target-a' }),
      makeCandidate({
        candidateId: 'candidate-target-b',
        targetCapability: OTHER_TARGET_CAPABILITY,
      }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const blocked = outcomes[0] as Extract<CompilationOutcome, { kind: 'blocked' }>;
    expect(blocked.kind).toBe('blocked');
    expect(blocked.reasons.some((reason) => reason.reason === 'scope-conflict')).toBe(true);
  });

  it('blocked reasons carry the offending candidate ids (machine-readable)', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-offender', rightsStatus: 'insufficient', globalReuseRequested: true }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const blocked = outcomes[0] as Extract<CompilationOutcome, { kind: 'blocked' }>;
    const reason = blocked.reasons.find((entry) => entry.reason === 'rights-insufficient');
    expect(reason?.candidateIds).toContain('candidate-offender');
    expect(typeof reason?.basis).toBe('string');
  });

  it('rejects non-candidate inputs loudly', async () => {
    await expect(
      compilePrograms([{ not: 'a-candidate' } as never], { compiledBy: 'x' }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_INVALID_CANDIDATE' });
  });
});

describe('compilePrograms — global reuse roll-up', () => {
  it('globalReuse is true only when every candidate granted global rights AND requested it', async () => {
    const granted = await makeCandidate({ globalReuseRequested: true, rightsStatus: 'granted-for-global-reuse' });
    const outcomes = await compilePrograms([granted], { compiledBy: 'x' });
    const program = (outcomes[0] as Extract<CompilationOutcome, { kind: 'compilable' }>).program;
    expect(program.globalReuse).toBe(true);
    expect(program.rights.status).toBe('granted-for-global-reuse');
  });

  it('globalReuse is false when the candidate did not request it (tenant-scoped program)', async () => {
    const local = await makeCandidate({ globalReuseRequested: false, rightsStatus: 'granted-tenant-scoped' });
    const outcomes = await compilePrograms([local], { compiledBy: 'x' });
    const program = (outcomes[0] as Extract<CompilationOutcome, { kind: 'compilable' }>).program;
    expect(program.globalReuse).toBe(false);
    expect(program.rights.status).toBe('granted-tenant-scoped');
  });
});

describe('compilePrograms — new versioned artifacts with lineage', () => {
  it('computes a NEW proposed artifact digest distinct from every input digest', async () => {
    const candidates = await Promise.all([
      makeCandidate({ candidateId: 'candidate-a', supersedes: null }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const program = (outcomes[0] as Extract<CompilationOutcome, { kind: 'compilable' }>).program;
    const inputs = new Set<string>([
      ...candidates.flatMap((entry) => [
        entry.digest as string,
        entry.sourceRecordRef as string,
        entry.artifact.digest as string,
        ...(entry.evidenceRefs as readonly string[]),
      ]),
    ]);
    expect(inputs.has(program.proposedArtifactRef as string)).toBe(false);
    expect(program.supersedes).toBeNull();
  });

  it('carries append-only lineage when a candidate supersedes a prior version', async () => {
    const candidates = await Promise.all([
      makeCandidate({ supersedes: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    ]);
    const outcomes = await compilePrograms(candidates, { compiledBy: 'x' });
    const program = (outcomes[0] as Extract<CompilationOutcome, { kind: 'compilable' }>).program;
    expect(program.supersedes).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
    expect(program.supersedes === program.proposedArtifactRef).toBe(false);
  });
});
