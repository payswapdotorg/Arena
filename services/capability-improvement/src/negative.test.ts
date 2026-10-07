/**
 * Adversarial minimum (Work Order C008) — the negative battery:
 *   - knowledge overgeneralization attempt (task-specific guidance
 *     promoted to universal/domain rule must fail closed);
 *   - promotion without consent/rights;
 *   - provenance tampering;
 *   - duplicate-signal injection inflating triage counts (must dedup).
 */

import { describe, expect, it } from 'vitest';
import { KnowledgeCaptureError } from '@arena/knowledge-capture';
import { CapabilityImprovementError } from './errors.js';
import {
  CAPTURE_KEY,
  CORR_ID,
  INTERVENTION_ID,
  T0,
  TENANT,
  assembleService,
  makeSignal,
  makeSubmission,
  makeTaskGuidanceArtifact,
  seedOutcome,
} from './test-support.js';

async function captureFrom(assembly: ReturnType<typeof assembleService>) {
  await seedOutcome(assembly.outcomePort, makeSubmission({ knowledge: [makeTaskGuidanceArtifact()] }));
  return assembly.service.captureInterventionOutputs({
    interventionId: INTERVENTION_ID,
    tenantId: TENANT,
    captureKey: CAPTURE_KEY,
    correlationId: CORR_ID,
    now: T0,
  });
}

describe('adversarial — knowledge overgeneralization', () => {
  it('task-specific guidance promoted straight to a domain rule fails closed (audited + rethrown)', async () => {
    const assembly = assembleService();
    const view = await captureFrom(assembly);
    const recordId = view.knowledgeRecordIds[0] ?? '';
    await expect(
      assembly.service.promoteKnowledge({
        recordId,
        tenantId: TENANT,
        toTier: 'candidate-domain-rule',
        toScope: { kind: 'domain', ref: 'eu-vat-filing' },
        justification: 'the expert insists this is universally true',
        consent: { granted: true, statement: 'consented' },
        now: T0 + 1,
      }),
    ).rejects.toThrow(KnowledgeCaptureError);
    const log = await assembly.service.auditLog();
    const denied = log.find((e) => e.decision === 'promotion_denied');
    expect(denied?.details['reason']).toBe('wall_overgeneralization');
    // no new record was created — the lattice was not polluted
    expect((await assembly.service.listKnowledgeRecords()).length).toBe(1);
  });

  it('task-specific guidance can never become a learning patch (learning seam stays clean)', async () => {
    const assembly = assembleService();
    const view = await captureFrom(assembly);
    const recordId = view.knowledgeRecordIds[0] ?? '';
    await expect(
      assembly.service.proposeKnowledgePatch({ recordId, tenantId: TENANT, now: T0 + 1 }),
    ).rejects.toThrow(KnowledgeCaptureError);
    expect(assembly.learningPort.proposals().length).toBe(0);
    const log = await assembly.service.auditLog();
    expect(log.map((e) => e.decision)).toContain('patch_denied');
  });
});

describe('adversarial — promotion without consent/rights', () => {
  it('promotion with ungranted consent fails closed', async () => {
    const assembly = assembleService();
    const view = await captureFrom(assembly);
    const recordId = view.knowledgeRecordIds[0] ?? '';
    await expect(
      assembly.service.promoteKnowledge({
        recordId,
        tenantId: TENANT,
        toTier: 'scoped-reusable-knowledge',
        toScope: { kind: 'case', ref: 'case-77' },
        justification: 'reuse without rights',
        consent: { granted: false, statement: 'explicitly NOT granted' },
        now: T0 + 1,
      }),
    ).rejects.toThrow(KnowledgeCaptureError);
    expect((await assembly.service.listKnowledgeRecords()).length).toBe(1);
  });

  it('reusable knowledge without granted session consent fails capture closed', async () => {
    const assembly = assembleService();
    // a hostile/host-wired outcome view carries a submission whose consent
    // statement is NOT granted (the C006 constructor would refuse it; the
    // service re-enforces the gate defense-in-depth on the wire view):
    const submission = makeSubmission();
    const forged = {
      ...submission,
      consentRightsStatement: { granted: false, statement: 'explicitly NOT granted' },
    };
    await seedOutcome(assembly.outcomePort, forged);
    await expect(
      assembly.service.captureInterventionOutputs({
        interventionId: INTERVENTION_ID,
        tenantId: TENANT,
        captureKey: CAPTURE_KEY,
        correlationId: CORR_ID,
        now: T0,
      }),
    ).rejects.toThrow(/GRANTED session consent/);
    expect((await assembly.service.listKnowledgeRecords()).length).toBe(0);
    expect((await assembly.service.listSignals()).length).toBe(0);
  });
});

