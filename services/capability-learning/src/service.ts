/**
 * CapabilityLearningService — the reference compiler service (Work Order
 * C022; issue #128).
 *
 * Candidate ingestion → program compilation → experiment orchestration →
 * gated proposal dispatch, all as durable idempotent jobs over injected
 * ports (lock rule 17):
 *
 *   - ingestCandidate: projects an intervention-derived candidate view
 *     (C008/C009/C013/C014 surfaces, projected by the host) through
 *     @arena/capability-learning's REAL constructor; digest dedup means
 *     duplicate ingestions DEDUPLICATE — they never inflate counts;
 *   - compileTenantPrograms: the deterministic compiler — one program
 *     per LE1.0 intervention class; blocked outcomes are AUDITED, never
 *     silently dropped;
 *   - runProgramExperiment: assembles the program's A020 experiment,
 *     executes it through THE INJECTED A020 ENGINE PORT, evaluates the
 *     Q1.0 five-condition capability-lift gate, stores the typed
 *     verdict and records the append-only feedback entry;
 *   - dispatchGatedProposals: routes the ADOPTED program's proposals to
 *     the A021/A022/A023 destination ports — an ungated program fails
 *     closed with CAPABILITY_LEARNING_SVC_NOT_ADOPTED (adoption of an
 *     ungated improvement is structurally impossible).
 *
 * Every decision lands in the append-only audit stream with a
 * machine-readable decision code. All failures are typed and
 * fail-closed; time is injected (never a wall-clock read); unknown and
 * cross-tenant ids are indistinguishable (tenant isolation).
 */

import {
  createImprovementCandidate,
  rankByExpectedInformationValue,
} from '@arena/capability-learning';
import type {
  CreateImprovementCandidateInput,
  FeedbackRecord,
  GatedImprovementProposal,
  ImprovementCandidate,
  ImprovementProgram,
} from '@arena/capability-learning';
import {
  assembleProgramExperiment,
  compilePrograms,
  createFeedbackRecord,
  evaluateAdoptionGate,
  routeGatedProposals,
} from '@arena/capability-learning';
import type { ExperimentRunRecord } from '@arena/learning';
import type {
  CandidateLedger,
  Clock,
  CompilerAuditSink,
  CompilerDecisionCode,
  CompatibilityRetestProposalPort,
  ExperimentArmInput,
  ExperimentEnginePort,
  FeedbackLedger,
  ForgeBodyVersionProposalPort,
  GateVerdictLedger,
  ProposalReceipt,
  ProposalSubmission,
  ProgramLedger,
  RecertificationTriggerProposalPort,
} from './ports.js';
import { CAPABILITY_LEARNING_SERVICE_ERROR_CODES, CapabilityLearningServiceError } from './errors.js';

/** Implementation version of the reference service. */
export const CAPABILITY_LEARNING_IMPLEMENTATION_VERSION = '0.1.0';

export interface CapabilityLearningServiceConfig {
  readonly clock: Clock;
  readonly candidateLedger: CandidateLedger;
  readonly programLedger: ProgramLedger;
  readonly gateVerdictLedger: GateVerdictLedger;
  readonly feedbackLedger: FeedbackLedger;
  /** THE A020 SEAM. */
  readonly experimentEngine: ExperimentEnginePort;
  /** THE A021/A022/A023 DESTINATION SEAMS. */
  readonly forgeProposalPort: ForgeBodyVersionProposalPort;
  readonly compatibilityRetestPort: CompatibilityRetestProposalPort;
  readonly recertificationTriggerPort: RecertificationTriggerProposalPort;
  readonly auditSink: CompilerAuditSink;
}

// ---------------------------------------------------------------------------
// Commands and views
// ---------------------------------------------------------------------------

export interface IngestCandidateInput {
  readonly candidate: CreateImprovementCandidateInput;
  readonly correlationId: string;
  readonly now?: number;
}

export interface IngestCandidateView {
  readonly candidateId: string;
  readonly digest: string;
  readonly status: 'ingested' | 'duplicate';
  readonly auditSequence: number;
}

export interface CompileTenantProgramsInput {
  readonly tenantId: string;
  readonly compiledBy: string;
  readonly correlationId: string;
  readonly now?: number;
}

export interface CompileTenantProgramsView {
  readonly tenantId: string;
  readonly compiled: readonly {
    readonly programId: string;
    readonly digest: string;
    readonly interventionClass: string;
    readonly auditSequence: number;
  }[];
  readonly blocked: readonly {
    readonly interventionClass: string;
    readonly reasons: readonly { readonly reason: string; readonly basis: string }[];
    readonly auditSequence: number;
  }[];
}

