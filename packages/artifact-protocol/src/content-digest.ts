/**
 * ContentDigest — the sha256 content address of a material artifact
 * (architecture-lock rules 5, 18).
 *
 * Digests are computed by @arena/protocol-core's canonical JSON + sha256
 * primitives (digestCanonical / canonicalJson) — this package NEVER
 * reimplements hashing or canonical serialization. The brand below only
 * marks the digest string type; every digest value is lowercase 64-char hex.
 */

import type { Brand } from '@arena/protocol-core';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';

export type ContentDigest = Brand<string, 'ContentDigest'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';

const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

/** Validate and brand a sha256 hex digest; throws ARTIFACT_INVALID_DIGEST otherwise. */
export function toContentDigest(value: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}
