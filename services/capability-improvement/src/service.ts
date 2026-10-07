/**
 * CapabilityImprovementService — the reference pipeline service (Work
 * Order C008; issue #115).
 *
 * Capture → disposition over injected ports, durable + idempotent on the
 * reference fabric (lock rule 17):
 *
 *   - captureInterventionOutputs: loads a COMPLETED C007 outcome through
 *     the injected seam and captures every EES1.0 tool-gap signal as a
 *     staged ToolGapSignalRecord (stage CAPTURED) and every four-tier
 *     knowledge artifact as a LatticeKnowledgeRecord. Consent is a hard
 *     gate (reusable artifacts without GRANTED session consent fail
 *     closed). Content-key dedup means duplicate injections DEDUPLICATE —
 *     audit 'deduplicated' — they never inflate triage counts;
 *   - triageSignal / proposeToolSpecification / dispositionSignal: the
 *     closed stage machine (captured → triaged → tool-specification-
 *     proposed → feed terminal), each step emitting its idempotent
 *     proposal onto the matching destination seam BEFORE the stage moves
 *     (a failed emission leaves the stage untouched — fail-closed);
 *   - promoteKnowledge: the EXPLICIT no-silent-promotion path through the
 *     knowledge-capture wall (denied promotions are audited and rethrown);
 *   - proposeKnowledgePatch: cuts the scoped, rights-carrying,
 *     evidence-backed KnowledgePatch and emits it to the A019/A020
 *     learning seam as a CANDIDATE ONLY.
 *
 * Every capture-to-disposition decision lands in the append-only audit
 * stream with a machine-readable decision code. All failures are typed
 * and fail-closed; time is injected (never a wall-clock read).
 */

import type { ExpertSessionSubmission } from '@arena/expert-session';
import { isToolGapSignal } from '@arena/expert-session';
import { KnowledgeCaptureError, createKnowledgePatch, createLatticeKnowledgeRecord, knowledgeContentKey, parseScopeDeclaration, promoteLatticeKnowledge } from '@arena/knowledge-capture';
import type { LatticeKnowledgeRecord, KnowledgeScopeDeclaration } from '@arena/knowledge-capture';
import {
  advanceToolGapSignalStage,
  checkStageTransition,
  createToolGapSignalRecord,
  isToolGapFeedStage,
  signalContentKey,
} from '@arena/tool-gap';
import type { ToolGapSignalRecord } from '@arena/tool-gap';
import type {
  AdapterRequestProposalPort,
  BenchmarkCandidatePort,
  BodyImprovementCandidatePort,
  Clock,
  CompletedInterventionOutcome,
  DispositionAuditSink,
  DispositionDecisionCode,
  InterventionOutcomePort,
  KnowledgeLatticeLedger,
  LearningCandidatePort,
  MarketplaceArtifactCandidatePort,
  ProposalReceipt,
  ProposalSource,
  ToolGapSignalLedger,
  ToolSpecificationProposalPort,
} from './ports.js';
import { CAPABILITY_IMPROVEMENT_ERROR_CODES, CapabilityImprovementError } from './errors.js';

/** Implementation version of the reference service. */
export const CAPABILITY_IMPROVEMENT_IMPLEMENTATION_VERSION = '0.1.0';

export interface CapabilityImprovementServiceConfig {
  readonly clock: Clock;
  /** THE C007 SEAM. */
  readonly outcomePort: InterventionOutcomePort;
  readonly toolGapLedger: ToolGapSignalLedger;
  readonly knowledgeLedger: KnowledgeLatticeLedger;
  /** THE EES1.0 FEED DESTINATIONS (A019/A020/A021 seams). */
  readonly toolSpecificationPort: ToolSpecificationProposalPort;
  readonly adapterRequestPort: AdapterRequestProposalPort;
  readonly bodyImprovementPort: BodyImprovementCandidatePort;
  readonly benchmarkPort: BenchmarkCandidatePort;
  readonly marketplacePort: MarketplaceArtifactCandidatePort;
  readonly learningPort: LearningCandidatePort;
  readonly auditSink: DispositionAuditSink;
}

