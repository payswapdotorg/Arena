/**
 * In-memory reference fabric for the capability-improvement service
 * (Work Order C008) — the services-layer house pattern (A013/A015/C001/
 * C006/C007): injected ports with an in-process, zero-external-dependency
 * reference implementation. Hosts swap the fabric for real persistence
 * (adapters/*, never here).
 *
 *   - InMemoryInterventionOutcomePort — tenant-scoped C007 outcome views
 *     the host seeds from the real intervention records;
 *   - InMemoryToolGapSignalLedger — append-only staged signal records
 *     with content-key dedup (duplicate injections cannot inflate triage
 *     counts);
 *   - InMemoryKnowledgeLatticeLedger — append-only lattice records with
 *     content-key dedup;
 *   - CollectingProposalPort — the reference destination seam: wraps
 *     submissions in protocol Envelope<T> command envelopes, dedups by
 *     idempotency key (replays return a duplicate receipt — never a
 *     second proposal), and collects them for inspection;
 *   - InMemoryDispositionAuditSink — the append-only audit stream with a
 *     contiguous sequence and a sha256 chain digest (tamper-evident).
 */

import { digestCanonical, makeEnvelope } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import type {
  AdapterRequestProposal,
  BenchmarkCandidateProposal,
  BodyImprovementCandidateProposal,
  CompletedInterventionOutcome,
  DispositionAuditEntry,
  DispositionAuditSink,
  InterventionOutcomePort,
  KnowledgeLatticeLedger,
  LedgerInsertOutcome,
  LearningCandidateProposal,
  MarketplaceArtifactCandidateProposal,
  ProposalReceipt,
  ProposalSubmission,
  ToolGapSignalLedger,
  ToolSpecificationProposal,
} from './ports.js';
import { isDispositionDecisionCode } from './ports.js';
import type { LatticeKnowledgeRecord } from '@arena/knowledge-capture';
import type { ToolGapSignalRecord } from '@arena/tool-gap';

// ---------------------------------------------------------------------------
// The C007 seam (in-process reference)
// ---------------------------------------------------------------------------

export class InMemoryInterventionOutcomePort implements InterventionOutcomePort {
  private readonly byInterventionId = new Map<string, CompletedInterventionOutcome>();

  async seed(outcome: CompletedInterventionOutcome): Promise<void> {
    this.byInterventionId.set(outcome.interventionId, outcome);
  }

  async get(interventionId: string, tenantId: string): Promise<CompletedInterventionOutcome | undefined> {
    const outcome = this.byInterventionId.get(interventionId);
    if (outcome === undefined || outcome.tenantId !== tenantId) return undefined;
    return outcome;
  }
}

// ---------------------------------------------------------------------------
// Append-only ledgers (content-key dedup)
// ---------------------------------------------------------------------------

export class InMemoryToolGapSignalLedger implements ToolGapSignalLedger {
  private readonly bySignalId = new Map<string, ToolGapSignalRecord>();
  private readonly byContentKey = new Map<string, ToolGapSignalRecord>();

  async insert(record: ToolGapSignalRecord): Promise<LedgerInsertOutcome> {
    if (this.byContentKey.has(record.contentKey)) return 'duplicate';
    this.bySignalId.set(record.signalId, record);
    this.byContentKey.set(record.contentKey, record);
    return 'inserted';
  }

  async update(record: ToolGapSignalRecord): Promise<void> {
    const existing = this.bySignalId.get(record.signalId);
    if (existing === undefined) {
      throw new Error(`unknown tool-gap signal record id: ${record.signalId}`);
    }
    this.bySignalId.set(record.signalId, record);
    this.byContentKey.set(record.contentKey, record);
  }

  async get(signalId: string, tenantId: string): Promise<ToolGapSignalRecord | undefined> {
    const record = this.bySignalId.get(signalId);
    if (record === undefined || record.provenance.tenantId !== tenantId) return undefined;
    return record;
  }

