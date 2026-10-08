/**
 * In-memory reference fabric for the capability-learning service (Work
 * Order C022) — the services-layer house pattern (A013/A015/C001/C006/
 * C007/C008): injected ports with an in-process, zero-external-dependency
 * reference implementation. Hosts swap the fabric for real persistence
 * (adapters/*, never here).
 *
 *   - InMemoryCandidateLedger / InMemoryProgramLedger /
 *     InMemoryGateVerdictLedger / InMemoryFeedbackLedger — append-only,
 *     digest-deduped, tenant-scoped stores;
 *   - ReferenceExperimentEnginePort — THE A020 SEAM: executes the A020
 *     experiment descriptor over both arms through @arena/learning's OWN
 *     pure computations (compareOutcomeMetrics,
 *     checkProtectedCapabilities, computeUncertaintyReport,
 *     attributeExperiment, decideCapabilityLift, createExperimentRunRecord)
 *     with REAL A011/A012/A013 record guards and freezeHistoricalInputs —
 *     the LE1.0 read-only evidence tier. Idempotent by experimentKey
 *     (same key + different command ⇒ conflict);
 *   - CollectingProposalPort — the reference A021/A022/A023 destination
 *     seams: wraps submissions in protocol Envelope<T> command
 *     envelopes, dedups by idempotency key, collects them for inspection;
 *   - InMemoryCompilerAuditSink — the append-only audit stream with a
 *     contiguous sequence and a sha256 chain digest (tamper-evident).
 */

import { digestCanonical, makeEnvelope } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import {
  attributeExperiment,
  compareOutcomeMetrics,
  computeUncertaintyReport,
  checkProtectedCapabilities,
  createExperimentRunRecord,
  decideCapabilityLift,
  freezeHistoricalInputs,
} from '@arena/learning';
import type { ExperimentDescriptor, ExperimentRunRecord } from '@arena/learning';
import { isTrajectoryRecord } from '@arena/trajectory';
import type { TrajectoryRecord } from '@arena/trajectory';
import { isEvaluationRecord } from '@arena/evaluation';
import type { EvaluationRecord } from '@arena/evaluation';
import { isVerificationRecord } from '@arena/verification';
import type { VerificationRecord } from '@arena/verification';
import type {
  CandidateLedger,
  CompilerAuditEntry,
  CompilerAuditSink,
  ExperimentArmInput,
  ExperimentEnginePort,
  FeedbackLedger,
  GateVerdictLedger,
  LedgerInsertOutcome,
  ProgramLedger,
  ProposalReceipt,
  ProposalSubmission,
} from './ports.js';
import { isCompilerDecisionCode } from './ports.js';
import type {
  AdoptionGateVerdict,
  FeedbackRecord,
  GatedImprovementProposal,
  ImprovementCandidate,
  ImprovementProgram,
} from '@arena/capability-learning';
import { CAPABILITY_LEARNING_SERVICE_ERROR_CODES, CapabilityLearningServiceError } from './errors.js';

// ---------------------------------------------------------------------------
// Append-only ledgers (digest dedup, tenant scoping)
// ---------------------------------------------------------------------------

export class InMemoryCandidateLedger implements CandidateLedger {
  private readonly byDigest = new Map<string, ImprovementCandidate>();

  async insert(record: ImprovementCandidate): Promise<LedgerInsertOutcome> {
    const key = record.digest as string;
    if (this.byDigest.has(key)) return 'duplicate';
    this.byDigest.set(key, record);
    return 'inserted';
  }

  async listByTenant(tenantId: string): Promise<readonly ImprovementCandidate[]> {
    return [...this.byDigest.values()].filter(
      (entry) => (entry.tenantId as string) === tenantId,
    );
  }
}

export class InMemoryProgramLedger implements ProgramLedger {
  private readonly byProgramId = new Map<string, ImprovementProgram>();
  private readonly byDigest = new Map<string, ImprovementProgram>();

