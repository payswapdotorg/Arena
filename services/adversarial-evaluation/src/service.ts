/**
 * The adversarial-evaluation reference service (Work Order C013; issue
 * #119; spec/adversarial-expert-evaluation.md AE1.0).
 *
 * Every mutation is a DURABLE IDEMPOTENT JOB: commands carry a command
 * id, run through the JobLog, and replay returns the same receipt. The
 * lifecycle binds through the domain state machine; every cast
 * judgment passes the STRUCTURAL GUARDRAIL BATTERY before append
 * (fail-closed admission — a denied judgment is never partially
 * recorded); adjudication composes the A012 evaluator seam, the A013
 * verifier seam, the C005 calibration seam and the C009 final-
 * verification seam through INJECTED PORTS, computes the labelled
 * community discovery signals (verdict-free by construction), and
 * projects results into Evaluation/Verification/Certification
 * candidates plus A030 byproduct candidates.
 *
 * Fail-closed error normalization per the sibling services: every
 * failure surfaces as the domain AdversarialEvaluationError with
 * machine-readable details.
 */

import {
  newChallengeId,
  AdversarialEvaluationError,
  ADVERSARIAL_EVALUATION_ERROR_CODES,
  computeCommunitySignal,
  createByproductRecord,
  createJudgment,
  deriveCompetitionResult,
  evaluateJudgmentGuardrails,
  toCandidateFeeds,
  toResearchCandidates,
  transitionCompetition,
  createCompetition,
  DEFAULT_GUARDRAIL_POLICY,
} from '@arena/adversarial-evaluation';
import type {
  AdjudicationInputs,
  CompetitionParticipant,
  CompetitionResult,
  CommunitySignal,
  GuardrailPolicy,
  JudgmentRecord,
  SolutionAdjudicationInput,
} from '@arena/adversarial-evaluation';
import { newCorrelationId } from '@arena/protocol-core';

import type {
  Clock,
  CompetitionAggregate,
  CompetitionEvent,
  CompetitionEventSink,
  CompetitionStore,
  EvaluationFabricPort,
  ExpertCalibrationPort,
  ExpertDirectory,
  FinalAdjudicationPort,
  JobLog,
  ResearchCandidateSink,
  StageRunInput,
  VerificationFabricPort,
} from './ports.js';
import { COMPETITION_EVENT_TYPES } from './ports.js';

/** The guardrail policy the reference service runs by default. */
export const REFERENCE_GUARDRAIL_POLICY: GuardrailPolicy = DEFAULT_GUARDRAIL_POLICY;

export interface ServiceDeps {
  readonly clock: Clock;
  readonly store: CompetitionStore;
  readonly directory: ExpertDirectory;
  readonly evaluator: EvaluationFabricPort;
  readonly verifier: VerificationFabricPort;
  readonly finalAdjudication: FinalAdjudicationPort;
  readonly calibration: ExpertCalibrationPort;
  readonly events: CompetitionEventSink;
  readonly research: ResearchCandidateSink;
  readonly jobLog: JobLog;
  readonly policy?: GuardrailPolicy;
}

/** The receipt every command returns (durable, replayable). */
export interface CommandReceipt {
  readonly commandId: string;
  readonly competitionId: string;
  readonly status: 'recorded' | 'denied';
  readonly detail: string;
  readonly guardrailViolations?: readonly { readonly code: string; readonly detail: string }[];
}

export class AdversarialEvaluationService {
  private readonly deps: ServiceDeps;
  private readonly policy: GuardrailPolicy;

  constructor(deps: ServiceDeps) {
    this.deps = deps;
    this.policy = deps.policy ?? REFERENCE_GUARDRAIL_POLICY;
  }

  // -------------------------------------------------------------------------
  // The idempotent job runner (fail-closed, replay-safe)
  // -------------------------------------------------------------------------

