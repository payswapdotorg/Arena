/**
 * Session completion contract (Work Order C006; spec
 * expert-environment-session.md EES1.0 "Session completion").
 *
 * The expert submits: result; evidence; annotations; corrections;
 * optional knowledge artifacts; optional tool-gap signals; and a
 * consent/rights statement for reusable learning. The session then
 * enters Arena validation (the C001 escalation moves in_progress →
 * submitted and the result hands to C001 validation).
 *
 * Fail-closed gates:
 *   - the consent/rights statement is REQUIRED on every submission
 *     (an absent statement can never be constructed);
 *   - knowledge artifacts require GRANTED consent (lock rule 31);
 *   - evidence and annotations are non-empty structured collections;
 *   - corrections reference the artifact/step they correct.
 */

import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { KnowledgeArtifact } from './knowledge.js';
import { isKnowledgeArtifact } from './knowledge.js';
import type { ToolGapSignal } from './toolgap.js';
import { isToolGapSignal } from './toolgap.js';
import type { ExpertSessionId, ExpertSessionTimestamp, PlainJsonValue } from './shared.js';
import {
  deepFreeze,
  isExpertSessionId,
  isPlainJsonValue,
  toExpertSessionTimestamp,
} from './shared.js';

/** Wire version of the session submission shape. */
export const EXPERT_SESSION_SUBMISSION_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Evidence / annotation / correction
// ---------------------------------------------------------------------------

/** One evidence reference (provenance-addressable — lock rule 18). */
export interface EvidenceRef {
  readonly kind: 'event-ref' | 'artifact-ref' | 'capsule-resource-ref';
  readonly ref: string;
}

/** One structured expert annotation (observable work, not hidden reasoning). */
export interface Annotation {
  readonly subjectRef: string;
  readonly note: string;
}

/** One expert correction of an artifact/step inside the capsule. */
export interface Correction {
  readonly correctedRef: string;
  readonly replacement: PlainJsonValue;
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface ExpertSessionSubmission {
  readonly submissionVersion: typeof EXPERT_SESSION_SUBMISSION_VERSION;
  readonly sessionId: ExpertSessionId;
  /** The machine-consumable result payload. */
  readonly result: PlainJsonValue;
  /** Evidence backing the result (non-empty). */
  readonly evidence: readonly EvidenceRef[];
  /** Structured annotations (may be empty). */
  readonly annotations: readonly Annotation[];
  /** Corrections applied inside the capsule (may be empty). */
  readonly corrections: readonly Correction[];
  /** Optional knowledge artifacts (four tiers; consent-gated). */
  readonly knowledgeArtifacts?: readonly KnowledgeArtifact[];
  /** Optional tool-gap signals (full EES1.0 field set). */
  readonly toolGapSignals?: readonly ToolGapSignal[];
  /** Consent/rights statement for reusable learning (REQUIRED). */
  readonly consentRightsStatement: { readonly granted: boolean; readonly statement: string };
  readonly submittedAt: ExpertSessionTimestamp;
}

export interface CreateSessionSubmissionInput {
  readonly sessionId: string;
  readonly result: unknown;
  readonly evidence: readonly { kind: string; ref: string }[];
  readonly annotations?: readonly { subjectRef: string; note: string }[];
  readonly corrections?: readonly { correctedRef: string; replacement: unknown }[];
  readonly knowledgeArtifacts?: readonly KnowledgeArtifact[];
  readonly toolGapSignals?: readonly ToolGapSignal[];
  readonly consentRightsStatement: { granted: boolean; statement: string };
  readonly now: number | string | Date;
}

const EVIDENCE_KINDS = Object.freeze(['event-ref', 'artifact-ref', 'capsule-resource-ref'] as const);

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: `${field} must be a non-empty string (<= 512 chars): ${JSON.stringify(value)}`,
    });
  }
  return value;
}

