/**
 * Shared body-forge helpers (Work Order A021).
 *
 * The forge's shared vocabularies — content digests, semver versions,
 * neutral identifiers, timestamps, principals, rights, policy
 * documents, versioned artifact refs — are the AGENT-BODY (AB1.0)
 * vocabularies: this package reuses @arena/agent-body's OWN
 * validators and pattern sources instead of mirroring them, so the
 * manifest/policy/record shapes can never drift from the A003
 * contract they compose into (compatibility by construction, the
 * same policy @arena/skill-extraction applies to its REAL guards).
 *
 * Only forge-specific helpers live here:
 *   - expectFields: closed-shape field checking (learning pattern);
 *   - forge-namespace constants (provenance record addressing);
 *   - provider-neutrality / credential tripwires re-exported from
 *     A003 so every constructor in this package applies them.
 */

import type {
  AgentBodyName,
  AgentBodyNamespace,
  AgentBodySemver,
  ContentDigest,
  NeutralId,
  TimestampView,
} from '@arena/agent-body';
import {
  AGENT_BODY_ID_PATTERN_SOURCE,
  PRINCIPAL_ID_PATTERN_SOURCE,
  isAgentBodyName,
  isAgentBodyNamespace,
  isAgentBodySemver,
  isContentDigest,
  isNeutralId,
  isTimestampView,
} from '@arena/agent-body';
import { BODY_FORGE_ERROR_CODES, BodyForgeError } from './errors.js';

// ---------------------------------------------------------------------------
// Re-used A003 vocabularies (single source of truth; disclosed)
// ---------------------------------------------------------------------------

export type {
  AgentBodyName,
  AgentBodyNamespace,
  AgentBodySemver,
  ContentDigest,
  NeutralId,
  TimestampView,
};

/** Digest pattern source (re-used from A003, character-for-character). */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';

/** Neutral-id pattern source (re-used from A003, character-for-character). */
export const FORGE_ID_PATTERN_SOURCE = AGENT_BODY_ID_PATTERN_SOURCE;

/** Principal-id pattern source (re-used from A003, character-for-character). */
export const FORGE_PRINCIPAL_ID_PATTERN_SOURCE = PRINCIPAL_ID_PATTERN_SOURCE;

const PRINCIPAL_ID_PATTERN = new RegExp(FORGE_PRINCIPAL_ID_PATTERN_SOURCE);

export {
  isAgentBodyName,
  isAgentBodyNamespace,
  isAgentBodySemver,
  isContentDigest,
  isNeutralId,
  isTimestampView,
};

/** Validate a content digest or throw BODY_FORGE_INVALID_DIGEST. */
export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a neutral identifier or throw BODY_FORGE_INVALID_IDENTITY. */
export function toNeutralId(value: string, context: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid neutral identifier: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: FORGE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a forge principal id (A003 principal-id charset) or throw. */
export function isForgePrincipalId(value: unknown): value is string {
  return typeof value === 'string' && PRINCIPAL_ID_PATTERN.test(value);
}

/** Validate a semver version (A003 charset) or throw BODY_FORGE_INVALID_IDENTITY. */
export function toForgeSemver(value: string, context: string): AgentBodySemver {
  if (!isAgentBodySemver(value)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
    });
  }
  return value;
}

/** Validate an ms-precision UTC timestamp (A003 charset) or throw. */
export function toForgeTimestamp(value: string, context: string): TimestampView {
  if (!isTimestampView(value)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${context}: invalid timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision)`,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Forge provenance-record namespace
// ---------------------------------------------------------------------------

/**
 * The artifact namespace under which the forge cites its own
 * content-addressed inputs in a forged BodyVersion's provenance
 * records: the manifest and the policy (A003 VersionedArtifactRef
 * shape: namespace/name@version#digest).
 */
export const FORGE_RECORD_NAMESPACE = 'body-forge';

// ---------------------------------------------------------------------------
// Closed-shape field checking (learning pattern)
// ---------------------------------------------------------------------------

/**
 * Structural field check: every `required` field must be present
 * (own property); when `forbidden` is a non-empty list it acts as a
 * closed-shape rejector (any listed field present ⇒ unknown-field
 * error); when empty, extra fields are allowed (callers validate
 * field-by-field afterwards). Returns the record for field-by-field
 * validation.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  forbidden: readonly string[],
  code: (typeof BODY_FORGE_ERROR_CODES)[keyof typeof BODY_FORGE_ERROR_CODES],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BodyForgeError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  for (const field of required) {
    if (!(field in record) || record[field] === undefined) {
      throw new BodyForgeError(code, {
        message: `${context}: missing required field ${JSON.stringify(field)}`,
        details: { required: [...required] },
      });
    }
  }
  for (const field of forbidden) {
    if (field in record) {
      throw new BodyForgeError(code, {
        message: `${context}: unknown field ${JSON.stringify(field)} (closed shape)`,
        details: { forbidden: [...forbidden] },
      });
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// Deep freeze (A003 semantics)
// ---------------------------------------------------------------------------

/** Recursively freeze a plain-JSON domain object; frozen inputs stay frozen. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** True iff two plain-JSON values are canonical-JSON identical. */
export function canonicallyIdentical(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
