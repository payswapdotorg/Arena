/**
 * Capability-learning service ports (Work Order C022) — the ONLY things
 * services/capability-learning depends on besides the domain package
 * (@arena/capability-learning) and the A020 seam packages
 * (@arena/learning, @arena/trajectory, @arena/evaluation,
 * @arena/verification, @arena/protocol-core).
 *
 * Mirroring the services-layer house pattern (A013/A015/C001/C006/C007/C008):
 *   - Clock                 — time is INJECTED (never a wall-clock read;
 *                             architecture-lock rule 17);
 *   - CandidateLedger       — append-only persistence for ingested
 *                             improvement candidates (digest dedup);
 *   - ProgramLedger         — append-only persistence for compiled
 *                             ImprovementPrograms (digest dedup);
 *   - GateVerdictLedger     — append-only persistence for adoption-gate
 *                             verdicts (program-addressed);
 *   - ExperimentEnginePort  — THE A020 SEAM: each program's assembled
 *                             experiment executes through this injected
 *                             port (never by importing the A020 service —
 *                             boundary rule B2);
 *   - proposal ports        — THE A021/A022/A023 DESTINATION SEAMS: the
 *                             Body Forge body-version proposals, the
 *                             compatibility re-test obligations and the
 *                             recertification triggers. Every emission is
 *                             an idempotent PROPOSAL — never a silent
 *                             promotion into a live surface (lock rule 32);
 *   - FeedbackLedger        — append-only persistence for the feedback
 *                             records (interventions → improvements →
 *                             measured lift);
 *   - CompilerAuditSink     — the append-only audit stream: every
 *                             ingest/compile/gate/dispatch decision is
 *                             audited (machine-readable decision codes,
 *                             contiguous sequence, tamper-evident chain).
 *
 * Authority boundary (lock rule 16): the service OWNS compile
 * orchestration only. It never judges capability outcomes beyond the
 * Q1.0 gate computation (which lives in @arena/capability-learning),
 * never grants rights, and never mutates the host application's live
 * agent.
 */

import type {
  AdoptionGateVerdict,
  CreateImprovementCandidateInput,
  FeedbackRecord,
  GatedImprovementProposal,
  ImprovementCandidate,
  ImprovementProgram,
} from '@arena/capability-learning';
import type { ExperimentDescriptor, ExperimentRunRecord } from '@arena/learning';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

// ---------------------------------------------------------------------------
// Append-only ledgers (durable + idempotent on the reference fabric)
// ---------------------------------------------------------------------------

/** Machine-readable insert outcome (duplicate content never inflates counts). */
export const LEDGER_INSERT_OUTCOMES = Object.freeze(['inserted', 'duplicate'] as const);
export type LedgerInsertOutcome = (typeof LEDGER_INSERT_OUTCOMES)[number];

/** Append-only persistence for ingested improvement candidates. */
export interface CandidateLedger {
  /** Insert a NEW ingested candidate; same digest yields 'duplicate' (no second record). */
  insert(record: ImprovementCandidate): Promise<LedgerInsertOutcome>;
  /** All candidates of one tenant (cross-tenant reads see nothing). */
  listByTenant(tenantId: string): Promise<readonly ImprovementCandidate[]>;
}

/** Append-only persistence for compiled improvement programs. */
export interface ProgramLedger {
  /** Insert a NEW compiled program; same digest yields 'duplicate'. */
  insert(record: ImprovementProgram): Promise<LedgerInsertOutcome>;
  /** Tenant-scoped lookup by program id. */
  get(programId: string, tenantId: string): Promise<ImprovementProgram | undefined>;
  /** All programs of one tenant. */
  listByTenant(tenantId: string): Promise<readonly ImprovementProgram[]>;
}

/** Append-only persistence for adoption-gate verdicts (program-addressed). */
export interface GateVerdictLedger {
  /** Store the latest verdict of one program (the append-only stream is the audit + feedback ledgers). */
  store(programId: string, verdict: AdoptionGateVerdict): Promise<void>;
  /** The latest verdict of one program (tenant scoping is the program's). */
  get(programId: string): Promise<AdoptionGateVerdict | undefined>;
  /** All verdicts, newest last (inspection). */
  list(): Promise<readonly AdoptionGateVerdict[]>;
}

/** Append-only persistence for feedback records. */
export interface FeedbackLedger {
  /** Insert a NEW feedback record; same digest yields 'duplicate'. */
  insert(record: FeedbackRecord): Promise<LedgerInsertOutcome>;
  /** All feedback records of one tenant. */
  listByTenant(tenantId: string): Promise<readonly FeedbackRecord[]>;
}

