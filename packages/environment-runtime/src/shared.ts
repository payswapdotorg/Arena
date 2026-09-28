/**
 * Shared environment-runtime value types, guards and tripwires (Work
 * Order A010).
 *
 * @arena/environment-runtime is a DOMAIN package. Its RUNTIME imports are
 * confined to @arena/protocol-core (envelopes, canonical JSON, digests,
 * branded identifiers, ProtocolError) — the sibling domain types it
 * reuses (A009 isolation envelopes / version refs, A015 job ids) enter
 * strictly as TYPE-ONLY imports (Work Order A010 gate 12; the boundary
 * checker permits domain→domain composition on this base). The runtime
 * guards for those shapes are therefore defined HERE against the
 * imported types, mirroring how every sibling domain package keeps its
 * own shared.ts: the pattern sources below are character-for-character
 * copies of the A009/A015 constants, and contracts.parity.test.ts plus
 * the committed contracts keep them from drifting.
 *
 * This module also hosts the protocol-neutral tripwires shared by every
 * constructor in this package (mirroring @arena/environment-protocol's
 * shared.ts, whose functions cannot be runtime-imported here):
 *   - assertRuntimeNeutralString / assertRuntimeNeutralTree: runner and
 *     provider-specific strings never enter canonical or digested
 *     objects (Work Order A010 gate 13 — the runtime protocol is
 *     runtime-neutral by construction);
 *   - assertNoSecretMaterialFields: secret VALUES never enter canonical
 *     objects — runs declare injection points by reference only;
 *   - expectFields: strict shape enforcement (additionalProperties:
 *     false semantics, the runtime twin of the generated contracts).
 */

