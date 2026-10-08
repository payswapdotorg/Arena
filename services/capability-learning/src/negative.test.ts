/**
 * Negative/adversarial service tests — fail-closed behaviors:
 * ungated dispatch, cross-tenant isolation, unknown ids, idempotency
 * conflicts, blocked compilations audited (never silent), evaluator
 * masquerade end-to-end through the REAL A020 records.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityLearningService } from './service.js';
import type { CapabilityLearningServiceConfig } from './service.js';
import {
  InMemoryCandidateLedger,
  InMemoryCompilerAuditSink,
  InMemoryCompatibilityRetestProposalPort,
  InMemoryFeedbackLedger,
  InMemoryForgeBodyVersionProposalPort,
  InMemoryGateVerdictLedger,
  InMemoryProgramLedger,
  InMemoryRecertificationTriggerProposalPort,
  ReferenceExperimentEngine,
} from './fabric.js';
import { makeArm, makeCandidateInput } from './test-support.js';

const T_NOW = Date.parse('2026-10-08T09:00:00.000Z');

function makeService() {
  const config: CapabilityLearningServiceConfig = {
    clock: { now: () => T_NOW },
    candidateLedger: new InMemoryCandidateLedger(),
    programLedger: new InMemoryProgramLedger(),
    gateVerdictLedger: new InMemoryGateVerdictLedger(),
    feedbackLedger: new InMemoryFeedbackLedger(),
    experimentEngine: new ReferenceExperimentEngine(),
    forgeProposalPort: new InMemoryForgeBodyVersionProposalPort(),
    compatibilityRetestPort: new InMemoryCompatibilityRetestProposalPort(),
    recertificationTriggerPort: new InMemoryRecertificationTriggerProposalPort(),
    auditSink: new InMemoryCompilerAuditSink(),
  };
  return { service: new CapabilityLearningService(config), config };
}

async function adoptedProgram(service: CapabilityLearningService, overrides: {
  changedSurface?: string;
  rightsStatus?: string;
  globalReuseRequested?: boolean;
  candidateId?: string;
} = {}): Promise<string> {
  await service.ingestCandidate({
    candidate: makeCandidateInput(overrides),
    correlationId: 'corr-cl-neg',
  });
  const compiled = await service.compileTenantPrograms({
    tenantId: 'tenant-a',
    compiledBy: 'arena-capability-learning-test',
    correlationId: 'corr-cl-neg',
  });
  return compiled.compiled[0]?.programId as string;
}

describe('negative — fail-closed dispatch', () => {
  it('REFUSES dispatch when the gate verdict is not adopted (ungated improvement, fail-closed)', async () => {
    const { service, config } = makeService();
    const programId = await adoptedProgram(service);
    // The intervention arm's verification FAILS → the audit does not survive.
    const run = await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms: {
        baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-nb', metricValue: 0.8 }),
        intervention: await makeArm({
          trajectoryId: 'traj-i',
          runId: 'tenant-a/run-ni',
          metricValue: 0.9,
          verificationMode: 'fail',
        }),
      },
      experimentKey: 'idem-cl-neg-0001',
      correlationId: 'corr-cl-neg',
    });
    expect(run.gateVerdictKind).toBe('rejected-with-reasons');
    expect(run.gateReasons).toContain('verification-audit-not-survived');
    await expect(
      service.dispatchGatedProposals({
        programId,
        tenantId: 'tenant-a',
        proposedBy: 'attacker',
        correlationId: 'corr-cl-neg',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_SVC_NOT_ADOPTED' });
    // No proposal was emitted (fail-closed, nothing leaks).
    expect((config.forgeProposalPort as InMemoryForgeBodyVersionProposalPort).proposals().length).toBe(0);
    // The refusal is AUDITED.
    const decisions = (await (config.auditSink as InMemoryCompilerAuditSink).list()).map(
      (entry) => entry.decision,
    );
    expect(decisions).toContain('dispatch_refused');
  });

  it('REFUSES dispatch when no experiment was ever run (no gate verdict)', async () => {
    const { service } = makeService();
    const programId = await adoptedProgram(service);
    await expect(
      service.dispatchGatedProposals({
        programId,
        tenantId: 'tenant-a',
        proposedBy: 'x',
        correlationId: 'corr-cl-neg',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_SVC_NOT_ADOPTED' });
  });
});

describe('negative — an evaluator change masquerading as capability lift (end-to-end)', () => {
  it('the gate refuses adoption when the evaluator digest differs between arms', async () => {
    const { service } = makeService();
    const programId = await adoptedProgram(service);
    const run = await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms: {
        baseline: await makeArm({
          trajectoryId: 'traj-b',
          runId: 'tenant-a/run-eb',
          metricValue: 0.8,
          evaluatorRef: '1111111111111111111111111111111111111111111111111111111111111111',
        }),
        intervention: await makeArm({
          trajectoryId: 'traj-i',
          runId: 'tenant-a/run-ei',
          metricValue: 0.95, // the score improved —
          evaluatorRef: '2222222222222222222222222222222222222222222222222222222222222222', // — but the EVALUATOR changed
        }),
      },
      experimentKey: 'idem-cl-neg-0002',
      correlationId: 'corr-cl-neg',
    });
    expect(run.gateVerdictKind).toBe('rejected-with-reasons');
    expect(run.gateReasons).toContain('evaluator-version-confound');
    await expect(
      service.dispatchGatedProposals({
        programId,
        tenantId: 'tenant-a',
        proposedBy: 'attacker',
        correlationId: 'corr-cl-neg',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_SVC_NOT_ADOPTED' });
  });
});

describe('negative — tenant isolation', () => {
  it('cross-tenant program lookup is indistinguishable from unknown (NOT_FOUND)', async () => {
    const { service } = makeService();
    const programId = await adoptedProgram(service);
    await expect(
      service.runProgramExperiment({
        programId,
        tenantId: 'tenant-b', // another tenant
        arms: {
          baseline: await makeArm({ trajectoryId: 'traj-x', runId: 'tenant-b/run-xb', metricValue: 0.8 }),
          intervention: await makeArm({ trajectoryId: 'traj-y', runId: 'tenant-b/run-xi', metricValue: 0.9 }),
        },
        experimentKey: 'idem-cl-neg-0003',
        correlationId: 'corr-cl-neg',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_SVC_NOT_FOUND' });
  });

  it('tenant B cannot dispatch tenant A’s adopted program', async () => {
    const { service } = makeService();
    const programId = await adoptedProgram(service);
    await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms: {
        baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-tb', metricValue: 0.8 }),
        intervention: await makeArm({ trajectoryId: 'traj-i', runId: 'tenant-a/run-ti', metricValue: 0.9 }),
      },
      experimentKey: 'idem-cl-neg-0004',
      correlationId: 'corr-cl-neg',
    });
    await expect(
      service.dispatchGatedProposals({
        programId,
        tenantId: 'tenant-b',
        proposedBy: 'tenant-b-attacker',
        correlationId: 'corr-cl-neg',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_SVC_NOT_FOUND' });
  });

  it('a tenant’s compilation never sees another tenant’s candidates', async () => {
    const { service } = makeService();
    await service.ingestCandidate({
      candidate: makeCandidateInput({ tenantId: 'tenant-a', candidateId: 'candidate-isolated-a' }),
      correlationId: 'corr-cl-neg',
    });
    const compiledB = await service.compileTenantPrograms({
      tenantId: 'tenant-b',
      compiledBy: 'x',
      correlationId: 'corr-cl-neg',
    });
    expect(compiledB.compiled).toEqual([]);
    expect(compiledB.blocked).toEqual([]);
  });
});

describe('negative — unknown ids and blocked compilations', () => {
  it('unknown program id fails closed (NOT_FOUND)', async () => {
    const { service } = makeService();
    await expect(
      service.runProgramExperiment({
        programId: 'program-does-not-exist',
        tenantId: 'tenant-a',
        arms: {
          baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-ub', metricValue: 0.8 }),
          intervention: await makeArm({ trajectoryId: 'traj-i', runId: 'tenant-a/run-ui', metricValue: 0.9 }),
        },
        experimentKey: 'idem-cl-neg-0005',
        correlationId: 'corr-cl-neg',
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_SVC_NOT_FOUND' });
  });

  it('a rights-free global-reuse request is BLOCKED at compilation and AUDITED (never silent)', async () => {
    const { service, config } = makeService();
    await service.ingestCandidate({
      candidate: makeCandidateInput({
        candidateId: 'candidate-rights-free',
        rightsStatus: 'insufficient',
        globalReuseRequested: true,
      }),
      correlationId: 'corr-cl-neg',
    });
    const compiled = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'x',
      correlationId: 'corr-cl-neg',
    });
    expect(compiled.compiled).toEqual([]);
    expect(compiled.blocked.length).toBe(1);
    expect(compiled.blocked[0]?.reasons.map((reason) => reason.reason)).toContain('rights-insufficient');
    const decisions = (await (config.auditSink as InMemoryCompilerAuditSink).list()).map(
      (entry) => entry.decision,
    );
    expect(decisions).toContain('program_blocked');
    expect(decisions).not.toContain('program_compiled');
  });

  it('invalid ingestion input fails closed (typed error)', async () => {
    const { service } = makeService();
    const bad = makeCandidateInput() as unknown as Record<string, unknown>;
    bad['changedSurface'] = 'prompts'; // not one of the LE1.0 nine
    await expect(
      service.ingestCandidate({
        candidate: bad as unknown as ReturnType<typeof makeCandidateInput>,
        correlationId: 'corr-cl-neg',
      }),
    ).rejects.toThrow();
  });

  it('same experimentKey bound to a different run command is a conflict (fail-closed)', async () => {
    const { service } = makeService();
    const programId = await adoptedProgram(service);
    const runInput = {
      programId,
      tenantId: 'tenant-a',
      experimentKey: 'idem-cl-neg-0006',
      correlationId: 'corr-cl-neg',
    } as const;
    await service.runProgramExperiment({
      ...runInput,
      arms: {
        baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-cb', metricValue: 0.8 }),
        intervention: await makeArm({ trajectoryId: 'traj-i', runId: 'tenant-a/run-ci', metricValue: 0.9 }),
      },
    });
    await expect(
      service.runProgramExperiment({
        ...runInput,
        arms: {
          baseline: await makeArm({ trajectoryId: 'traj-b2', runId: 'tenant-a/run-cb2', metricValue: 0.7 }),
          intervention: await makeArm({ trajectoryId: 'traj-i2', runId: 'tenant-a/run-ci2', metricValue: 0.9 }),
        },
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_LEARNING_SVC_IDEMPOTENCY_CONFLICT' });
  });
});
