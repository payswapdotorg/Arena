/**
 * ArtifactIdentity — the stable, provider-neutral identity of any material
 * artifact (architecture-lock rules 5, 18, 22; docs/architecture.md §15).
 *
 * An identity is (namespace, name, version):
 *   - `namespace` is the tenant scope, or the reserved `public` namespace for
 *     globally shared artifacts (lock rule 11: customer data is tenant-scoped;
 *     lock rule 12: public artifacts are explicitly published);
 *   - `name` is the artifact name inside the scope;
 *   - `version` is a semver-compatible version (major.minor.patch with an
 *     optional prerelease; build metadata is REJECTED because it is ignored
 *     by semver precedence and would let two different contents claim the
 *     same precedence rank — content addressing requires exact versions).
 *
 * Identities are pure data: creation validates and brands the parts, and no
 * mutation API exists anywhere in this package (immutability is enforced at
 * the artifact level — see artifact.ts — where identity + content digest are
 * frozen together).
 */

import type { Brand } from '@arena/protocol-core';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';

export type ArtifactNamespace = Brand<string, 'ArtifactNamespace'>;
export type ArtifactName = Brand<string, 'ArtifactName'>;
export type ArtifactVersion = Brand<string, 'ArtifactVersion'>;

/** The reserved namespace for explicitly published, globally shared artifacts. */
export const PUBLIC_NAMESPACE = 'public' as const;

/** Exact pattern source; kept in sync with the generated contracts. */
export const ARTIFACT_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';

/** Exact pattern source; kept in sync with the generated contracts. */
export const ARTIFACT_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';

/**
 * Exact pattern source (kept in sync with the generated contracts):
 * semver 2.0.0 core with optional prerelease, WITHOUT build metadata.
 */
export const ARTIFACT_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

const NAMESPACE_PATTERN = new RegExp(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(ARTIFACT_NAME_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(ARTIFACT_VERSION_PATTERN_SOURCE);

export interface ArtifactIdentity {
  readonly namespace: ArtifactNamespace;
  readonly name: ArtifactName;
  readonly version: ArtifactVersion;
}

/** String form of an identity: `arena:artifact/<namespace>/<name>@<version>`. */
export const ARTIFACT_IDENTITY_PREFIX = 'arena:artifact';

/** Exact pattern source for the identity string form (mirrors the contracts). */
export const ARTIFACT_IDENTITY_PATTERN_SOURCE =
  '^arena:artifact/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{1,127}@' +
  '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

const IDENTITY_PARSE_PATTERN =
  /^arena:artifact\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,127})@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)$/;

export function isArtifactNamespace(value: unknown): value is ArtifactNamespace {
  return typeof value === 'string' && NAMESPACE_PATTERN.test(value);
}

export function isArtifactName(value: unknown): value is ArtifactName {
  return typeof value === 'string' && NAME_PATTERN.test(value);
}

export function isArtifactVersion(value: unknown): value is ArtifactVersion {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/** Validate and brand a namespace (tenant scope or `public`); throws on invalid input. */
export function toArtifactNamespace(value: string): ArtifactNamespace {
  if (!isArtifactNamespace(value)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid artifact namespace: ${JSON.stringify(value)}`,
      details: { pattern: ARTIFACT_NAMESPACE_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate and brand an artifact name; throws on invalid input. */
export function toArtifactName(value: string): ArtifactName {
  if (!isArtifactName(value)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid artifact name: ${JSON.stringify(value)}`,
      details: { pattern: ARTIFACT_NAME_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate and brand an artifact version; throws on invalid input. */
export function toArtifactVersion(value: string): ArtifactVersion {
  if (!isArtifactVersion(value)) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid artifact version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { pattern: ARTIFACT_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate every part and produce a frozen ArtifactIdentity. */
export function toArtifactIdentity(value: {
  namespace: string;
  name: string;
  version: string;
}): ArtifactIdentity {
  const identity: ArtifactIdentity = Object.freeze({
    namespace: toArtifactNamespace(value.namespace),
    name: toArtifactName(value.name),
    version: toArtifactVersion(value.version),
  });
  return identity;
}

export function isArtifactIdentity(value: unknown): value is ArtifactIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isArtifactNamespace(candidate['namespace']) &&
    isArtifactName(candidate['name']) &&
    isArtifactVersion(candidate['version'])
  );
}

/** Format an identity as its stable string form. */
export function formatArtifactIdentity(identity: ArtifactIdentity): string {
  return `${ARTIFACT_IDENTITY_PREFIX}/${identity.namespace}/${identity.name}@${identity.version}`;
}

/** Strictly parse an identity string form; throws ARTIFACT_INVALID_IDENTITY otherwise. */
export function parseArtifactIdentity(value: string): ArtifactIdentity {
  const match = IDENTITY_PARSE_PATTERN.exec(value);
  if (!match) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid artifact identity string: ${JSON.stringify(value)}`,
      details: { pattern: ARTIFACT_IDENTITY_PATTERN_SOURCE },
    });
  }
  const namespace = match[1];
  const name = match[2];
  const version = match[3];
  if (namespace === undefined || name === undefined || version === undefined) {
    throw new ArtifactError(ARTIFACT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid artifact identity string: ${JSON.stringify(value)}`,
    });
  }
  return toArtifactIdentity({ namespace, name, version });
}

/** True iff both identities have the same namespace, name and version. */
export function isSameIdentity(a: ArtifactIdentity, b: ArtifactIdentity): boolean {
  return a.namespace === b.namespace && a.name === b.name && a.version === b.version;
}

/**
 * Semver 2.0.0 precedence comparison: negative when `a` is lower, positive
 * when `a` is higher, 0 when equal precedence. Build metadata never applies
 * (it is rejected at validation time).
 */
export function compareArtifactVersions(a: ArtifactVersion, b: ArtifactVersion): number {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const aPart = aCore[i] ?? 0;
    const bPart = bCore[i] ?? 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  if (aPre === null && bPre === null) return 0;
  // A version without prerelease has HIGHER precedence than one with.
  if (aPre === null) return 1;
  if (bPre === null) return -1;
  return comparePrerelease(aPre, bPre);
}

function splitVersion(version: ArtifactVersion): [number[], string[] | null] {
  const [core, prerelease] = version.split('-', 2) as [string, string | undefined];
  const coreParts = core.split('.').map((part) => Number.parseInt(part, 10));
  if (prerelease === undefined) return [coreParts, null];
  return [coreParts, prerelease.split('.')];
}

function comparePrerelease(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const aPart = a[i];
    const bPart = b[i];
    if (aPart === undefined) return -1; // shorter set of fields sorts lower
    if (bPart === undefined) return 1;
    const aNum = /^\d+$/.test(aPart) ? Number.parseInt(aPart, 10) : null;
    const bNum = /^\d+$/.test(bPart) ? Number.parseInt(bPart, 10) : null;
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
      continue;
    }
    if (aNum !== null) return -1; // numeric identifiers sort lower than alphanumeric
    if (bNum !== null) return 1;
    if (aPart < bPart) return -1;
    if (aPart > bPart) return 1;
  }
  return 0;
}