// ---------------------------------------------------------------------------
// Commands and views
// ---------------------------------------------------------------------------

export interface CaptureInterventionOutputsInput {
  readonly interventionId: string;
  readonly tenantId: string;
  /** Idempotency key of the capture command (lock rule 17). */
  readonly captureKey: string;
  readonly correlationId: string;
  readonly now?: number;
}

export interface CaptureOutcomeView {
  readonly interventionId: string;
  readonly signalsCaptured: number;
  readonly signalsDeduplicated: number;
  readonly knowledgeCaptured: number;
  readonly knowledgeDeduplicated: number;
  readonly signalIds: readonly string[];
  readonly knowledgeRecordIds: readonly string[];
  readonly capturedAt: string;
}

export interface TriageSignalInput {
  readonly signalId: string;
  readonly tenantId: string;
  readonly decision: string;
  readonly actor?: string;
  readonly now?: number;
}

export interface ProposeToolSpecificationInput {
  readonly signalId: string;
  readonly tenantId: string;
  /** The specification summary (what the proposed tool must do). */
  readonly summary: string;
  readonly decision: string;
  readonly actor?: string;
  readonly now?: number;
}

export interface DispositionSignalInput {
  readonly signalId: string;
  readonly tenantId: string;
  readonly feed: string;
  readonly decision: string;
  readonly actor?: string;
  readonly now?: number;
}

export interface PromoteKnowledgeInput {
  readonly recordId: string;
  readonly tenantId: string;
  readonly toTier: string;
  readonly toScope: KnowledgeScopeDeclaration;
  readonly justification: string;
  readonly consent: { readonly granted: boolean; readonly statement: string };
  readonly validationRef?: string;
  readonly now?: number;
}

export interface ProposeKnowledgePatchInput {
  readonly recordId: string;
  readonly tenantId: string;
  readonly now?: number;
}

export interface DispositionResultView {
  readonly signalId: string;
  readonly stage: string;
  readonly receipt: ProposalReceipt;
  readonly auditSequence: number;
}

export interface KnowledgeDispositionResultView {
  readonly recordId: string;
  readonly receipt: ProposalReceipt;
  readonly auditSequence: number;
}

export interface PromotionResultView {
  readonly fromRecordId: string;
  readonly toRecordId: string;
  readonly tier: string;
  readonly scope: KnowledgeScopeDeclaration;
  readonly auditSequence: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type AuditSubjectKind = 'tool-gap-signal' | 'knowledge-record' | 'knowledge-patch';

export class CapabilityImprovementService {
  private readonly clock: Clock;
  private readonly outcomePort: InterventionOutcomePort;
  private readonly toolGapLedger: ToolGapSignalLedger;
  private readonly knowledgeLedger: KnowledgeLatticeLedger;
  private readonly toolSpecificationPort: ToolSpecificationProposalPort;
  private readonly adapterRequestPort: AdapterRequestProposalPort;
  private readonly bodyImprovementPort: BodyImprovementCandidatePort;
  private readonly benchmarkPort: BenchmarkCandidatePort;
  private readonly marketplacePort: MarketplaceArtifactCandidatePort;
  private readonly learningPort: LearningCandidatePort;
  private readonly auditSink: DispositionAuditSink;

  constructor(config: CapabilityImprovementServiceConfig) {
    this.clock = config.clock;
    this.outcomePort = config.outcomePort;
    this.toolGapLedger = config.toolGapLedger;
    this.knowledgeLedger = config.knowledgeLedger;
    this.toolSpecificationPort = config.toolSpecificationPort;
    this.adapterRequestPort = config.adapterRequestPort;
    this.bodyImprovementPort = config.bodyImprovementPort;
    this.benchmarkPort = config.benchmarkPort;
    this.marketplacePort = config.marketplacePort;
    this.learningPort = config.learningPort;
    this.auditSink = config.auditSink;
  }

  private now(input: { readonly now?: number }): number {
    return input.now === undefined ? this.clock.now() : input.now;
  }

