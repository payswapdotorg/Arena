/**
 * Internal strict-shape helpers for @arena/capability-learning — the
 * house expectFields/expectEnumMember pattern, typed to THIS package's
 * error taxonomy (the @arena/learning helpers are typed to LearningError
 * codes; strict shape must throw CapabilityLearningError here).
 *
 * Pure validators and branded types are consumed from @arena/learning
 * (the REAL vocabulary — never redefined).
 */

import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import type { CapabilityLearningErrorCode } from './errors.js';

/**
 * Enforce a strict field shape: every required field present, no
 * unknown fields (additionalProperties rejected). Returns the record
 * for field-by-field extraction.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: CapabilityLearningErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CapabilityLearningError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new CapabilityLearningError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CapabilityLearningError(code, {
        message: `${context}: unknown field '${key}' (strict shape; additionalProperties are rejected)`,
        details: { field: key, allowed },
      });
    }
  }
  return record;
}

/** Validate a member of a closed enum (string union). */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: CapabilityLearningErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new CapabilityLearningError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

/** Exported for test parity with the error-code surface. */
export const STRICT_SHAPE_HELPER_CODES = Object.freeze([
  CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT,
  CAPABILITY_LEARNING_ERROR_CODES.INVALID_CANDIDATE,
  CAPABILITY_LEARNING_ERROR_CODES.INVALID_PROGRAM,
] as const);
