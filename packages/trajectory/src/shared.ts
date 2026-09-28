/**
 * Shared trajectory-protocol view types, guards and tripwires (Work Order
 * A011; requirements R10, R11, R24; architecture-lock rule 6 — trajectories
 * are append-only and content-addressed).
 *
 * @arena/trajectory is a domain package whose RUNTIME imports are confined
 * to @arena/protocol-core (canonical JSON + sha256 digests, envelopes,
 * branded identifiers, ProtocolError — reused throughout, never
 * reimplemented). The ONE sibling type it reuses — A009's TaskVersionRef —
 * enters strictly as a TYPE-ONLY import from
 * @arena/environment-protocol (the boundary checker permits domain→domain
 * composition on this base; Work Order A011 gate 8), and its runtime guard
 * lives here, typed against the imported type, exactly like
 * @arena/environment-runtime's shared.ts keeps local mirrors of sibling
 * pattern sources. The pattern sources below are character-for-character
 * copies of the A009/A010 constants; the generated contracts
 * (contracts/trajectory/*.v1.json) and contracts.parity.test.ts keep these
 * copies from drifting.
 *
 * STORAGE NEUTRALITY (Work Order A011 gate 7): the trajectory protocol is
 * storage-neutral — the reference store is an in-process, pure-TypeScript
 * object graph and durable persistence is a deployment-tier concern. This
 * is enforced at the SOURCE level by the hygiene suite (the storage-brand
 * deny-list lives only in hygiene.test.ts, mirroring how A009/A010 keep
 * their deny-lists out of the scanned surface); it is deliberately NOT a
 * runtime tripwire, because action inputs and observation CONTENT are
 * workload data — a trajectory of an agent working on, say, a database
 * task may legitimately mention storage engines, and the protocol must
 * record what actually happened inside the run, not police it.
 *
 * expectFields: strict shape enforcement — every protocol object must
 * carry exactly its declared field set (missing fields AND unknown fields
 * are rejected), mirroring the additionalProperties: false semantics of
 * the generated contracts.
 */

import type { Brand } from '@arena/protocol-core';
import { TRAJECTORY_ERROR_CODES, TrajectoryError } from './errors.js';
import type { TrajectoryErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/environment-protocol /
// @arena/environment-protocol constants they mirror (character-for-
// character). Kept in sync with the generated contracts by
// contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant in A002/A009/A010/A015. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const TRAJECTORY_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors A010's RunTimestamp /
 * A015's JobTimestamp) — ordering inside a trajectory is total and
 * timezone-free.
 */
export const TRAJECTORY_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Deterministic seeds (neutral charset) — mirrors A010's SEED_PATTERN. */
export const SEED_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
/** Task version strings — mirrors A009's TaskVersionRef.version charset. */
export const TASK_VERSION_PATTERN_SOURCE = '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$';
/** Environment namespace / name — mirrors A009's identity charsets. */
export const NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
/** Environment semver — mirrors A009's version charset (no build metadata). */
export const SEMVER_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Error codes carried by error entries (closed, uppercase). */
export const ERROR_CODE_PATTERN_SOURCE = '^[A-Z][A-Z0-9_]{0,127}$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const TRAJECTORY_ID_PATTERN = new RegExp(TRAJECTORY_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(TRAJECTORY_TIMESTAMP_PATTERN_SOURCE);
const SEED_PATTERN = new RegExp(SEED_PATTERN_SOURCE);
const ERROR_CODE_PATTERN = new RegExp(ERROR_CODE_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'TrajectoryContentDigest'>;
export type TrajectoryId = Brand<string, 'TrajectoryIdBrand'>;
export type NeutralId = Brand<string, 'TrajectoryNeutralId'>;
export type TrajectoryTimestamp = Brand<string, 'TrajectoryTimestamp'>;
export type TrajectorySeed = Brand<string, 'TrajectorySeed'>;
export type NeutralText = Brand<string, 'TrajectoryNeutralText'>;
export type ErrorCode = Brand<string, 'TrajectoryErrorCode'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isTrajectoryId(value: unknown): value is TrajectoryId {
  return typeof value === 'string' && TRAJECTORY_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && TRAJECTORY_ID_PATTERN.test(value);
}

export function isTrajectoryTimestamp(value: unknown): value is TrajectoryTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isTrajectorySeed(value: unknown): value is TrajectorySeed {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toTrajectoryId(value: string): TrajectoryId {
  if (!isTrajectoryId(value)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid trajectory id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: TRAJECTORY_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: TRAJECTORY_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toTrajectoryTimestamp(value: string, field: string): TrajectoryTimestamp {
  if (!isTrajectoryTimestamp(value)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid trajectory timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: TRAJECTORY_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toTrajectorySeed(value: string): TrajectorySeed {
  if (!isTrajectorySeed(value)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_HEADER, {
      message: `invalid trajectory seed: ${JSON.stringify(value)} (neutral seed charset required)`,
      details: { pattern: SEED_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toErrorCode(value: string): ErrorCode {
  if (!isErrorCode(value)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD, {
      message: `invalid error entry code: ${JSON.stringify(value)} (uppercase code charset required)`,
      details: { pattern: ERROR_CODE_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strict shape enforcement (additionalProperties: false semantics)
// ---------------------------------------------------------------------------

/**
 * Assert that `value` is a plain object carrying every REQUIRED field and
 * no field outside required ∪ optional. Missing required fields and
 * unknown fields are both rejected with the given error code — the runtime
 * twin of the generated contracts' additionalProperties: false.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: TrajectoryErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TrajectoryError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new TrajectoryError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new TrajectoryError(code, {
        message: `${context}: unknown field '${key}' (strict shape; additionalProperties are rejected)`,
        details: { field: key, allowed },
      });
    }
  }
  return record;
}

/** Validate a required positive integer field already read from a record. */
export function expectPositiveInteger(
  value: unknown,
  field: string,
  code: TrajectoryErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TrajectoryError(code, {
      message: `${context}: ${field} must be a positive integer, got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a member of a closed enum (string union). */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: TrajectoryErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new TrajectoryError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

/** Validate a JSON-value field: anything @arena/protocol-core's canonical
 * JSON can serialize (the digest pipeline rejects the rest at compute
 * time; this guard front-runs it with a typed trajectory error). */
export function expectCanonicalJsonValue(
  value: unknown,
  field: string,
  context: string,
): unknown {
  if (value === undefined) {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_PAYLOAD, {
      message: `${context}: ${field} must be a canonical JSON value (undefined is not representable)`,
      details: { field },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deep freeze (Work Order A011 gate 10 — domain objects are immutable)
// ---------------------------------------------------------------------------

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