  async insert(record: ImprovementProgram): Promise<LedgerInsertOutcome> {
    const key = record.digest as string;
    if (this.byDigest.has(key)) return 'duplicate';
    this.byProgramId.set(record.programId as string, record);
    this.byDigest.set(key, record);
    return 'inserted';
  }

  async get(programId: string, tenantId: string): Promise<ImprovementProgram | undefined> {
    const record = this.byProgramId.get(programId);
    if (record === undefined || (record.tenantId as string) !== tenantId) return undefined;
    return record;
  }

  async listByTenant(tenantId: string): Promise<readonly ImprovementProgram[]> {
    return [...this.byProgramId.values()].filter(
      (entry) => (entry.tenantId as string) === tenantId,
    );
  }
}

export class InMemoryGateVerdictLedger implements GateVerdictLedger {
  private readonly byProgramId = new Map<string, AdoptionGateVerdict>();
  private readonly all: AdoptionGateVerdict[] = [];

  async store(programId: string, verdict: AdoptionGateVerdict): Promise<void> {
    this.byProgramId.set(programId, verdict);
    this.all.push(verdict);
  }

  async get(programId: string): Promise<AdoptionGateVerdict | undefined> {
    return this.byProgramId.get(programId);
  }

  async list(): Promise<readonly AdoptionGateVerdict[]> {
    return [...this.all];
  }
}

export class InMemoryFeedbackLedger implements FeedbackLedger {
  private readonly byDigest = new Map<string, FeedbackRecord>();

  async insert(record: FeedbackRecord): Promise<LedgerInsertOutcome> {
    const key = record.digest as string;
    if (this.byDigest.has(key)) return 'duplicate';
    this.byDigest.set(key, record);
    return 'inserted';
  }

  async listByTenant(tenantId: string): Promise<readonly FeedbackRecord[]> {
    return [...this.byDigest.values()].filter(
      (entry) => (entry.tenantId as string) === tenantId,
    );
  }
}

// ---------------------------------------------------------------------------
// THE A020 SEAM — the reference experiment engine
// ---------------------------------------------------------------------------

function enforceArmContract(
  armName: 'baseline' | 'intervention',
  arm: ExperimentArmInput,
): void {
  if (arm.trajectories.length === 0) {
    throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.EXPERIMENT_FAILED, {
      message: `${armName} arm: at least one trajectory record is required`,
    });
  }
  for (const trajectory of arm.trajectories) {
    if (!isTrajectoryRecord(trajectory)) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.EXPERIMENT_FAILED, {
        message: `${armName} arm: every trajectory must be a structurally valid A011 TrajectoryRecord (REAL @arena/trajectory guard)`,
      });
    }
  }
  for (const evaluation of arm.evaluations) {
    if (!isEvaluationRecord(evaluation)) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.EXPERIMENT_FAILED, {
        message: `${armName} arm: every evaluation must be a structurally valid A012 EvaluationRecord (REAL @arena/evaluation guard)`,
      });
    }
  }
  for (const verification of arm.verifications) {
    if (!isVerificationRecord(verification)) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.EXPERIMENT_FAILED, {
        message: `${armName} arm: every verification must be a structurally valid A013 VerificationRecord (REAL @arena/verification guard)`,
      });
    }
  }
  if (arm.metrics.length === 0) {
    throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.EXPERIMENT_FAILED, {
      message: `${armName} arm: at least one metric measurement is required`,
    });
  }
}

async function armInputDigest(arm: ExperimentArmInput): Promise<string> {
  return digestCanonical({
    trajectories: arm.trajectories.map((entry) => entry.chainHead as string),
    evaluations: arm.evaluations.map((entry) => entry.digest as string),
    verifications: arm.verifications.map((entry) => entry.digest as string),
    metrics: arm.metrics,
    protectedMetrics: arm.protectedMetrics,
  });
}

