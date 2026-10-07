/**
 * Integration tests (Work Order C008) — capture → disposition over the
 * injected C007/A019/A020/A021 ports on the reference fabric.
 */

import { describe, expect, it } from 'vitest';
import { CapabilityImprovementError } from './errors.js';
import {
  CAPTURE_KEY,
  CORR_ID,
  INTERVENTION_ID,
  OTHER_TENANT,
  T0,
  TENANT,
  assembleService,
  makeSubmission,
  makeTaskGuidanceArtifact,
  makeToolGapContract,
  seedOutcome,
} from './test-support.js';

describe('capture → staged ledgers (the C007 seam)', () => {
  it('captures the signal and the knowledge artifact of a completed intervention', async () => {
    const assembly = assembleService();
    await seedOutcome(assembly.outcomePort, makeSubmission());
    const view = await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: CAPTURE_KEY,
      correlationId: CORR_ID,
      now: T0,
    });
    expect(view.signalsCaptured).toBe(1);
    expect(view.knowledgeCaptured).toBe(1);
    expect(view.signalsDeduplicated).toBe(0);
    expect(view.signalIds.length).toBe(1);
    expect(view.knowledgeRecordIds.length).toBe(1);
    const signal = await assembly.service.getSignal(view.signalIds[0] ?? '', TENANT);
    expect(signal?.stage).toBe('captured');
    expect(signal?.provenance.interventionId).toBe(INTERVENTION_ID);
    expect(signal?.signal.toolName).toBe('spectral-analyzer');
    const record = await assembly.service.getKnowledgeRecord(view.knowledgeRecordIds[0] ?? '', TENANT);
    expect(record?.artifact.tier).toBe('scoped-reusable-knowledge');
    expect(record?.scope.kind).toBe('case');
    expect(record?.evidenceRefs.length).toBe(2);
  });

  it('audits every capture decision append-only with a contiguous tamper-evident chain', async () => {
    const assembly = assembleService();
    await seedOutcome(assembly.outcomePort, makeSubmission());
    await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: CAPTURE_KEY,
      correlationId: CORR_ID,
      now: T0,
    });
    const log = await assembly.service.auditLog();
    expect(log.length).toBe(2);
    expect(log.map((e) => e.decision)).toEqual(['signal_captured', 'knowledge_captured']);
    expect(log[0]?.sequence).toBe(1);
    expect(log[1]?.sequence).toBe(2);
    expect(await assembly.service.verifyAuditChain()).toBe(true);
  });

  it('a completed intervention without a submission captures nothing (empty view)', async () => {
    const assembly = assembleService();
    await seedOutcome(assembly.outcomePort, makeSubmission());
    // seed a second outcome with no submission
    await assembly.outcomePort.seed({
      interventionId: 'ivn_000000000000000000000000000000bb',
      requestId: 'req_000000000000000000000000000000bb',
      sessionId: 'session-c008-service-0002',
      tenantId: TENANT,
      mode: 'review',
      resultKind: 'review',
      contract: makeToolGapContract(),
      completedAt: new Date(T0).toISOString(),
    });
    await expect(
      assembly.service.captureInterventionOutputs({
        interventionId: 'ivn_000000000000000000000000000000bb',
        tenantId: TENANT,
        captureKey: 'capture-2',
        correlationId: CORR_ID,
        now: T0,
      }),
    ).resolves.toMatchObject({ signalsCaptured: 0, knowledgeCaptured: 0 });
  });

  it('unknown and cross-tenant intervention ids fail closed (NOT_FOUND)', async () => {
    const assembly = assembleService();
    await seedOutcome(assembly.outcomePort, makeSubmission());
    await expect(
      assembly.service.captureInterventionOutputs({
        interventionId: 'ivn_missing',
        tenantId: TENANT,
        captureKey: CAPTURE_KEY,
        correlationId: CORR_ID,
        now: T0,
      }),
    ).rejects.toThrow(CapabilityImprovementError);
    await expect(
      assembly.service.captureInterventionOutputs({
        interventionId: INTERVENTION_ID,
        tenantId: OTHER_TENANT,
        captureKey: CAPTURE_KEY,
        correlationId: CORR_ID,
        now: T0,
      }),
    ).rejects.toThrow(/no completed intervention outcome/);
  });
});