import type { Brand } from '@arena/protocol-core';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import type { EnvironmentRuntimeErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/environment-protocol /
// @arena/job-protocol constants (character-for-character). Kept in sync
// with the generated contracts by contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Tenant namespace (mirrors the environment/job namespace charset). */
export const TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
/**
 * Run key: the tenant-local half of a run id. Uses A009's neutral-id
 * charset so the run key is exactly what A009's RunAddress.runId
 * addresses (the evidence address is tenant-local; the tenant scope is
 * bound by the RunRecord, whose digest includes the tenant id).
 */
export const RUN_KEY_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Full tenant-scoped run id: `<tenant>/<run-key>`. */
export const RUN_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{0,63}$';
/** Content digests (sha256 hex) — identical constant in A002/A009/A015. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Canonical ms-precision UTC timestamps (mirrors A015 JobTimestamp). */
export const RUN_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Deterministic seeds (neutral charset, no runner/provider tokens). */
export const SEED_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';

const TENANT_PATTERN = new RegExp(TENANT_PATTERN_SOURCE);
const RUN_KEY_PATTERN = new RegExp(RUN_KEY_PATTERN_SOURCE);
const RUN_ID_PATTERN = new RegExp(RUN_ID_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(RUN_TIMESTAMP_PATTERN_SOURCE);
const SEED_PATTERN = new RegExp(SEED_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type TenantId = Brand<string, 'EnvironmentRuntimeTenantId'>;
export type RunKey = Brand<string, 'EnvironmentRuntimeRunKey'>;
export type RunId = Brand<string, 'EnvironmentRuntimeRunId'>;
export type ContentDigest = Brand<string, 'EnvironmentRuntimeContentDigest'>;
export type RunTimestamp = Brand<string, 'EnvironmentRuntimeRunTimestamp'>;
export type RunSeed = Brand<string, 'EnvironmentRuntimeRunSeed'>;

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

export function isRunKey(value: unknown): value is RunKey {
  return typeof value === 'string' && RUN_KEY_PATTERN.test(value);
}

export function isRunId(value: unknown): value is RunId {
  return typeof value === 'string' && RUN_ID_PATTERN.test(value);
}

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isRunTimestamp(value: unknown): value is RunTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function isRunSeed(value: unknown): value is RunSeed {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export function toTenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_TENANT, {
      message: `invalid tenant id: ${JSON.stringify(value)} (lowercase namespace required)`,
      details: { pattern: TENANT_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRunKey(value: string): RunKey {
  if (!isRunKey(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
      message: `invalid run key: ${JSON.stringify(value)}`,
      details: { pattern: RUN_KEY_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRunId(value: string): RunId {
  if (!isRunId(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
      message: `invalid run id: ${JSON.stringify(value)} (expected the tenant-scoped form <tenant>/<run-key>)`,
      details: { pattern: RUN_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toContentDigest(value: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SNAPSHOT_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRunTimestamp(value: string): RunTimestamp {
  if (!isRunTimestamp(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid run timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-01-15T09:30:00.000Z)`,
      details: { pattern: RUN_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRunSeed(value: string): RunSeed {
  if (!isRunSeed(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_SEED, {
      message: `invalid seed: ${JSON.stringify(value)} (neutral identifier charset required)`,
      details: { pattern: SEED_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Current time as a canonical run timestamp (Date#toISOString is always ms UTC). */
export function nowRunTimestamp(): RunTimestamp {
  return new Date().toISOString() as RunTimestamp;
}

// ---------------------------------------------------------------------------
// Runtime neutrality (Work Order A010 gate 13 — the runtime protocol is
// runtime-neutral; no runner/provider-specific strings in canonical or
// digested objects, mirroring A009's tripwires)
// ---------------------------------------------------------------------------

/**
 * Runner / provider tokens that must never appear in canonical or
 * digested environment-runtime objects. Long unambiguous tokens use
 * substring semantics; short tokens use alphanumeric delimiters so that
 * ordinary protocol vocabulary is never matched. Mirrors the A009
 * pattern sources.
 */
export const RUNTIME_NEUTRALITY_SUBSTRING_PATTERN_SOURCE =
  'docker|podman|firecracker|containerd|gvisor|qemu|vmware|virtualbox|hyperv|kubernetes|openstack|nspawn|microvm';
export const RUNTIME_NEUTRALITY_WORD_PATTERN_SOURCE =
  'aws|gcp|azure|k8s|ec2|gce|vm|runc|crun|kvm';

const RUNTIME_SUBSTRING_PATTERN = new RegExp(
  RUNTIME_NEUTRALITY_SUBSTRING_PATTERN_SOURCE,
  'i',
);
const RUNTIME_WORD_PATTERN = new RegExp(
  `(?<![a-z0-9])(?:${RUNTIME_NEUTRALITY_WORD_PATTERN_SOURCE})(?![a-z0-9])`,
  'i',
);

/** True when the value carries a runner/provider-specific token. */
export function containsRuntimeLeak(value: string): boolean {
  return RUNTIME_SUBSTRING_PATTERN.test(value) || RUNTIME_WORD_PATTERN.test(value);
}

/** Reject a string carrying a runner/provider token. */
export function assertRuntimeNeutralString(value: string, field: string): void {
  if (containsRuntimeLeak(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.RUNTIME_LEAKAGE, {
      message: `runner/provider-specific string at ${field} is rejected: the environment runtime protocol is runtime-neutral and addresses the substrate only through content digests`,
      details: { field },
    });
  }
}

/** Recursively assert runtime neutrality over every string in a tree. */
export function assertRuntimeNeutralTree(value: unknown, path = 'value'): void {
  if (typeof value === 'string') {
    assertRuntimeNeutralString(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertRuntimeNeutralTree(item, `${path}[${String(index)}]`),
    );
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertRuntimeNeutralTree(child, `${path}.${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Secret-material guard (secrets never enter canonical objects; runs
// declare injection points by reference only — mirrors A009)
// ---------------------------------------------------------------------------

/** Field names that CARRY secret material when present (exact, case-insensitive). */
const SECRET_FIELD_NAMES = new Set([
  'value',
  'values',
  'secret',
  'secrets',
  'plaintext',
  'material',
  'password',
  'passwd',
  'token',
  'tokens',
  'credential',
  'credentials',
  'apikey',
  'secretvalue',
]);

/** Credential-shaped compounds (substring over the lowercased field name). */
const CREDENTIAL_COMPOUND_PATTERN =
  /api[_-]?key|access[_-]?key|access[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?(value|material|content|data|body|text)|auth[_-]?(token|key|secret)|bearer[_-]?token|refresh[_-]?token/;

function isSecretMaterialFieldName(key: string): boolean {
  const lowered = key.toLowerCase();
  if (SECRET_FIELD_NAMES.has(lowered)) return true;
  return CREDENTIAL_COMPOUND_PATTERN.test(lowered);
}

/**
 * Reject value-carrying / credential-shaped FIELD NAMES anywhere in a
 * declaration input. Secret references (secretId, secretEnvelope) are
 * legitimate protocol vocabulary and never match.
 */
export function assertNoSecretMaterialFields(value: unknown, path = 'value'): void {
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSecretMaterialFields(item, `${path}[${String(index)}]`),
    );
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretMaterialFieldName(key)) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.CREDENTIAL_REJECTED,
        {
          message: `field ${JSON.stringify(key)} at ${path} would carry secret material: secrets never enter canonical environment-runtime objects (spec ENV1.0 Isolation); declare injection points by reference instead`,
          details: { field: key, path },
        },
      );
    }
    assertNoSecretMaterialFields(child, `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Strict shape enforcement (additionalProperties: false semantics)
// ---------------------------------------------------------------------------

/**
 * Assert that `value` is a plain object carrying every REQUIRED field and
 * no field outside required ∪ optional. Missing required fields and
 * unknown fields are both rejected with the given error code.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: EnvironmentRuntimeErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EnvironmentRuntimeError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new EnvironmentRuntimeError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new EnvironmentRuntimeError(code, {
        message: `${context}: unknown field '${key}' (strict shape; additionalProperties are rejected)`,
        details: { field: key, allowed },
      });
    }
  }
  return record;
}

/** Validate a required non-empty integer field already read from a record. */
export function expectPositiveInteger(
  value: unknown,
  field: string,
  code: EnvironmentRuntimeErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new EnvironmentRuntimeError(code, {
      message: `${context}: ${field} must be a positive integer, got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a required boolean field already read from a record. */
export function expectBoolean(
  value: unknown,
  field: string,
  code: EnvironmentRuntimeErrorCode,
  context: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new EnvironmentRuntimeError(code, {
      message: `${context}: ${field} must be a boolean, got: ${String(value)}`,
      details: { field },
    });
  }
  return value;
}

/** Validate a member of a closed enum (string union). */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: EnvironmentRuntimeErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new EnvironmentRuntimeError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Plain-JSON screening (canonical serializability of payloads)
// ---------------------------------------------------------------------------

/** True iff the value is plain JSON (canonically serializable, no undefined). */
export function isPlainJsonValue(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every((item) => isPlainJsonValue(item));
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.values(value).every((item) => isPlainJsonValue(item));
    }
    default:
      return false;
  }
}

/** Fail closed with INVALID_RECORD when a payload is not plain JSON. */
export function assertPlainJson(value: unknown, field: string): void {
  if (!isPlainJsonValue(value)) {
    throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RECORD, {
      message: `${field} must be plain JSON (canonically serializable: no undefined, non-finite numbers, bigints, dates or class instances)`,
      details: { field },
    });
  }
}

// ---------------------------------------------------------------------------
// Deep freeze (Work Order A010 gate 14 — domain objects are immutable)
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
