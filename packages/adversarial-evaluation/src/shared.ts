/**
 * Shared primitives for the Arena adversarial expert evaluation domain
 * core (Work Order C013; issue #119; AE1.0).
 *
 * House conventions (mirroring @arena/escalation-validation shared.ts,
 * consumed — never reimplemented — from there):
 *   - branded identifier types validated by strict guards;
 *   - canonical ms-UTC timestamps as strings (NEVER wall-clock reads —
 *     all timestamps are injected by callers, architecture-lock rule 17);
 *   - plain-JSON value discipline;
 *   - deep-freeze helpers so domain objects are immutable in place;
 *   - typed machine-readable outcomes — never a bare boolean.
 */

import type { PlainJsonValue } from '@arena/escalation-validation';
import { isEscalationTimestamp, toEscalationTimestamp } from '@arena/escalation-validation';

export { isEscalationTimestamp, toEscalationTimestamp };
export type { PlainJsonValue };

/**
 * Deep-freeze a (possibly nested) value IN PLACE and return it typed as
 * itself (the house generic form freezes domain objects without widening
 * their types).
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const entry of value) deepFreeze(entry);
      return Object.freeze(value);
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

/** Wire version of every adversarial-evaluation payload shape. */
export const ADVERSARIAL_EVALUATION_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type CompetitionId = string & { readonly __brand: 'CompetitionId' };
export type CompetitionSubmissionId = string & { readonly __brand: 'CompetitionSubmissionId' };
export type ChallengeId = string & { readonly __brand: 'ChallengeId' };
export type ChallengeResponseId = string & { readonly __brand: 'ChallengeResponseId' };
export type JudgmentId = string & { readonly __brand: 'JudgmentId' };
export type CompetitionResultId = string & { readonly __brand: 'CompetitionResultId' };

export const COMPETITION_ID_PATTERN_SOURCE = '^cmp_[0-9a-f]{32}$';
export const COMPETITION_SUBMISSION_ID_PATTERN_SOURCE = '^sub_[0-9a-f]{32}$';
export const CHALLENGE_ID_PATTERN_SOURCE = '^cha_[0-9a-f]{32}$';
export const CHALLENGE_RESPONSE_ID_PATTERN_SOURCE = '^rsp_[0-9a-f]{32}$';
export const JUDGMENT_ID_PATTERN_SOURCE = '^jdg_[0-9a-f]{32}$';
export const COMPETITION_RESULT_ID_PATTERN_SOURCE = '^crs_[0-9a-f]{32}$';

const COMPETITION_ID_RE = new RegExp(COMPETITION_ID_PATTERN_SOURCE);
const COMPETITION_SUBMISSION_ID_RE = new RegExp(COMPETITION_SUBMISSION_ID_PATTERN_SOURCE);
const CHALLENGE_ID_RE = new RegExp(CHALLENGE_ID_PATTERN_SOURCE);
const CHALLENGE_RESPONSE_ID_RE = new RegExp(CHALLENGE_RESPONSE_ID_PATTERN_SOURCE);
const JUDGMENT_ID_RE = new RegExp(JUDGMENT_ID_PATTERN_SOURCE);
const COMPETITION_RESULT_ID_RE = new RegExp(COMPETITION_RESULT_ID_PATTERN_SOURCE);

export function isCompetitionId(value: unknown): value is CompetitionId {
  return typeof value === 'string' && COMPETITION_ID_RE.test(value);
}
export function isCompetitionSubmissionId(value: unknown): value is CompetitionSubmissionId {
  return typeof value === 'string' && COMPETITION_SUBMISSION_ID_RE.test(value);
}
export function isChallengeId(value: unknown): value is ChallengeId {
  return typeof value === 'string' && CHALLENGE_ID_RE.test(value);
}
export function isChallengeResponseId(value: unknown): value is ChallengeResponseId {
  return typeof value === 'string' && CHALLENGE_RESPONSE_ID_RE.test(value);
}
export function isJudgmentId(value: unknown): value is JudgmentId {
  return typeof value === 'string' && JUDGMENT_ID_RE.test(value);
}
export function isCompetitionResultId(value: unknown): value is CompetitionResultId {
  return typeof value === 'string' && COMPETITION_RESULT_ID_RE.test(value);
}

function brand<T extends string>(value: string): T {
  return Object.freeze(value) as T;
}