describe('tool-gap disposition (capture → feed destination)', () => {
  async function captured(assembly: Awaited<ReturnType<typeof assembleService>>) {
    await seedOutcome(assembly.outcomePort, makeSubmission());
    return assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: CAPTURE_KEY,
      correlationId: CORR_ID,
      now: T0,
    });
  }

  it('triaged → tool specification proposed → adapter request, proposals emitted idempotently', async () => {
    const assembly = assembleService();
    const view = await captured(assembly);
    const signalId = view.signalIds[0] ?? '';
    const triaged = await assembly.service.triageSignal({
      signalId,
      tenantId: TENANT,
      decision: 'actionable: propose a tool specification',
      now: T0 + 1,
    });
    expect(triaged.stage).toBe('triaged');
    const proposed = await assembly.service.proposeToolSpecification({
      signalId,
      tenantId: TENANT,
      summary: 'Frequency-domain analysis adapter for sensor telemetry',
      decision: 'spec proposal drafted from the triaged signal',
      now: T0 + 2,
    });
    expect(proposed.stage).toBe('tool-specification-proposed');
    expect(assembly.toolSpecificationPort.proposals().length).toBe(1);
    expect(assembly.toolSpecificationPort.proposals()[0]?.summary).toContain('Frequency-domain');
    expect(assembly.toolSpecificationPort.proposals()[0]?.source.signalId).toBe(signalId);
    const disposed = await assembly.service.dispositionSignal({
      signalId,
      tenantId: TENANT,
      feed: 'adapter-request',
      decision: 'route to the adapter request feed',
      now: T0 + 3,
    });
    expect(disposed.stage).toBe('adapter-request');
    expect(assembly.adapterRequestPort.proposals().length).toBe(1);
    expect(assembly.adapterRequestPort.proposals()[0]?.toolName).toBe('spectral-analyzer');
    // the proposal envelopes follow the sibling-service envelope convention
    const envelope = assembly.adapterRequestPort.envelopes()[0];
    expect(envelope?.kind).toBe('command');
    expect(envelope?.idempotencyKey).toBe(`adr-${signalId}`);
  });

  it('each feed destination routes to its own port', async () => {
    for (const feed of [
      'body-improvement-candidate',
      'benchmark-candidate',
      'marketplace-artifact-candidate',
    ] as const) {
      const assembly = assembleService();
      const view = await captured(assembly);
      const signalId = view.signalIds[0] ?? '';
      await assembly.service.triageSignal({
        signalId,
        tenantId: TENANT,
        decision: 'triage',
        now: T0 + 1,
      });
      const disposed = await assembly.service.dispositionSignal({
        signalId,
        tenantId: TENANT,
        feed,
        decision: `dispose to ${feed}`,
        now: T0 + 2,
      });
      expect(disposed.stage).toBe(feed);
      if (feed === 'body-improvement-candidate') {
        expect(assembly.bodyImprovementPort.proposals().length).toBe(1);
      } else if (feed === 'benchmark-candidate') {
        expect(assembly.benchmarkPort.proposals().length).toBe(1);
      } else {
        expect(assembly.marketplacePort.proposals().length).toBe(1);
      }
    }
  });

  it('terminal stages are final — a disposed signal cannot move or re-emit', async () => {
    const assembly = assembleService();
    const view = await captured(assembly);
    const signalId = view.signalIds[0] ?? '';
    await assembly.service.triageSignal({ signalId, tenantId: TENANT, decision: 'triage', now: T0 + 1 });
    await assembly.service.dispositionSignal({
      signalId,
      tenantId: TENANT,
      feed: 'benchmark-candidate',
      decision: 'dispose',
      now: T0 + 2,
    });
    await expect(
      assembly.service.dispositionSignal({
        signalId,
        tenantId: TENANT,
        feed: 'adapter-request',
        decision: 'try to move again',
        now: T0 + 3,
      }),
    ).rejects.toThrow(/denied/);
    expect(assembly.benchmarkPort.proposals().length).toBe(1);
    expect(assembly.adapterRequestPort.proposals().length).toBe(0);
  });

  it('the full audit trail records every disposition decision in order', async () => {
    const assembly = assembleService();
    const view = await captured(assembly);
    const signalId = view.signalIds[0] ?? '';
    await assembly.service.triageSignal({ signalId, tenantId: TENANT, decision: 'triage', now: T0 + 1 });
    await assembly.service.proposeToolSpecification({
      signalId,
      tenantId: TENANT,
      summary: 'spec',
      decision: 'propose',
      now: T0 + 2,
    });
    await assembly.service.dispositionSignal({
      signalId,
      tenantId: TENANT,
      feed: 'adapter-request',
      decision: 'dispose',
      now: T0 + 3,
    });
    const log = await assembly.service.auditLog();
    expect(log.map((e) => e.decision)).toEqual([
      'signal_captured',
      'knowledge_captured',
      'signal_triaged',
      'tool_specification_proposed',
      'adapter_request_proposed',
    ]);
    expect(await assembly.service.verifyAuditChain()).toBe(true);
  });
});

