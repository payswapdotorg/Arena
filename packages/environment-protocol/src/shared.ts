/**
 * Shared environment-protocol view types and guards (Work Order A009).
 *
 * @arena/environment-protocol is a domain package whose ONLY workspace
 * import is @arena/protocol-core (protocol layer). The structural
 * components shared with the artifact/agent-body world — tenant-scoped
 * identity namespaces, content digests, semver versions — are defined HERE
 * as validated plain-string view types, exactly like
 * @arena/agent-body's shared.ts (sibling domain packages are not allowed
 * imports of this package; Work Order A009 constraint "imports ONLY
 * @arena/protocol-core").
 *
 * These views are STRUCTURALLY COMPATIBLE with the corresponding
 * @arena/artifact-protocol types (plain strings accept branded strings).
 * The pattern sources below are character-for-character the A002/A003
 * constants; the generated contracts (contracts/environment/*.v1.json) and
 * contracts.parity.test.ts keep this copy from drifting.
 *
 * This module also hosts the three protocol-neutral tripwires shared by
 * every constructor in this package:
 *   - assertRuntimeNeutralString / assertRuntimeNeutralTree: runner and
 *     provider-specific strings (container runtime brands, cloud brands)
 *     never enter canonical or digested objects — the environment protocol
 *     is RUNTIME-NEUTRAL (Work Order A009 gate 10; architecture-lock rule
 *     10). The execution substrate is addressed exclusively through
 *     content digests (the image/build digest), never through a runner
 *     brand.
 *   - assertNoSecretMaterialFields: secret VALUES never enter canonical
 *     objects (spec ENV1.0 Isolation: "secret isolation"). The secret
 *     policy declares injection POINTS (secret references, mount paths,
 *     mechanisms) only — a credential-shaped or value-carrying FIELD NAME
 *     anywhere in a declaration input is rejected. Note the deliberate
 *     difference from @arena/agent-body's broader field scan: this package
 *     has LEGITIMATE reference fields whose names contain the word
 *     "secret" (secretPolicy, secretId), so the guard matches
 *     value-carrying names exactly ("secret", "value", "plaintext",
 *     "password", "token", "credential", ...) and credential-shaped
 *     compounds ("apiKey", "clientSecret", ...), never bare substrings.
 *   - expectFields: strict shape enforcement — every policy object must
 *     carry exactly its declared field set (missing fields AND unknown
 *     fields are rejected), mirroring the additionalProperties: false
 *     semantics of the generated contracts.
 */

