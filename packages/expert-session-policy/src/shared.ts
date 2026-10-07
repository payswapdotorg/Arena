/**
 * Expert-session-policy shared primitives (Work Order C018) — mirrors the
 * sibling domain packages' discipline (@arena/expert-session shared.ts):
 * ms-precision UTC RFC 3339 timestamps, deep freezing, closed ref-list
 * validation, branded-id coercion via @arena/security's tenant model.
 */

import { toTenantId } from '@arena/security';
import { ExpertSessionPolicyError } from './errors.js';

/** Timestamp pattern: ms-precision UTC RFC 3339 (house wire format). */
export const POLICY_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type PolicyTimestamp = string;

/** Coerce epoch ms / ISO string / Date into the house timestamp form. */
export function toPolicyTimestamp(value: number | string | Date, context: string): PolicyTimestamp {
  let ms: number;
  if (typeof value === 'number') {
    ms = value;
  } else if (value instanceof Date) {
    ms = value.getTime();
  } else {
    ms = Date.parse(value);
  }
  if (!Number.isFinite(ms)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `${context}: must be an epoch-ms number, ISO string or Date`,
      details: { received: JSON.stringify(value) },
    });
  }
  return new Date(ms).toISOString();
}

/** True when the value is already the house timestamp form. */
export function isPolicyTimestamp(value: unknown): value is PolicyTimestamp {
  return typeof value === 'string' && POLICY_TIMESTAMP_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

/** Require the house timestamp form (fail-closed on anything else). */
export function expectPolicyTimestamp(value: unknown, context: string): PolicyTimestamp {
  if (!isPolicyTimestamp(value)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `${context}: must be a ms-precision UTC RFC 3339 timestamp`,
      details: { received: typeof value === 'string' ? value : JSON.stringify(value) },
    });
  }
  return value;
}

/** Pack/subject/authorization identifier pattern (kebab/lowercase). */
export const POLICY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{2,127}$/;

export function expectPolicyId(value: unknown, context: string): string {
  if (typeof value !== 'string' || !POLICY_ID_PATTERN.test(value)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `${context}: must match ${POLICY_ID_PATTERN.source}`,
      details: { received: typeof value === 'string' ? value : JSON.stringify(value) },
    });
  }
  return value;
}

/** Tenant id via @arena/security's typed model (composed, never duplicated). */
export function expectTenantId(value: unknown, context: string): string {
  return String(toTenantId(String(value), context));
}

/** Deep-freeze helper (house discipline: records are frozen at birth). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Validate a list of non-empty bounded strings (resource/tool/action refs). */
export function expectRefList(values: unknown, context: string, max = 512): readonly string[] {
  if (!Array.isArray(values)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `${context}: must be an array of refs`,
    });
  }
  for (const entry of values) {
    if (typeof entry !== 'string' || entry.length === 0 || entry.length > max) {
      throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
        message: `${context}: entries must be non-empty strings (<= ${String(max)} chars)`,
        details: { received: JSON.stringify(entry) },
      });
    }
  }
  return Object.freeze([...values]);
}
