/**
 * Escalation result taxonomy (Work Order C001; spec/expert-escalation-api.md
 * ES1.0 "Result types"). A response can be typed as exactly one of the
 * CLOSED eleven-member vocabulary:
 *
 *   Correction · Unblock · Answer · Decision · Solution · Review ·
 *   EvidenceBundle · KnowledgePatch · ToolGapSignal · EvaluationVerdict ·
 *   LearningArtifactRef
 *
 * Every kind carries kind-specific REQUIRED fields (fail-closed guards —
 * a Correction without a corrected payload, or a ToolGapSignal without a
 * missing-tool rationale, can never be constructed). Results are plain
 * frozen JSON; an accepted result is operationally DISTINCT from any
 * reusable learning artifact (architecture-lock rule 31 — reuse requires
 * explicit rights, which LearningArtifactRef makes explicit).
 */

import { ESCALATION_ERROR_CODES, EscalationError } from './errors.js';
import type { EscalationTimestamp, PlainJsonValue } from './shared.js';
import { deepFreeze, isEscalationTimestamp, isPlainJsonValue, isSourceRef, toEscalationTimestamp } from './shared.js';

/** Wire version of the escalation result shapes. */
export const ESCALATION_RESULT_VERSION = 1 as const;

export const ESCALATION_RESULT_KINDS = Object.freeze([
  'correction',
  'unblock',
  'answer',
  'decision',
  'solution',
  'review',
  'evidence-bundle',
  'knowledge-patch',
  'tool-gap-signal',
  'evaluation-verdict',
  'learning-artifact-ref',
] as const);
export type EscalationResultKind = (typeof ESCALATION_RESULT_KINDS)[number];

export function isEscalationResultKind(value: unknown): value is EscalationResultKind {
  return (
    typeof value === 'string' &&
    (ESCALATION_RESULT_KINDS as readonly string[]).includes(value)
  );
}

export const EVALUATION_VERDICTS = Object.freeze(['pass', 'fail', 'inconclusive'] as const);
export type EvaluationVerdictValue = (typeof EVALUATION_VERDICTS)[number];

export interface EscalationResultCommon {
  readonly resultVersion: typeof ESCALATION_RESULT_VERSION;
  readonly kind: EscalationResultKind;
  /** When the expert produced this result (injected, canonical ms-UTC). */
  readonly producedAt: EscalationTimestamp;
  /** Human-readable summary (non-empty). */
  readonly summary: string;
}

export interface CorrectionResult extends EscalationResultCommon {
  readonly kind: 'correction';
  /** Reference to the corrected artifact/step. */
  readonly correctedRef: string;
  /** The corrected payload (plain JSON). */
  readonly replacement: PlainJsonValue;
}

export interface UnblockResult extends EscalationResultCommon {
  readonly kind: 'unblock';
  /** What was blocking, and how it was cleared. */
  readonly blockageRef: string;
  readonly resolution: PlainJsonValue;
}

export interface AnswerResult extends EscalationResultCommon {
  readonly kind: 'answer';
  /** The machine-consumable answer payload. */
  readonly payload: PlainJsonValue;
}

export interface DecisionResult extends EscalationResultCommon {
  readonly kind: 'decision';
  readonly decision: string;
  readonly rationale: string;
  readonly optionsConsidered: readonly string[];
}

export interface SolutionResult extends EscalationResultCommon {
  readonly kind: 'solution';
  /** The solution payload satisfying the request's desired output schema. */
  readonly payload: PlainJsonValue;
  readonly steps: readonly string[];
}

export interface ReviewResult extends EscalationResultCommon {
  readonly kind: 'review';
  readonly verdict: 'approved' | 'changes-requested' | 'rejected';
  readonly findings: readonly string[];
}

export interface EvidenceBundleResult extends EscalationResultCommon {
  readonly kind: 'evidence-bundle';
  readonly evidenceRefs: readonly string[];
}

export interface KnowledgePatchResult extends EscalationResultCommon {
  readonly kind: 'knowledge-patch';
  /** Scoped domain rule / knowledge statement. */
  readonly statement: string;
  readonly scope: string;
}

export interface ToolGapSignalResult extends EscalationResultCommon {
  readonly kind: 'tool-gap-signal';
  /** The capability that is missing as a tool. */
  readonly missingToolId: string;
  readonly rationale: string;
}

export interface EvaluationVerdictResult extends EscalationResultCommon {
  readonly kind: 'evaluation-verdict';
  readonly verdict: EvaluationVerdictValue;
  readonly subjectRef: string;
}

export interface LearningArtifactRefResult extends EscalationResultCommon {
  readonly kind: 'learning-artifact-ref';
  /** Reference to the separately-authorized learning artifact. */
  readonly artifactRef: string;
  /** Provenance of the artifact (required — lock rule 31). */
  readonly provenance: string;
}

export type EscalationResult =
  | CorrectionResult
  | UnblockResult
  | AnswerResult
  | DecisionResult
  | SolutionResult
  | ReviewResult
  | EvidenceBundleResult
  | KnowledgePatchResult
  | ToolGapSignalResult
  | EvaluationVerdictResult
  | LearningArtifactRefResult;