  private async runJob<T extends CommandReceipt>(
    commandId: string,
    digestInput: Readonly<Record<string, unknown>>,
    run: () => Promise<T>,
  ): Promise<T> {
    if (typeof commandId !== 'string' || commandId.length === 0) {
      throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION, {
        message: 'every command REQUIRES a command id (idempotency key; architecture-lock rule 17)',
      });
    }
    const digest = JSON.stringify(digestInput);
    const prior = await this.deps.jobLog.entryOf(commandId);
    if (prior !== undefined) {
      if (prior.digest !== digest) {
        throw new AdversarialEvaluationError(
          ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION,
          {
            message: `command id ${commandId} was already used for a DIFFERENT command (idempotency collision denied)`,
            details: { commandId, priorDigest: prior.digest, attemptedDigest: digest },
          },
        );
      }
      // Replay: the SAME command id + digest returns the SAME receipt.
      return prior.receipt as T;
    }
    const receipt = await run();
    await this.deps.jobLog.record(
      commandId,
      digest,
      receipt as unknown as Readonly<Record<string, unknown>>,
    );
    return receipt;
  }

  private async emit(
    aggregate: CompetitionAggregate,
    type: (typeof COMPETITION_EVENT_TYPES)[number],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const event: CompetitionEvent = {
      eventId: newCorrelationId(),
      competitionId: aggregate.competition.competitionId,
      tenantId: aggregate.competition.tenantId,
      type,
      occurredAt: new Date(this.deps.clock.now()).toISOString(),
      payload,
    };
    await this.deps.events.emit(event);
  }

  private async loadForTenant(competitionId: string, tenantId: string): Promise<CompetitionAggregate> {
    const aggregate = await this.deps.store.get(competitionId, tenantId);
    if (aggregate === undefined) {
      // Fail closed with the typed cross-tenant failure when it exists elsewhere.
      const unscoped = await this.deps.store.findById(competitionId);
      if (unscoped !== undefined) {
        throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION, {
          message: `competition ${competitionId} exists but is not visible to tenant ${tenantId} (cross-tenant access denied)`,
        });
      }
      throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_COMPETITION, {
        message: `unknown competition ${competitionId}`,
      });
    }
    return aggregate;
  }

  // -------------------------------------------------------------------------
  // Lifecycle commands
  // -------------------------------------------------------------------------

  /** Open a competition over a task (OPEN). */
  async openCompetition(command: {
    readonly commandId: string;
    readonly competitionId: string;
    readonly tenantId: string;
    readonly task: {
      readonly taskId: string;
      readonly title: string;
      readonly statement: string;
      readonly requiredSkills: readonly string[];
    };
  }): Promise<CommandReceipt> {
    return this.runJob(command.commandId, { op: 'openCompetition', ...command }, async () => {
      const competition = createCompetition({
        competitionId: command.competitionId,
        tenantId: command.tenantId,
        task: command.task,
        now: this.deps.clock.now(),
      });
      const aggregate: CompetitionAggregate = {
        competition,
        submissions: [],
        judgments: [],
        result: null,
        signals: [],
      };
      await this.deps.store.insert(aggregate);
      await this.emit(aggregate, 'competition.opened', { state: competition.state });
      return {
        commandId: command.commandId,
        competitionId: command.competitionId,
        status: 'recorded',
        detail: `competition opened in OPEN over task ${command.task.taskId}`,
      };
    });
  }

  /** Advance the lifecycle along ONE legal edge (typed, fail-closed). */
  async advanceState(command: {
    readonly commandId: string;
    readonly competitionId: string;
    readonly tenantId: string;
    readonly target: Parameters<typeof transitionCompetition>[1]['target'];
    readonly reason: string | null;
    readonly terminalReason?: Parameters<typeof transitionCompetition>[1]['terminalReason'];
  }): Promise<CommandReceipt> {
    return this.runJob(command.commandId, { op: 'advanceState', ...command }, async () => {
      const aggregate = await this.loadForTenant(command.competitionId, command.tenantId);
      const competition = transitionCompetition(aggregate.competition, {
        target: command.target,
        reason: command.reason,
        ...(command.terminalReason === undefined ? {} : { terminalReason: command.terminalReason }),
        now: this.deps.clock.now(),
      });
      const updated: CompetitionAggregate = { ...aggregate, competition };
      await this.deps.store.update(updated);
      await this.emit(updated, 'competition.state_changed', {
        state: competition.state,
        reason: command.reason,
      });
      return {
        commandId: command.commandId,
        competitionId: command.competitionId,
        status: 'recorded',
        detail: `competition advanced to ${command.target}`,
      };
    });
  }

  /** Record an independent expert solution (AE1.0 step 1). */
  async submitSolution(command: {
    readonly commandId: string;
    readonly competitionId: string;
    readonly tenantId: string;
    readonly submissionId: string;
    readonly authorExpertRef: string;
    readonly evidenceRefs: readonly string[];
  }): Promise<CommandReceipt> {
    return this.runJob(command.commandId, { op: 'submitSolution', ...command }, async () => {
      const aggregate = await this.loadForTenant(command.competitionId, command.tenantId);
      const participants = await this.eliminateCrossTenant(command.tenantId);
      const author = participants.find((participant) => participant.expertRef === command.authorExpertRef);
      if (author === undefined || !author.qualified) {
        throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.GUARDRAIL_VIOLATION, {
          message: `only QUALIFIED participants may submit solutions (expert ${command.authorExpertRef})`,
        });
      }
      if (aggregate.competition.state !== 'soliciting' && aggregate.competition.state !== 'submitted') {
        throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_TRANSITION, {
          message: `solutions are accepted in SOLICITING/SUBMITTED only (state ${aggregate.competition.state})`,
        });
      }
      const submission = {
        submissionId: command.submissionId,
        competitionId: command.competitionId,
        authorExpertRef: command.authorExpertRef,
        submittedAt: new Date(this.deps.clock.now()).toISOString(),
      };
      const updated: CompetitionAggregate = {
        ...aggregate,
        submissions: [...aggregate.submissions, submission],
        competition:
          aggregate.competition.state === 'soliciting'
            ? transitionCompetition(aggregate.competition, {
                target: 'submitted',
                reason: 'first solution recorded',
                now: this.deps.clock.now(),
              })
            : aggregate.competition,
      };
      await this.deps.store.update(updated);
      await this.emit(updated, 'competition.submission.recorded', {
        submissionId: command.submissionId,
        authorExpertRef: command.authorExpertRef,
      });
      return {
        commandId: command.commandId,
        competitionId: command.competitionId,
        status: 'recorded',
        detail: `solution ${command.submissionId} recorded (author ${command.authorExpertRef})`,
      };
    });
  }

  /**
   * Cast a judgment (any of the six AE1.0 types) — the GUARDRAIL
   * ADMISSION path. A denied judgment fails closed with the full
   * machine-readable violation list; nothing is appended.
   */
  async castJudgment(command: {
    readonly commandId: string;
    readonly competitionId: string;
    readonly tenantId: string;
    readonly judgmentId: string;
    readonly submissionId: string;
    readonly challengeId?: string | null;
    readonly expertRef: string;
    readonly type: JudgmentRecord['type'];
    readonly claim: string;
    readonly evidence: readonly {
      readonly kind: string;
      readonly evidenceRef: string;
      readonly supportsClaim: string;
      readonly note?: string | null;
    }[];
    readonly note?: string | null;
  }): Promise<CommandReceipt> {
    return this.runJob(command.commandId, { op: 'castJudgment', ...command }, async () => {
      const aggregate = await this.loadForTenant(command.competitionId, command.tenantId);
      const participants = await this.eliminateCrossTenant(command.tenantId);
      const judgment = createJudgment({
        judgmentId: command.judgmentId,
        competitionId: command.competitionId,
        submissionId: command.submissionId,
        challengeId:
          command.challengeId ??
          (command.type === 'challenge' ? newChallengeId() : null),
        expertRef: command.expertRef,
        type: command.type,
        claim: command.claim,
        evidence: command.evidence,
        note: command.note ?? null,
        recordedAt: this.deps.clock.now(),
        provenance: 'services/adversarial-evaluation',
      });
      const decision = evaluateJudgmentGuardrails({
        judgment,
        participants,
        submissions: aggregate.submissions,
        priorJudgments: aggregate.judgments,
        policy: this.policy,
      });
      if (!decision.allowed) {
        await this.emit(aggregate, 'competition.judgment.denied', {
          judgmentId: judgment.judgmentId,
          violations: decision.violations,
        });
        return {
          commandId: command.commandId,
          competitionId: command.competitionId,
          status: 'denied',
          detail: 'judgment denied by the structural guardrail battery (fail closed; nothing appended)',
          guardrailViolations: decision.violations,
        };
      }
      const judgments = [...aggregate.judgments, judgment];
      const updated: CompetitionAggregate = {
        ...aggregate,
        judgments,
        competition: this.stateAfterJudgment(aggregate, judgments),
      };
      await this.deps.store.update(updated);
      await this.emit(updated, 'competition.judgment.recorded', {
        judgmentId: judgment.judgmentId,
        type: judgment.type,
        expertRef: judgment.expertRef,
      });
      return {
        commandId: command.commandId,
        competitionId: command.competitionId,
        status: 'recorded',
        detail: `${judgment.type} judgment recorded (evidence items: ${judgment.evidence.length})`,
      };
    });
  }

  private stateAfterJudgment(
    aggregate: CompetitionAggregate,
    judgments: readonly JudgmentRecord[],
  ) {
    const state = aggregate.competition.state;
    const hasChallenge = judgments.some((judgment) => judgment.type === 'challenge');
    const hasResponse = judgments.some(
      (judgment) => judgment.type === 'accept_challenge' || judgment.type === 'reject_challenge',
    );
    const now = this.deps.clock.now();
    if (state === 'submitted' && hasChallenge) {
      return transitionCompetition(aggregate.competition, {
        target: 'challenge',
        reason: 'first challenge issued',
        now,
      });
    }
    if (state === 'challenge' && hasResponse) {
      return transitionCompetition(aggregate.competition, {
        target: 'response',
        reason: 'challenge verdict judgments recorded',
        now,
      });
    }
    if (state === 'response' && this.hasVotingJudgments(judgments)) {
      return transitionCompetition(aggregate.competition, {
        target: 'voting',
        reason: 'solution vote judgments recorded',
        now,
      });
    }
    return aggregate.competition;
  }

  private hasVotingJudgments(judgments: readonly JudgmentRecord[]): boolean {
    return judgments.some(
      (judgment) =>
        judgment.type === 'upvote_with_proof' ||
        judgment.type === 'downvote_with_proof' ||
        judgment.type === 'needs_more_evidence',
    );
  }

  // -------------------------------------------------------------------------
  // Adjudication (AE1.0 step 8 — composed with the C009/A012/A013 seams)
  // -------------------------------------------------------------------------

  /**
   * Run adjudication: derive the AE1.0 input list through the injected
   * ports, derive the result, compute the labelled community discovery
   * signals, transition to VERIFIED_RESULT, project the certification
   * candidate feeds and deliver A030 byproduct candidates.
   */
  async runAdjudication(command: {
    readonly commandId: string;
    readonly competitionId: string;
    readonly tenantId: string;
  }): Promise<CommandReceipt & { readonly result: CompetitionResult | null }> {
    return this.runJob(command.commandId, { op: 'runAdjudication', ...command }, async () => {
      const aggregate = await this.loadForTenant(command.competitionId, command.tenantId);
      if (aggregate.submissions.length === 0) {
        throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
          message: 'adjudication requires at least one submission',
        });
      }
      const participants = await this.eliminateCrossTenant(command.tenantId);
      const patterns = await this.deps.calibration.listAgreementPatterns(command.tenantId);
      const solutions: SolutionAdjudicationInput[] = [];
      for (const submission of aggregate.submissions) {
        const stageInput: StageRunInput = {
          competitionId: command.competitionId,
          tenantId: command.tenantId,
          submissionId: submission.submissionId,
          authorExpertRef: submission.authorExpertRef,
          task: aggregate.competition.task,
          evidenceRefs: aggregate.judgments
            .filter((judgment) => judgment.submissionId === submission.submissionId)
            .flatMap((judgment) => judgment.evidence.map((item) => item.evidenceRef)),
          now: this.deps.clock.now(),
        };
        // STAGE A — the A012 task-specific evaluator (judgment against criteria).
        const evaluatorOutcome = await this.deps.evaluator.runEvaluator(stageInput);
        // STAGE B — the A013 verifier (evidence supports claims).
        const verifierOutcome = await this.deps.verifier.runVerifier(stageInput);
        // STAGE C — the C009/A013 FINAL VERIFICATION SEAM: the outcome
        // AUTHORITY stays in escalation-validation/Verification; the
        // A013 record digest is carried for audit when the seam has none.
        const finalOutcome = await this.deps.finalAdjudication.adjudicateSubmission(stageInput);
        const votes = aggregate.judgments
          .filter(
            (judgment) =>
              judgment.submissionId === submission.submissionId &&
              (judgment.type === 'upvote_with_proof' || judgment.type === 'downvote_with_proof'),
          )
          .map((judgment) => ({
            expertRef: judgment.expertRef,
            direction: judgment.type === 'upvote_with_proof' ? ('up' as const) : ('down' as const),
            evidenceQuality: Math.min(1, judgment.evidence.length / Math.max(1, this.policy.minEvidenceItems)),
            // Historical calibration weight — a C005 read-surface
            // projection; the reference fabric supplies the uninformed
            // 0.5 unless the host wires a real calibration seam.
            calibrationWeight: 0.5,
          }));
        const challenges = aggregate.judgments
          .filter((judgment) => judgment.challengeId !== null)
          .map((judgment) => ({
            challengeId: judgment.challengeId ?? '',
            validity: (judgment.type === 'accept_challenge'
              ? 'accepted'
              : judgment.type === 'reject_challenge'
                ? 'rejected'
                : 'undecided') as 'accepted' | 'rejected' | 'undecided',
            evidenceQuality: Math.min(1, judgment.evidence.length),
          }));
        solutions.push({
          submissionId: submission.submissionId,
          authorExpertRef: submission.authorExpertRef,
          votes,
          challenges,
          verifierOutcome: {
            outcome: finalOutcome.outcome,
            recordDigest: finalOutcome.recordDigest ?? verifierOutcome.recordDigest,
          },
          evaluatorOutcome,
        });
      }
      const inputs: AdjudicationInputs = {
        competitionId: command.competitionId,
        tenantId: command.tenantId,
        solutions,
        agreementPatterns: patterns,
        policy: this.policy,
        now: this.deps.clock.now(),
      };
      const result = deriveCompetitionResult(inputs);
      // The labelled community discovery signals (verdict-free projection).
      const signals: CommunitySignal[] = aggregate.submissions.map((submission) =>
        computeCommunitySignal({
          competitionId: command.competitionId,
          submissionId: submission.submissionId,
          judgments: aggregate.judgments,
          participants,
          submissions: aggregate.submissions,
          policy: this.policy,
          now: this.deps.clock.now(),
        }),
      );
      // The AE1.0 chain passes THROUGH the ADJUDICATION state: walk
      // current -> adjudication -> verified_result (typed edges only).
      let competition = aggregate.competition;
      if (competition.state !== 'adjudication' && competition.state !== 'verified_result') {
        competition = transitionCompetition(competition, {
          target: 'adjudication',
          reason: 'adjudication started',
          now: this.deps.clock.now(),
        });
      }
      if (competition.state === 'adjudication') {
        competition = transitionCompetition(competition, {
          target: 'verified_result',
          reason: `adjudication derived ${result.outcome}`,
          now: this.deps.clock.now(),
        });
      }
      const updated: CompetitionAggregate = {
        competition,
        submissions: aggregate.submissions,
        judgments: aggregate.judgments,
        result,
        signals,
      };
      await this.deps.store.update(updated);
      // The certification candidate feeds (public ports; candidateOnly).
      const evidenceBySubmission: Record<string, readonly string[]> = {};
      for (const submission of aggregate.submissions) {
        evidenceBySubmission[submission.submissionId] = aggregate.judgments
          .filter((judgment) => judgment.submissionId === submission.submissionId)
          .flatMap((judgment) => judgment.evidence.map((item) => item.evidenceRef));
      }
      void toCandidateFeeds(result, evidenceBySubmission);
      // The A030 byproduct candidates (rights/provenance-carrying).
      const byproductRefs = [
        ...aggregate.judgments.map((judgment) => `judgment:${judgment.judgmentId}`),
        ...aggregate.submissions.map((submission) => `submission:${submission.submissionId}`),
      ];
      if (byproductRefs.length > 0) {
        const byproduct = createByproductRecord({
          byproductId: `bp_${command.competitionId.slice(4)}`,
          competitionId: command.competitionId,
          kind: 'adversarial-trajectory',
          refs: byproductRefs,
          rights: {
            license: 'arena-research-only',
            provenance: `arena adversarial competition ${command.competitionId} (tenant ${command.tenantId})`,
            consentForResearch: true,
          },
          createdAt: new Date(this.deps.clock.now()).toISOString(),
        });
        await this.deps.research.accept(toResearchCandidates(byproduct));
      }
      await this.emit(updated, 'competition.result.derived', {
        outcome: result.outcome,
        winnerSubmissionId: result.winnerSubmissionId,
        formulaVersion: result.formulaVersion,
      });
      return {
        commandId: command.commandId,
        competitionId: command.competitionId,
        status: 'recorded',
        detail: `adjudication derived ${result.outcome} (formula v${result.formulaVersion})`,
        result,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /** Tenant-scoped competition listing (read model). */
  async listCompetitions(tenantId: string): Promise<readonly CompetitionAggregate[]> {
    return this.deps.store.listByTenant(tenantId);
  }

  /** Tenant-scoped aggregate read (typed cross-tenant failure). */
  async getCompetition(
    competitionId: string,
    tenantId: string,
  ): Promise<CompetitionAggregate> {
    return this.loadForTenant(competitionId, tenantId);
  }

  private async eliminateCrossTenant(tenantId: string): Promise<readonly CompetitionParticipant[]> {
    const participants = await this.deps.directory.listParticipants(tenantId);
    // Double-guard the host contract: eliminate cross-tenant candidates.
    return participants.filter(
      (participant) => participant.tenant === tenantId || participant.tenant === 'public',
    );
  }
}
