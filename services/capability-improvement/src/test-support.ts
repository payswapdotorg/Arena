/**
 * Test support (Work Order C008) — deterministic reference-fabric wiring:
 * a completed C007 intervention outcome whose EES1.0 session submission
 * carries one tool-gap signal and one four-tier knowledge artifact, all
 * built through the REAL C006/C007 constructors, plus a ready-to-use
 * service assembly over the in-memory fabric.
 */

import {
  createExpertSessionSubmission,
  createKnowledgeArtifact,
  createToolGapSignal,
} from '@arena/expert-session';
import type { ExpertSessionSubmission, KnowledgeArtifact, ToolGapSignal } from '@arena/expert-session';
import { createInterventionResult } from '@arena/intervention';
import type { InterventionResultContract } from '@arena/intervention';
import {
  CapabilityImprovementService,
  InMemoryAdapterRequestProposalPort,
  InMemoryBenchmarkCandidatePort,
  InMemoryBodyImprovementCandidatePort,
  InMemoryDispositionAuditSink,
  InMemoryInterventionOutcomePort,
  InMemoryKnowledgeLatticeLedger,
  InMemoryLearningCandidatePort,
  InMemoryMarketplaceArtifactCandidatePort,
  InMemoryToolGapSignalLedger,
  InMemoryToolSpecificationProposalPort,
} from './index.js';
import type { CapabilityImprovementServiceConfig } from './service.js';
import type { CompletedInterventionOutcome } from './ports.js';

export const T0 = 1_000_000_000_000;
export const TENANT = 'tenant-alpha';
export const OTHER_TENANT = 'tenant-beta';
export const INTERVENTION_ID = 'ivn_000000000000000000000000000000aa';
export const REQUEST_ID = 'req_000000000000000000000000000000aa';
export const SESSION_ID = 'session-c008-service-0001';
export const CORR_ID = 'corr-c008-service-0001';
export const CAPTURE_KEY = 'capture-c008-service-0001';

/** Deterministic clock (tests never read the wall clock). */
export class FixedClock {
  private current: number;
  constructor(start: number) {
    this.current = start;
  }
  now(): number {
    return this.current;
  }
  advanceTo(ms: number): void {
    this.current = ms;
  }
}

export function makeSignal(toolName = 'spectral-analyzer'): ToolGapSignal {
  // Build the EES1.0 signal through the REAL C006 constructor.
  return createToolGapSignal({
    sessionId: SESSION_ID,
    toolName,
    capabilityProvided: 'frequency-domain analysis of sensor telemetry',
    whyNeeded: 'the agent could not isolate the bearing fault frequency',
    inputs: { samples: [1, 2, 3] },
    outputs: { peakHz: 148.2 },
    nature: 'external-tool',
    accessRequirements: ['network:reach'],
    cost: { amountMinorUnits: 250, currency: 'usd', latencyMs: 900 },
    evidenceOfUse: ['event/evt-tool-invocation-0001', 'event/evt-tool-result-0001'],
    recommendedIntegrationBoundary: 'adapter behind the tool gateway',
    substitutionPossible: false,
    now: T0,
  });
}

export function makeTaskGuidanceArtifact(): KnowledgeArtifact {
  return createKnowledgeArtifact({
    tier: 'task-specific-guidance',
    statement: 'Leave the reverse-charge box empty for this non-EU customer.',
    scope: 'task:task-2026-1042',
    sessionId: SESSION_ID,
    expertRef: 'expert-042',
    now: T0,
    artifactId: 'esknow_00000000000000000000000000000001',
  });
}

export function makeReusableArtifact(): KnowledgeArtifact {
  return createKnowledgeArtifact({
    tier: 'scoped-reusable-knowledge',
    statement: 'Reverse-charge handling requires the customer VAT id before submission.',
    scope: 'case:case-77',
    sessionId: SESSION_ID,
    expertRef: 'expert-042',
    now: T0,
    artifactId: 'esknow_00000000000000000000000000000002',
    consent: { granted: true, statement: 'Expert grants reusable-learning rights.' },
  });
}