describe('adversarial — provenance tampering', () => {
  it('a hostile update of the stored record with foreign provenance cannot promote (wall)', async () => {
    const assembly = assembleService();
    const view = await captureFrom(assembly);
    const recordId = view.knowledgeRecordIds[0] ?? '';
    const record = await assembly.service.getKnowledgeRecord(recordId, TENANT);
    expect(record).toBeDefined();
    // a hostile host rewrites the stored snapshot with a foreign session:
    const spliced = {
      ...record!,
      provenance: { ...record!.provenance, sessionId: 'session-somewhere-else-0009' },
    };
    await assembly.knowledgeLedger.update(spliced);
    // the promotion wall rejects the tampered lineage (provenance mismatch):
    await expect(
      assembly.service.promoteKnowledge({
        recordId: spliced.recordId,
        tenantId: TENANT,
        toTier: 'scoped-reusable-knowledge',
        toScope: { kind: 'task', ref: 'task-2026-1042' },
        justification: 'promote the spliced record',
        consent: { granted: true, statement: 'granted' },
        now: T0 + 1,
      }),
    ).rejects.toThrow(/provenance/);
  });

  it('a spliced tool-gap stage history is detected by the integrity check', async () => {
    const assembly = assembleService();
    const view = await captureFrom(assembly);
    const signalId = view.signalIds[0] ?? '';
    await assembly.service.triageSignal({ signalId, tenantId: TENANT, decision: 'triage', now: T0 + 1 });
    const signal = await assembly.service.getSignal(signalId, TENANT);
    expect(signal).toBeDefined();
    const tampered = {
      ...signal!,
      stage: 'benchmark-candidate' as const,
      stageHistory: [
        ...signal!.stageHistory,
        {
          from: 'captured' as const,
          to: 'benchmark-candidate' as const,
          reason: 'transition_ok' as const,
          decisionCode: 'feed_disposition' as const,
          decision: 'spliced jump',
          actor: null,
          occurredAt: new Date(T0 + 2).toISOString(),
        },
      ],
    };
    const { verifyProvenanceIntegrity } = await import('@arena/tool-gap');
    const verdict = verifyProvenanceIntegrity(tampered);
    expect(verdict.intact).toBe(false);
  });

  it('the append-only audit chain verifies clean after a full run', async () => {
    const assembly = assembleService();
    await captureFrom(assembly);
    const view = await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: CAPTURE_KEY,
      correlationId: CORR_ID,
      now: T0 + 1,
    });
    await assembly.service.triageSignal({
      signalId: view.signalIds[0] ?? '',
      tenantId: TENANT,
      decision: 'triage',
      now: T0 + 2,
    });
    const raw = await assembly.auditSink.list();
    expect(raw.length).toBeGreaterThan(2);
    expect(await assembly.service.verifyAuditChain()).toBe(true);
  });
});

