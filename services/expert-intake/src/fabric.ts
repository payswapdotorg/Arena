/**
 * ExpertIntakeService — the in-process reference ORCHESTRATOR over the
 * @arena/expert-intake engine (Work Order C003; mirrors the
 * services/expert-matching fabric pattern structurally: in-memory
 * reference store, injected ports, fail-closed errors, envelope
 * conventions).
 *
 * Operations:
 *   - startInterview (COMMAND, idempotency key REQUIRED — lock rule 17):
 *     creates the session over the injected model adapter + catalog seed;
 *   - askNextQuestion / recordAnswer (interactive session steps — the
 *     transcript is the durable record, questions/answers are engine ops);
 *   - abandonInterview / timeoutInterview / submitInterview / assessInterview
 *     (COMMANDS, idempotency keys REQUIRED): typed lifecycle transitions;
 *   - getTranscript (QUERY — pure read, fail-closed TENANT_MISMATCH on
 *     cross-tenant access);
 *   - assessInterview hands the IntakeProfile to the injected A006/A007
 *     ports on a complete-with-claims outcome (submissions hand the
 *     profile to the public ports — never direct writes into another
 *     surface's state; port faults and rejections fail closed with typed
 *     PORT_FAILURE).
 *
 * Integrity: every session fetch re-verifies the content digest — a
 * tampered store entry fails closed with EXPERT_INTAKE_TAMPERED.
 * Idempotency: the same key + the same command tuple replays the stored
 * result; the same key + a different tuple is an IDEMPOTENCY_CONFLICT.
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import {
  EXPERT_INTAKE_ERROR_CODES,
  ExpertIntakeError,
  IntakeInterviewEngine,
  ScriptedInterviewerModel,
  recomputeSessionDigest,
  toRegistryProposal,
  toQualificationClaimInputs,
  makeAbandonInterviewCommand,
  makeAssessInterviewCommand,
  makeGetInterviewTranscriptQuery,
  makeGetInterviewTranscriptResponse,
  makeIntakeAssessedEvent,
  makeIntakeProfileProposedEvent,
  makeIntakeSubmittedEvent,
  makeStartInterviewCommand,
  makeSubmitInterviewCommand,
  makeTimeoutInterviewCommand,
} from '@arena/expert-intake';
import type {
  CreateInterviewSessionInput,
  InterviewItem,
  InterviewSession,
  IntakeOutcome,
  SelectionRationale,
  StartInterviewCommandPayload,
} from '@arena/expert-intake';
import type {
  ExpertRegistryProposalPort,
  QualificationClaimPort,
  QualificationClaimReceipt,
  RegistryProposalReceipt,
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

export interface StartInterviewCommand {
  readonly sessionId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly selectionSeed: string;
  readonly catalogSeed?: unknown;
  readonly privacyPolicy: { readonly dataClassification: string; readonly pii: string };
  readonly identityRefs?: readonly string[];
}

interface IdempotencyBinding {
  readonly commandCanonical: string;
}

interface ServiceEvent {
  readonly kind: 'intake-submitted' | 'intake-assessed' | 'intake-profile-proposed';
  readonly envelope: Envelope<Record<string, unknown>>;
}

export interface AssessmentHandoff {
  readonly registryProposal?: RegistryProposalReceipt;
  readonly claimCandidates: readonly QualificationClaimReceipt[];
}

export interface AssessmentResult {
  readonly outcome: IntakeOutcome;
  readonly handoff: AssessmentHandoff;
  readonly envelopes: readonly Envelope<Record<string, unknown>>[];
}

function canonicalOf(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

/**
 * The in-process reference service. Construct with the injected ports
 * (model adapter, A006 registry proposal port, A007 qualification claim
 * port); the store is fresh per instance (the reference-fabric pattern).
 */
export class ExpertIntakeService {
  private readonly engine: IntakeInterviewEngine;
  private readonly registry: ExpertRegistryProposalPort;
  private readonly qualification: QualificationClaimPort;
  private readonly sessions = new Map<string, InterviewSession>();
  private readonly runKeys = new Map<string, IdempotencyBinding>();
  private readonly events: ServiceEvent[] = [];

  constructor(options: {
    readonly model?: IntakeInterviewEngine['model'];
    readonly registry: ExpertRegistryProposalPort;
    readonly qualification: QualificationClaimPort;
  }) {
    this.engine = new IntakeInterviewEngine(options.model ?? new ScriptedInterviewerModel());
    this.registry = options.registry;
    this.qualification = options.qualification;
  }