  private async audit(
    subject: { readonly kind: AuditSubjectKind; readonly id: string },
    decision: DispositionDecisionCode,
    correlationId: string,
    details: Readonly<Record<string, unknown>>,
    occurredAt: number,
  ): Promise<number> {
    const entry = await this.auditSink.append({
      auditVersion: 1,
      occurredAt: new Date(occurredAt).toISOString(),
      correlationId,
      subject,
      decision,
      details,
    });
    return entry.sequence;
  }

  // -------------------------------------------------------------------------
  // Capture (the C007 seam → the staged ledgers)
  // -------------------------------------------------------------------------

  /** Capture all EES1.0 signals + knowledge artifacts of a completed intervention. */
  async captureInterventionOutputs(input: CaptureInterventionOutputsInput): Promise<CaptureOutcomeView> {
    if (typeof input !== 'object' || input === null) {
      throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
        message: 'capture input must be an object',
      });
    }
    for (const field of ['interventionId', 'tenantId', 'captureKey', 'correlationId'] as const) {
      if (typeof input[field] !== 'string' || input[field].length === 0) {
        throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
          message: `${field} must be a non-empty string`,
        });
      }
    }
    const outcome = await this.outcomePort.get(input.interventionId, input.tenantId);
    if (outcome === undefined) {
      throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.NOT_FOUND, {
        message: `no completed intervention outcome for id ${input.interventionId} in tenant ${input.tenantId} (fail-closed: cross-tenant and unknown ids are indistinguishable)`,
        details: { interventionId: input.interventionId },
      });
    }
    const submission = outcome.submission;
    if (submission === undefined) {
      return Object.freeze({
        interventionId: outcome.interventionId,
        signalsCaptured: 0,
        signalsDeduplicated: 0,
        knowledgeCaptured: 0,
        knowledgeDeduplicated: 0,
        signalIds: [],
        knowledgeRecordIds: [],
        capturedAt: new Date(this.now({})).toISOString(),
      });
    }
    this.assertConsentForCapture(submission, outcome);

    const capturedAt = this.now({});
    const signalIds: string[] = [];
    const knowledgeRecordIds: string[] = [];
    let signalsDeduplicated = 0;
    let knowledgeDeduplicated = 0;

    for (const signal of submission.toolGapSignals ?? []) {
      if (!isToolGapSignal(signal)) {
        throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
          message: 'toolGapSignals entry is not a valid EES1.0 ToolGapSignal (C006 vocabulary)',
          details: { interventionId: outcome.interventionId },
        });
      }
      const contentKey = signalContentKey(signal);
      const existing = await this.toolGapLedger.findByContentKey(contentKey);
      if (existing !== undefined) {
        signalsDeduplicated += 1;
        await this.audit(
          { kind: 'tool-gap-signal', id: existing.signalId },
          'signal_deduplicated',
          input.correlationId,
          { contentKey, captureKey: input.captureKey, interventionId: outcome.interventionId },
          capturedAt,
        );
        signalIds.push(existing.signalId);
        continue;
      }
      const record = createToolGapSignalRecord({
        signal,
        tenantId: outcome.tenantId,
        interventionId: outcome.interventionId,
        requestId: outcome.requestId,
        sessionId: outcome.sessionId,
        correlationId: input.correlationId,
        captureKey: input.captureKey,
        now: capturedAt,
      });
      const insertOutcome = await this.toolGapLedger.insert(record);
      if (insertOutcome === 'duplicate') {
        signalsDeduplicated += 1;
        await this.audit(
          { kind: 'tool-gap-signal', id: record.signalId },
          'signal_deduplicated',
          input.correlationId,
          { contentKey, captureKey: input.captureKey },
          capturedAt,
        );
      } else {
        await this.audit(
          { kind: 'tool-gap-signal', id: record.signalId },
          'signal_captured',
          input.correlationId,
          {
            toolName: record.signal.toolName,
            nature: record.signal.nature,
            interventionId: outcome.interventionId,
            captureKey: input.captureKey,
          },
          capturedAt,
        );
      }
      signalIds.push(record.signalId);
    }

    for (const artifact of submission.knowledgeArtifacts ?? []) {
      const declared = parseScopeDeclaration(artifact.scope);
      if (declared === null) {
        throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_SCOPE, {
          message: `knowledge artifact scope is not a typed "<kind>:<ref>" declaration (task/case/domain/jurisdiction): ${JSON.stringify(artifact.scope)} — free-text scopes cannot enter the lattice`,
          details: { artifactId: artifact.artifactId, scope: artifact.scope },
        });
      }
      const evidence = evidenceRefsOf(submission);
      const contentKey = knowledgeContentKey(artifact, declared);
      const existing = await this.knowledgeLedger.findByContentKey(contentKey);
      if (existing !== undefined) {
        knowledgeDeduplicated += 1;
        await this.audit(
          { kind: 'knowledge-record', id: existing.recordId },
          'knowledge_deduplicated',
          input.correlationId,
          { contentKey, captureKey: input.captureKey, interventionId: outcome.interventionId },
          capturedAt,
        );
        knowledgeRecordIds.push(existing.recordId);
        continue;
      }
      const record = createLatticeKnowledgeRecord({
        artifact,
        scope: declared,
        evidenceRefs: evidence,
        tenantId: outcome.tenantId,
        interventionId: outcome.interventionId,
        requestId: outcome.requestId,
        sessionId: outcome.sessionId,
        correlationId: input.correlationId,
        captureKey: input.captureKey,
        now: capturedAt,
      });
      const insertOutcome = await this.knowledgeLedger.insert(record);
      if (insertOutcome === 'duplicate') {
        knowledgeDeduplicated += 1;
        await this.audit(
          { kind: 'knowledge-record', id: record.recordId },
          'knowledge_deduplicated',
          input.correlationId,
          { contentKey, captureKey: input.captureKey },
          capturedAt,
        );
      } else {
        await this.audit(
          { kind: 'knowledge-record', id: record.recordId },
          'knowledge_captured',
          input.correlationId,
          {
            tier: record.artifact.tier,
            scopeKind: record.scope.kind,
            interventionId: outcome.interventionId,
            captureKey: input.captureKey,
          },
          capturedAt,
        );
      }
      knowledgeRecordIds.push(record.recordId);
    }

    return Object.freeze({
      interventionId: outcome.interventionId,
      signalsCaptured: signalIds.length - signalsDeduplicated,
      signalsDeduplicated,
      knowledgeCaptured: knowledgeRecordIds.length - knowledgeDeduplicated,
      knowledgeDeduplicated,
      signalIds: Object.freeze([...signalIds]),
      knowledgeRecordIds: Object.freeze([...knowledgeRecordIds]),
      capturedAt: new Date(capturedAt).toISOString(),
    });
  }

  private assertConsentForCapture(
    submission: ExpertSessionSubmission,
    outcome: CompletedInterventionOutcome,
  ): void {
    const knowledge = submission.knowledgeArtifacts ?? [];
    if (knowledge.length > 0 && !submission.consentRightsStatement.granted) {
      throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.MISSING_CONSENT, {
        message: 'knowledge artifacts require GRANTED session consent (EES1.0 completion contract + lock rule 31) — capture fails closed',
        details: { interventionId: outcome.interventionId, artifacts: knowledge.length },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Tool-gap disposition (the closed stage machine)
  // -------------------------------------------------------------------------

  private async loadSignal(signalId: string, tenantId: string): Promise<ToolGapSignalRecord> {
    const record = await this.toolGapLedger.get(signalId, tenantId);
    if (record === undefined) {
      throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.NOT_FOUND, {
        message: `no tool-gap signal record for id ${signalId} in tenant ${tenantId}`,
        details: { signalId },
      });
    }
    return record;
  }

  /**
   * Guard the closed stage machine BEFORE any proposal is emitted — an
   * illegal transition can never emit a proposal onto a destination seam
   * (fail-closed ordering: verdict → emission → stage move → audit).
   */
  private guardStageTransition(record: ToolGapSignalRecord, toStage: string): void {
    const verdict = checkStageTransition(record.stage, toStage);
    if (!verdict.allowed) {
      const code =
        verdict.reason === 'transition_terminal_final'
          ? CAPABILITY_IMPROVEMENT_ERROR_CODES.NOT_FOUND
          : CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT;
      throw new CapabilityImprovementError(code, {
        message: `stage transition ${record.stage} -> ${toStage} denied (${verdict.reason}) — no proposal was emitted`,
        details: { reason: verdict.reason, from: verdict.from, to: verdict.to, signalId: record.signalId },
        correlationId: record.correlation.correlationId,
      });
    }
  }

  /** CAPTURED → TRIAGED (explicit triage decision, audited). */
  async triageSignal(input: TriageSignalInput): Promise<DispositionResultView> {
    const record = await this.loadSignal(input.signalId, input.tenantId);
    const at = this.now(input);
    const advanced = advanceToolGapSignalStage({
      record,
      toStage: 'triaged',
      decision: input.decision,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      now: at,
    });
    await this.toolGapLedger.update(advanced);
    const sequence = await this.audit(
      { kind: 'tool-gap-signal', id: advanced.signalId },
      'signal_triaged',
      advanced.correlation.correlationId,
      { decision: input.decision, from: record.stage, to: advanced.stage },
      at,
    );
    return Object.freeze({
      signalId: advanced.signalId,
      stage: advanced.stage,
      receipt: Object.freeze({
        receiptVersion: 1,
        receiptId: `triage-${advanced.signalId}`,
        status: 'submitted' as const,
        submittedAt: new Date(at).toISOString(),
      }),
      auditSequence: sequence,
    });
  }

  /** TRIAGED → TOOL_SPECIFICATION_PROPOSED (emits the idempotent proposal first). */
  async proposeToolSpecification(input: ProposeToolSpecificationInput): Promise<DispositionResultView> {
    if (typeof input.summary !== 'string' || input.summary.length === 0) {
      throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
        message: 'summary must be a non-empty string',
      });
    }
    const record = await this.loadSignal(input.signalId, input.tenantId);
    this.guardStageTransition(record, 'tool-specification-proposed');
    const at = this.now(input);
    const proposalId = `tsp-${record.signalId}`;
    const source = proposalSourceOf(record);
    const receipt = await this.toolSpecificationPort.submit({
      payload: {
        proposalVersion: 1,
        proposalId,
        source,
        summary: input.summary,
        toolName: record.signal.toolName,
        capabilityProvided: record.signal.capabilityProvided,
        whyNeeded: record.signal.whyNeeded,
        inputs: record.signal.inputs,
        outputs: record.signal.outputs,
        nature: record.signal.nature,
        accessRequirements: record.signal.accessRequirements,
        cost: record.signal.cost,
        evidenceOfUse: record.signal.evidenceOfUse,
        recommendedIntegrationBoundary: record.signal.recommendedIntegrationBoundary,
        substitutionPossible: record.signal.substitutionPossible,
        proposedAt: new Date(at).toISOString(),
      },
      correlationId: record.correlation.correlationId,
      idempotencyKey: proposalId,
      submittedAt: new Date(at).toISOString(),
    });
    const advanced = advanceToolGapSignalStage({
      record,
      toStage: 'tool-specification-proposed',
      decision: input.decision,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      now: at,
    });
    await this.toolGapLedger.update(advanced);
    const sequence = await this.audit(
      { kind: 'tool-gap-signal', id: advanced.signalId },
      'tool_specification_proposed',
      advanced.correlation.correlationId,
      { decision: input.decision, proposalId, receiptId: receipt.receiptId, receiptStatus: receipt.status },
      at,
    );
    return Object.freeze({
      signalId: advanced.signalId,
      stage: advanced.stage,
      receipt,
      auditSequence: sequence,
    });
  }

  /** → one of the four feed terminals (emits the idempotent proposal first). */
  async dispositionSignal(input: DispositionSignalInput): Promise<DispositionResultView> {
    if (!isToolGapFeedStage(input.feed)) {
      throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
        message: `feed must be one of adapter-request | body-improvement-candidate | benchmark-candidate | marketplace-artifact-candidate: ${JSON.stringify(input.feed)}`,
      });
    }
    const record = await this.loadSignal(input.signalId, input.tenantId);
    this.guardStageTransition(record, input.feed);
    const at = this.now(input);
    const source = proposalSourceOf(record);
    const proposedAt = new Date(at).toISOString();
    const summary = `${record.signal.toolName}: ${record.signal.capabilityProvided}`;
    let receipt: ProposalReceipt;
    let decision: DispositionDecisionCode;
    if (input.feed === 'adapter-request') {
      receipt = await this.adapterRequestPort.submit({
        payload: {
          requestVersion: 1,
          requestId: `adr-${record.signalId}`,
          source,
          toolName: record.signal.toolName,
          integrationBoundary: record.signal.recommendedIntegrationBoundary,
          evidenceOfUse: record.signal.evidenceOfUse,
          proposedAt,
        },
        correlationId: record.correlation.correlationId,
        idempotencyKey: `adr-${record.signalId}`,
        submittedAt: proposedAt,
      });
      decision = 'adapter_request_proposed';
    } else if (input.feed === 'body-improvement-candidate') {
      receipt = await this.bodyImprovementPort.submit({
        payload: {
          candidateVersion: 1,
          candidateId: `bic-${record.signalId}`,
          source,
          summary,
          toolName: record.signal.toolName,
          evidenceOfUse: record.signal.evidenceOfUse,
          proposedAt,
        },
        correlationId: record.correlation.correlationId,
        idempotencyKey: `bic-${record.signalId}`,
        submittedAt: proposedAt,
      });
      decision = 'body_improvement_candidate_proposed';
    } else if (input.feed === 'benchmark-candidate') {
      receipt = await this.benchmarkPort.submit({
        payload: {
          candidateVersion: 1,
          candidateId: `bmk-${record.signalId}`,
          source,
          summary,
          toolName: record.signal.toolName,
          evidenceOfUse: record.signal.evidenceOfUse,
          proposedAt,
        },
        correlationId: record.correlation.correlationId,
        idempotencyKey: `bmk-${record.signalId}`,
        submittedAt: proposedAt,
      });
      decision = 'benchmark_candidate_proposed';
    } else {
      receipt = await this.marketplacePort.submit({
        payload: {
          candidateVersion: 1,
          candidateId: `mkt-${record.signalId}`,
          source,
          summary,
          toolName: record.signal.toolName,
          evidenceOfUse: record.signal.evidenceOfUse,
          proposedAt,
        },
        correlationId: record.correlation.correlationId,
        idempotencyKey: `mkt-${record.signalId}`,
        submittedAt: proposedAt,
      });
      decision = 'marketplace_artifact_candidate_proposed';
    }
    const advanced = advanceToolGapSignalStage({
      record,
      toStage: input.feed,
      decision: input.decision,
      ...(input.actor !== undefined ? { actor: input.actor } : {}),
      now: at,
    });
    await this.toolGapLedger.update(advanced);
    const sequence = await this.audit(
      { kind: 'tool-gap-signal', id: advanced.signalId },
      decision,
      advanced.correlation.correlationId,
      { decision: input.decision, feed: input.feed, receiptId: receipt.receiptId, receiptStatus: receipt.status },
      at,
    );
    return Object.freeze({
      signalId: advanced.signalId,
      stage: advanced.stage,
      receipt,
      auditSequence: sequence,
    });
  }

  // -------------------------------------------------------------------------
  // Knowledge disposition (the lattice + the learning seam)
  // -------------------------------------------------------------------------

  private async loadKnowledge(recordId: string, tenantId: string): Promise<LatticeKnowledgeRecord> {
    const record = await this.knowledgeLedger.get(recordId, tenantId);
    if (record === undefined) {
      throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.NOT_FOUND, {
        message: `no lattice knowledge record for id ${recordId} in tenant ${tenantId}`,
        details: { recordId },
      });
    }
    return record;
  }

  /** The EXPLICIT promotion path (through the no-silent-promotion wall). */
  async promoteKnowledge(input: PromoteKnowledgeInput): Promise<PromotionResultView> {
    const record = await this.loadKnowledge(input.recordId, input.tenantId);
    const at = this.now(input);
    try {
      const promoted = promoteLatticeKnowledge({
        record,
        toTier: input.toTier,
        toScope: input.toScope,
        justification: input.justification,
        consent: input.consent,
        ...(input.validationRef !== undefined ? { validationRef: input.validationRef } : {}),
        now: at,
      });
      await this.knowledgeLedger.insert(promoted);
      const sequence = await this.audit(
        { kind: 'knowledge-record', id: promoted.recordId },
        'knowledge_promoted',
        promoted.correlation.correlationId,
        {
          fromTier: record.artifact.tier,
          toTier: promoted.artifact.tier,
          fromScope: record.scope,
          toScope: promoted.scope,
          justification: input.justification,
        },
        at,
      );
      return Object.freeze({
        fromRecordId: record.recordId,
        toRecordId: promoted.recordId,
        tier: promoted.artifact.tier,
        scope: promoted.scope,
        auditSequence: sequence,
      });
    } catch (error) {
      if (error instanceof KnowledgeCaptureError) {
        await this.audit(
          { kind: 'knowledge-record', id: record.recordId },
          'promotion_denied',
          record.correlation.correlationId,
          {
            code: error.code,
            reason: error.details['reason'] ?? null,
            toTier: input.toTier,
            toScope: input.toScope,
          },
          at,
        );
      }
      throw error;
    }
  }

  /** Cut the KnowledgePatch and emit it to the A019/A020 learning seam (candidate ONLY). */
  async proposeKnowledgePatch(input: ProposeKnowledgePatchInput): Promise<KnowledgeDispositionResultView> {
    const record = await this.loadKnowledge(input.recordId, input.tenantId);
    const at = this.now(input);
    try {
      const patch = createKnowledgePatch({ record, now: at });
      const candidateId = `lc-${record.recordId}`;
      const receipt = await this.learningPort.submit({
        payload: {
          candidateVersion: 1,
          candidateId,
          sourceRecordId: record.recordId,
          tenantId: record.provenance.tenantId,
          correlationId: record.correlation.correlationId,
          patch,
          proposedAt: new Date(at).toISOString(),
        },
        correlationId: record.correlation.correlationId,
        idempotencyKey: candidateId,
        submittedAt: new Date(at).toISOString(),
      });
      const sequence = await this.audit(
        { kind: 'knowledge-patch', id: patch.patchId },
        'learning_candidate_proposed',
        record.correlation.correlationId,
        { recordId: record.recordId, tier: patch.tier, scope: patch.scope, receiptId: receipt.receiptId },
        at,
      );
      return Object.freeze({ recordId: record.recordId, receipt, auditSequence: sequence });
    } catch (error) {
      if (error instanceof KnowledgeCaptureError) {
        await this.audit(
          { kind: 'knowledge-record', id: record.recordId },
          'patch_denied',
          record.correlation.correlationId,
          { code: error.code, tier: record.artifact.tier },
          at,
        );
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Read projections (pure)
  // -------------------------------------------------------------------------

  async getSignal(signalId: string, tenantId: string): Promise<ToolGapSignalRecord | undefined> {
    return this.toolGapLedger.get(signalId, tenantId);
  }

  async listSignals(): Promise<readonly ToolGapSignalRecord[]> {
    return this.toolGapLedger.list();
  }

  async getKnowledgeRecord(recordId: string, tenantId: string): Promise<LatticeKnowledgeRecord | undefined> {
    return this.knowledgeLedger.get(recordId, tenantId);
  }

  async listKnowledgeRecords(): Promise<readonly LatticeKnowledgeRecord[]> {
    return this.knowledgeLedger.list();
  }

  async auditLog(): Promise<readonly import('./ports.js').DispositionAuditEntry[]> {
    return this.auditSink.list();
  }

  async verifyAuditChain(): Promise<boolean> {
    return this.auditSink.verify();
  }
}

function proposalSourceOf(record: ToolGapSignalRecord): ProposalSource {
  return Object.freeze({
    tenantId: record.provenance.tenantId,
    interventionId: record.provenance.interventionId,
    requestId: record.provenance.requestId,
    sessionId: record.provenance.sessionId,
    signalId: record.signalId,
  });
}

function evidenceRefsOf(submission: ExpertSessionSubmission): readonly string[] {
  return submission.evidence.map((entry) => `${entry.kind}:${entry.ref}`);
}
