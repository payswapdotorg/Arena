/**
 * Shared body-registry view types, guards and tripwires (Work Order
 * A024).
 *
 * The registry's shared vocabularies — content digests, semver versions,
 * body identity, neutral identifiers, timestamps, principals, rights —
 * are the AGENT-BODY (AB1.0) vocabularies: this package reuses
 * @arena/agent-body's OWN validators and pattern sources instead of
 * mirroring them (compatibility by construction — the same policy
 * @arena/body-forge applies). Release-specific vocabularies (channels,
 * tags, record kinds, publication actions, gate reasons) are frozen
 * here and mirrored by the tests.
 *
 * expectFields: strict shape enforcement — every protocol object must
 * carry exactly its declared field set (missing fields AND unknown
 * fields are rejected), mirroring the additionalProperties: false
 * semantics of the sibling packages.
 */

import type {
  AgentBodyName,
  AgentBodyNamespace,
  AgentBodySemver,
  ContentDigest,
  NeutralId,
  PrincipalRefView,
  RightsMetadataView,
  TimestampView,
} from '@arena/agent-body';
import {
  isAgentBodyName,
  isAgentBodyNamespace,
  isAgentBodySemver,
  isContentDigest,
  isNeutralId,
  isPrincipalRefView,
  isRightsMetadataView,
  isTimestampView,
  toPrincipalRefView,
  toRightsMetadataView,
  deepFreeze,
} from '@arena/agent-body';
import { BODY_REGISTRY_ERROR_CODES, BodyRegistryError } from './errors.js';

// ---------------------------------------------------------------------------
// Re-used A003 vocabularies (single source of truth; disclosed)
// ---------------------------------------------------------------------------

export type {
  AgentBodyName,
  AgentBodyNamespace,
  AgentBodySemver,
  ContentDigest,
  NeutralId,
  PrincipalRefView,
  RightsMetadataView,
  TimestampView,
};

/** Digest pattern source (re-used from A003, character-for-character). */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';

/** Neutral-id pattern source (re-used from A003, character-for-character). */
export const BODY_REGISTRY_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

/** Neutral text (printable ASCII; mirrors the sibling pattern sources). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

/** Release tags — lowercase neutral tokens (A002 name charset family). */
export const RELEASE_TAG_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);
const RELEASE_TAG_PATTERN = new RegExp(RELEASE_TAG_PATTERN_SOURCE);

export {
  isAgentBodyName,
  isAgentBodyNamespace,
  isAgentBodySemver,
  isContentDigest,
  isNeutralId,
  isPrincipalRefView,
  isRightsMetadataView,
  isTimestampView,
};

export { toPrincipalRefView, toRightsMetadataView, deepFreeze };

/** Maximum number of tags on one release registration. */
export const MAX_RELEASE_TAGS = 16;

/** Validate a content digest or throw BODY_REGISTRY_INVALID_DIGEST. */
export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate an optional content digest (null passes) or throw. */
export function toOptionalContentDigest(
  value: string | null | undefined,
  context: string,
): ContentDigest | null {
  if (value === null || value === undefined) return null;
  return toContentDigest(value, context);
}

/** Validate a neutral identifier or throw BODY_REGISTRY_INVALID_IDENTITY. */
export function toNeutralId(value: string, context: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid neutral identifier: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: BODY_REGISTRY_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a timestamp (A003 charset) or throw BODY_REGISTRY_INVALID_TIMESTAMP. */
export function toReleaseTimestamp(value: string, context: string): TimestampView {
  if (!isTimestampView(value)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${context}: invalid timestamp: ${JSON.stringify(value)} (canonical ms-precision UTC required)`,
    });
  }
  return value;
}

/** Structural check for neutral text. */
export function isNeutralText(value: unknown): value is string {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

/** Structural check for release tags. */
export function isReleaseTag(value: unknown): value is string {
  return typeof value === 'string' && RELEASE_TAG_PATTERN.test(value);
}

/**
 * Validate a release tag list (closed charset, no duplicates, at most
 * MAX_RELEASE_TAGS) or throw BODY_REGISTRY_INVALID_TAG.
 */
export function toReleaseTags(
  values: readonly string[],
  context: string,
): readonly string[] {
  if (!Array.isArray(values)) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TAG, {
      message: `${context}: tags must be an array of release tags`,
    });
  }
  if (values.length > MAX_RELEASE_TAGS) {
    throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TAG, {
      message: `${context}: at most ${MAX_RELEASE_TAGS} tags are allowed (got ${values.length})`,
      details: { limit: MAX_RELEASE_TAGS, received: values.length },
    });
  }
  const seen = new Set<string>();
  for (const tag of values) {
    if (!isReleaseTag(tag)) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TAG, {
        message: `${context}: invalid release tag: ${JSON.stringify(tag)}`,
        details: { pattern: RELEASE_TAG_PATTERN_SOURCE },
      });
    }
    if (seen.has(tag)) {
      throw new BodyRegistryError(BODY_REGISTRY_ERROR_CODES.INVALID_TAG, {
        message: `${context}: duplicate release tag: ${JSON.stringify(tag)}`,
        details: { tag },
      });
    }
    seen.add(tag);
  }
  return Object.freeze([...values]);
}

/**
 * expectFields: strict closed-shape enforcement — every object must carry
 * exactly its declared field set. `required` fields must be present
 * (own-property, value may be null unless in optional); unknown fields are
 * rejected. Mirrors the learning/certification helper.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: (typeof BODY_REGISTRY_ERROR_CODES)[keyof typeof BODY_REGISTRY_ERROR_CODES],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BodyRegistryError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  for (const field of required) {
    if (!(field in record)) {
      throw new BodyRegistryError(code, {
        message: `${context}: missing required field ${JSON.stringify(field)}`,
        details: { field, required: [...required] },
      });
    }
  }
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new BodyRegistryError(code, {
        message: `${context}: unknown field ${JSON.stringify(key)} (closed shape)`,
        details: { field: key, allowed: [...required, ...optional] },
      });
    }
  }
  return record;
}
