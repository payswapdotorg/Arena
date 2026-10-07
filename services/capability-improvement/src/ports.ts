/**
 * Capability-improvement service ports (Work Order C008) — the ONLY
 * things services/capability-improvement depends on besides the domain
 * packages (@arena/tool-gap, @arena/knowledge-capture,
 * @arena/expert-session, @arena/intervention, @arena/protocol-core).
 *
 * Mirroring the services-layer house pattern (A013/A015/C001/C006/C007):
 *   - Clock                 — time is INJECTED (never a wall-clock read;
 *                             architecture-lock rule 17);
 *   - InterventionOutcomePort — THE C007 SEAM: completed intervention
 *                             outcomes (per-mode result contract + the
 *                             EES1.0 session submission carrying
 *                             tool-gap signals, knowledge artifacts and
 *                             the consent/rights statement) are consumed
 *                             through this injected port — never by
 *                             importing another service (boundary rule
 *                             B2); hosts wire the C007 records into this
 *                             view;
 *   - ToolGapSignalLedger   — append-only persistence for staged signal
 *                             records (content-key dedup; the stage
 *                             history inside each record is the
 *                             append-only event level);
 *   - KnowledgeLatticeLedger — append-only persistence for lattice
 *                             knowledge records (content-key dedup);
 *   - proposal ports        — THE A019/A020/A021 DESTINATION SEAMS:
 *                             tool specification proposals, adapter
 *                             requests, body improvement candidates,
 *                             benchmark candidates, marketplace artifact
 *                             candidates and learning candidates. Every
 *                             emission is an idempotent proposal —
 *                             CANDIDATES ONLY, never a silent promotion
 *                             into a live surface (lock rule 32);
 *   - DispositionAuditSink  — the append-only audit stream: every
 *                             capture-to-disposition decision is
 *                             audited (machine-readable decision codes,
 *                             contiguous sequence, tamper-evident
 *                             chain).
 *
 * Authority boundary (lock rule 16): the service OWNS capture
 * orchestration and disposition routing only. It never judges domain
 * outcomes (validation is C009's), never grants rights beyond the
 * session's consent statement, and never mutates the host application's
 * live agent.
 */

import type { ExpertSessionSubmission } from '@arena/expert-session';
import type { InterventionResultContract } from '@arena/intervention';
import type { LatticeKnowledgeRecord } from '@arena/knowledge-capture';
import type { ToolGapFeedStage, ToolGapSignalRecord } from '@arena/tool-gap';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

// ---------------------------------------------------------------------------
// THE C007 SEAM — completed intervention outcomes
// ---------------------------------------------------------------------------

/** A completed intervention outcome (the C007 output this pipeline consumes). */
export interface CompletedInterventionOutcome {
  readonly interventionId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly tenantId: string;
  /** The escalation mode the intervention ran in. */
  readonly mode: string;
  /** The C001 escalation result kind the per-mode contract mapped onto. */
  readonly resultKind: string;
  /** The per-mode intervention result contract (C007). */
  readonly contract: InterventionResultContract;
  /**
   * The EES1.0 session completion submission (tool-gap signals, four-tier
   * knowledge artifacts, consent/rights statement) when the intervention
   * captured one. Signals and knowledge are ONLY captured from here.
   */
  readonly submission?: ExpertSessionSubmission;
  readonly completedAt: string;
}

/** THE C007 SEAM — completed intervention outcomes through an injected port. */
export interface InterventionOutcomePort {
  /** Tenant-scoped lookup by intervention id (cross-tenant reads return undefined). */
  get(interventionId: string, tenantId: string): Promise<CompletedInterventionOutcome | undefined>;
}

// ---------------------------------------------------------------------------
// Append-only ledgers (durable + idempotent on the reference fabric)
// ---------------------------------------------------------------------------

/** Machine-readable insert outcome (duplicate content never inflates counts). */
export const LEDGER_INSERT_OUTCOMES = Object.freeze(['inserted', 'duplicate'] as const);
export type LedgerInsertOutcome = (typeof LEDGER_INSERT_OUTCOMES)[number];