  // -------------------------------------------------------------------------
  // Store access (fail closed: NOT_FOUND / TENANT_MISMATCH / TAMPERED)
  // -------------------------------------------------------------------------

  private getSession(sessionId: string, tenant: string): InterviewSession {
    const stored = this.sessions.get(sessionId);
    if (stored === undefined) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.NOT_FOUND, {
        message: `no interview session ${JSON.stringify(sessionId)}`,
        details: { sessionId },
      });
    }
    if (stored.tenant !== tenant) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.TENANT_MISMATCH, {
        message: `interview session ${sessionId} belongs to tenant ${stored.tenant}, not ${tenant} (cross-tenant reads fail closed — lock rule 11)`,
        details: { sessionId, ownerTenant: stored.tenant, readerTenant: tenant },
      });
    }
    return stored;
  }

  private async getSessionVerified(sessionId: string, tenant: string): Promise<InterviewSession> {
    const session = this.getSession(sessionId, tenant);
    await recomputeSessionDigest(session); // throws EXPERT_INTAKE_TAMPERED on mismatch
    return session;
  }

  private async putSession(session: InterviewSession): Promise<void> {
    await recomputeSessionDigest(session); // never store an unverifiable session
    this.sessions.set(session.sessionId, session);
  }

  // -------------------------------------------------------------------------
  // Idempotency gate (lock rule 17)
  // -------------------------------------------------------------------------

  private bindKey(key: IdempotencyKey, canonical: string): void {
    const existing = this.runKeys.get(key);
    if (existing !== undefined && existing.commandCanonical !== canonical) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(key)} is already bound to a different command tuple`,
        details: { idempotencyKey: key, bound: existing.commandCanonical, attempted: canonical },
      });
    }
    if (existing !== undefined) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
        message: `idempotency key ${JSON.stringify(key)} already ran — replay returns the stored state instead of re-executing`,
        details: { idempotencyKey: key, commandCanonical: canonical },
      });
    }
    this.runKeys.set(key, { commandCanonical: canonical });
  }

  private isReplay(key: IdempotencyKey, canonical: string): boolean {
    const existing = this.runKeys.get(key);
    if (existing === undefined) return false;
    if (existing.commandCanonical !== canonical) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(key)} is already bound to a different command tuple (same key + different command is a conflict, not a rerun)`,
        details: { idempotencyKey: key, bound: existing.commandCanonical, attempted: canonical },
      });
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // startInterview (command — idempotency key REQUIRED)
  // -------------------------------------------------------------------------

  async startInterview(
    command: StartInterviewCommand,
    options: CommandOptions,
  ): Promise<{ session: InterviewSession; envelope: Envelope<StartInterviewCommandPayload> }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const payload: StartInterviewCommandPayload = {
      sessionId: command.sessionId,
      tenant: command.tenant,
      expertId: command.expertId,
      selectionSeed: command.selectionSeed,
    };
    const envelope = makeStartInterviewCommand(payload, { correlationId, idempotencyKey });
    const canonical = canonicalOf(['start', command.sessionId, command.tenant, command.expertId, command.selectionSeed]);
    if (this.isReplay(idempotencyKey, canonical)) {
      const stored = this.sessions.get(command.sessionId);
      if (stored !== undefined) return { session: stored, envelope };
    }
    this.bindKey(idempotencyKey, canonical);

    const session = await this.engine.create({
      sessionId: command.sessionId,
      tenant: command.tenant,
      expertId: command.expertId,
      ...(command.catalogSeed !== undefined ? { catalogSeed: command.catalogSeed as NonNullable<CreateInterviewSessionInput['catalogSeed']> } : {}),
      selectionSeed: command.selectionSeed,
      privacyPolicy: command.privacyPolicy,
      ...(command.identityRefs !== undefined ? { identityRefs: command.identityRefs } : {}),
      createdAt: options.at,
    });
    await this.putSession(session);
    return { session, envelope };
  }

  // -------------------------------------------------------------------------
  // Interactive session steps (ask / answer)
  // -------------------------------------------------------------------------

  /** Ask the next adaptively-selected question at a caller-injected time. */
  async askNextQuestionAt(
    sessionId: string,
    tenant: string,
    options: QueryOptions & { readonly at: string },
  ): Promise<{ item: InterviewItem; question: string; rationale: SelectionRationale }> {
    const session = await this.getSessionVerified(sessionId, tenant);
    const asked = await this.engine.askNext(session, { at: options.at });
    await this.putSession(asked.session);
    return { item: asked.item, question: asked.question, rationale: asked.rationale };
  }

  async recordAnswer(
    sessionId: string,
    tenant: string,
    itemId: string,
    answer: unknown,
    options: QueryOptions & { readonly at: string },
  ): Promise<{ answeredItems: number }> {
    const session = await this.getSessionVerified(sessionId, tenant);
    const next = await this.engine.answer(session, itemId, answer, { at: options.at });
    await this.putSession(next);
    return { answeredItems: next.transcript.filter((entry) => entry.answer !== undefined).length };
  }

  // -------------------------------------------------------------------------
  // Lifecycle commands (idempotency key REQUIRED)
  // -------------------------------------------------------------------------

  private async lifecycle(
    kind: 'submit' | 'abandon' | 'timeout',
    sessionId: string,
    tenant: string,
    options: CommandOptions,
  ): Promise<{ session: InterviewSession; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const session = await this.getSessionVerified(sessionId, tenant);
    const payload = { sessionId, at: options.at };
    const command =
      kind === 'submit'
        ? makeSubmitInterviewCommand(payload, { correlationId, idempotencyKey })
        : kind === 'abandon'
          ? makeAbandonInterviewCommand(payload, { correlationId, idempotencyKey })
          : makeTimeoutInterviewCommand(payload, { correlationId, idempotencyKey });
    const canonical = canonicalOf([kind, sessionId, options.at]);
    if (this.isReplay(idempotencyKey, canonical)) {
      return { session, envelopes: [command as unknown as Envelope<Record<string, unknown>>] };
    }
    this.bindKey(idempotencyKey, canonical);
    const next =
      kind === 'submit'
        ? await this.engine.submit(session, { at: options.at })
        : kind === 'abandon'
          ? await this.engine.abandon(session, { at: options.at })
          : await this.engine.timeout(session, { at: options.at });
    await this.putSession(next);
    const envelopes: Envelope<Record<string, unknown>>[] = [command as unknown as Envelope<Record<string, unknown>>];
    if (kind === 'submit') {
      const event = makeIntakeSubmittedEvent(
        { sessionId, sessionDigest: next.digest, at: options.at },
        { correlationId, idempotencyKey },
      );
      this.events.push({ kind: 'intake-submitted', envelope: event as unknown as Envelope<Record<string, unknown>> });
      envelopes.push(event as unknown as Envelope<Record<string, unknown>>);
    }
    return { session: next, envelopes };
  }

  async submitInterview(
    sessionId: string,
    tenant: string,
    options: CommandOptions,
  ): Promise<{ session: InterviewSession; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    return this.lifecycle('submit', sessionId, tenant, options);
  }

  async abandonInterview(
    sessionId: string,
    tenant: string,
    options: CommandOptions,
  ): Promise<{ session: InterviewSession; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    return this.lifecycle('abandon', sessionId, tenant, options);
  }

  async timeoutInterview(
    sessionId: string,
    tenant: string,
    options: CommandOptions,
  ): Promise<{ session: InterviewSession; envelopes: readonly Envelope<Record<string, unknown>>[] }> {
    return this.lifecycle('timeout', sessionId, tenant, options);
  }

  // -------------------------------------------------------------------------
  // assessInterview (command — hands the IntakeProfile to the A006/A007 ports)
  // -------------------------------------------------------------------------

  async assessInterview(sessionId: string, tenant: string, options: CommandOptions): Promise<AssessmentResult> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    const session = await this.getSessionVerified(sessionId, tenant);
    const command = makeAssessInterviewCommand({ sessionId, at: options.at }, { correlationId, idempotencyKey });
    const canonical = canonicalOf(['assess', sessionId, options.at]);
    if (this.isReplay(idempotencyKey, canonical)) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
        message: `assessment for session ${sessionId} already ran under this idempotency key — inspect the stored outcome via listEvents`,
        details: { sessionId, idempotencyKey },
      });
    }
    this.bindKey(idempotencyKey, canonical);

    const { session: assessed, outcome } = await this.engine.assess(session, { at: options.at });
    await this.putSession(assessed);
    const envelopes: Envelope<Record<string, unknown>>[] = [command as unknown as Envelope<Record<string, unknown>>];
    envelopes.push(
      makeIntakeAssessedEvent({ sessionId, outcome: outcome.outcome, at: options.at }, { correlationId, idempotencyKey }) as unknown as Envelope<Record<string, unknown>>,
    );

    const handoff: { registryProposal?: RegistryProposalReceipt; claimCandidates: readonly QualificationClaimReceipt[] } = {
      claimCandidates: [],
    };
    if (outcome.outcome === 'complete-with-claims') {
      const profile = outcome.profile;
      // --- A006 public port: the registry-field proposal -------------------
      let registryReceipt: RegistryProposalReceipt;
      try {
        registryReceipt = await this.registry.submitRegistryProposal(toRegistryProposal(profile));
      } catch (error) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.PORT_FAILURE, {
          message: `the A006 registry proposal port failed for session ${sessionId} (fail closed — the intake profile was NOT proposed)`,
          details: { sessionId, cause: error instanceof Error ? error.message : String(error) },
        });
      }
      if (!registryReceipt.accepted) {
        throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.PORT_FAILURE, {
          message: `the A006 registry port rejected the intake proposal for session ${sessionId} (fail closed)`,
          details: { sessionId, reasons: [...(registryReceipt.reasons ?? [])] },
        });
      }
      handoff.registryProposal = registryReceipt;

      // --- A007 public port: the qualification claim candidates ------------
      const receipts: QualificationClaimReceipt[] = [];
      for (const candidate of toQualificationClaimInputs(profile)) {
        try {
          const receipt = await this.qualification.submitClaimCandidate(candidate);
          receipts.push(receipt);
          if (!receipt.accepted) {
            throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.PORT_FAILURE, {
              message: `the A007 qualification port rejected a claim candidate for session ${sessionId} (fail closed)`,
              details: { sessionId, reasons: [...(receipt.reasons ?? [])] },
            });
          }
        } catch (error) {
          if (error instanceof ExpertIntakeError) throw error;
          throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.PORT_FAILURE, {
            message: `the A007 qualification claim port failed for session ${sessionId} (fail closed)`,
            details: { sessionId, cause: error instanceof Error ? error.message : String(error) },
          });
        }
      }
      handoff.claimCandidates = Object.freeze([...receipts]);
      const proposedEvent = makeIntakeProfileProposedEvent(
        { sessionId, profileDigest: profile.digest, claimCandidateCount: receipts.length, at: options.at },
        { correlationId, idempotencyKey },
      );
      envelopes.push(proposedEvent as unknown as Envelope<Record<string, unknown>>);
      this.events.push({ kind: 'intake-profile-proposed', envelope: proposedEvent as unknown as Envelope<Record<string, unknown>> });
    }

    const assessedEvent: ServiceEvent = {
      kind: 'intake-assessed',
      envelope: envelopes[1] as Envelope<Record<string, unknown>>,
    };
    this.events.push(assessedEvent);
    return { outcome, handoff, envelopes };
  }

  // -------------------------------------------------------------------------
  // getTranscript (query — pure read, fail-closed tenant gate)
  // -------------------------------------------------------------------------

  async getTranscript(
    sessionId: string,
    tenant: string,
    options: QueryOptions,
  ): Promise<{
    entries: readonly { readonly itemId: string; readonly question: string; readonly answered: boolean }[];
    query: Envelope<Record<string, unknown>>;
    response: Envelope<Record<string, unknown>>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const query = makeGetInterviewTranscriptQuery({ sessionId, tenant }, { correlationId });
    const session = await this.getSessionVerified(sessionId, tenant);
    const entries = session.transcript.map((entry) => ({
      itemId: entry.itemId,
      question: entry.question,
      answered: entry.answer !== undefined,
    }));
    const response = makeGetInterviewTranscriptResponse(
      { sessionId, entries: entries.length, answered: entries.filter((entry) => entry.answered).length, transcriptHead: session.transcriptHead },
      { correlationId },
    );
    return {
      entries: Object.freeze([...entries]),
      query: query as unknown as Envelope<Record<string, unknown>>,
      response: response as unknown as Envelope<Record<string, unknown>>,
    };
  }

  // -------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------

  listEvents(): readonly Envelope<Record<string, unknown>>[] {
    return this.events.map((entry) => entry.envelope);
  }

  describe(): { sessions: number; events: number; runKeys: number } {
    return { sessions: this.sessions.size, events: this.events.length, runKeys: this.runKeys.size };
  }
}

/** Construct a fresh reference service (convenience). */
export function createExpertIntakeService(options: {
  readonly model?: IntakeInterviewEngine['model'];
  readonly registry: ExpertRegistryProposalPort;
  readonly qualification: QualificationClaimPort;
}): ExpertIntakeService {
  return new ExpertIntakeService(options);
}