// ---------------------------------------------------------------------------
// THE A020 SEAM — the experiment engine
// ---------------------------------------------------------------------------

/** The arm evidence + measurements of one experiment run (the A020 engine's own input shape). */
export interface ExperimentArmInput {
  readonly trajectories: readonly import('@arena/trajectory').TrajectoryRecord[];
  readonly evaluations: readonly import('@arena/evaluation').EvaluationRecord[];
  readonly verifications: readonly import('@arena/verification').VerificationRecord[];
  readonly metrics: readonly {
    readonly metricId: string;
    readonly value: number;
    readonly variance: number | null;
  }[];
  readonly protectedMetrics: readonly {
    readonly capabilityRef: string;
    readonly value: number;
  }[];
}

/** THE A020 SEAM: execute one compiled program's assembled experiment. */
export interface ExperimentEnginePort {
  /**
   * Run the A020 experiment descriptor over both arms and return the
   * append-only ExperimentRunRecord (idempotent by experimentKey —
   * architecture-lock rule 17; same key + different descriptor/arms is a
   * conflict, not a rerun).
   */
  run(
    request: {
      readonly descriptor: ExperimentDescriptor;
      readonly arms: { readonly baseline: ExperimentArmInput; readonly intervention: ExperimentArmInput };
      readonly experimentKey: string;
      readonly correlationId: string;
    },
  ): Promise<ExperimentRunRecord>;
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

/** The payload every destination proposal carries (the gated proposal, verbatim). */
export interface GatedProposalPayload {
  readonly payloadVersion: 1;
  readonly gated: GatedImprovementProposal;
  readonly submittedAt: string;
}

/** THE A021 SEAM: Body Forge body-version proposals (new immutable BodyVersions). */
export interface ForgeBodyVersionProposalPort {
  submit(submission: ProposalSubmission<GatedProposalPayload>): Promise<ProposalReceipt>;
}

/** THE A022 SEAM: compatibility re-test obligations for substrate-affecting changes. */
export interface CompatibilityRetestProposalPort {
  submit(submission: ProposalSubmission<GatedProposalPayload>): Promise<ProposalReceipt>;
}

/** THE A023 SEAM: recertification triggers. */
export interface RecertificationTriggerProposalPort {
  submit(submission: ProposalSubmission<GatedProposalPayload>): Promise<ProposalReceipt>;
}

// ---------------------------------------------------------------------------
// The append-only compiler audit stream
// ---------------------------------------------------------------------------

/** Machine-readable compiler decision codes (closed set). */
export const COMPILER_DECISION_CODES = Object.freeze([
  'candidate_ingested',
  'candidate_deduplicated',
  'program_compiled',
  'program_blocked',
  'experiment_run',
  'gate_evaluated',
  'gate_adopted',
  'gate_refused',
  'feedback_recorded',
  'proposal_dispatched',
  'proposal_duplicate',
  'dispatch_refused',
] as const);
export type CompilerDecisionCode = (typeof COMPILER_DECISION_CODES)[number];

export function isCompilerDecisionCode(value: unknown): value is CompilerDecisionCode {
  return (
    typeof value === 'string' &&
    (COMPILER_DECISION_CODES as readonly string[]).includes(value)
  );
}

/** One append-only audit entry (the ingest→compile→gate→dispatch decision record). */
export interface CompilerAuditEntry {
  readonly auditVersion: 1;
  /** Contiguous sequence (1..n) stamped by the sink. */
  readonly sequence: number;
  /** Tamper-evident chain digest (sha256 over sequence + payload + previous digest). */
  readonly digest: string;
  readonly entryId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly subject: {
    readonly kind: 'candidate' | 'program' | 'gate-verdict' | 'feedback-record' | 'proposal';
    readonly id: string;
  };
  readonly decision: CompilerDecisionCode;
  readonly details: Readonly<Record<string, unknown>>;
}

/** The append-only audit stream (every decision lands here). */
export interface CompilerAuditSink {
  /** Append one decision (the sink stamps sequence + digest; gaps/duplicates rejected). */
  append(entry: Omit<CompilerAuditEntry, 'sequence' | 'digest' | 'entryId'>): Promise<CompilerAuditEntry>;
  /** All entries in append order (pure projection). */
  list(): Promise<readonly CompilerAuditEntry[]>;
  /** Recompute the chain (tamper detection). */
  verify(): Promise<boolean>;
}

/** Re-export of the domain candidate input (the ingestion command shape). */
export type SubmitCandidateInput = CreateImprovementCandidateInput;