/** Create a validated session submission (the EES1.0 completion contract). */
export function createExpertSessionSubmission(input: CreateSessionSubmissionInput): ExpertSessionSubmission {
  if (typeof input !== 'object' || input === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'session submission input must be an object',
    });
  }
  if (!isExpertSessionId(input.sessionId)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: `sessionId is invalid: ${JSON.stringify(input.sessionId)}`,
    });
  }
  if (!isPlainJsonValue(input.result)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'result must be a plain-JSON value',
    });
  }
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'evidence is required — a submission without evidence cannot enter validation',
    });
  }
  const evidence = Object.freeze(
    input.evidence.map((entry) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !(EVIDENCE_KINDS as readonly string[]).includes(String(entry.kind)) ||
        typeof entry.ref !== 'string' ||
        entry.ref.length === 0
      ) {
        throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
          message: `evidence entry is invalid: ${JSON.stringify(entry)}`,
        });
      }
      return Object.freeze({ kind: entry.kind, ref: entry.ref });
    }),
  );

  const annotations = Object.freeze(
    (input.annotations ?? []).map((entry) => {
      requireNonEmptyString(entry?.subjectRef, 'annotations.subjectRef');
      if (typeof entry?.note !== 'string' || entry.note.length === 0 || entry.note.length > 4096) {
        throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
          message: 'annotations.note must be a non-empty string (<= 4096 chars)',
        });
      }
      return Object.freeze({ subjectRef: entry.subjectRef, note: entry.note });
    }),
  );

  const corrections = Object.freeze(
    (input.corrections ?? []).map((entry) => {
      requireNonEmptyString(entry?.correctedRef, 'corrections.correctedRef');
      if (!isPlainJsonValue(entry?.replacement)) {
        throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
          message: 'corrections.replacement must be a plain-JSON value',
        });
      }
      return Object.freeze({ correctedRef: entry.correctedRef, replacement: entry.replacement });
    }),
  );

  const consent = input.consentRightsStatement;
  if (
    typeof consent !== 'object' ||
    consent === null ||
    typeof consent.granted !== 'boolean' ||
    typeof consent.statement !== 'string' ||
    consent.statement.length === 0 ||
    consent.statement.length > 4096
  ) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'consentRightsStatement { granted, statement } is REQUIRED on every session submission (EES1.0)',
    });
  }

  const knowledgeArtifacts = input.knowledgeArtifacts ?? [];
  if (!Array.isArray(knowledgeArtifacts)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'knowledgeArtifacts must be an array',
    });
  }
  for (const artifact of knowledgeArtifacts) {
    if (!isKnowledgeArtifact(artifact)) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
        message: `knowledgeArtifacts entry is invalid: ${JSON.stringify(artifact)}`,
      });
    }
    if (artifact.provenance.sessionId !== input.sessionId) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
        message: 'knowledge artifacts must originate from the submitting session',
      });
    }
  }
  if (knowledgeArtifacts.length > 0 && !consent.granted) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'knowledge artifacts require GRANTED consent (architecture-lock rule 31 — reuse requires explicit rights)',
    });
  }

  const toolGapSignals = input.toolGapSignals ?? [];
  if (!Array.isArray(toolGapSignals)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'toolGapSignals must be an array',
    });
  }
  for (const signal of toolGapSignals) {
    if (!isToolGapSignal(signal) || signal.sessionId !== input.sessionId) {
      throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
        message: `toolGapSignals entry is invalid or belongs to another session: ${JSON.stringify(signal?.sessionId)}`,
      });
    }
  }

  const submission: ExpertSessionSubmission = Object.freeze({
    submissionVersion: EXPERT_SESSION_SUBMISSION_VERSION,
    sessionId: input.sessionId,
    result: deepFreeze(input.result),
    evidence,
    annotations,
    corrections,
    ...(knowledgeArtifacts.length > 0 ? { knowledgeArtifacts: Object.freeze([...knowledgeArtifacts]) } : {}),
    ...(toolGapSignals.length > 0 ? { toolGapSignals: Object.freeze([...toolGapSignals]) } : {}),
    consentRightsStatement: Object.freeze({ granted: consent.granted, statement: consent.statement }),
    submittedAt: toExpertSessionTimestamp(input.now),
  });
  return submission;
}

/** Structural guard for wire values claiming to be session submissions. */
export function isExpertSessionSubmission(value: unknown): value is ExpertSessionSubmission {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['submissionVersion'] === EXPERT_SESSION_SUBMISSION_VERSION &&
    isExpertSessionId(candidate['sessionId']) &&
    isPlainJsonValue(candidate['result']) &&
    Array.isArray(candidate['evidence']) &&
    candidate['evidence'].length > 0 &&
    typeof candidate['consentRightsStatement'] === 'object' &&
    candidate['consentRightsStatement'] !== null
  );
}
