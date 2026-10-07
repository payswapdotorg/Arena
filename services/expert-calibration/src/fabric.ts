/**
 * ExpertCalibrationService — the in-process reference ORCHESTRATOR over
 * the @arena/expert-calibration domain (Work Order C004; mirrors the
 * services/expert-intake fabric pattern structurally: in-memory
 * reference store, injected ports, fail-closed errors, envelope
 * conventions, REQUIRED idempotency keys on commands).
 *
 * Operations:
 *   - registerProgram (COMMAND, idempotency key REQUIRED — lock rule 17):
 *     content-addresses + stores a CalibrationProgram;
 *   - recordCalibrationOutcome (COMMAND): APPENDS one CalibrationRecord
 *     under a registered program (append-only history, lock rule 6);
 *   - runProgram (COMMAND): derives the typed drift verdict over the
 *     expert's records under the program's pinned drift policy and
 *     content-addresses the verdict record;
 *   - derivePreTrainingTrack (COMMAND): pulls the typed gap-list from the
 *     C003 intake port and dispatches the gap-filling assignments to the
 *     A017 workbench port (fail-closed PORT_FAILURE);
 *   - completePreTrainingAssignment (COMMAND): records the workbench
 *     completion; when the track becomes pre-trained it PROPOSES the
 *     qualification update to the A007 port (never a direct write);
 *   - scheduleRequalificationCheck / runRequalificationCheck (COMMANDS):
 *     durable idempotent requalification checks as A015 JobRecords —
 *     claim → derive typed transition proposals (time-window-elapsed /
 *     drift-verdict) → submit to the A007 port → complete;
 *   - getDemonstratedPerformance (QUERY — the C002 routing read port):
 *     the frozen demonstrated-performance/freshness view routing consumes
 *     as an input; inForce false after the qualification window elapses
 *     (the requalification bypass defense).
 *
 * Integrity: every store fetch re-verifies the content digest — a
 * tampered store entry fails closed with EXPERT_CALIBRATION_TAMPERED.
 * Tenant isolation: cross-tenant access fails closed with
 * EXPERT_CALIBRATION_TENANT_MISMATCH (lock rule 11).
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import {
  claimJob,
  completeJob,
  createJobRecord,
} from '@arena/job-protocol';
import type { JobRecord } from '@arena/job-protocol';
import {
  buildDemonstratedPerformance,
  buildQualificationUpdateProposal,
  completePreTrainingAssignment,
  consumeCalibrationAsAuthorization,
  createCalibrationProgram,
  createCalibrationRecord,
  createDriftVerdictRecord,
  createRequalificationProposal,
  deriveDriftVerdict,
  derivePreTrainingTrack,
  deriveRequalificationProposal,
  makeCompletePreTrainingAssignmentCommand,
  makeDerivePreTrainingTrackCommand,
  makeOutcomeRecordedEvent,
  makePreTrainingCompletedEvent,
  makeProgramRegisteredEvent,
  makeQualificationUpdateProposedEvent,
  makeRecordOutcomeCommand,
  makeRegisterProgramCommand,
  makeRequalificationProposedEvent,
  makeRequalificationCheckScheduledEvent,
  makeRunProgramCommand,
  makeRunRequalificationCheckCommand,
  makeScheduleRequalificationCheckCommand,
  makeVerdictDerivedEvent,
  makeGetDemonstratedPerformanceQuery,
  makeGetDemonstratedPerformanceResponse,
  recomputeCalibrationRecordDigest,
  recomputeCalibrationProgramDigest,
  summarizeCalibrationRecords,
  EXPERT_CALIBRATION_ERROR_CODES,
  ExpertCalibrationError,
  isValidityInForce,
} from '@arena/expert-calibration';
import type {
  CalibrationProgram,
  CalibrationRecord,
  CreateCalibrationProgramInput,
  CreateCalibrationRecordInput,
  DriftVerdictRecord,
  DemonstratedPerformance,
  PreTrainingTrack,
  QualificationUpdateProposal,
  RequalificationProposal,
} from '@arena/expert-calibration';
import type {
  ExpertQualificationPort,
  IntakeGapSourcePort,
  WorkbenchAssignmentPort,
  WorkbenchAssignmentReceipt,
  QualificationProposalReceipt,
} from './ports.js';

export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** Caller-injected operation time (ms-precision UTC — no hidden clock). */
  readonly at: string;
}

