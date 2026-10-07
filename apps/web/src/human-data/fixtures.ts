/**
 * The deterministic demo corpus for the human-data studio (Work Order C012;
 * apps/web/src/human-data): TWO commissions driven through the REAL
 * service + reference fabric with a fixed clock —
 *
 *   1. a DELIVERED correction-pairs commission (quantity 2, both items
 *      C009-ACCEPTED, consent granted, bundle assembled + verified through
 *      the A014 vocabulary) — the dataset delivery page's subject;
 *   2. an IN_PRODUCTION demonstrations commission (quantity 2, escalations
 *      created, not yet accepted) — the production dashboard's subject.
 *
 * Demo state is never customer state; every demo surface renders visibly
 * labelled (DemoDataBadge).
 */

import { DEMO_NARRATIVE_EPOCH_MS, DEMO_TENANT_ID } from '@arena/demo';
import { createEscalationResult } from '../../../../packages/escalation/src/index.js';
import { HumanDataService } from '../../../../services/human-data/src/index.js';
import { createHumanDataReferenceFabric } from '../../../../services/human-data/src/index.js';
import type { HumanDataReferenceFabric } from '../../../../services/human-data/src/index.js';
import {
  describeHumanDatasetDelivery,
  verifyHumanDataCommission,
} from '../../../../packages/human-data/src/index.js';
import type { HumanDataCommission } from '../../../../packages/human-data/src/index.js';
import type { DatasetManifest } from '../../../../packages/datasets/src/index.js';
import type { HumanDatasetDeliveryDescriptor } from '../../../../packages/human-data/src/index.js';
import type { ProductionProjection } from '../../../../services/human-data/src/index.js';

const CONSENT = {
  granted: true,
  statement:
    'Demo expert grants reuse rights for the produced records (EES1.0 consent/rights statement collected at session completion).',
};

const CUSTOMER_CONSENT = {
  granted: true,
  statement:
    'The demo customer grants Arena the right to assemble the commissioned deliverables into a versioned dataset bundle (training-data rights; operational delivery stays separate per ERF1.0).',
};

/** A REAL C001 correction result (built through the C001 domain function). */
function correctionResultFixture(index: number) {
  return createEscalationResult({
    kind: 'correction',
    producedAt: '2026-10-07T10:00:00.000Z',
    summary: `demo correction ${index}`,
    correctedRef: `record:T-100${index}`,
    replacement: { priority: 'P1', rationale: 'clinical keywords detected' },
  });
}

function acceptedAdjudication(requestId: string, index: number) {
  return {
    adjudicationVersion: 1 as const,
    verdictId: `av_${requestId.replaceAll(/[^0-9a-f]/g, '0').slice(0, 30)}${index}`.padEnd(
      35,
      '0',
    ) as `av_${string}`,
    requestId,
    tenantId: DEMO_TENANT_ID,
    attemptNumber: 1,
    verdict: 'accepted' as const,
    reasons: [
      { code: 'evaluation-meets-criteria' as const, detail: 'all declared criteria met', ref: null },
      { code: 'verification-pass' as const, detail: 'evidence supports claims', ref: null },
    ],
    evaluationStage: {
      stage: 'evaluation' as const,
      outcome: 'meets-criteria' as const,
      recordDigest: 'a'.repeat(64),
      evaluatorRef: 'demo-evaluator-1',
      validatorExpertRef: null,
      criteriaJudgments: [
        { criteriaRef: 'criteria:1', verdict: 'met' as const, score: 1, note: null },
      ],
      executedAt: '2026-10-07T10:00:00.000Z',
      provenance: 'demo-corpus',
    },
    verificationStage: {
      stage: 'verification' as const,
      outcome: 'pass' as const,
      recordDigest: 'b'.repeat(64),
      verifierRef: 'demo-verifier-1',
      evidenceSupport: [{ claim: 'claim:1', status: 'present-supported' as const }],
      evidenceRefs: ['evidence://demo-1'],
      executedAt: '2026-10-07T10:05:00.000Z',
      provenance: 'demo-corpus',
    },
    validationStatus: 'passed' as const,
    adjudicatedAt: '2026-10-07T10:10:00.000Z',
  };
}