export interface RunProgramExperimentInput {
  readonly programId: string;
  readonly tenantId: string;
  readonly arms: {
    readonly baseline: ExperimentArmInput;
    readonly intervention: ExperimentArmInput;
  };
  /** REQUIRED idempotency key of the experiment run (lock rule 17). */
  readonly experimentKey: string;
  readonly correlationId: string;
  readonly now?: number;
}

export interface RunProgramExperimentView {
  readonly programId: string;
  readonly experimentDigest: string;
  readonly runRecordDigest: string;
  readonly gateVerdictKind: string;
  readonly gateReasons: readonly string[];
  readonly measuredLift: readonly {
    readonly metricId: string;
    readonly baselineValue: number;
    readonly interventionValue: number;
    readonly delta: number;
    readonly improved: boolean;
  }[];
  readonly feedbackRecorded: boolean;
  readonly auditSequence: number;
}

export interface DispatchGatedProposalsInput {
  readonly programId: string;
  readonly tenantId: string;
  readonly proposedBy: string;
  readonly correlationId: string;
  readonly now?: number;
}

export interface DispatchGatedProposalsView {
  readonly programId: string;
  readonly gateVerdictKind: string;
  readonly receipts: readonly {
    readonly destination: string;
    readonly proposalId: string;
    readonly receipt: ProposalReceipt;
    readonly auditSequence: number;
  }[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type AuditSubjectKind = 'candidate' | 'program' | 'gate-verdict' | 'feedback-record' | 'proposal';

export class CapabilityLearningService {
  private readonly clock: Clock;
  private readonly candidateLedger: CandidateLedger;
  private readonly programLedger: ProgramLedger;
  private readonly gateVerdictLedger: GateVerdictLedger;
  private readonly feedbackLedger: FeedbackLedger;
  private readonly experimentEngine: ExperimentEnginePort;
  private readonly forgeProposalPort: ForgeBodyVersionProposalPort;
  private readonly compatibilityRetestPort: CompatibilityRetestProposalPort;
  private readonly recertificationTriggerPort: RecertificationTriggerProposalPort;
  private readonly auditSink: CompilerAuditSink;

  constructor(config: CapabilityLearningServiceConfig) {
    this.clock = config.clock;
    this.candidateLedger = config.candidateLedger;
    this.programLedger = config.programLedger;
    this.gateVerdictLedger = config.gateVerdictLedger;
    this.feedbackLedger = config.feedbackLedger;
    this.experimentEngine = config.experimentEngine;
    this.forgeProposalPort = config.forgeProposalPort;
    this.compatibilityRetestPort = config.compatibilityRetestPort;
    this.recertificationTriggerPort = config.recertificationTriggerPort;
    this.auditSink = config.auditSink;
  }

  private now(input: { readonly now?: number }): number {
    return input.now === undefined ? this.clock.now() : input.now;
  }

  private async audit(
    tenantId: string,
    subject: { readonly kind: AuditSubjectKind; readonly id: string },
    decision: CompilerDecisionCode,
    correlationId: string,
    details: Readonly<Record<string, unknown>>,
    occurredAt: number,
  ): Promise<number> {
    const entry = await this.auditSink.append({
      auditVersion: 1,
      occurredAt: new Date(occurredAt).toISOString(),
      correlationId,
      tenantId,
      subject,
      decision,
      details,
    });
    return entry.sequence;
  }

  // -------------------------------------------------------------------------
  // Ingestion (the C008/C009/C013/C014 seam → the candidate ledger)
  // -------------------------------------------------------------------------

  /** Ingest one intervention-derived improvement candidate (idempotent by digest). */
  async ingestCandidate(input: IngestCandidateInput): Promise<IngestCandidateView> {
    if (typeof input !== 'object' || input === null || typeof input.correlationId !== 'string' || input.correlationId.length === 0) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT, {
        message: 'ingestCandidate requires a candidate input and a non-empty correlationId',
      });
    }
    const candidate = await createImprovementCandidate(input.candidate);
    const insertOutcome = await this.candidateLedger.insert(candidate);
    const occurredAt = this.now(input);
    const decision: CompilerDecisionCode =
      insertOutcome === 'duplicate' ? 'candidate_deduplicated' : 'candidate_ingested';
    const sequence = await this.audit(
      candidate.tenantId as string,
      { kind: 'candidate', id: candidate.candidateId as string },
      decision,
      input.correlationId,
      {
        digest: candidate.digest as string,
        sourceKind: candidate.sourceKind,
        changedSurface: candidate.changedSurface,
        rightsStatus: candidate.rights.status,
      },
      occurredAt,
    );
    return {
      candidateId: candidate.candidateId as string,
      digest: candidate.digest as string,
      status: insertOutcome === 'duplicate' ? 'duplicate' : 'ingested',
      auditSequence: sequence,
    };
  }

