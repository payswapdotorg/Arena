/**
 * The interviewer model ADAPTER PORT (Work Order C003; architecture-lock
 * rule 10: "models sit behind adapters" — the domain package stays
 * model-neutral).
 *
 * The interview engine never calls a model directly: question phrasing is
 * delegated to an injected `InterviewerModelPort`. The reference
 * implementation (`ScriptedInterviewerModel`) is fully deterministic —
 * a pure template renderer over the typed interview item — so tests and
 * replay are reproducible byte-for-byte. A production adapter may wrap a
 * real model substrate; the CONTRACT here is unchanged: given the same
 * render request, an adapter suitable for deterministic intake replay
 * returns the same question text (the intake transcript is evidence, and
 * evidence must be reproducible).
 *
 * Fail-closed: adapters that throw, return non-neutral text or smuggle
 * model-private reasoning into the question are rejected with typed
 * MODEL_ADAPTER_FAILURE errors — the transcript records what the expert
 * was ASKED and what the expert DECLARED, never hidden model reasoning.
 */

import { isIntakeNeutralText } from './shared.js';
import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';
import type { InterviewItem } from './items.js';

/** The render request handed to the adapter port (typed data, no model API). */
export interface QuestionRenderRequest {
  readonly sessionId: string;
  readonly item: InterviewItem;
  /** Zero-based ordinal of this question within the session transcript. */
  readonly questionNumber: number;
}

/** The adapter's answer: ONE neutral-text question phrasing. */
export interface QuestionRender {
  readonly question: string;
}

/**
 * The interviewer model port (lock rule 10). Implementations MUST be
 * side-effect free; deterministic implementations make intake replay
 * byte-reproducible.
 */
export interface InterviewerModelPort {
  /** Stable adapter/model identity recorded next to the transcript entry. */
  readonly modelId: string;
  /** Render one question phrasing for the given interview item. */
  renderQuestion(request: QuestionRenderRequest): Promise<QuestionRender>;
}

/** The reference scripted interviewer model — deterministic, zero model calls. */
export const SCRIPTED_INTERVIEWER_MODEL_ID = 'scripted-reference-interviewer@1' as const;

const KIND_PHRASING: Readonly<Record<string, string>> = Object.freeze({
  'capability-probe': 'Please state your proficiency level for the following capability',
  'experience-probe': 'Please state your years of hands-on experience with',
  'evidence-request': 'Please provide a digest-addressed evidence pointer supporting your declared work on',
  'scenario-item': 'Please walk through how you would handle the following scenario for',
});

const TARGET_FALLBACK = 'this interview focus area';

function targetLabel(item: InterviewItem): string {
  if (item.target === undefined) return TARGET_FALLBACK;
  return `${item.target.kind} '${item.target.id}' (v${item.target.version})`;
}

function answerHint(item: InterviewItem): string {
  const expected = item.expected;
  switch (expected.answerKind) {
    case 'proficiency-selection':
      return `Expected answer: one proficiency level of [${expected.allowedLevels.join(', ')}].`;
    case 'years-experience':
      return `Expected answer: an integer number of years between ${expected.minimumYears} and ${expected.maximumYears}.`;
    case 'evidence-pointer':
      return `Expected answer: an evidence pointer of kind [${expected.allowedEvidenceKinds.join(', ')}] with a sha256 content digest.`;
    case 'scenario-response':
      return `Expected answer: a bounded neutral-text response (at most ${expected.maximumLength} characters).`;
    case 'locale-declaration':
      return 'Expected answer: one or more BCP-47-style locale tags.';
    case 'jurisdiction-declaration':
      return 'Expected answer: one or more ISO 3166 country (or country-region) codes.';
    case 'availability-window':
      return `Expected answer: availability windows with recurrence [${expected.requiredRecurrences.join(', ')}] in UTC HH:MM.`;
    case 'privacy-consent':
      return `Expected answer: an explicit consent decision for transcript retention (${expected.retentionDays} days).`;
    default:
      return 'Expected answer: a typed answer matching the item schema.';
  }
}

/**
 * The scripted reference interviewer model: deterministic template
 * phrasing derived ONLY from the typed item + session ordinal. Identical
 * requests render identical questions — the replay guarantee.
 */
export class ScriptedInterviewerModel implements InterviewerModelPort {
  readonly modelId: string = SCRIPTED_INTERVIEWER_MODEL_ID;

  async renderQuestion(request: QuestionRenderRequest): Promise<QuestionRender> {
    const { item, questionNumber, sessionId } = request;
    const phrasing = KIND_PHRASING[item.kind] ?? 'Please respond to the following interview item';
    const question = [
      `[${sessionId}] Question ${questionNumber + 1} (${item.kind})`,
      `${phrasing}: ${targetLabel(item)}.`,
      answerHint(item),
    ].join(' ');
    return { question };
  }
}

/**
 * Wrap one adapter invocation, failing closed with a typed
 * MODEL_ADAPTER_FAILURE error on adapter faults or non-neutral output.
 */
export async function renderQuestionFailClosed(
  port: InterviewerModelPort,
  request: QuestionRenderRequest,
): Promise<string> {
  let render: QuestionRender;
  try {
    render = await port.renderQuestion(request);
  } catch (error) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.MODEL_ADAPTER_FAILURE, {
      message: `interviewer model adapter '${port.modelId}' failed while rendering item ${request.item.itemId}`,
      details: { modelId: port.modelId, itemId: request.item.itemId, cause: error instanceof Error ? error.message : String(error) },
    });
  }
  if (typeof render?.question !== 'string' || !isIntakeNeutralText(render.question)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.MODEL_ADAPTER_FAILURE, {
      message: `interviewer model adapter '${port.modelId}' returned a non-neutral question for item ${request.item.itemId}`,
      details: { modelId: port.modelId, itemId: request.item.itemId },
    });
  }
  return render.question;
}