import type { Brand } from '@arena/protocol-core';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { EnvironmentErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/artifact-protocol /
// @arena/agent-body constants (character-for-character). Kept in sync with
// the generated contracts by contracts.parity.test.ts.
// ---------------------------------------------------------------------------

export const ENVIRONMENT_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ENVIRONMENT_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const ENVIRONMENT_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const ENVIRONMENT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Absolute filesystem paths used in mounts / injection points. */
export const MOUNT_PATH_PATTERN_SOURCE =
  '^/(?:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)?$';
/** DNS-style hostnames for explicit network egress allows. */
export const HOSTNAME_PATTERN_SOURCE = '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,512}$';

const NAMESPACE_PATTERN = new RegExp(ENVIRONMENT_NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(ENVIRONMENT_NAME_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(ENVIRONMENT_VERSION_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const ID_PATTERN = new RegExp(ENVIRONMENT_ID_PATTERN_SOURCE);
const MOUNT_PATH_PATTERN = new RegExp(MOUNT_PATH_PATTERN_SOURCE);
const HOSTNAME_PATTERN = new RegExp(HOSTNAME_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type EnvironmentNamespace = Brand<string, 'EnvironmentNamespace'>;
export type EnvironmentName = Brand<string, 'EnvironmentName'>;
export type EnvironmentSemver = Brand<string, 'EnvironmentSemver'>;
export type ContentDigest = Brand<string, 'EnvironmentContentDigest'>;
export type NeutralId = Brand<string, 'EnvironmentNeutralId'>;
export type MountPath = Brand<string, 'EnvironmentMountPath'>;
export type Hostname = Brand<string, 'EnvironmentHostname'>;
export type NeutralText = Brand<string, 'EnvironmentNeutralText'>;

export function isEnvironmentNamespace(value: unknown): value is EnvironmentNamespace {
  return typeof value === 'string' && NAMESPACE_PATTERN.test(value);
}

export function isEnvironmentName(value: unknown): value is EnvironmentName {
  return typeof value === 'string' && NAME_PATTERN.test(value);
}

export function isEnvironmentSemver(value: unknown): value is EnvironmentSemver {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function isMountPath(value: unknown): value is MountPath {
  if (typeof value !== 'string' || !MOUNT_PATH_PATTERN.test(value)) return false;
  return value
    .split('/')
    .every((segment) => segment !== '..' && segment !== '.');
}

export function isHostname(value: unknown): value is Hostname {
  return typeof value === 'string' && value.length <= 253 && HOSTNAME_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toEnvironmentNamespace(value: string): EnvironmentNamespace {
  if (!isEnvironmentNamespace(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid environment namespace: ${JSON.stringify(value)}`,
      details: { pattern: ENVIRONMENT_NAMESPACE_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toEnvironmentName(value: string): EnvironmentName {
  if (!isEnvironmentName(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid environment name: ${JSON.stringify(value)}`,
      details: { pattern: ENVIRONMENT_NAME_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toEnvironmentSemver(value: string): EnvironmentSemver {
  if (!isEnvironmentSemver(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid environment version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { pattern: ENVIRONMENT_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toContentDigest(value: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid environment identifier: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: ENVIRONMENT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toMountPath(value: string): MountPath {
  if (!isMountPath(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_FILESYSTEM_POLICY, {
      message: `invalid mount path: ${JSON.stringify(value)} (absolute path, no '.' or '..' segments)`,
      details: { pattern: MOUNT_PATH_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toHostname(value: string): Hostname {
  if (!isHostname(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_NETWORK_POLICY, {
      message: `invalid egress hostname: ${JSON.stringify(value)} (DNS-style hostname required)`,
      details: { pattern: HOSTNAME_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a free-form neutral text; throws the given code (INVALID_DEFINITION by default) on shape errors, RUNTIME_LEAKAGE on runner/provider strings. */
export function toNeutralText(
  value: string,
  field: string,
  code: EnvironmentErrorCode = ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION,
): NeutralText {
  if (!isNeutralText(value)) {
    throw new EnvironmentError(code, {
      message: `invalid text at ${field}: must be 1-512 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  assertRuntimeNeutralString(value, field);
  return value;
}

// ---------------------------------------------------------------------------
// Runtime neutrality (Work Order A009 gate 10 — the protocol is
// runtime-neutral; no runner/provider-specific strings in canonical or
// digested objects)
// ---------------------------------------------------------------------------

/**
 * Runner / provider tokens that must never appear in canonical or digested
 * environment objects. Long unambiguous tokens use substring semantics;
 * short tokens (aws, gcp, k8s, vm, ...) use alphanumeric delimiters so that
 * ordinary protocol vocabulary ("platform", "governs") is never matched.
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

/**
 * Reject a string carrying a runner/provider token. The environment
 * protocol addresses the executable substrate ONLY through content
 * digests; naming a runner brand is an implementation leak.
 */
export function assertRuntimeNeutralString(value: string, field: string): void {
  if (containsRuntimeLeak(value)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.RUNTIME_LEAKAGE, {
      message: `runner/provider-specific string at ${field} is rejected: the environment protocol is runtime-neutral and addresses the substrate only through content digests`,
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
    value.forEach((item, index) => assertRuntimeNeutralTree(item, `${path}[${String(index)}]`));
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertRuntimeNeutralTree(child, `${path}.${key}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Secret-material guard (spec ENV1.0 Isolation: secrets never enter
// canonical objects; Work Order A009 gate 6)
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
 * declaration input. Secret references (secretId, secretPolicy) are
 * legitimate protocol vocabulary and never match.
 */
export function assertNoSecretMaterialFields(value: unknown, path = 'value'): void {
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretMaterialFields(item, `${path}[${String(index)}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretMaterialFieldName(key)) {
      throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.CREDENTIAL_REJECTED, {
        message: `field ${JSON.stringify(key)} at ${path} would carry secret material: secrets never enter canonical environment objects (spec ENV1.0 Isolation); declare injection points by reference instead`,
        details: { field: key, path },
      });
    }
    assertNoSecretMaterialFields(child, `${path}.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Strict shape enforcement (additionalProperties: false semantics)
// ---------------------------------------------------------------------------

/**
 * Assert that `value` is a plain object carrying every REQUIRED field and
 * no field outside required ∪ optional. Missing required fields and unknown
 * fields are both rejected with the given error code — this is the runtime
 * twin of the generated contracts' additionalProperties: false (optional
 * fields may be absent, and are read conditionally by the caller).
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: EnvironmentErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EnvironmentError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new EnvironmentError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new EnvironmentError(code, {
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
  code: EnvironmentErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new EnvironmentError(code, {
      message: `${context}: ${field} must be a positive integer (bounded quota), got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a required boolean field already read from a record. */
export function expectBoolean(
  value: unknown,
  field: string,
  code: EnvironmentErrorCode,
  context: string,
): boolean {
  if (typeof value !== 'boolean') {
    throw new EnvironmentError(code, {
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
  code: EnvironmentErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new EnvironmentError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Deep freeze (Work Order A009 gate 12 — domain objects are immutable)
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