/** Validate and brand a competition id (cmp_ + 32 lowercase hex). */
export function toCompetitionId(value: string): CompetitionId {
  if (!isCompetitionId(value)) {
    throw new TypeError(
      `invalid competition id: ${JSON.stringify(value)} (expected ${COMPETITION_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<CompetitionId>(value);
}

/** Validate and brand a competition submission id (sub_ + 32 lowercase hex). */
export function toCompetitionSubmissionId(value: string): CompetitionSubmissionId {
  if (!isCompetitionSubmissionId(value)) {
    throw new TypeError(
      `invalid submission id: ${JSON.stringify(value)} (expected ${COMPETITION_SUBMISSION_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<CompetitionSubmissionId>(value);
}

/** Validate and brand a challenge id (cha_ + 32 lowercase hex). */
export function toChallengeId(value: string): ChallengeId {
  if (!isChallengeId(value)) {
    throw new TypeError(
      `invalid challenge id: ${JSON.stringify(value)} (expected ${CHALLENGE_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<ChallengeId>(value);
}

/** Validate and brand a challenge response id (rsp_ + 32 lowercase hex). */
export function toChallengeResponseId(value: string): ChallengeResponseId {
  if (!isChallengeResponseId(value)) {
    throw new TypeError(
      `invalid challenge response id: ${JSON.stringify(value)} (expected ${CHALLENGE_RESPONSE_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<ChallengeResponseId>(value);
}

/** Validate and brand a judgment id (jdg_ + 32 lowercase hex). */
export function toJudgmentId(value: string): JudgmentId {
  if (!isJudgmentId(value)) {
    throw new TypeError(
      `invalid judgment id: ${JSON.stringify(value)} (expected ${JUDGMENT_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<JudgmentId>(value);
}

/** Validate and brand a competition result id (crs_ + 32 lowercase hex). */
export function toCompetitionResultId(value: string): CompetitionResultId {
  if (!isCompetitionResultId(value)) {
    throw new TypeError(
      `invalid competition result id: ${JSON.stringify(value)} (expected ${COMPETITION_RESULT_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<CompetitionResultId>(value);
}

function randomHex32(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

/** Generate a fresh competition id. */
export function newCompetitionId(): CompetitionId {
  return toCompetitionId(`cmp_${randomHex32()}`);
}
/** Generate a fresh competition submission id. */
export function newCompetitionSubmissionId(): CompetitionSubmissionId {
  return toCompetitionSubmissionId(`sub_${randomHex32()}`);
}
/** Generate a fresh challenge id. */
export function newChallengeId(): ChallengeId {
  return toChallengeId(`cha_${randomHex32()}`);
}
/** Generate a fresh challenge response id. */
export function newChallengeResponseId(): ChallengeResponseId {
  return toChallengeResponseId(`rsp_${randomHex32()}`);
}
/** Generate a fresh judgment id. */
export function newJudgmentId(): JudgmentId {
  return toJudgmentId(`jdg_${randomHex32()}`);
}
/** Generate a fresh competition result id. */
export function newCompetitionResultId(): CompetitionResultId {
  return toCompetitionResultId(`crs_${randomHex32()}`);
}

// ---------------------------------------------------------------------------
// Shared value helpers (strict, fail-closed)
// ---------------------------------------------------------------------------

/** A non-empty bounded string (1..4096 chars). */
export function requireBoundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new TypeError(`${field} must be a non-empty string (<= 4096 chars)`);
  }
  return value;
}

/** A frozen non-empty string array. */
export function requireStringArray(values: unknown, field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must be a non-empty string array`);
  }
  for (const value of values) requireBoundedString(value, `${field} entry`);
  return Object.freeze([...values]);
}

/** A finite number in [0, 1] (normalized weights/scores). */
export function requireUnitInterval(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number in [0, 1]`);
  }
  return value;
}

/** A positive integer with an inclusive upper bound. */
export function requirePositiveInt(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${field} must be an integer in [1, ${max}]`);
  }
  return value;
}

/**
 * Strict-shape rejection helper: throws when `value` carries a field
 * outside the CLOSED field list (unknown fields are rejected — a
 * smuggled authority-shaped field can never ride inside a competition
 * payload; lock rules 9/34).
 */
export function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  typeName: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${typeName} rejects unknown field: ${JSON.stringify(key)}`);
    }
  }
}