describe('adversarial — duplicate-signal injection', () => {
  it('duplicate injections deduplicate and never inflate triage counts', async () => {
    const assembly = assembleService();
    await seedOutcome(assembly.outcomePort, makeSubmission());
    const first = await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: 'capture-1',
      correlationId: CORR_ID,
      now: T0,
    });
    // the SAME outcome captured again under a DIFFERENT capture key
    const second = await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: 'capture-2',
      correlationId: CORR_ID,
      now: T0 + 1,
    });
    expect(first.signalsCaptured).toBe(1);
    expect(second.signalsCaptured).toBe(0);
    expect(second.signalsDeduplicated).toBe(1);
    expect(second.knowledgeDeduplicated).toBe(1);
    expect((await assembly.service.listSignals()).length).toBe(1);
    expect((await assembly.service.listKnowledgeRecords()).length).toBe(1);
    // triage operates on the single stored record — counts were not inflated
    const triaged = await assembly.service.triageSignal({
      signalId: second.signalIds[0] ?? '',
      tenantId: TENANT,
      decision: 'triage the deduplicated record',
      now: T0 + 2,
    });
    expect(triaged.stage).toBe('triaged');
    const log = await assembly.service.auditLog();
    expect(log.filter((e) => e.decision === 'signal_deduplicated').length).toBe(1);
    expect(log.filter((e) => e.decision === 'signal_captured').length).toBe(1);
  });

  it('two DISTINCT signals from the same session both capture', async () => {
    const assembly = assembleService();
    await seedOutcome(
      assembly.outcomePort,
      makeSubmission({ signals: [makeSignal('spectral-analyzer'), makeSignal('cad-frame-solver')] }),
    );
    const view = await assembly.service.captureInterventionOutputs({
      interventionId: INTERVENTION_ID,
      tenantId: TENANT,
      captureKey: CAPTURE_KEY,
      correlationId: CORR_ID,
      now: T0,
    });
    expect(view.signalsCaptured).toBe(2);
    expect((await assembly.service.listSignals()).length).toBe(2);
  });
});

describe('adversarial — input validation (fail-closed)', () => {
  it('free-text knowledge scopes fail capture closed', async () => {
    const assembly = assembleService();
    const { createKnowledgeArtifact } = await import('@arena/expert-session');
    const artifact = createKnowledgeArtifact({
      tier: 'task-specific-guidance',
      statement: 'some guidance',
      scope: 'generally true everywhere', // NOT a typed "<kind>:<ref>" declaration
      sessionId: 'session-c008-service-0001',
      now: T0,
    });
    await seedOutcome(assembly.outcomePort, makeSubmission({ knowledge: [artifact] }));
    await expect(
      assembly.service.captureInterventionOutputs({
        interventionId: INTERVENTION_ID,
        tenantId: TENANT,
        captureKey: CAPTURE_KEY,
        correlationId: CORR_ID,
        now: T0,
      }),
    ).rejects.toThrow(CapabilityImprovementError);
    expect((await assembly.service.listKnowledgeRecords()).length).toBe(0);
  });

  it('unknown feed destinations are rejected typed', async () => {
    const assembly = assembleService();
    const view = await captureFrom(assembly);
    const signalId = view.signalIds[0] ?? '';
    await assembly.service.triageSignal({ signalId, tenantId: TENANT, decision: 'triage', now: T0 + 1 });
    await expect(
      assembly.service.dispositionSignal({
        signalId,
        tenantId: TENANT,
        feed: 'not-a-feed',
        decision: 'invalid feed',
        now: T0 + 2,
      }),
    ).rejects.toThrow(/feed must be one of/);
  });

  it('skipping triage (captured → feed terminal) fails closed with NO proposal emitted', async () => {
    const assembly = assembleService();
    const view = await captureFrom(assembly);
    const signalId = view.signalIds[0] ?? '';
    await expect(
      assembly.service.dispositionSignal({
        signalId,
        tenantId: TENANT,
        feed: 'adapter-request',
        decision: 'skip triage',
        now: T0 + 1,
      }),
    ).rejects.toThrow(/denied/);
    expect(assembly.adapterRequestPort.proposals().length).toBe(0);
  });

  it('empty command fields fail closed', async () => {
    const assembly = assembleService();
    await expect(
      assembly.service.captureInterventionOutputs({
        interventionId: '',
        tenantId: TENANT,
        captureKey: CAPTURE_KEY,
        correlationId: CORR_ID,
        now: T0,
      }),
    ).rejects.toThrow(/non-empty string/);
  });
});