export interface QueryOptions {
  readonly correlationId: string;
}

/** The record-outcome command input: the domain record input + the program it pins. */
export type RecordCalibrationOutcomeInput = CreateCalibrationRecordInput & {
  readonly programId: string;
};

interface IdempotencyBinding {
  readonly commandCanonical: string;
}

interface ServiceEvent {
  readonly kind: string;
  readonly envelope: Envelope<Record<string, unknown>>;
}

function canonicalOf(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

/**
 * The in-process reference service. Construct with the injected ports
 * (C003 intake gap source, A007 qualification proposal port, A017
 * workbench assignment port); the store is fresh per instance (the
 * reference-fabric pattern).
 */
export class ExpertCalibrationService {
  private readonly intake: IntakeGapSourcePort;
  private readonly qualification: ExpertQualificationPort;
  private readonly workbench: WorkbenchAssignmentPort;
  private readonly programs = new Map<string, CalibrationProgram>();
  private readonly records = new Map<string, CalibrationRecord>();
  private readonly verdicts = new Map<string, DriftVerdictRecord>();
  private readonly tracks = new Map<string, PreTrainingTrack>();
  private readonly jobs = new Map<string, JobRecord>();
  private readonly runKeys = new Map<string, IdempotencyBinding>();
  private readonly events: ServiceEvent[] = [];

  constructor(options: {
    readonly intake: IntakeGapSourcePort;
    readonly qualification: ExpertQualificationPort;
    readonly workbench: WorkbenchAssignmentPort;
  }) {
    this.intake = options.intake;
    this.qualification = options.qualification;
    this.workbench = options.workbench;
  }

  // -------------------------------------------------------------------------
  // Store access (fail closed: NOT_FOUND / TENANT_MISMATCH / TAMPERED)
  // -------------------------------------------------------------------------

  private getProgram(programId: string, tenant: string): CalibrationProgram {
    const stored = this.programs.get(programId);
    if (stored === undefined) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
        message: `no calibration program ${JSON.stringify(programId)}`,
        details: { programId },
      });
    }
    if (stored.tenant !== tenant) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.TENANT_MISMATCH, {
        message: `calibration program ${programId} belongs to tenant ${stored.tenant}, not ${tenant} (cross-tenant access fails closed — lock rule 11)`,
        details: { programId, ownerTenant: stored.tenant, readerTenant: tenant },
      });
    }
    return stored;
  }

  private async getProgramVerified(programId: string, tenant: string): Promise<CalibrationProgram> {
    const program = this.getProgram(programId, tenant);
    await recomputeCalibrationProgramDigest(program); // throws TAMPERED on mismatch
    return program;
  }

  private getTrack(trackId: string, tenant: string): PreTrainingTrack {
    const stored = this.tracks.get(trackId);
    if (stored === undefined) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
        message: `no pre-training track ${JSON.stringify(trackId)}`,
        details: { trackId },
      });
    }
    if (stored.tenant !== tenant) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.TENANT_MISMATCH, {
        message: `pre-training track ${trackId} belongs to tenant ${stored.tenant}, not ${tenant} (cross-tenant access fails closed — lock rule 11)`,
        details: { trackId, ownerTenant: stored.tenant, readerTenant: tenant },
      });
    }
    return stored;
  }

  // -------------------------------------------------------------------------
  // Idempotency gate (lock rule 17)
  // -------------------------------------------------------------------------

  private bindKey(key: IdempotencyKey, canonical: string): void {
    const existing = this.runKeys.get(key);
    if (existing !== undefined && existing.commandCanonical !== canonical) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(key)} is already bound to a different command tuple`,
        details: { idempotencyKey: key, bound: existing.commandCanonical, attempted: canonical },
      });
    }
    if (existing !== undefined) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
        message: `idempotency key ${JSON.stringify(key)} already ran — replay returns the stored state instead of re-executing`,
        details: { idempotencyKey: key, commandCanonical: canonical },
      });
    }
    this.runKeys.set(key, { commandCanonical: canonical });
  }

  private recordEvent(kind: string, envelope: Envelope<Record<string, unknown>>): void {
    this.events.push({ kind, envelope });
  }

  // -------------------------------------------------------------------------
  // registerProgram (command — idempotency key REQUIRED)
  // -------------------------------------------------------------------------

  async registerProgram(
    input: CreateCalibrationProgramInput,
    options: CommandOptions,
  ): Promise<{ program: CalibrationProgram; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const command = makeRegisterProgramCommand(
      { programId: input.programId, tenant: input.tenant, seed: input.seed, at: options.at },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf(['register-program', input.programId, input.tenant, input.seed, options.at]);
    this.bindKey(idempotencyKey, canonical);
    if (this.programs.has(input.programId)) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
        message: `calibration program ${JSON.stringify(input.programId)} is already registered (programs are immutable once registered — version a NEW program instead)`,
        details: { programId: input.programId },
      });
    }
    const program = await createCalibrationProgram({ ...input, createdAt: options.at });
    this.programs.set(program.programId, program);
    const event = makeProgramRegisteredEvent(
      { programId: program.programId, programDigest: program.digest, probeCount: program.probes.length, at: options.at },
      { correlationId, idempotencyKey },
    );
    this.recordEvent('program-registered', event as unknown as Envelope<Record<string, unknown>>);
    return {
      program,
      envelopes: [command as unknown as Envelope<Record<string, unknown>>, event as unknown as Envelope<Record<string, unknown>>],
    };
  }

  // -------------------------------------------------------------------------
  // recordCalibrationOutcome (command — appends, never rewrites)
  // -------------------------------------------------------------------------

  async recordCalibrationOutcome(
    input: RecordCalibrationOutcomeInput,
    options: CommandOptions,
  ): Promise<{ record: CalibrationRecord; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const program = await this.getProgramVerified(input.programId, input.tenant);
    const command = makeRecordOutcomeCommand(
      { programId: program.programId, tenant: input.tenant, expertId: input.expertId, at: options.at },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf(['record-outcome', input.calibrationId, input.programId, input.expertId, options.at]);
    this.bindKey(idempotencyKey, canonical);
    if (input.programDigest !== program.digest) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_REF, {
        message: `calibration record ${JSON.stringify(input.calibrationId)} pins program digest ${JSON.stringify(input.programDigest)} but program ${program.programId} is ${program.digest} (the program pin is part of the record's integrity)`,
        details: { programId: program.programId, expected: program.digest, actual: input.programDigest },
      });
    }
    if (this.records.has(input.calibrationId)) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
        message: `calibration record ${JSON.stringify(input.calibrationId)} already exists (the history is APPEND-ONLY — corrections supersede, they never overwrite)`,
        details: { calibrationId: input.calibrationId },
      });
    }
    const { programId: _programId, ...recordInput } = input;
    const record = await createCalibrationRecord(recordInput);
    await recomputeCalibrationRecordDigest(record);
    this.records.set(record.calibrationId, record);
    const event = makeOutcomeRecordedEvent(
      { calibrationId: record.calibrationId, programDigest: program.digest, expertId: record.expertId, outcome: record.observed.outcome, at: options.at },
      { correlationId, idempotencyKey },
    );
    this.recordEvent('outcome-recorded', event as unknown as Envelope<Record<string, unknown>>);
    return {
      record,
      envelopes: [command as unknown as Envelope<Record<string, unknown>>, event as unknown as Envelope<Record<string, unknown>>],
    };
  }

  // -------------------------------------------------------------------------
  // runProgram (command — derives the typed drift verdict)
  // -------------------------------------------------------------------------

  async runProgram(
    programId: string,
    tenant: string,
    expertId: string,
    options: CommandOptions & { readonly verdictId: string },
  ): Promise<{ verdict: DriftVerdictRecord; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const program = await this.getProgramVerified(programId, tenant);
    const command = makeRunProgramCommand(
      { programId, tenant, expertId, at: options.at },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf(['run-program', programId, expertId, options.verdictId, options.at]);
    this.bindKey(idempotencyKey, canonical);
    const expertRecords = [...this.records.values()]
      .filter((record) => record.tenant === tenant && record.expertId === expertId && record.programDigest === program.digest)
      .sort((a, b) => (a.calibrationId < b.calibrationId ? -1 : 1));
    const derived = deriveDriftVerdict(expertRecords, program.driftPolicy, options.at);
    const verdict = await createDriftVerdictRecord({
      verdictId: options.verdictId,
      tenant,
      expertId,
      programDigest: program.digest,
      verdict: derived.verdict,
      recordCount: derived.recordCount,
      freshDecidedCount: derived.freshDecidedCount,
      staleDecidedCount: derived.staleDecidedCount,
      inconclusiveCount: derived.inconclusiveCount,
      bias: derived.bias,
      tolerance: derived.tolerance,
      foldedRecordDigests: expertRecords.map((record) => record.digest),
      evaluatedAt: options.at,
      rationale: `derived over ${expertRecords.length} record(s) under program ${programId}`,
    });
    this.verdicts.set(verdict.verdictId, verdict);
    const event = makeVerdictDerivedEvent(
      { verdictId: verdict.verdictId, programDigest: program.digest, expertId, verdict: verdict.verdict, freshDecidedCount: verdict.freshDecidedCount, at: options.at },
      { correlationId, idempotencyKey },
    );
    this.recordEvent('verdict-derived', event as unknown as Envelope<Record<string, unknown>>);
    return {
      verdict,
      envelopes: [command as unknown as Envelope<Record<string, unknown>>, event as unknown as Envelope<Record<string, unknown>>],
    };
  }

  // -------------------------------------------------------------------------
  // derivePreTrainingTrack (command — C003 gap-list → A017 workbench)
  // -------------------------------------------------------------------------

  async derivePreTrainingTrack(
    input: {
      readonly trackId: string;
      readonly tenant: string;
      readonly expertId: string;
      readonly intakeSessionId: string;
    },
    options: CommandOptions,
  ): Promise<{ track: PreTrainingTrack; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const command = makeDerivePreTrainingTrackCommand(
      { trackId: input.trackId, tenant: input.tenant, expertId: input.expertId, intakeSessionId: input.intakeSessionId, at: options.at },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf(['derive-pre-training-track', input.trackId, input.intakeSessionId, options.at]);
    this.bindKey(idempotencyKey, canonical);
    if (this.tracks.has(input.trackId)) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.LIFECYCLE_CONFLICT, {
        message: `pre-training track ${JSON.stringify(input.trackId)} already exists`,
        details: { trackId: input.trackId },
      });
    }

    // --- C003 public port: the typed intake gap-list -----------------------
    let gaps;
    try {
      gaps = await this.intake.getIntakeGaps(input.intakeSessionId, input.tenant);
    } catch (error) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
        message: `the C003 intake gap port failed for session ${input.intakeSessionId} (fail closed — no track was derived)`,
        details: { intakeSessionId: input.intakeSessionId, cause: error instanceof Error ? error.message : String(error) },
      });
    }
    if (gaps === null) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
        message: `the C003 intake gap port knows no session ${JSON.stringify(input.intakeSessionId)} for tenant ${input.tenant}`,
        details: { intakeSessionId: input.intakeSessionId },
      });
    }

    const track = await derivePreTrainingTrack(gaps.gaps, {
      trackId: input.trackId,
      tenant: input.tenant,
      expertId: input.expertId,
      intakeSessionId: input.intakeSessionId,
      derivedAt: options.at,
    });

    // --- A017 public port: dispatch each assignment to the workbench -------
    for (const assignment of track.assignments) {
      let receipt: WorkbenchAssignmentReceipt;
      try {
        receipt = await this.workbench.dispatchPreTrainingAssignment({
          trackId: track.trackId,
          assignmentId: assignment.assignmentId,
          focus: assignment.focus,
          workbenchTask: { ...assignment.workbenchTask },
        });
      } catch (error) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
          message: `the A017 workbench assignment port failed for assignment ${assignment.assignmentId} (fail closed — the track was NOT stored)`,
          details: { assignmentId: assignment.assignmentId, cause: error instanceof Error ? error.message : String(error) },
        });
      }
      if (!receipt.accepted) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
          message: `the A017 workbench port rejected assignment ${assignment.assignmentId} (fail closed)`,
          details: { assignmentId: assignment.assignmentId, reasons: [...(receipt.reasons ?? [])] },
        });
      }
    }

    this.tracks.set(track.trackId, track);
    return {
      track,
      envelopes: [command as unknown as Envelope<Record<string, unknown>>],
    };
  }

  // -------------------------------------------------------------------------
  // completePreTrainingAssignment (command — proposal, never a write)
  // -------------------------------------------------------------------------

  async completePreTrainingAssignment(
    trackId: string,
    tenant: string,
    expertId: string,
    assignmentId: string,
    options: CommandOptions & {
      readonly capability: { readonly kind: string; readonly id: string; readonly version: string; readonly digest: string };
      readonly evidence: readonly string[];
    },
  ): Promise<{
    track: PreTrainingTrack;
    proposal: QualificationUpdateProposal | null;
    receipt: QualificationProposalReceipt | null;
    envelopes: readonly Envelope<Record<string, unknown>>[];
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const track = this.getTrack(trackId, tenant);
    const command = makeCompletePreTrainingAssignmentCommand(
      { trackId, tenant, expertId, assignmentId, at: options.at },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf(['complete-pre-training-assignment', trackId, assignmentId, options.at]);
    this.bindKey(idempotencyKey, canonical);

    const completed = completePreTrainingAssignment(track, assignmentId, {
      tenant,
      expertId,
      completedAt: options.at,
    });
    this.tracks.set(trackId, completed);

    const envelopes: Envelope<Record<string, unknown>>[] = [
      command as unknown as Envelope<Record<string, unknown>>,
    ];
    let proposal: QualificationUpdateProposal | null = null;
    let receipt: QualificationProposalReceipt | null = null;

    if (completed.state === 'pre-trained') {
      const completedEvent = makePreTrainingCompletedEvent(
        { trackId, trackDigest: completed.digest, expertId, assignmentCount: completed.assignments.length, at: options.at },
        { correlationId, idempotencyKey },
      );
      this.recordEvent('pre-training-completed', completedEvent as unknown as Envelope<Record<string, unknown>>);
      envelopes.push(completedEvent as unknown as Envelope<Record<string, unknown>>);

      proposal = await buildQualificationUpdateProposal(completed, {
        capability: options.capability,
        evidence: options.evidence,
        proposedAt: options.at,
      });

      // --- A007 public port: the qualification-update PROPOSAL -------------
      try {
        receipt = await this.qualification.submitQualificationUpdateProposal({
          tenant,
          expertId,
          kind: proposal.kind,
          trackDigest: proposal.trackDigest,
          proposalDigest: proposal.digest,
          capability: { ...proposal.capability },
          evidence: [...proposal.evidence],
          proposedAt: proposal.proposedAt,
        });
      } catch (error) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
          message: `the A007 qualification proposal port failed for track ${trackId} (fail closed — the proposal was NOT handed off)`,
          details: { trackId, cause: error instanceof Error ? error.message : String(error) },
        });
      }
      if (!receipt.accepted) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
          message: `the A007 qualification port rejected the proposal for track ${trackId} (fail closed)`,
          details: { trackId, reasons: [...(receipt.reasons ?? [])] },
        });
      }
      const proposedEvent = makeQualificationUpdateProposedEvent(
        { trackDigest: completed.digest, proposalDigest: proposal.digest, expertId, at: options.at },
        { correlationId, idempotencyKey },
      );
      this.recordEvent('qualification-update-proposed', proposedEvent as unknown as Envelope<Record<string, unknown>>);
      envelopes.push(proposedEvent as unknown as Envelope<Record<string, unknown>>);
    }

    return { track: completed, proposal, receipt, envelopes };
  }

  // -------------------------------------------------------------------------
  // Requalification checks (durable idempotent jobs on the A015 fabric)
  // -------------------------------------------------------------------------

  async scheduleRequalificationCheck(
    programId: string,
    tenant: string,
    expertId: string,
    options: CommandOptions,
  ): Promise<{ job: JobRecord; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const program = await this.getProgramVerified(programId, tenant);
    const command = makeScheduleRequalificationCheckCommand(
      { tenant, expertId, programId, at: options.at },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf(['schedule-requalification-check', programId, expertId, options.at]);
    this.bindKey(idempotencyKey, canonical);
    const job = createJobRecord({
      definitionDigest: program.digest,
      kind: { namespace: 'expert-calibration', name: 'requalification-check', version: '1.0.0' },
      correlationId,
      idempotencyKey,
      idempotencyScope: 'expert-calibration-requalification',
      input: { programId, tenant, expertId },
      policy: {
        timeoutMs: 30_000,
        retry: { maxAttempts: 3, backoffScheduleMs: [0, 100], retryableErrorClasses: ['EXPERT_CALIBRATION_PORT_FAILURE'] },
      },
      submittedAt: options.at,
    });
    this.jobs.set(job.jobId, job);
    const event = makeRequalificationCheckScheduledEvent(
      { jobId: job.jobId, expertId, scheduledAt: options.at, at: options.at },
      { correlationId, idempotencyKey },
    );
    this.recordEvent('requalification-check-scheduled', event as unknown as Envelope<Record<string, unknown>>);
    return {
      job,
      envelopes: [command as unknown as Envelope<Record<string, unknown>>, event as unknown as Envelope<Record<string, unknown>>],
    };
  }

  async runRequalificationCheck(
    jobId: string,
    tenant: string,
    options: CommandOptions,
  ): Promise<{
    job: JobRecord;
    proposal: RequalificationProposal | null;
    receipt: QualificationProposalReceipt | null;
    envelopes: readonly Envelope<Record<string, unknown>>[];
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const stored = this.jobs.get(jobId);
    if (stored === undefined) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
        message: `no requalification-check job ${JSON.stringify(jobId)}`,
        details: { jobId },
      });
    }
    const input = stored.input as { programId: string; tenant: string; expertId: string };
    if (input.tenant !== tenant) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.TENANT_MISMATCH, {
        message: `requalification-check job ${jobId} belongs to tenant ${input.tenant}, not ${tenant} (cross-tenant execution fails closed — lock rule 11)`,
        details: { jobId, ownerTenant: input.tenant, readerTenant: tenant },
      });
    }
    const command = makeRunRequalificationCheckCommand(
      { jobId, tenant, at: options.at },
      { correlationId, idempotencyKey },
    );
    const canonical = canonicalOf(['run-requalification-check', jobId, options.at]);
    this.bindKey(idempotencyKey, canonical);

    const claimed = claimJob(stored, { at: options.at });
    const program = await this.getProgramVerified(input.programId, tenant);
    const capability = { ...program.capability };

    // --- A007 public port: the qualification window read -------------------
    let window;
    try {
      window = await this.qualification.getQualificationWindow({
        tenant,
        expertId: input.expertId,
        capabilityId: capability.id,
      });
    } catch (error) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
        message: `the A007 qualification window read failed for job ${jobId} (fail closed)`,
        details: { jobId, cause: error instanceof Error ? error.message : String(error) },
      });
    }

    const latestVerdict = [...this.verdicts.values()]
      .filter((verdict) => verdict.tenant === tenant && verdict.expertId === input.expertId && verdict.programDigest === program.digest)
      .sort((a, b) => (a.evaluatedAt < b.evaluatedAt ? -1 : 1))
      .at(-1);

    let proposal: RequalificationProposal | null = null;
    let receipt: QualificationProposalReceipt | null = null;
    let trigger: 'time-window-elapsed' | 'drift-verdict' | null = null;

    if (window !== null && !isValidityInForce(window.validFrom, window.validUntil, options.at)) {
      trigger = 'time-window-elapsed';
    } else if (latestVerdict !== undefined && latestVerdict.verdict !== 'calibrated') {
      trigger = 'drift-verdict';
    }

    if (trigger !== null) {
      const view = deriveRequalificationProposal({
        tenant,
        expertId: input.expertId,
        capability,
        qualification: {
          validFrom: window?.validFrom ?? options.at,
          validUntil: window?.validUntil ?? options.at,
          priorRecordDigest: window?.recordDigest ?? null,
        },
        trigger,
        ...(trigger === 'drift-verdict' && latestVerdict !== undefined
          ? { driftVerdict: latestVerdict.verdict, verdictDigest: latestVerdict.digest }
          : {}),
        proposedAt: options.at,
      });
      proposal = await createRequalificationProposal(view);
      try {
        receipt = await this.qualification.submitRequalificationProposal({
          tenant,
          expertId: input.expertId,
          proposalDigest: proposal.digest,
          capability: { ...proposal.capability },
          trigger: proposal.trigger,
          proposedStatus: proposal.proposedStatus,
          priorRecordDigest: proposal.priorRecordDigest,
          verdictDigest: proposal.verdictDigest,
          rationale: proposal.rationale,
          proposedAt: proposal.proposedAt,
        });
      } catch (error) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
          message: `the A007 requalification proposal port failed for job ${jobId} (fail closed)`,
          details: { jobId, cause: error instanceof Error ? error.message : String(error) },
        });
      }
      if (!receipt.accepted) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
          message: `the A007 qualification port rejected the requalification proposal for job ${jobId} (fail closed)`,
          details: { jobId, reasons: [...(receipt.reasons ?? [])] },
        });
      }
      const event = makeRequalificationProposedEvent(
        { proposalDigest: proposal.digest, expertId: input.expertId, trigger: proposal.trigger, proposedStatus: proposal.proposedStatus, at: options.at },
        { correlationId, idempotencyKey },
      );
      this.recordEvent('requalification-proposed', event as unknown as Envelope<Record<string, unknown>>);
    }

    const result =
      proposal === null
        ? { trigger: null, proposalDigest: null, reason: 'no requalification trigger in force at the evaluated time' }
        : { trigger: proposal.trigger, proposalDigest: proposal.digest, proposedStatus: proposal.proposedStatus };
    const job = completeJob(claimed, { at: options.at, result });
    this.jobs.set(jobId, job);
    return {
      job,
      proposal,
      receipt,
      envelopes: [command as unknown as Envelope<Record<string, unknown>>],
    };
  }

  // -------------------------------------------------------------------------
  // getDemonstratedPerformance (query — the C002 routing read port)
  // -------------------------------------------------------------------------

  async getDemonstratedPerformance(
    tenant: string,
    expertId: string,
    capabilityId: string,
    options: QueryOptions & { readonly at: string },
  ): Promise<{
    performance: DemonstratedPerformance;
    query: Envelope<Record<string, unknown>>;
    response: Envelope<Record<string, unknown>>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const query = makeGetDemonstratedPerformanceQuery(
      { tenant, expertId, capabilityId },
      { correlationId },
    );
    const latestVerdict = [...this.verdicts.values()]
      .filter(
        (verdict) =>
          verdict.tenant === tenant && verdict.expertId === expertId && verdict.verdict !== undefined,
      )
      .sort((a, b) => (a.evaluatedAt < b.evaluatedAt ? -1 : 1))
      .at(-1);
    if (latestVerdict === undefined) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
        message: `no calibration verdict for expert ${JSON.stringify(expertId)} in tenant ${JSON.stringify(tenant)} (routing reads require demonstrated performance, never invented data)`,
        details: { expertId, tenant },
      });
    }
    const program = [...this.programs.values()].find(
      (candidate) => candidate.digest === latestVerdict.programDigest && candidate.tenant === tenant,
    );
    if (program === undefined) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
        message: `the program digest ${latestVerdict.programDigest} of verdict ${latestVerdict.verdictId} is not registered in this tenant`,
        details: { verdictId: latestVerdict.verdictId },
      });
    }
    if (program.capability.id !== capabilityId) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.NOT_FOUND, {
        message: `no calibration verdict for capability ${JSON.stringify(capabilityId)} (verdict ${latestVerdict.verdictId} covers ${program.capability.id})`,
        details: { capabilityId, covered: program.capability.id },
      });
    }

    // --- A007 public port: the qualification window read (in-force flag) ---
    let window;
    try {
      window = await this.qualification.getQualificationWindow({
        tenant,
        expertId,
        capabilityId,
      });
    } catch (error) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PORT_FAILURE, {
        message: `the A007 qualification window read failed for the demonstrated-performance view (fail closed)`,
        details: { cause: error instanceof Error ? error.message : String(error) },
      });
    }

    const lastObservedAt = [...this.records.values()]
      .filter((record) => record.tenant === tenant && record.expertId === expertId && record.programDigest === program.digest)
      .map((record) => record.observedAt)
      .sort()
      .at(-1) ?? null;

    const performance = await buildDemonstratedPerformance({
      tenant,
      expertId,
      capability: { ...program.capability },
      programDigest: program.digest,
      verdict: latestVerdict.verdict,
      verdictDigest: latestVerdict.digest,
      freshSampleCount: latestVerdict.freshDecidedCount,
      totalSampleCount: latestVerdict.recordCount,
      lastObservedAt,
      qualification: {
        validFrom: window?.validFrom ?? options.at,
        validUntil: window?.validUntil ?? options.at,
      },
      asOf: options.at,
    });
    const response = makeGetDemonstratedPerformanceResponse(
      {
        expertId,
        verdict: performance.verdict,
        freshSampleCount: performance.freshSampleCount,
        totalSampleCount: performance.totalSampleCount,
        inForce: performance.inForce,
        performanceDigest: performance.digest,
      },
      { correlationId },
    );
    return {
      performance,
      query: query as unknown as Envelope<Record<string, unknown>>,
      response: response as unknown as Envelope<Record<string, unknown>>,
    };
  }

  // -------------------------------------------------------------------------
  // Adversarial boundary (lock rule 9 — fail closed, ALWAYS)
  // -------------------------------------------------------------------------

  /**
   * The masquerade boundary: any attempt to consume this service's
   * calibration output as an AUTHORIZATION fails closed — there is no
   * code path that upgrades calibration data into a grant.
   */
  consumeAsAuthorization(value: unknown, context: string): never {
    consumeCalibrationAsAuthorization(value, context);
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.MASQUERADE_REJECTED, {
      message: 'unreachable: consumeCalibrationAsAuthorization never returns',
    });
  }

  // -------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------

  listEvents(): readonly Envelope<Record<string, unknown>>[] {
    return this.events.map((entry) => entry.envelope);
  }

  /** The pure LE1.0 diagnostic over one expert's records (audit view). */
  diagnosticFor(tenant: string, expertId: string, programId: string) {
    const program = this.getProgram(programId, tenant);
    const expertRecords = [...this.records.values()].filter(
      (record) => record.tenant === tenant && record.expertId === expertId && record.programDigest === program.digest,
    );
    return summarizeCalibrationRecords(expertRecords);
  }

  describe(): {
    programs: number;
    records: number;
    verdicts: number;
    tracks: number;
    jobs: number;
    events: number;
    runKeys: number;
  } {
    return {
      programs: this.programs.size,
      records: this.records.size,
      verdicts: this.verdicts.size,
      tracks: this.tracks.size,
      jobs: this.jobs.size,
      events: this.events.length,
      runKeys: this.runKeys.size,
    };
  }
}

/** Construct a fresh reference service (convenience). */
export function createExpertCalibrationService(options: {
  readonly intake: IntakeGapSourcePort;
  readonly qualification: ExpertQualificationPort;
  readonly workbench: WorkbenchAssignmentPort;
}): ExpertCalibrationService {
  return new ExpertCalibrationService(options);
}