/** The demo human-data corpus: the delivered + in-production commissions. */
export interface DemoHumanDataCorpus {
  readonly delivered: HumanDataCommission;
  readonly deliveredManifest: DatasetManifest;
  readonly deliveredDescriptor: HumanDatasetDeliveryDescriptor;
  readonly inProduction: HumanDataCommission;
  readonly inProductionProjection: ProductionProjection;
  readonly fabric: HumanDataReferenceFabric;
}

export async function buildDemoHumanDataCorpus(): Promise<DemoHumanDataCorpus> {
  const fabric = createHumanDataReferenceFabric(DEMO_NARRATIVE_EPOCH_MS);
  const service = new HumanDataService({
    clock: fabric.clock,
    store: fabric.store,
    escalations: fabric.escalations,
    sources: fabric.sources,
    events: fabric.events,
  });

  const base = {
    tenantId: DEMO_TENANT_ID,
    clientAppId: 'demo-studio-app',
    capabilityNeed: 'support.triage.corrections',
    escalationModes: ['correct'],
    perItemOutputSchema: {
      type: 'object',
      properties: { correctedRef: { type: 'string' }, replacement: { type: 'object' } },
    },
    budget: { amountMinorUnits: 5000, currency: 'USD' },
    urgency: 'priority',
    productionWindowMs: 24 * 60 * 60 * 1000,
    expertRequirements: { requiredCapabilities: ['support.triage'] },
    locale: 'en',
    permittedActions: ['read-context', 'propose-patch', 'annotate-evidence'],
    environmentSessionPolicy: { sessionMode: 'none', sanitization: 'standard' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 90 * 24 * 60 * 60 * 1000, disposition: 'retain' },
    rights: {
      license: 'CC-BY-4.0',
      commercialUse: 'allowed',
      redistribution: 'tenant-only',
      customerData: 'derived',
    },
    consent: CUSTOMER_CONSENT,
    now: DEMO_NARRATIVE_EPOCH_MS,
  };

  // 1. The DELIVERED correction-pairs commission.
  const deliveredDraft = await service.createCommission({
    ...base,
    datasetName: 'demo-triage-corrections',
    deliverableKind: 'correction-pairs',
    quantity: 2,
    acceptanceCriteria: { criteria: ['replacement-is-valid-json'], minAcceptedRatio: 0.5 },
  });
  const deliveredSubmitted = await service.submitCommission({
    commissionId: deliveredDraft.commissionId,
    tenantId: DEMO_TENANT_ID,
  });
  for (const [index, requestId] of (deliveredSubmitted.escalationRequestIds ?? []).entries()) {
    fabric.sources.script(requestId, {
      result: correctionResultFixture(index + 1),
      adjudication: acceptedAdjudication(requestId, index + 1),
      consent: CONSENT,
      originalSnapshot: { priority: 'P3' },
    });
  }
  const deliveredResult = await service.assembleCommission({
    commissionId: deliveredDraft.commissionId,
    tenantId: DEMO_TENANT_ID,
  });
  if (deliveredResult.outcome !== 'delivered' || deliveredResult.manifest === null) {
    throw new Error('the demo delivered commission must assemble + deliver');
  }

  // 2. The IN_PRODUCTION demonstrations commission (not yet accepted).
  const inProduction = await service.createCommission({
    ...base,
    datasetName: 'demo-triage-demonstrations',
    deliverableKind: 'demonstrations',
    escalationModes: ['solve'],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    quantity: 2,
    acceptanceCriteria: { criteria: ['bounded-replay-trace'], minAcceptedRatio: 1 },
  });
  await service.submitCommission({
    commissionId: inProduction.commissionId,
    tenantId: DEMO_TENANT_ID,
  });
  const inProductionProjection = await service.trackProduction({
    commissionId: inProduction.commissionId,
    tenantId: DEMO_TENANT_ID,
  });

  // Integrity: the delivered commission verifies (tamper-free demo corpus).
  await verifyHumanDataCommission(deliveredResult.commission);

  return Object.freeze({
    delivered: deliveredResult.commission,
    deliveredManifest: deliveredResult.manifest,
    deliveredDescriptor: describeHumanDatasetDelivery(
      deliveredResult.manifest,
      deliveredResult.deliverables.length,
    ),
    inProduction: inProductionProjection.commission,
    inProductionProjection,
    fabric,
  });
}