/** Append-only persistence for staged tool-gap signal records. */
export interface ToolGapSignalLedger {
  /** Insert a NEW captured record; same contentKey yields 'duplicate' (no second record). */
  insert(record: ToolGapSignalRecord): Promise<LedgerInsertOutcome>;
  /** Replace the latest snapshot of a record (a stage advance; the history inside is append-only). */
  update(record: ToolGapSignalRecord): Promise<void>;
  /** Tenant-scoped lookup by signal id. */
  get(signalId: string, tenantId: string): Promise<ToolGapSignalRecord | undefined>;
  /** Dedup lookup by content key. */
  findByContentKey(contentKey: string): Promise<ToolGapSignalRecord | undefined>;
  /** All records (scans). */
  list(): Promise<readonly ToolGapSignalRecord[]>;
}

/** Append-only persistence for lattice knowledge records. */
export interface KnowledgeLatticeLedger {
  /** Insert a NEW captured/promoted record; same contentKey yields 'duplicate'. */
  insert(record: LatticeKnowledgeRecord): Promise<LedgerInsertOutcome>;
  /** Replace the latest snapshot of a record (hosts own durability; the domain wall protects integrity). */
  update(record: LatticeKnowledgeRecord): Promise<void>;
  /** Tenant-scoped lookup by record id. */
  get(recordId: string, tenantId: string): Promise<LatticeKnowledgeRecord | undefined>;
  /** Dedup lookup by content key. */
  findByContentKey(contentKey: string): Promise<LatticeKnowledgeRecord | undefined>;
  /** All records (scans). */
  list(): Promise<readonly LatticeKnowledgeRecord[]>;
}

// ---------------------------------------------------------------------------
// THE DESTINATION SEAMS — proposals (candidates only, idempotent)
// ---------------------------------------------------------------------------

/** Receipt for one submitted proposal (idempotent by proposal key). */
export interface ProposalReceipt {
  readonly receiptVersion: 1;
  /** Deterministic receipt id (idempotent per idempotency key). */
  readonly receiptId: string;
  readonly status: 'submitted' | 'duplicate';
  readonly submittedAt: string;
}

/** Common submission metadata for every proposal emission. */
export interface ProposalSubmission<TPayload> {
  readonly payload: TPayload;
  readonly correlationId: string;
  /** Idempotency key — the same key replays as a duplicate receipt (never a second proposal). */
  readonly idempotencyKey: string;
  readonly submittedAt: string;
}

/** The source slice every proposal carries (provenance, lock rule 18). */
export interface ProposalSource {
  readonly tenantId: string;
  readonly interventionId: string;
  readonly requestId: string;
  readonly sessionId: string;
  readonly signalId: string;
}

/** A tool specification proposal (the EES1.0 feed head: Tool specification). */
export interface ToolSpecificationProposal {
  readonly proposalVersion: 1;
  readonly proposalId: string;
  readonly source: ProposalSource;
  readonly summary: string;
  readonly toolName: string;
  readonly capabilityProvided: string;
  readonly whyNeeded: string;
  readonly inputs: unknown;
  readonly outputs: unknown;
  readonly nature: string;
  readonly accessRequirements: readonly string[];
  readonly cost: { readonly amountMinorUnits?: number; readonly currency?: string; readonly latencyMs?: number } | null;
  readonly evidenceOfUse: readonly string[];
  readonly recommendedIntegrationBoundary: string;
  readonly substitutionPossible: boolean;
  readonly proposedAt: string;
}

/** An adapter request proposal (the EES1.0 feed: Adapter request). */
export interface AdapterRequestProposal {
  readonly requestVersion: 1;
  readonly requestId: string;
  readonly source: ProposalSource;
  readonly toolName: string;
  readonly integrationBoundary: string;
  readonly evidenceOfUse: readonly string[];
  readonly proposedAt: string;
}

/** A body improvement candidate (the EES1.0 feed: Body improvement — A021 seam). */
export interface BodyImprovementCandidateProposal {
  readonly candidateVersion: 1;
  readonly candidateId: string;
  readonly source: ProposalSource;
  readonly summary: string;
  readonly toolName: string;
  readonly evidenceOfUse: readonly string[];
  readonly proposedAt: string;
}

/** A capability benchmark candidate (the EES1.0 feed: capability benchmark). */
export interface BenchmarkCandidateProposal {
  readonly candidateVersion: 1;
  readonly candidateId: string;
  readonly source: ProposalSource;
  readonly summary: string;
  readonly toolName: string;
  readonly evidenceOfUse: readonly string[];
  readonly proposedAt: string;
}