  // -------------------------------------------------------------------------
  // Compilation (the deterministic compiler)
  // -------------------------------------------------------------------------

  /** Compile all ingested candidates of one tenant into typed programs (deterministic). */
  async compileTenantPrograms(input: CompileTenantProgramsInput): Promise<CompileTenantProgramsView> {
    if (typeof input !== 'object' || input === null) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT, {
        message: 'compileTenantPrograms requires {tenantId, compiledBy, correlationId}',
      });
    }
    for (const field of ['tenantId', 'compiledBy', 'correlationId'] as const) {
      if (typeof input[field] !== 'string' || (input[field] as string).length === 0) {
        throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT, {
          message: `compileTenantPrograms: ${field} must be a non-empty string`,
        });
      }
    }
    const candidates = await this.candidateLedger.listByTenant(input.tenantId);
    const outcomes = await compilePrograms(candidates, { compiledBy: input.compiledBy });
    const occurredAt = this.now(input);
    const compiled: CompileTenantProgramsView['compiled'][number][] = [];
    const blocked: CompileTenantProgramsView['blocked'][number][] = [];
    for (const outcome of outcomes) {
      if (outcome.kind === 'compilable') {
        const program = outcome.program;
        await this.programLedger.insert(program);
        const sequence = await this.audit(
          input.tenantId,
          { kind: 'program', id: program.programId as string },
          'program_compiled',
          input.correlationId,
          {
            digest: program.digest as string,
            interventionClass: program.interventionClass,
            candidateRefs: program.candidateRefs.length,
            globalReuse: program.globalReuse,
          },
          occurredAt,
        );
        compiled.push({
          programId: program.programId as string,
          digest: program.digest as string,
          interventionClass: program.interventionClass,
          auditSequence: sequence,
        });
      } else {
        // A blocked outcome is for the tenant's NEXT class in canonical
        // order — the class is recoverable from the reasons' candidates.
        const interventionClass = blockedClassOf(outcome.reasons, candidates);
        const sequence = await this.audit(
          input.tenantId,
          { kind: 'program', id: `blocked-${interventionClass}` },
          'program_blocked',
          input.correlationId,
          {
            interventionClass,
            reasons: outcome.reasons.map((reason) => reason.reason),
          },
          occurredAt,
        );
        blocked.push({
          interventionClass,
          reasons: outcome.reasons.map((reason) => ({
            reason: reason.reason,
            basis: reason.basis,
          })),
          auditSequence: sequence,
        });
      }
    }
    return { tenantId: input.tenantId, compiled, blocked };
  }

  // -------------------------------------------------------------------------
  // Experiment orchestration (the A020 seam) + the Q1.0 gate
  // -------------------------------------------------------------------------

  /** Run one program's assembled experiment and evaluate the Q1.0 adoption gate. */
  async runProgramExperiment(input: RunProgramExperimentInput): Promise<RunProgramExperimentView> {
    if (typeof input !== 'object' || input === null) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT, {
        message: 'runProgramExperiment requires {programId, tenantId, arms, experimentKey, correlationId}',
      });
    }
    for (const field of ['programId', 'tenantId', 'experimentKey', 'correlationId'] as const) {
      if (typeof input[field] !== 'string' || (input[field] as string).length === 0) {
        throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT, {
          message: `runProgramExperiment: ${field} must be a non-empty string`,
        });
      }
    }
    const program = await this.programLedger.get(input.programId, input.tenantId);
    if (program === undefined) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.NOT_FOUND, {
        message: `no compiled program for id ${input.programId} in tenant ${input.tenantId} (fail-closed: cross-tenant and unknown ids are indistinguishable)`,
        details: { programId: input.programId },
        correlationId: input.correlationId,
      });
    }
    const candidates = (await this.candidateLedger.listByTenant(input.tenantId)).filter(
      (candidate) => (program.candidateRefs as readonly string[]).includes(candidate.digest as string),
    );
    if (candidates.length === 0) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.NOT_FOUND, {
        message: `the candidates compiled into program ${input.programId} are no longer addressable (fail-closed)`,
        details: { programId: input.programId },
        correlationId: input.correlationId,
      });
    }

    // 1. Assemble the program's A020 experiment (deterministic).
    const experimentId = `exp-${program.programId as string}`.slice(0, 64);
    const experiment = await assembleProgramExperiment(program, { experimentId });

    // 2. Execute through THE INJECTED A020 ENGINE PORT.
    const runRecord: ExperimentRunRecord = await this.experimentEngine.run({
      descriptor: experiment,
      arms: input.arms,
      experimentKey: input.experimentKey,
      correlationId: input.correlationId,
    });
    const occurredAt = this.now(input);
    await this.audit(
      input.tenantId,
      { kind: 'program', id: program.programId as string },
      'experiment_run',
      input.correlationId,
      {
        experimentDigest: experiment.digest as string,
        runRecordDigest: runRecord.digest as string,
        experimentVerdict: runRecord.verdict.verdict,
      },
      occurredAt,
    );

    // 3. The Q1.0 five-condition capability-lift gate (typed verdict).
    const gateVerdict = await evaluateAdoptionGate({
      program,
      experiment,
      runRecord,
      candidates,
    });
    await this.gateVerdictLedger.store(program.programId as string, gateVerdict);
    const gateSequence = await this.audit(
      input.tenantId,
      { kind: 'gate-verdict', id: program.programId as string },
      gateVerdict.kind === 'adopted-with-evidence' ? 'gate_adopted' : 'gate_refused',
      input.correlationId,
      {
        verdictKind: gateVerdict.kind,
        reasons: gateVerdict.reasons,
        attributionConfounds: gateVerdict.attributionConfounds,
      },
      occurredAt,
    );

    // 4. The append-only feedback record (interventions → improvement → measured lift).
    const feedback = await createFeedbackRecord({
      feedbackId: `fb-${program.programId as string}-${(runRecord.digest as string).slice(0, 16)}`.slice(0, 64),
      tenantId: input.tenantId,
      interventionClass: program.interventionClass,
      programRef: program.digest as string,
      candidateRefs: candidates.map((entry) => entry.digest as string),
      gateVerdict: gateVerdict.kind,
      measuredLift: [...(gateVerdict.measuredLift as { metricId: string; baselineValue: number; interventionValue: number; delta: number; improved: boolean }[])],
      runRecordRef: runRecord.digest as string,
      recordedAt: new Date(occurredAt).toISOString(),
    });
    const feedbackInsert = await this.feedbackLedger.insert(feedback);
    if (feedbackInsert === 'inserted') {
      await this.audit(
        input.tenantId,
        { kind: 'feedback-record', id: feedback.feedbackId as string },
        'feedback_recorded',
        input.correlationId,
        { gateVerdictKind: gateVerdict.kind },
        occurredAt,
      );
    }

    return {
      programId: program.programId as string,
      experimentDigest: experiment.digest as string,
      runRecordDigest: runRecord.digest as string,
      gateVerdictKind: gateVerdict.kind,
      gateReasons: [...(gateVerdict.reasons as readonly string[])],
      measuredLift: [...(gateVerdict.measuredLift as { metricId: string; baselineValue: number; interventionValue: number; delta: number; improved: boolean }[])],
      feedbackRecorded: feedbackInsert === 'inserted',
      auditSequence: gateSequence,
    };
  }

  // -------------------------------------------------------------------------
  // Gated proposal dispatch (the A021/A022/A023 seams)
  // -------------------------------------------------------------------------

  /** Dispatch the ADOPTED program's gated proposals (ungated programs fail closed). */
  async dispatchGatedProposals(input: DispatchGatedProposalsInput): Promise<DispatchGatedProposalsView> {
    if (typeof input !== 'object' || input === null) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT, {
        message: 'dispatchGatedProposals requires {programId, tenantId, proposedBy, correlationId}',
      });
    }
    for (const field of ['programId', 'tenantId', 'proposedBy', 'correlationId'] as const) {
      if (typeof input[field] !== 'string' || (input[field] as string).length === 0) {
        throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT, {
          message: `dispatchGatedProposals: ${field} must be a non-empty string`,
        });
      }
    }
    const program = await this.programLedger.get(input.programId, input.tenantId);
    if (program === undefined) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.NOT_FOUND, {
        message: `no compiled program for id ${input.programId} in tenant ${input.tenantId} (fail-closed: cross-tenant and unknown ids are indistinguishable)`,
        details: { programId: input.programId },
        correlationId: input.correlationId,
      });
    }
    const gateVerdict = await this.gateVerdictLedger.get(program.programId as string);
    if (gateVerdict === undefined) {
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.NOT_ADOPTED, {
        message: `program ${input.programId} has no adoption-gate verdict yet — run its experiment first (dispatch is gated on adoption; fail-closed)`,
        details: { programId: input.programId },
        correlationId: input.correlationId,
      });
    }
    if (gateVerdict.kind !== 'adopted-with-evidence') {
      // Fail closed — adoption of an ungated improvement is structurally impossible.
      await this.audit(
        input.tenantId,
        { kind: 'proposal', id: program.programId as string },
        'dispatch_refused',
        input.correlationId,
        { gateVerdictKind: gateVerdict.kind, reasons: gateVerdict.reasons },
        this.now(input),
      );
      throw new CapabilityLearningServiceError(CAPABILITY_LEARNING_SERVICE_ERROR_CODES.NOT_ADOPTED, {
        message: `dispatch REFUSED: program ${input.programId} was not adopted by the Q1.0 capability-lift gate (verdict ${JSON.stringify(gateVerdict.kind)}${(gateVerdict.reasons as readonly string[]).length > 0 ? `; reasons: ${(gateVerdict.reasons as readonly string[]).join(', ')}` : ''}) — adoption of an ungated improvement is structurally impossible`,
        details: { programId: input.programId, verdictKind: gateVerdict.kind, reasons: [...(gateVerdict.reasons as readonly string[])] },
        correlationId: input.correlationId,
      });
    }

    const proposals = await routeGatedProposals(program, gateVerdict, {
      proposedBy: input.proposedBy,
    });
    const occurredAt = this.now(input);
    const receipts: DispatchGatedProposalsView['receipts'][number][] = [];
    for (const proposal of proposals) {
      const receipt = await this.submitProposal(proposal, input.correlationId, occurredAt);
      const sequence = await this.audit(
        input.tenantId,
        { kind: 'proposal', id: proposal.proposalId as string },
        receipt.status === 'duplicate' ? 'proposal_duplicate' : 'proposal_dispatched',
        input.correlationId,
        { destination: proposal.destination, gateVerdictRef: gateVerdict.digest as string },
        occurredAt,
      );
      receipts.push({
        destination: proposal.destination,
        proposalId: proposal.proposalId as string,
        receipt,
        auditSequence: sequence,
      });
    }
    return { programId: program.programId as string, gateVerdictKind: gateVerdict.kind, receipts };
  }

  private async submitProposal(
    proposal: GatedImprovementProposal,
    correlationId: string,
    occurredAt: number,
  ): Promise<ProposalReceipt> {
    const submittedAt = new Date(occurredAt).toISOString();
    const submission: ProposalSubmission<{ payloadVersion: 1; gated: GatedImprovementProposal; submittedAt: string }> = {
      payload: { payloadVersion: 1, gated: proposal, submittedAt },
      correlationId,
      idempotencyKey: `cl-${proposal.digest as string}`,
      submittedAt,
    };
    if (proposal.destination === 'body-forge') {
      return this.forgeProposalPort.submit(submission);
    }
    if (proposal.destination === 'compatibility-retest') {
      return this.compatibilityRetestPort.submit(submission);
    }
    return this.recertificationTriggerPort.submit(submission);
  }

  // -------------------------------------------------------------------------
  // Read projections
  // -------------------------------------------------------------------------

  /** Rank a tenant's next compilation targets by expected information value (CC1.0). */
  async rankNextSelections(tenantId: string): Promise<readonly { interventionClass: string; expectedInformationValue: number; rationale: string }[]> {
    const programs = await this.programLedger.listByTenant(tenantId);
    const feedback = await this.feedbackLedger.listByTenant(tenantId);
    const classes = [...new Set([
      ...programs.map((program: ImprovementProgram) => program.interventionClass),
      ...feedback.map((record: FeedbackRecord) => record.interventionClass),
    ])];
    const ranking = rankByExpectedInformationValue(feedback, classes.map((interventionClass) => ({ tenantId, interventionClass })));
    return ranking.map((entry) => ({
      interventionClass: entry.interventionClass,
      expectedInformationValue: entry.expectedInformationValue,
      rationale: entry.rationale,
    }));
  }
}

/** Recover the intervention class of a blocked outcome from its offending candidates (canonical order). */
function blockedClassOf(
  reasons: readonly { candidateIds: readonly string[] }[],
  candidates: readonly ImprovementCandidate[],
): string {
  const byId = new Map(candidates.map((entry) => [entry.candidateId as string, entry]));
  for (const reason of reasons) {
    for (const candidateId of reason.candidateIds) {
      const candidate = byId.get(candidateId);
      if (candidate !== undefined) return candidate.changedSurface as string;
    }
  }
  const first = candidates[0];
  return first === undefined ? 'unknown' : (first.changedSurface as string);
}
