/**
 * Typed intake outcomes (Work Order C003) — the house verdict style,
 * NEVER a bare boolean:
 *
 *   - complete-with-claims   → the structured IntakeProfile proposal
 *                               (registry fields + qualification claim
 *                               candidates with evidence pointers);
 *   - incomplete-with-gap-list → the closed machine-readable gap list
 *                               (which routing inputs are missing and
 *                               why — repairable by resuming the
 *                               interview);
 *   - rejected-with-reasons  → the closed rejection reason list
 *                               (consent denied, PII smuggling detected,
 *                               transcript integrity failure — NOT
 *                               repairable by answering more items).
 *
 * Assessment is PURE over the session (deterministic given the same
 * transcript): no clock reads — `assessedAt` is injected.
 */

import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';
import { answeredEntries, screenFreeText, verifyTranscriptIntegrity } from './session.js';
import type { InterviewSession } from './session.js';
import { buildIntakeProfile } from './profile.js';
import type { IntakeProfile } from './profile.js';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const INTAKE_GAP_REASONS = Object.freeze([
  'privacy-consent-missing',
  'locale-missing',
  'jurisdiction-missing',
  'availability-missing',
  'capability-unanswered',
  'experience-unanswered',
  'evidence-missing',
  'scenario-unanswered',
] as const);
export type IntakeGapReason = (typeof INTAKE_GAP_REASONS)[number];

export const INTAKE_REJECTION_REASONS = Object.freeze([
  'privacy-consent-denied',
  'pii-smuggling-detected',
  'transcript-integrity-failed',
  'empty-transcript',
] as const);
export type IntakeRejectionReason = (typeof INTAKE_REJECTION_REASONS)[number];

export interface IntakeGap {
  readonly reason: IntakeGapReason;
  readonly itemId: string;
  /** The routing input tag the gap starves (inspectability). */
  readonly routingInput: string;
}

export interface IntakeRejection {
  readonly reason: IntakeRejectionReason;
  readonly itemId?: string;
  readonly detail?: string;
}

export type IntakeOutcome =
  | { readonly outcome: 'complete-with-claims'; readonly profile: IntakeProfile }
  | { readonly outcome: 'incomplete-with-gap-list'; readonly gaps: readonly IntakeGap[] }
  | { readonly outcome: 'rejected-with-reasons'; readonly reasons: readonly IntakeRejection[] };

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/**
 * Assess one SUBMITTED interview session into the typed outcome.
 * Deterministic: the same transcript always yields the same outcome.
 * Fails closed when the transcript chain does not verify.
 */
export async function assessInterview(
  session: InterviewSession,
  options: { readonly assessedAt: string },
): Promise<IntakeOutcome> {
  if (session.state !== 'SUBMITTED') {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.LIFECYCLE_CONFLICT, {
      message: `assessment requires a SUBMITTED session (session ${session.sessionId} is ${session.state})`,
      details: { sessionId: session.sessionId, state: session.state },
    });
  }

  const rejections: IntakeRejection[] = [];

  // --- integrity gate (fail closed) -------------------------------------
  try {
    await verifyTranscriptIntegrity(session);
  } catch (error) {
    if (error instanceof ExpertIntakeError && error.code === EXPERT_INTAKE_ERROR_CODES.TAMPERED) {
      rejections.push({
        reason: 'transcript-integrity-failed',
        detail: error.message,
      });
      return { outcome: 'rejected-with-reasons', reasons: Object.freeze([...rejections]) };
    }
    throw error;
  }

  // --- empty transcript ---------------------------------------------------
  if (session.transcript.length === 0) {
    return { outcome: 'rejected-with-reasons', reasons: Object.freeze([{ reason: 'empty-transcript' }]) };
  }

  const answered = answeredEntries(session);

  // --- PII re-screen (defense in depth over the recorded transcript) ------
  for (const { answer } of answered) {
    try {
      if (answer.answerKind === 'scenario-response') screenFreeText(answer.response, 'scenario response');
      if (answer.answerKind === 'evidence-pointer' && answer.description !== undefined) {
        screenFreeText(answer.description, 'evidence description');
      }
    } catch (error) {
      if (error instanceof ExpertIntakeError && error.code === EXPERT_INTAKE_ERROR_CODES.PRIVACY_VIOLATION) {
        rejections.push({ reason: 'pii-smuggling-detected', detail: error.message });
        continue;
      }
      throw error;
    }
  }
  if (rejections.length > 0) {
    return { outcome: 'rejected-with-reasons', reasons: Object.freeze([...rejections]) };
  }


  // --- consent gate (rejection, not gap) ----------------------------------
  const consent = answered.find(({ item }) => item.routingInput === 'privacy');
  if (consent === undefined) {
    // not answered at all → gap (repairable)
  } else if (consent.answer.answerKind === 'privacy-consent') {
    if (!consent.answer.consentGranted || !consent.answer.transcriptRetentionConsent) {
      rejections.push({
        reason: 'privacy-consent-denied',
        itemId: consent.item.itemId,
        detail: 'the expert declined intake consent or transcript retention consent',
      });
    }
  }
  if (rejections.length > 0) {
    return { outcome: 'rejected-with-reasons', reasons: Object.freeze([...rejections]) };
  }

  // --- gap detection (closed reasons, machine-readable) --------------------
  const gaps: IntakeGap[] = [];
  const answeredIds = new Set(answered.map(({ entry }) => entry.itemId));
  for (const item of session.catalog) {
    if (answeredIds.has(item.itemId)) continue;
    const reason: IntakeGapReason | null =
      item.routingInput === 'privacy'
        ? 'privacy-consent-missing'
        : item.routingInput === 'locale'
          ? 'locale-missing'
          : item.routingInput === 'jurisdiction'
            ? 'jurisdiction-missing'
            : item.routingInput === 'availability'
              ? 'availability-missing'
              : item.kind === 'capability-probe'
                ? 'capability-unanswered'
                : item.kind === 'experience-probe'
                  ? 'experience-unanswered'
                  : item.kind === 'evidence-request'
                    ? 'evidence-missing'
                    : 'scenario-unanswered';
    if (reason === null) continue;
    gaps.push({ reason, itemId: item.itemId, routingInput: item.routingInput });
  }

  if (gaps.length > 0) {
    return { outcome: 'incomplete-with-gap-list', gaps: Object.freeze([...gaps]) };
  }

  // --- complete: build the structured profile proposal ---------------------
  const profile = await buildIntakeProfile(session, { assessedAt: options.assessedAt });
  return { outcome: 'complete-with-claims', profile };
}

/** Structural (non-throwing) guard for a typed intake outcome. */
export function isIntakeOutcome(value: unknown): value is IntakeOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['outcome'] === 'complete-with-claims') return typeof candidate['profile'] === 'object';
  if (candidate['outcome'] === 'incomplete-with-gap-list') return Array.isArray(candidate['gaps']);
  if (candidate['outcome'] === 'rejected-with-reasons') return Array.isArray(candidate['reasons']);
  return false;
}