describe('knowledge disposition (lattice + learning seam)', () => {
  it('emits a learning candidate carrying the KnowledgePatch (candidate only)', async () => {
    const assembly = assembleService();
    await seedOutcome(assembly.outcomePort, makeSubmission());
    const view = await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: CAPTURE_KEY,
      correlationId: CORR_ID,
      now: T0,
    });
    const recordId = view.knowledgeRecordIds[0] ?? '';
    const result = await assembly.service.proposeKnowledgePatch({
      recordId,
      tenantId: TENANT,
      now: T0 + 1,
    });
    expect(result.receipt.status).toBe('submitted');
    const candidates = assembly.learningPort.proposals();
    expect(candidates.length).toBe(1);
    const candidate = candidates[0];
    expect(candidate?.patch.candidateOnly).toBe(true);
    expect(candidate?.patch.tier).toBe('scoped-reusable-knowledge');
    expect(candidate?.patch.scope.kind).toBe('case');
    expect(candidate?.sourceRecordId).toBe(recordId);
  });

  it('explicit promotion through the wall appends a new record and audits it', async () => {
    const assembly = assembleService();
    await seedOutcome(
      assembly.outcomePort,
      makeSubmission({ knowledge: [makeTaskGuidanceArtifact()] }),
    );
    const view = await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: CAPTURE_KEY,
      correlationId: CORR_ID,
      now: T0,
    });
    const recordId = view.knowledgeRecordIds[0] ?? '';
    const promotion = await assembly.service.promoteKnowledge({
      recordId,
      tenantId: TENANT,
      toTier: 'scoped-reusable-knowledge',
      toScope: { kind: 'case', ref: 'case-77' },
      justification: 'expert consented to case-level reuse',
      consent: { granted: true, statement: 'granted for case-level reuse' },
      now: T0 + 1,
    });
    expect(promotion.tier).toBe('scoped-reusable-knowledge');
    expect(promotion.toRecordId).not.toBe(recordId);
    const promoted = await assembly.service.getKnowledgeRecord(promotion.toRecordId, TENANT);
    expect(promoted?.promotions.length).toBe(1);
    const original = await assembly.service.getKnowledgeRecord(recordId, TENANT);
    expect(original?.artifact.tier).toBe('task-specific-guidance');
    expect(original?.promotions.length).toBe(0);
    const log = await assembly.service.auditLog();
    expect(log.map((e) => e.decision)).toContain('knowledge_promoted');
  });
});
