/**
 * The adaptive interview engine facade (Work Order C003) — one typed entry
 * point per interview operation, wiring the item catalog, the
 * expected-information-value selector, the interviewer model adapter port
 * and the session lifecycle together:
 *
 *   createInterview → askNext (adaptive) → recordDeclaredAnswer →
 *   submitInterview → assessInterview | abandonInterview | timeoutInterview
 *
 * DETERMINISM CONTRACT: given an identical (catalog seed, selection seed,
 * injected timestamps, scripted model adapter) tuple, two engine runs
 * produce byte-identical transcripts and identical session digests —
 * the interview is replayable evidence. No clock reads (all times are
 * injected); no hidden state (every mutation returns a new frozen
 * session).
 */

import { renderQuestionFailClosed } from './model-adapter.js';
import type { InterviewerModelPort } from './model-adapter.js';
import { selectNextItem } from './selection.js';
import type { SelectionRationale } from './selection.js';
import {
  appendQuestion,
  createInterviewSession,
  markAbandoned,
  markAssessed,
  markSubmitted,
  markTimedOut,
  recordDeclaredAnswer,
} from './session.js';
import type { CreateInterviewSessionInput, InterviewSession } from './session.js';
import { assessInterview } from './outcome.js';
import type { IntakeOutcome } from './outcome.js';
import { catalogItemById } from './items.js';
import type { InterviewItem } from './items.js';
import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';

/** Options for one engine operation (all times injected — no clock reads). */
export interface EngineOperationOptions {
  readonly at: string;
}

export interface AskNextResult {
  readonly session: InterviewSession;
  readonly item: InterviewItem;
  readonly question: string;
  readonly rationale: SelectionRationale;
}

/**
 * The adaptive interview engine. Construct with the interviewer model
 * ADAPTER PORT (lock rule 10 — the domain stays model-neutral; the
 * scripted reference implementation makes runs deterministic).
 */
export class IntakeInterviewEngine {
  readonly model: InterviewerModelPort;

  constructor(model: InterviewerModelPort) {
    this.model = model;
  }

  /** Create a session in the CREATED state (deterministic catalog build). */
  async create(input: CreateInterviewSessionInput): Promise<InterviewSession> {
    return createInterviewSession(input);
  }

  /**
   * Ask the next item — adaptively selected by expected information value
   * with a full inspectable rationale, rendered through the model adapter
   * port (fail-closed MODEL_ADAPTER_FAILURE). CREATED → IN_PROGRESS.
   */
  async askNext(session: InterviewSession, options: EngineOperationOptions): Promise<AskNextResult> {
    const selection = this.selectNext(session);
    if (selection.item === null) {
      throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
        message: `every catalog item has been asked in session ${session.sessionId} — submit or abandon the interview`,
        details: { sessionId: session.sessionId, state: session.state },
      });
    }
    const item = selection.item;
    const question = await renderQuestionFailClosed(this.model, {
      sessionId: session.sessionId,
      item,
      questionNumber: session.transcript.length,
    });
    const next = await appendQuestion(session, item, question, this.model.modelId, options.at);
    return { session: next, item, question, rationale: selection.rationale };
  }

  /** Pure next-item selection (exposed for inspection/tests). */
  selectNext(session: InterviewSession): { item: InterviewItem | null; rationale: SelectionRationale } {
    return selectNextItem(
      session.catalog,
      session.transcript.map((entry) => ({ itemId: entry.itemId, answered: entry.answer !== undefined })),
      session.selectionSeed,
    );
  }

  /** Record the expert's declared answer for one asked item (validated). */
  async answer(
    session: InterviewSession,
    itemId: string,
    answer: unknown,
    options: EngineOperationOptions,
  ): Promise<InterviewSession> {
    return recordDeclaredAnswer(session, itemId, answer, options.at);
  }

  /** Submit the interview (IN_PROGRESS → SUBMITTED). */
  async submit(session: InterviewSession, options: EngineOperationOptions): Promise<InterviewSession> {
    return markSubmitted(session, options.at);
  }

  /** Abandon the interview (explicit — terminal). */
  async abandon(session: InterviewSession, options: EngineOperationOptions): Promise<InterviewSession> {
    return markAbandoned(session, options.at);
  }

  /** Time the interview out (deadline lapse — terminal). */
  async timeout(session: InterviewSession, options: EngineOperationOptions): Promise<InterviewSession> {
    return markTimedOut(session, options.at);
  }

  /**
   * Assess a submitted interview (SUBMITTED → ASSESSED) and return the
   * typed outcome: complete-with-claims / incomplete-with-gap-list /
   * rejected-with-reasons.
   */
  async assess(
    session: InterviewSession,
    options: EngineOperationOptions,
  ): Promise<{ session: InterviewSession; outcome: IntakeOutcome }> {
    const outcome = await assessInterview(session, { assessedAt: options.at });
    const assessed = await markAssessed(session, options.at);
    return { session: assessed, outcome };
  }

  /** Look up a catalog item by id (fail-closed NOT_FOUND). */
  itemById(session: InterviewSession, itemId: string): InterviewItem {
    return catalogItemById(session.catalog, itemId);
  }
}

/** Construct an engine over the given interviewer model adapter port. */
export function createIntakeInterviewEngine(model: InterviewerModelPort): IntakeInterviewEngine {
  return new IntakeInterviewEngine(model);
}