export function makeSubmission(options: {
  signals?: readonly ToolGapSignal[];
  knowledge?: readonly KnowledgeArtifact[];
  consent?: { granted: boolean; statement: string };
} = {}): ExpertSessionSubmission {
  return createExpertSessionSubmission({
    sessionId: SESSION_ID,
    result: { outcome: 'completed' },
    evidence: [
      { kind: 'event-ref', ref: 'event/evt-tool-invocation-0001' },
      { kind: 'artifact-ref', ref: 'artifact/capsule-note-0007' },
    ],
    annotations: [{ subjectRef: 'artifact/capsule-note-0007', note: 'verified against filing manual' }],
    corrections: [],
    knowledgeArtifacts: options.knowledge ?? [makeReusableArtifact()],
    toolGapSignals: options.signals ?? [makeSignal()],
    consentRightsStatement:
      options.consent ?? { granted: true, statement: 'Expert grants Arena reusable-learning rights.' },
    now: T0,
  });
}

export function makeToolGapContract(): InterventionResultContract {
  return createInterventionResult({
    mode: 'tool_gap',
    permittedModes: ['tool_gap'],
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    producedAt: T0,
    summary: 'expert used an external spectral analyzer the agent lacks',
    missingToolId: 'spectral-analyzer',
    rationale: 'needed frequency-domain analysis',
    evidenceOfUseRefs: ['event/evt-tool-invocation-0001'],
  });
}

export interface ServiceAssembly {
  readonly service: CapabilityImprovementService;
  readonly clock: FixedClock;
  readonly outcomePort: InMemoryInterventionOutcomePort;
  readonly toolGapLedger: InMemoryToolGapSignalLedger;
  readonly knowledgeLedger: InMemoryKnowledgeLatticeLedger;
  readonly toolSpecificationPort: InMemoryToolSpecificationProposalPort;
  readonly adapterRequestPort: InMemoryAdapterRequestProposalPort;
  readonly bodyImprovementPort: InMemoryBodyImprovementCandidatePort;
  readonly benchmarkPort: InMemoryBenchmarkCandidatePort;
  readonly marketplacePort: InMemoryMarketplaceArtifactCandidatePort;
  readonly learningPort: InMemoryLearningCandidatePort;
  readonly auditSink: InMemoryDispositionAuditSink;
}

export function assembleService(startAt = T0): ServiceAssembly {
  const clock = new FixedClock(startAt);
  const outcomePort = new InMemoryInterventionOutcomePort();
  const toolGapLedger = new InMemoryToolGapSignalLedger();
  const knowledgeLedger = new InMemoryKnowledgeLatticeLedger();
  const toolSpecificationPort = new InMemoryToolSpecificationProposalPort();
  const adapterRequestPort = new InMemoryAdapterRequestProposalPort();
  const bodyImprovementPort = new InMemoryBodyImprovementCandidatePort();
  const benchmarkPort = new InMemoryBenchmarkCandidatePort();
  const marketplacePort = new InMemoryMarketplaceArtifactCandidatePort();
  const learningPort = new InMemoryLearningCandidatePort();
  const auditSink = new InMemoryDispositionAuditSink();
  const config: CapabilityImprovementServiceConfig = {
    clock,
    outcomePort,
    toolGapLedger,
    knowledgeLedger,
    toolSpecificationPort,
    adapterRequestPort,
    bodyImprovementPort,
    benchmarkPort,
    marketplacePort,
    learningPort,
    auditSink,
  };
  return {
    service: new CapabilityImprovementService(config),
    clock,
    outcomePort,
    toolGapLedger,
    knowledgeLedger,
    toolSpecificationPort,
    adapterRequestPort,
    bodyImprovementPort,
    benchmarkPort,
    marketplacePort,
    learningPort,
    auditSink,
  };
}

export async function seedOutcome(
  outcomePort: InMemoryInterventionOutcomePort,
  submission: ExpertSessionSubmission,
  overrides: { interventionId?: string; tenantId?: string } = {},
): Promise<CompletedInterventionOutcome> {
  const outcome: CompletedInterventionOutcome = {
    interventionId: overrides.interventionId ?? INTERVENTION_ID,
    requestId: REQUEST_ID,
    sessionId: SESSION_ID,
    tenantId: overrides.tenantId ?? TENANT,
    mode: 'tool_gap',
    resultKind: 'tool-gap-signal',
    contract: makeToolGapContract(),
    submission,
    completedAt: new Date(T0).toISOString(),
  };
  await outcomePort.seed(outcome);
  return outcome;
}