/** A marketplace artifact candidate (the EES1.0 feed: marketplace artifact). */
export interface MarketplaceArtifactCandidateProposal {
  readonly candidateVersion: 1;
  readonly candidateId: string;
  readonly source: ProposalSource;
  readonly summary: string;
  readonly toolName: string;
  readonly evidenceOfUse: readonly string[];
  readonly proposedAt: string;
}

/** A learning candidate (the A019/A020 seam — a KnowledgePatch, candidate ONLY). */
export interface LearningCandidateProposal {
  readonly candidateVersion: 1;
  readonly candidateId: string;
  readonly sourceRecordId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  /** The scoped, rights-carrying, evidence-backed patch (candidateOnly: true). */
  readonly patch: import('@arena/knowledge-capture').KnowledgePatch;
  readonly proposedAt: string;
}

/** The EES1.0 feed destination: tool specification proposals. */
export interface ToolSpecificationProposalPort {
  submit(submission: ProposalSubmission<ToolSpecificationProposal>): Promise<ProposalReceipt>;
}

/** The EES1.0 feed destination: adapter requests. */
export interface AdapterRequestProposalPort {
  submit(submission: ProposalSubmission<AdapterRequestProposal>): Promise<ProposalReceipt>;
}

/** The EES1.0 feed destination: body improvement candidates (A021). */
export interface BodyImprovementCandidatePort {
  submit(submission: ProposalSubmission<BodyImprovementCandidateProposal>): Promise<ProposalReceipt>;
}

/** The EES1.0 feed destination: capability benchmark candidates. */
export interface BenchmarkCandidatePort {
  submit(submission: ProposalSubmission<BenchmarkCandidateProposal>): Promise<ProposalReceipt>;
}

/** The EES1.0 feed destination: marketplace artifact candidates. */
export interface MarketplaceArtifactCandidatePort {
  submit(submission: ProposalSubmission<MarketplaceArtifactCandidateProposal>): Promise<ProposalReceipt>;
}

/** The A019/A020 destination: learning candidates (knowledge patches). */
export interface LearningCandidatePort {
  submit(submission: ProposalSubmission<LearningCandidateProposal>): Promise<ProposalReceipt>;
}

// ---------------------------------------------------------------------------
// The append-only disposition audit stream
// ---------------------------------------------------------------------------

/** Machine-readable disposition decision codes (closed set). */
export const DISPOSITION_DECISION_CODES = Object.freeze([
  'signal_captured',
  'signal_deduplicated',
  'signal_triaged',
  'tool_specification_proposed',
  'adapter_request_proposed',
  'body_improvement_candidate_proposed',
  'benchmark_candidate_proposed',
  'marketplace_artifact_candidate_proposed',
  'knowledge_captured',
  'knowledge_deduplicated',
  'knowledge_promoted',
  'promotion_denied',
  'learning_candidate_proposed',
  'patch_denied',
] as const);
export type DispositionDecisionCode = (typeof DISPOSITION_DECISION_CODES)[number];

export function isDispositionDecisionCode(value: unknown): value is DispositionDecisionCode {
  return (
    typeof value === 'string' &&
    (DISPOSITION_DECISION_CODES as readonly string[]).includes(value)
  );
}

/** One append-only audit entry (the capture-to-disposition decision record). */
export interface DispositionAuditEntry {
  readonly auditVersion: 1;
  /** Contiguous sequence (1..n) stamped by the sink. */
  readonly sequence: number;
  /** Tamper-evident chain digest (sha256 over sequence + payload + previous digest). */
  readonly digest: string;
  readonly entryId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly subject: {
    readonly kind: 'tool-gap-signal' | 'knowledge-record' | 'knowledge-patch';
    readonly id: string;
  };
  readonly decision: DispositionDecisionCode;
  readonly details: Readonly<Record<string, unknown>>;
}

/** The append-only audit stream (every capture → disposition decision lands here). */
export interface DispositionAuditSink {
  /** Append one decision (the sink stamps sequence + digest; gaps/duplicates rejected). */
  append(entry: Omit<DispositionAuditEntry, 'sequence' | 'digest' | 'entryId'>): Promise<DispositionAuditEntry>;
  /** All entries in append order (pure projection). */
  list(): Promise<readonly DispositionAuditEntry[]>;
  /** Recompute the chain (tamper detection). */
  verify(): Promise<boolean>;
}

/** The feed stage a disposition routes onto (typed view of ToolGapFeedStage). */
export type CapabilityFeedStage = ToolGapFeedStage;