  async findByContentKey(contentKey: string): Promise<ToolGapSignalRecord | undefined> {
    return this.byContentKey.get(contentKey);
  }

  async list(): Promise<readonly ToolGapSignalRecord[]> {
    return [...this.bySignalId.values()];
  }
}

export class InMemoryKnowledgeLatticeLedger implements KnowledgeLatticeLedger {
  private readonly byRecordId = new Map<string, LatticeKnowledgeRecord>();
  private readonly byContentKey = new Map<string, LatticeKnowledgeRecord>();

  async insert(record: LatticeKnowledgeRecord): Promise<LedgerInsertOutcome> {
    if (this.byContentKey.has(record.contentKey)) return 'duplicate';
    this.byRecordId.set(record.recordId, record);
    this.byContentKey.set(record.contentKey, record);
    return 'inserted';
  }

  async update(record: LatticeKnowledgeRecord): Promise<void> {
    const existing = this.byRecordId.get(record.recordId);
    if (existing === undefined) {
      throw new Error(`unknown lattice knowledge record id: ${record.recordId}`);
    }
    this.byRecordId.set(record.recordId, record);
    this.byContentKey.set(record.contentKey, record);
  }

  async get(recordId: string, tenantId: string): Promise<LatticeKnowledgeRecord | undefined> {
    const record = this.byRecordId.get(recordId);
    if (record === undefined || record.provenance.tenantId !== tenantId) return undefined;
    return record;
  }

  async findByContentKey(contentKey: string): Promise<LatticeKnowledgeRecord | undefined> {
    return this.byContentKey.get(contentKey);
  }

  async list(): Promise<readonly LatticeKnowledgeRecord[]> {
    return [...this.byRecordId.values()];
  }
}

// ---------------------------------------------------------------------------
// The destination seams (collecting proposal ports over protocol envelopes)
// ---------------------------------------------------------------------------

interface CollectedProposal {
  readonly envelope: Envelope<unknown>;
  readonly payload: unknown;
  readonly submittedAt: string;
}

/**
 * The reference destination seam: wraps each submission in a protocol
 * Envelope (command kind — the envelope conventions of the sibling
 * services), dedups by idempotency key and collects proposals for
 * inspection. Same key + same payload ⇒ duplicate receipt (the stored
 * one); same key + different payload ⇒ conflict (fail-closed).
 */
export class CollectingProposalPort<TPayload> {
  private readonly byKey = new Map<string, CollectedProposal>();
  readonly schema: string;
  private readonly payloadId: (payload: TPayload) => string;

  constructor(schema: string, payloadId: (payload: TPayload) => string) {
    this.schema = schema;
    this.payloadId = payloadId;
  }

  async submit(submission: ProposalSubmission<TPayload>): Promise<ProposalReceipt> {
    const existing = this.byKey.get(submission.idempotencyKey);
    if (existing !== undefined) {
      const storedId = this.payloadId(existing.payload as TPayload);
      if (storedId !== this.payloadId(submission.payload)) {
        throw new Error(
          `proposal idempotency conflict on key ${submission.idempotencyKey}`,
        );
      }
      return Object.freeze({
        receiptVersion: 1,
        receiptId: `pr-${submission.idempotencyKey}`,
        status: 'duplicate',
        submittedAt: existing.submittedAt,
      });
    }
    const envelope = makeEnvelope<unknown>({
      kind: 'command',
      schema: this.schema,
      correlationId: submission.correlationId as CorrelationId,
      idempotencyKey: submission.idempotencyKey as IdempotencyKey,
      payload: submission.payload,
      issuedAt: submission.submittedAt,
    });
    this.byKey.set(submission.idempotencyKey, {
      envelope,
      payload: submission.payload,
      submittedAt: submission.submittedAt,
    });
    return Object.freeze({
      receiptVersion: 1,
      receiptId: `pr-${submission.idempotencyKey}`,
      status: 'submitted',
      submittedAt: submission.submittedAt,
    });
  }