export interface CreateEscalationResultInput {
  readonly kind: string;
  readonly producedAt: number | string | Date;
  readonly summary: string;
  readonly correctedRef?: string;
  readonly replacement?: unknown;
  readonly blockageRef?: string;
  readonly resolution?: unknown;
  readonly payload?: unknown;
  readonly decision?: string;
  readonly rationale?: string;
  readonly optionsConsidered?: readonly string[];
  readonly verdict?: string;
  readonly findings?: readonly string[];
  readonly evidenceRefs?: readonly string[];
  readonly statement?: string;
  readonly scope?: string;
  readonly missingToolId?: string;
  readonly subjectRef?: string;
  readonly artifactRef?: string;
  readonly provenance?: string;
  readonly steps?: readonly string[];
}

function requirePlainJson(value: unknown, field: string): PlainJsonValue {
  if (!isPlainJsonValue(value)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a plain-JSON value`,
    });
  }
  return deepFreeze(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a non-empty string (<= 4096 chars)`,
    });
  }
  return value;
}

function requireSourceRef(value: unknown, field: string): string {
  if (!isSourceRef(value)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a valid reference`,
    });
  }
  return value;
}

function requireStringArray(values: unknown, field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
      message: `${field} must be a non-empty string array`,
    });
  }
  for (const value of values) requireString(value, `${field} entry`);
  return Object.freeze([...values]);
}

/** Create and freeze a typed escalation result (strict, fail-closed). */
export function createEscalationResult(input: CreateEscalationResultInput): EscalationResult {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
      message: 'escalation result input must be an object',
    });
  }
  if (!isEscalationResultKind(input.kind)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
      message: `escalation result kind is not in the closed vocabulary: ${JSON.stringify(input.kind)}`,
      details: { vocabulary: ESCALATION_RESULT_KINDS },
    });
  }
  const producedAt = toEscalationTimestamp(input.producedAt);
  const summary = requireString(input.summary, 'summary');
  const common = { resultVersion: ESCALATION_RESULT_VERSION, producedAt, summary };

  switch (input.kind) {
    case 'correction':
      return Object.freeze({
        ...common,
        kind: 'correction',
        correctedRef: requireSourceRef(input.correctedRef, 'correctedRef'),
        replacement: requirePlainJson(input.replacement, 'replacement'),
      });
    case 'unblock':
      return Object.freeze({
        ...common,
        kind: 'unblock',
        blockageRef: requireSourceRef(input.blockageRef, 'blockageRef'),
        resolution: requirePlainJson(input.resolution, 'resolution'),
      });
    case 'answer':
      return Object.freeze({
        ...common,
        kind: 'answer',
        payload: requirePlainJson(input.payload, 'payload'),
      });
    case 'decision':
      return Object.freeze({
        ...common,
        kind: 'decision',
        decision: requireString(input.decision, 'decision'),
        rationale: requireString(input.rationale, 'rationale'),
        optionsConsidered: requireStringArray(input.optionsConsidered, 'optionsConsidered'),
      });
    case 'solution':
      return Object.freeze({
        ...common,
        kind: 'solution',
        payload: requirePlainJson(input.payload, 'payload'),
        steps: requireStringArray(input.steps, 'steps'),
      });
    case 'review':
      if (
        input.verdict !== 'approved' &&
        input.verdict !== 'changes-requested' &&
        input.verdict !== 'rejected'
      ) {
        throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
          message: `review verdict must be approved | changes-requested | rejected: ${JSON.stringify(input.verdict)}`,
        });
      }
      return Object.freeze({
        ...common,
        kind: 'review',
        verdict: input.verdict,
        findings: requireStringArray(input.findings, 'findings'),
      });
    case 'evidence-bundle':
      return Object.freeze({
        ...common,
        kind: 'evidence-bundle',
        evidenceRefs: requireStringArray(input.evidenceRefs, 'evidenceRefs'),
      });
    case 'knowledge-patch':
      return Object.freeze({
        ...common,
        kind: 'knowledge-patch',
        statement: requireString(input.statement, 'statement'),
        scope: requireString(input.scope, 'scope'),
      });
    case 'tool-gap-signal':
      return Object.freeze({
        ...common,
        kind: 'tool-gap-signal',
        missingToolId: requireSourceRef(input.missingToolId, 'missingToolId'),
        rationale: requireString(input.rationale, 'rationale'),
      });
    case 'evaluation-verdict':
      if (!EVALUATION_VERDICTS.includes(input.verdict as EvaluationVerdictValue)) {
        throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_RESULT, {
          message: `evaluation verdict must be pass | fail | inconclusive: ${JSON.stringify(input.verdict)}`,
        });
      }
      return Object.freeze({
        ...common,
        kind: 'evaluation-verdict',
        verdict: input.verdict as EvaluationVerdictValue,
        subjectRef: requireSourceRef(input.subjectRef, 'subjectRef'),
      });
    case 'learning-artifact-ref':
      return Object.freeze({
        ...common,
        kind: 'learning-artifact-ref',
        artifactRef: requireSourceRef(input.artifactRef, 'artifactRef'),
        provenance: requireString(input.provenance, 'provenance'),
      });
  }
}

/** Structural guard for wire values claiming to be escalation results. */
export function isEscalationResult(value: unknown): value is EscalationResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['resultVersion'] === ESCALATION_RESULT_VERSION &&
    isEscalationResultKind(candidate['kind']) &&
    isEscalationTimestamp(candidate['producedAt']) &&
    typeof candidate['summary'] === 'string' &&
    candidate['summary'].length > 0
  );
}
