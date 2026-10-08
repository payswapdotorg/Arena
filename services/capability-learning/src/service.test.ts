/**
 * Service integration tests — the full reference flow over injected
 * ports on the reference fabric: candidate ingestion → program
 * compilation → A020 experiment orchestration → Q1.0 gate → gated
 * proposal dispatch into the A021/A022/A023 seams.
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
  const service = new CapabilityLearningService(config);
  return { service, config };
}

describe('integration — candidate → program → experiment → gated proposal', () => {
  it('runs the full compile loop and dispatches ONLY adopted proposals', async () => {
    const { service, config } = makeService();
    // 1. Ingestion (the C008 seam projection).
    const ingested = await service.ingestCandidate({
      candidate: makeCandidateInput(),
      correlationId: 'corr-cl-0001',
    });
    expect(ingested.status).toBe('ingested');
    expect(ingested.digest).toMatch(/^[0-9a-f]{64}$/);

    // 2. Compilation (deterministic; one program per class).
    const compiled = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'arena-capability-learning-test',
      correlationId: 'corr-cl-0001',
    });
    expect(compiled.compiled.length).toBe(1);
    const programId = compiled.compiled[0]?.programId as string;
    expect(compiled.compiled[0]?.interventionClass).toBe('skills');
    expect(compiled.blocked).toEqual([]);

    // 3. Experiment orchestration + the Q1.0 gate (REAL A020 records).
    const run = await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms: {
        baseline: await makeArm({ trajectoryId: 'traj-baseline', runId: 'tenant-a/run-baseline', metricValue: 0.8 }),
        intervention: await makeArm({ trajectoryId: 'traj-intervention', runId: 'tenant-a/run-intervention', metricValue: 0.9 }),
      },
      experimentKey: 'idem-cl-run-0001',
      correlationId: 'corr-cl-0001',
    });
    expect(run.gateVerdictKind).toBe('adopted-with-evidence');
    expect(run.measuredLift[0]?.delta).toBeCloseTo(0.1, 10);
    expect(run.feedbackRecorded).toBe(true);

    // 4. Gated proposal dispatch (the A021/A022/A023 seams).
    const dispatched = await service.dispatchGatedProposals({
      programId,
      tenantId: 'tenant-a',
      proposedBy: 'arena-capability-learning-test',
      correlationId: 'corr-cl-0001',
    });
    expect(dispatched.gateVerdictKind).toBe('adopted-with-evidence');
    expect(dispatched.receipts.length).toBe(1); // skills: body-forge only
    expect(dispatched.receipts[0]?.destination).toBe('body-forge');
    expect(dispatched.receipts[0]?.receipt.status).toBe('submitted');
    const forgePort = config.forgeProposalPort as InMemoryForgeBodyVersionProposalPort;
    expect(forgePort.proposals().length).toBe(1);
    expect(forgePort.envelopes()[0]?.schema).toBe(
      'arena:schema/capability-learning/forge-body-version-proposal@1.0.0',
    );

    // 5. The audit stream is append-only, contiguous and tamper-evident.
    const audit = config.auditSink as InMemoryCompilerAuditSink;
    const entries = await audit.list();
    expect(entries.length).toBeGreaterThan(4);
    expect((await audit.verify()) as boolean).toBe(true);
    const decisions = entries.map((entry) => entry.decision);
    expect(decisions).toContain('candidate_ingested');
    expect(decisions).toContain('program_compiled');
    expect(decisions).toContain('experiment_run');
    expect(decisions).toContain('gate_adopted');
    expect(decisions).toContain('feedback_recorded');
    expect(decisions).toContain('proposal_dispatched');
  });

  it('substrate-affecting programs dispatch compatibility re-test obligations too', async () => {
    const { service, config } = makeService();
    await service.ingestCandidate({
      candidate: makeCandidateInput({ changedSurface: 'substrate', candidateId: 'candidate-substrate-0001' }),
      correlationId: 'corr-cl-0002',
    });
    const compiled = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'arena-capability-learning-test',
      correlationId: 'corr-cl-0002',
    });
    const programId = compiled.compiled[0]?.programId as string;
    const run = await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms: {
        baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-b2', metricValue: 0.8 }),
        intervention: await makeArm({ trajectoryId: 'traj-i', runId: 'tenant-a/run-i2', metricValue: 0.9 }),
      },
      experimentKey: 'idem-cl-run-0002',
      correlationId: 'corr-cl-0002',
    });
    expect(run.gateVerdictKind).toBe('adopted-with-evidence');
    const dispatched = await service.dispatchGatedProposals({
      programId,
      tenantId: 'tenant-a',
      proposedBy: 'arena-capability-learning-test',
      correlationId: 'corr-cl-0002',
    });
    const destinations = dispatched.receipts.map((entry) => entry.destination).sort();
    expect(destinations).toEqual(['body-forge', 'compatibility-retest']);
    expect(
      (config.compatibilityRetestPort as InMemoryCompatibilityRetestProposalPort).proposals().length,
    ).toBe(1);
  });

  it('duplicate ingestion deduplicates; recompilation is idempotent (no new programs)', async () => {
    const { service } = makeService();
    await service.ingestCandidate({ candidate: makeCandidateInput(), correlationId: 'corr-cl-0003' });
    const duplicate = await service.ingestCandidate({
      candidate: makeCandidateInput(),
      correlationId: 'corr-cl-0003',
    });
    expect(duplicate.status).toBe('duplicate');
    const first = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'x',
      correlationId: 'corr-cl-0003',
    });
    const second = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'x',
      correlationId: 'corr-cl-0003',
    });
    expect(second.compiled[0]?.digest).toBe(first.compiled[0]?.digest);
    expect(second.compiled[0]?.auditSequence).not.toBe(first.compiled[0]?.auditSequence);
  });

  it('experiment runs are idempotent by experimentKey (replay returns the same record)', async () => {
    const { service } = makeService();
    await service.ingestCandidate({ candidate: makeCandidateInput(), correlationId: 'corr-cl-0004' });
    const compiled = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'x',
      correlationId: 'corr-cl-0004',
    });
    const programId = compiled.compiled[0]?.programId as string;
    const arms = {
      baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-b4', metricValue: 0.8 }),
      intervention: await makeArm({ trajectoryId: 'traj-i', runId: 'tenant-a/run-i4', metricValue: 0.9 }),
    };
    const first = await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms,
      experimentKey: 'idem-cl-run-0004',
      correlationId: 'corr-cl-0004',
    });
    const replay = await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms,
      experimentKey: 'idem-cl-run-0004',
      correlationId: 'corr-cl-0004',
    });
    expect(replay.runRecordDigest).toBe(first.runRecordDigest);
  });

  it('proposal dispatch is idempotent (duplicate receipts, never a second proposal)', async () => {
    const { service, config } = makeService();
    await service.ingestCandidate({ candidate: makeCandidateInput(), correlationId: 'corr-cl-0005' });
    const compiled = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'x',
      correlationId: 'corr-cl-0005',
    });
    const programId = compiled.compiled[0]?.programId as string;
    await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms: {
        baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-b5', metricValue: 0.8 }),
        intervention: await makeArm({ trajectoryId: 'traj-i', runId: 'tenant-a/run-i5', metricValue: 0.9 }),
      },
      experimentKey: 'idem-cl-run-0005',
      correlationId: 'corr-cl-0005',
    });
    const first = await service.dispatchGatedProposals({
      programId,
      tenantId: 'tenant-a',
      proposedBy: 'x',
      correlationId: 'corr-cl-0005',
    });
    const second = await service.dispatchGatedProposals({
      programId,
      tenantId: 'tenant-a',
      proposedBy: 'x',
      correlationId: 'corr-cl-0005',
    });
    expect(second.receipts[0]?.receipt.status).toBe('duplicate');
    expect((config.forgeProposalPort as InMemoryForgeBodyVersionProposalPort).proposals().length).toBe(1);
    expect(first.receipts[0]?.receipt.receiptId).toBe(second.receipts[0]?.receipt.receiptId);
  });

  it('ranks the tenant’s next selections by expected information value (inspectable)', async () => {
    const { service } = makeService();
    await service.ingestCandidate({ candidate: makeCandidateInput(), correlationId: 'corr-cl-0006' });
    const compiled = await service.compileTenantPrograms({
      tenantId: 'tenant-a',
      compiledBy: 'x',
      correlationId: 'corr-cl-0006',
    });
    const programId = compiled.compiled[0]?.programId as string;
    await service.runProgramExperiment({
      programId,
      tenantId: 'tenant-a',
      arms: {
        baseline: await makeArm({ trajectoryId: 'traj-b', runId: 'tenant-a/run-b6', metricValue: 0.8 }),
        intervention: await makeArm({ trajectoryId: 'traj-i', runId: 'tenant-a/run-i6', metricValue: 0.9 }),
      },
      experimentKey: 'idem-cl-run-0006',
      correlationId: 'corr-cl-0006',
    });
    const ranking = await service.rankNextSelections('tenant-a');
    expect(ranking.length).toBe(1);
    expect(ranking[0]?.interventionClass).toBe('skills');
    expect(ranking[0]?.rationale).toContain('prior outcome');
  });
});