  /** All submitted proposals (test surface, in submission order). */
  proposals(): readonly TPayload[] {
    return [...this.byKey.values()].map((entry) => entry.payload as TPayload);
  }

  /** The emitted envelopes (inspection/test surface). */
  envelopes(): readonly Envelope<unknown>[] {
    return [...this.byKey.values()].map((entry) => entry.envelope);
  }
}

export class InMemoryToolSpecificationProposalPort extends CollectingProposalPort<ToolSpecificationProposal> {
  constructor() {
    super('arena:schema/capability-improvement/tool-specification-proposal@1.0.0', (p) => p.proposalId);
  }
}

export class InMemoryAdapterRequestProposalPort extends CollectingProposalPort<AdapterRequestProposal> {
  constructor() {
    super('arena:schema/capability-improvement/adapter-request-proposal@1.0.0', (p) => p.requestId);
  }
}

export class InMemoryBodyImprovementCandidatePort extends CollectingProposalPort<BodyImprovementCandidateProposal> {
  constructor() {
    super('arena:schema/capability-improvement/body-improvement-candidate@1.0.0', (p) => p.candidateId);
  }
}

export class InMemoryBenchmarkCandidatePort extends CollectingProposalPort<BenchmarkCandidateProposal> {
  constructor() {
    super('arena:schema/capability-improvement/benchmark-candidate@1.0.0', (p) => p.candidateId);
  }
}

export class InMemoryMarketplaceArtifactCandidatePort extends CollectingProposalPort<MarketplaceArtifactCandidateProposal> {
  constructor() {
    super('arena:schema/capability-improvement/marketplace-artifact-candidate@1.0.0', (p) => p.candidateId);
  }
}

export class InMemoryLearningCandidatePort extends CollectingProposalPort<LearningCandidateProposal> {
  constructor() {
    super('arena:schema/capability-improvement/learning-candidate@1.0.0', (p) => p.candidateId);
  }
}

// ---------------------------------------------------------------------------
// The append-only disposition audit stream (tamper-evident)
// ---------------------------------------------------------------------------

type AuditEntryInput = Omit<DispositionAuditEntry, 'sequence' | 'digest' | 'entryId'>;

export class InMemoryDispositionAuditSink implements DispositionAuditSink {
  private readonly entries: DispositionAuditEntry[] = [];
  private sequence = 0;
  private previousDigest: string | null = null;

  async append(entry: AuditEntryInput): Promise<DispositionAuditEntry> {
    if (!isDispositionDecisionCode(entry.decision)) {
      throw new Error(`unknown disposition decision code: ${JSON.stringify(entry.decision)}`);
    }
    this.sequence += 1;
    const chainInput = {
      sequence: this.sequence,
      previousDigest: this.previousDigest,
      decision: entry.decision,
      subject: entry.subject,
      occurredAt: entry.occurredAt,
      correlationId: entry.correlationId,
    };
    const digest = await digestCanonical(chainInput);
    const stamped: DispositionAuditEntry = Object.freeze({
      ...entry,
      sequence: this.sequence,
      digest,
      entryId: `audit-${String(this.sequence).padStart(8, '0')}`,
    });
    this.entries.push(stamped);
    this.previousDigest = digest;
    return stamped;
  }

  async list(): Promise<readonly DispositionAuditEntry[]> {
    return [...this.entries];
  }

  async verify(): Promise<boolean> {
    let previous: string | null = null;
    let expected = 0;
    for (const entry of this.entries) {
      expected += 1;
      if (entry.sequence !== expected) return false;
      const recomputed = await digestCanonical({
        sequence: entry.sequence,
        previousDigest: previous,
        decision: entry.decision,
        subject: entry.subject,
        occurredAt: entry.occurredAt,
        correlationId: entry.correlationId,
      });
      if (recomputed !== entry.digest) return false;
      previous = entry.digest;
    }
    return true;
  }
}
