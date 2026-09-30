/**
 * @arena/body-structural-engineer — shared identity, vocabularies and
 * errors for the reference Structural Engineer Agent Body (A029).
 *
 * This package is a CONTENT package: it declares the reference body as
 * typed, content-addressed protocol data over @arena/body-forge and
 * @arena/agent-body. It contains NO runtime tool implementations —
 * the tool/skill/knowledge/procedure surface is expressed as typed
 * protocol objects (surface descriptors) that project onto
 * VersionedArtifactRef entries of the BodyManifest.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { ContentDigest } from '@arena/agent-body';

/** Tenant that owns the reference body. */
export const STRUCTURAL_ENGINEER_BODY_TENANT = 'arena-reference' as const;

/** Stable body name (AgentBodyIdentity.name). */
export const STRUCTURAL_ENGINEER_BODY_NAME = 'structural-engineer' as const;

/** The reference body identity ({tenant, name}). */
export const STRUCTURAL_ENGINEER_BODY_IDENTITY = Object.freeze({
  tenant: STRUCTURAL_ENGINEER_BODY_TENANT,
  name: STRUCTURAL_ENGINEER_BODY_NAME,
});

/** Artifact namespace under which this body's owned surface artifacts are content-addressed. */
export const STRUCTURAL_ENGINEER_SURFACE_NAMESPACE = 'structural-engineer-body' as const;

/** Neutral id of the reference BodyManifest artifact. */
export const STRUCTURAL_ENGINEER_MANIFEST_ID = 'manifest-structural-engineer-body' as const;

/** Fixed, caller-supplied provenance timestamps (no hidden clock reads). */
export const STRUCTURAL_ENGINEER_AUTHORED_AT = '2026-10-02T08:00:00.000Z' as const;
export const STRUCTURAL_ENGINEER_FORGED_AT = '2026-10-02T08:00:01.000Z' as const;
export const STRUCTURAL_ENGINEER_BODY_CREATED_AT = '2026-10-02T08:00:00.000Z' as const;

/** Fixed forge recipe identifiers (deterministic replays). */
export const STRUCTURAL_ENGINEER_FORGE_CORRELATION_ID = 'corr-struct-body-forge-0001' as const;
export const STRUCTURAL_ENGINEER_FORGE_KEY = 'forge-key-struct-body-0001' as const;
export const STRUCTURAL_ENGINEER_FORGE_PRINCIPAL_ID = 'arena-body-forge-fabric' as const;

/** Error codes for this package's thin declaration surface. */
export const STRUCTURAL_ENGINEER_BODY_ERROR_CODES = Object.freeze({
  INVALID_SURFACE_ARTIFACT: 'STRUCTURAL_ENGINEER_BODY_INVALID_SURFACE_ARTIFACT',
  INVALID_CAPABILITY_DECLARATION: 'STRUCTURAL_ENGINEER_BODY_INVALID_CAPABILITY_DECLARATION',
  INVALID_MANIFEST_INPUT: 'STRUCTURAL_ENGINEER_BODY_INVALID_MANIFEST_INPUT',
  INVALID_LINEAGE: 'STRUCTURAL_ENGINEER_BODY_INVALID_LINEAGE',
  UNKNOWN_ERROR: 'STRUCTURAL_ENGINEER_BODY_UNKNOWN_ERROR',
});

export const STRUCTURAL_ENGINEER_BODY_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'versioning',
  'unknown',
] as const);

export type StructuralEngineerBodyErrorCategory =
  (typeof STRUCTURAL_ENGINEER_BODY_ERROR_CATEGORIES)[number];

const CATEGORY_BY_CODE: Readonly<Record<string, StructuralEngineerBodyErrorCategory>> =
  Object.freeze({
    [STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT]: 'validation',
    [STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_CAPABILITY_DECLARATION]: 'validation',
    [STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_MANIFEST_INPUT]: 'validation',
    [STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_LINEAGE]: 'versioning',
    [STRUCTURAL_ENGINEER_BODY_ERROR_CODES.UNKNOWN_ERROR]: 'unknown',
  });

/** Typed error for the body declaration surface. */
export class StructuralEngineerBodyError extends Error {
  readonly code: string;
  readonly category: StructuralEngineerBodyErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = 'StructuralEngineerBodyError';
    this.code = code;
    this.category = CATEGORY_BY_CODE[code] ?? 'unknown';
    if (details !== undefined) {
      this.details = details;
    }
  }
}

const NEUTRAL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

/** Assert a neutral id (kebab) — mirrors the house pattern source. */
export function assertNeutralId(value: string, field: string): void {
  if (typeof value !== 'string' || !NEUTRAL_ID_PATTERN.test(value)) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT,
      `${field} must match ${NEUTRAL_ID_PATTERN.source} (got: ${String(value)})`,
      { field },
    );
  }
}

/** Assert a semver without build metadata. */
export function assertSemver(value: string, field: string): void {
  if (typeof value !== 'string' || !SEMVER_PATTERN.test(value)) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT,
      `${field} must be semver without build metadata (got: ${String(value)})`,
      { field },
    );
  }
}

/** Assert a non-empty printable description. */
export function assertDescription(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4096) {
    throw new StructuralEngineerBodyError(
      STRUCTURAL_ENGINEER_BODY_ERROR_CODES.INVALID_SURFACE_ARTIFACT,
      `${field} must be a non-empty string of at most 4096 characters`,
      { field },
    );
  }
}

/** Compute the content digest of a digest-free descriptor view. */
export function surfaceDigest(view: unknown): Promise<ContentDigest> {
  return digestCanonical(view) as Promise<ContentDigest>;
}

/** Deep-freeze helper (mirrors the house convention). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (!Object.isFrozen(value)) {
      Object.freeze(value);
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