interface EngineBinding {
  readonly commandCanonical: string;
  readonly recordDigest: string;
}

/**
 * The reference A020 engine seam: executes the A020 experiment descriptor
 * over both arms through @arena/learning's OWN pure computations, with
 * REAL record guards and the LE1.0 read-only evidence tier
 * (freezeHistoricalInputs). Idempotent by experimentKey.
 */
export class ReferenceExperimentEngine implements ExperimentEnginePort {
  private readonly recordsByDigest = new Map<string, ExperimentRunRecord>();
  private readonly experimentKeys = new Map<string, EngineBinding>();

  async run(
    request: {
      readonly descriptor: ExperimentDescriptor;
      readonly arms: { readonly baseline: ExperimentArmInput; readonly intervention: ExperimentArmInput };
      readonly experimentKey: string;
      readonly correlationId: string;
    },
  ): Promise<ExperimentRunRecord> {
    enforceArmContract('baseline', request.arms.baseline);
    enforceArmContract('intervention', request.arms.intervention);

    // LE1.0 layer 1: read-only historical inputs (never rewritten).
    const baselineFrozen = freezeHistoricalInputs({
      trajectories: request.arms.baseline.trajectories,
      evaluations: request.arms.baseline.evaluations,
      verifications: request.arms.baseline.verifications,
    });
    const interventionFrozen = freezeHistoricalInputs({
      trajectories: request.arms.intervention.trajectories,
      evaluations: request.arms.intervention.evaluations,
      verifications: request.arms.intervention.verifications,
    });

    const baselineDigest = await armInputDigest(request.arms.baseline);
    const interventionDigest = await armInputDigest(request.arms.intervention);
    const command = JSON.stringify([
      request.descriptor.digest as string,
      baselineDigest,
      interventionDigest,
    ]);
    const binding = this.experimentKeys.get(request.experimentKey);
    if (binding !== undefined) {
      if (binding.commandCanonical !== command) {
        throw new CapabilityLearningServiceError(
          CAPABILITY_LEARNING_SERVICE_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          {
            message: `experiment key ${JSON.stringify(request.experimentKey)} is already bound to a different run command (same key + different descriptor/arms is a conflict, not a rerun)`,
            details: { experimentKey: request.experimentKey },
          },
        );
      }
      const stored = this.recordsByDigest.get(binding.recordDigest);
      if (stored !== undefined) return stored;
    }

    const comparison = compareOutcomeMetrics(
      request.descriptor.outcomeMetrics,
      request.arms.baseline.metrics,
      request.arms.intervention.metrics,
    );
    const protectedChecks = checkProtectedCapabilities(
      request.descriptor.protectedCapabilities,
      request.arms.baseline.protectedMetrics,
      request.arms.intervention.protectedMetrics,
    );
    const uncertainty = computeUncertaintyReport(
      request.descriptor.uncertainty,
      request.arms.baseline.metrics,
      request.arms.intervention.metrics,
    );
    const attribution = attributeExperiment(
      request.descriptor,
      baselineFrozen,
      interventionFrozen,
      uncertainty,
    );
    const verdict = decideCapabilityLift(
      request.descriptor,
      comparison,
      uncertainty,
      attribution,
      protectedChecks,
      request.arms.intervention.verifications,
    );

    const record = await createExperimentRunRecord({
      experimentKey: request.experimentKey,
      correlationId: request.correlationId,
      descriptorRef: request.descriptor.digest as string,
      baseline: {
        trajectories: request.arms.baseline.trajectories.map((entry) => entry.chainHead as string),
        evaluations: request.arms.baseline.evaluations.map((entry) => entry.digest as string),
        verifications: request.arms.baseline.verifications.map((entry) => entry.digest as string),
      },
      intervention: {
        trajectories: request.arms.intervention.trajectories.map((entry) => entry.chainHead as string),
        evaluations: request.arms.intervention.evaluations.map((entry) => entry.digest as string),
        verifications: request.arms.intervention.verifications.map((entry) => entry.digest as string),
      },
      baselineMetrics: [...request.arms.baseline.metrics] as unknown as ExperimentRunRecord['baselineMetrics'],
      interventionMetrics: [...request.arms.intervention.metrics] as unknown as ExperimentRunRecord['interventionMetrics'],
      comparison,
      uncertainty,
      protectedCapabilityChecks: protectedChecks,
      attribution,
      verdict,
      provenance: {
        executedBy: 'arena-capability-learning-fabric',
        recordedAt: new Date(0).toISOString(),
        notes: 'reference A020 engine seam (in-process)',
      },
    });
    this.recordsByDigest.set(record.digest as string, record);
    this.experimentKeys.set(request.experimentKey, {
      commandCanonical: command,
      recordDigest: record.digest as string,
    });
    return record;
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
        throw new CapabilityLearningServiceError(
          CAPABILITY_LEARNING_SERVICE_ERROR_CODES.PROPOSAL_CONFLICT,
          {
            message: `proposal idempotency conflict on key ${submission.idempotencyKey}`,
          },
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

export type GatedProposalPayloadShape = {
  payloadVersion: 1;
  gated: GatedImprovementProposal;
  submittedAt: string;
};

export class InMemoryForgeBodyVersionProposalPort extends CollectingProposalPort<GatedProposalPayloadShape> {
  constructor() {
    super(
      'arena:schema/capability-learning/forge-body-version-proposal@1.0.0',
      (p) => p.gated.proposalId as string,
    );
  }
}

export class InMemoryCompatibilityRetestProposalPort extends CollectingProposalPort<GatedProposalPayloadShape> {
  constructor() {
    super(
      'arena:schema/capability-learning/compatibility-retest-obligation@1.0.0',
      (p) => p.gated.proposalId as string,
    );
  }
}

export class InMemoryRecertificationTriggerProposalPort extends CollectingProposalPort<GatedProposalPayloadShape> {
  constructor() {
    super(
      'arena:schema/capability-learning/recertification-trigger@1.0.0',
      (p) => p.gated.proposalId as string,
    );
  }
}

// ---------------------------------------------------------------------------
// The append-only compiler audit stream (tamper-evident)
// ---------------------------------------------------------------------------

type AuditEntryInput = Omit<CompilerAuditEntry, 'sequence' | 'digest' | 'entryId'>;

export class InMemoryCompilerAuditSink implements CompilerAuditSink {
  private readonly entries: CompilerAuditEntry[] = [];
  private sequence = 0;
  private previousDigest: string | null = null;

  async append(entry: AuditEntryInput): Promise<CompilerAuditEntry> {
    if (!isCompilerDecisionCode(entry.decision)) {
      throw new Error(`unknown compiler decision code: ${JSON.stringify(entry.decision)}`);
    }
    this.sequence += 1;
    const chainInput = {
      sequence: this.sequence,
      previousDigest: this.previousDigest,
      decision: entry.decision,
      subject: entry.subject,
      occurredAt: entry.occurredAt,
      correlationId: entry.correlationId,
      tenantId: entry.tenantId,
    };
    const digest = await digestCanonical(chainInput);
    const stamped: CompilerAuditEntry = Object.freeze({
      ...entry,
      sequence: this.sequence,
      digest,
      entryId: `cl-audit-${String(this.sequence).padStart(8, '0')}`,
    });
    this.entries.push(stamped);
    this.previousDigest = digest;
    return stamped;
  }

  async list(): Promise<readonly CompilerAuditEntry[]> {
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
        tenantId: entry.tenantId,
      });
      if (recomputed !== entry.digest) return false;
      previous = entry.digest;
    }
    return true;
  }
}

/** Unused-type re-exports kept for the test surface (fixture typing). */
export type { TrajectoryRecord, EvaluationRecord, VerificationRecord };
