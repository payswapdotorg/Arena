/**
 * Possession — the immutable, digest-bearing binding
 * (spec AB1.0; architecture-lock rules 3, 22; requirements R2, R45).
 *
 * A Possession binds:
 *
 *   BodyVersion + CognitiveSubstrate + RuntimeProfile + EnvironmentProfile
 *   + PolicyBundle + optional ModelSpecificArtifacts
 *
 * into ONE content-addressed object: the sha256 `digest` is computed over
 * the canonical JSON of the digest-free view (digestCanonical from
 * @arena/protocol-core — never reimplemented). Because the full body
 * version and substrate are embedded, the possession digest transitively
 * commits to the exact bytes of both — a Possession is a VERSIONED BINDING,
 * not an alias for the model (lock rule 3): changing ANY component
 * (substrate upgrade, runtime tweak, policy change, artifact change)
 * produces a DIFFERENT possession digest, i.e. a new possession version.
 *
 * Model-specific artifacts (lock rule 22: they may exist but cannot
 * silently redefine Body identity):
 *   - each artifact is VERSIONED and content-addressed (id + semver +
 *     sha256 digest + materiality flag);
 *   - the same artifactId+artifactVersion can never be re-registered with a
 *     different digest (AGENT_BODY_ARTIFACT_VERSION_CONFLICT — an artifact
 *     version cannot silently mutate a certified binding);
 *   - the materiality flag is PART OF THE CANONICAL CONTENT: relabeling an
 *     artifact behavioral↔non-behavioral changes the possession content and
 *     therefore re-digests it (a visible new possession version — never a
 *     silent mutation);
 *   - a materially different artifact (new version, new digest, or a
 *     materiality flip) forces a NEW Possession — verified by
 *     upgradeModelSpecificArtifact, which returns a different, fully
 *     re-digested possession; the original binding is never mutated.
 *
 * Everything is deep-frozen at creation; there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import { AGENT_BODY_ERROR_CODES, AgentBodyError } from './errors.js';
import type { BodyVersion, BodyVersionRef } from './body.js';
import { bodyVersionRef, isBodyVersion, verifyBodyVersion } from './body.js';
import type { CognitiveSubstrate } from './substrate.js';
import { isCognitiveSubstrate, verifyCognitiveSubstrate } from './substrate.js';
import type { ContentDigest, PolicyDocument } from './shared.js';
import {
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isContentDigest,
  isNeutralId,
  isPolicyDocument,
  toAgentBodySemver,
  toContentDigest,
  toNeutralId,
  toPolicyDocument,
} from './shared.js';

// ---------------------------------------------------------------------------
// RuntimeProfile view (structurally compatible with future runtime
// protocol packages; validated plain data — a sibling domain package is not
// an importable dependency of this package)
// ---------------------------------------------------------------------------

/**
 * The runtime profile bound into a possession: a neutral runtime identifier,
 * its version, and a closed configuration map of JSON scalars (no free
 * objects — everything must stay canonically serializable and neutral).
 */
export interface RuntimeProfileView {
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly configuration: Readonly<Record<string, string | number | boolean | null>>;
}

export function isRuntimeProfileView(value: unknown): value is RuntimeProfileView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['runtimeId'] !== 'string' ||
    !isNeutralId(candidate['runtimeId']) ||
    typeof candidate['runtimeVersion'] !== 'string'
  ) {
    return false;
  }
  const configuration = candidate['configuration'];
  if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) {
    return false;
  }
  for (const configValue of Object.values(configuration as Record<string, unknown>)) {
    if (
      configValue !== null &&
      typeof configValue !== 'string' &&
      typeof configValue !== 'number' &&
      typeof configValue !== 'boolean'
    ) {
      return false;
    }
    if (typeof configValue === 'number' && !Number.isFinite(configValue)) return false;
  }
  return true;
}

export function toRuntimeProfileView(value: {
  runtimeId: string;
  runtimeVersion: string;
  configuration: Readonly<Record<string, string | number | boolean | null>>;
}): RuntimeProfileView {
  if (!isRuntimeProfileView(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
      message: `invalid runtime profile: ${JSON.stringify(value)} (runtimeId must be a neutral identifier; configuration values must be JSON scalars)`,
    });
  }
  assertProviderNeutralString(value.runtimeId, 'runtimeId');
  assertProviderNeutralString(value.runtimeVersion, 'runtimeVersion');
  return Object.freeze({
    runtimeId: value.runtimeId,
    runtimeVersion: toAgentBodySemver(value.runtimeVersion),
    configuration: Object.freeze({ ...value.configuration }),
  });
}

// ---------------------------------------------------------------------------
// EnvironmentProfile view
// ---------------------------------------------------------------------------

/** The environment profile bound into a possession. */
export interface EnvironmentProfileView {
  readonly environmentId: string;
  readonly environmentVersion: string;
  readonly constraints: readonly string[];
}

export function isEnvironmentProfileView(value: unknown): value is EnvironmentProfileView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['environmentId'] === 'string' &&
    isNeutralId(candidate['environmentId']) &&
    typeof candidate['environmentVersion'] === 'string' &&
    Array.isArray(candidate['constraints']) &&
    candidate['constraints'].length > 0 &&
    candidate['constraints'].every(
      (item) => typeof item === 'string' && item.length > 0,
    )
  );
}

export function toEnvironmentProfileView(value: {
  environmentId: string;
  environmentVersion: string;
  constraints: readonly string[];
}): EnvironmentProfileView {
  if (!isEnvironmentProfileView(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
      message: `invalid environment profile: ${JSON.stringify(value)}`,
    });
  }
  assertProviderNeutralString(value.environmentId, 'environmentId');
  assertProviderNeutralString(value.environmentVersion, 'environmentVersion');
  const constraints = value.constraints.map((item) => {
    if (typeof item !== 'string' || item.length === 0) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
        message: 'environment profile constraints must be non-empty strings',
      });
    }
    assertProviderNeutralString(item, 'environment constraint');
    return item;
  });
  return Object.freeze({
    environmentId: value.environmentId,
    environmentVersion: toAgentBodySemver(value.environmentVersion),
    constraints: Object.freeze(constraints),
  });
}

// ---------------------------------------------------------------------------
// PolicyBundle view
// ---------------------------------------------------------------------------

/** A bundle of mandatory policies governing the possession. */
export interface PolicyBundleView {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly policies: readonly PolicyDocument[];
}

export function isPolicyBundleView(value: unknown): value is PolicyBundleView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['bundleId'] === 'string' &&
    isNeutralId(candidate['bundleId']) &&
    typeof candidate['bundleVersion'] === 'string' &&
    Array.isArray(candidate['policies']) &&
    candidate['policies'].length > 0 &&
    candidate['policies'].every((policy) => isPolicyDocument(policy))
  );
}

export function toPolicyBundleView(value: {
  bundleId: string;
  bundleVersion: string;
  policies: readonly { policyId: string; statements: readonly string[] }[];
}): PolicyBundleView {
  assertProviderNeutralString(value.bundleId, 'bundleId');
  const bundleId = toNeutralId(value.bundleId);
  const bundleVersion = toAgentBodySemver(value.bundleVersion);
  const policies = value.policies.map((policy) => toPolicyDocument(policy));
  if (policies.length === 0) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
      message: 'policy bundle requires at least one policy document',
    });
  }
  const policyIds = new Set<string>();
  for (const policy of policies) {
    if (policyIds.has(policy.policyId)) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
        message: `duplicate policy id in bundle: ${policy.policyId}`,
      });
    }
    policyIds.add(policy.policyId);
  }
  return Object.freeze({
    bundleId,
    bundleVersion,
    policies: Object.freeze(policies),
  });
}

// ---------------------------------------------------------------------------
// ModelSpecificArtifacts (lock rule 22)
// ---------------------------------------------------------------------------

/**
 * Whether an artifact can materially change professional behavior.
 * Behavioral artifacts MUST be versioned so they cannot silently mutate a
 * certified binding (spec AB1.0 Evolution).
 */
export const MODEL_ARTIFACT_MATERIALITIES = ['behavioral', 'non-behavioral'] as const;
export type ModelArtifactMateriality = (typeof MODEL_ARTIFACT_MATERIALITIES)[number];

/** A versioned, content-addressed model-specific artifact. */
export interface ModelSpecificArtifact {
  readonly artifactId: string;
  readonly artifactVersion: string;
  readonly digest: string;
  readonly materiality: ModelArtifactMateriality;
}

export function isModelArtifactMateriality(
  value: unknown,
): value is ModelArtifactMateriality {
  return (
    typeof value === 'string' &&
    (MODEL_ARTIFACT_MATERIALITIES as readonly string[]).includes(value)
  );
}

export function isModelSpecificArtifact(value: unknown): value is ModelSpecificArtifact {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['artifactId'] === 'string' &&
    isNeutralId(candidate['artifactId']) &&
    typeof candidate['artifactVersion'] === 'string' &&
    isContentDigest(candidate['digest']) &&
    isModelArtifactMateriality(candidate['materiality'])
  );
}

export function toModelSpecificArtifact(value: {
  artifactId: string;
  artifactVersion: string;
  digest: string;
  materiality: string;
}): ModelSpecificArtifact {
  assertProviderNeutralString(value.artifactId, 'artifactId');
  const artifactId = toNeutralId(value.artifactId);
  const artifactVersion = toAgentBodySemver(value.artifactVersion);
  const digest = toContentDigest(value.digest);
  if (!isModelArtifactMateriality(value.materiality)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
      message: `unknown model artifact materiality: ${JSON.stringify(value.materiality)}`,
      details: { known: [...MODEL_ARTIFACT_MATERIALITIES] },
    });
  }
  return Object.freeze({
    artifactId,
    artifactVersion,
    digest,
    materiality: value.materiality,
  });
}

/** Stable key for a model-specific artifact: `<id>@<version>#<digest>`. */
export function modelSpecificArtifactKey(artifact: ModelSpecificArtifact): string {
  return `${artifact.artifactId}@${artifact.artifactVersion}#${artifact.digest}`;
}

// ---------------------------------------------------------------------------
// Possession
// ---------------------------------------------------------------------------

/** Wire version of the possession shape. */
export const POSSESSION_RECORD_VERSION = 1 as const;

export interface Possession {
  readonly recordVersion: typeof POSSESSION_RECORD_VERSION;
  readonly bodyVersion: BodyVersion;
  readonly substrate: CognitiveSubstrate;
  readonly runtime: RuntimeProfileView;
  readonly environment: EnvironmentProfileView;
  readonly policies: PolicyBundleView;
  readonly modelSpecificArtifacts: readonly ModelSpecificArtifact[];
  /** sha256 content digest over the canonical digest-free view. */
  readonly digest: ContentDigest;
}

/** Digest-free view of a possession — exactly what the digest covers. */
export type PossessionView = Omit<Possession, 'digest'>;

/** Content-addressed reference to a possession. */
export interface PossessionRef {
  readonly bodyVersion: BodyVersionRef;
  readonly substrateDigest: string;
  readonly possessionDigest: string;
}

export interface CreatePossessionInput {
  readonly bodyVersion: BodyVersion;
  readonly substrate: CognitiveSubstrate;
  readonly runtime: { runtimeId: string; runtimeVersion: string; configuration: Readonly<Record<string, string | number | boolean | null>> };
  readonly environment: { environmentId: string; environmentVersion: string; constraints: readonly string[] };
  readonly policies: {
    bundleId: string;
    bundleVersion: string;
    policies: readonly { policyId: string; statements: readonly string[] }[];
  };
  readonly modelSpecificArtifacts?: readonly {
    artifactId: string;
    artifactVersion: string;
    digest: string;
    materiality: string;
  }[];
}

function invalidPossession(message: string, details?: Record<string, unknown>): never {
  throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POSSESSION, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function toModelSpecificArtifactSet(
  values:
    | readonly {
        artifactId: string;
        artifactVersion: string;
        digest: string;
        materiality: string;
      }[]
    | undefined,
): readonly ModelSpecificArtifact[] {
  const artifacts = (values ?? []).map((artifact) => toModelSpecificArtifact(artifact));
  const byId = new Map<string, ModelSpecificArtifact>();
  for (const artifact of artifacts) {
    const existing = byId.get(artifact.artifactId);
    if (existing !== undefined) {
      if (
        existing.artifactVersion === artifact.artifactVersion &&
        existing.digest !== artifact.digest
      ) {
        // Same version, different bytes: a silent mutation attempt.
        throw new AgentBodyError(AGENT_BODY_ERROR_CODES.ARTIFACT_VERSION_CONFLICT, {
          message: `model-specific artifact ${artifact.artifactId}@${artifact.artifactVersion} appears twice with different digests (${existing.digest} vs ${artifact.digest}); an artifact version cannot silently mutate a certified binding (architecture-lock rule 22)`,
          details: {
            artifactId: artifact.artifactId,
            artifactVersion: artifact.artifactVersion,
            registered: existing.digest,
            attempted: artifact.digest,
          },
        });
      }
      invalidPossession(`duplicate model-specific artifact id: ${artifact.artifactId}`);
    }
    byId.set(artifact.artifactId, artifact);
  }
  return Object.freeze(artifacts);
}

/**
 * Create an immutable, content-addressed Possession. Fails closed when:
 *   - the body version is structurally invalid or digest-mismatched
 *     (AGENT_BODY_TAMPERED via verifyBodyVersion);
 *   - the substrate is structurally invalid or integrity-mismatched
 *     (AGENT_BODY_TAMPERED via verifyCognitiveSubstrate);
 *   - the runtime/environment/policy views are malformed;
 *   - model-specific artifacts repeat an id, or repeat an
 *     (id, version) with a DIFFERENT digest (AGENT_BODY_ARTIFACT_VERSION_CONFLICT).
 * The possession digest is the sha256 over the canonical digest-free view
 * and commits to every component — including the full body version content
 * and the full substrate content.
 */
export async function createPossession(
  input: CreatePossessionInput,
): Promise<Possession> {
  assertNoCredentialFields(input, 'possession');

  if (!isBodyVersion(input.bodyVersion)) {
    invalidPossession('possession requires a structurally valid body version');
  }
  await verifyBodyVersion(input.bodyVersion);

  if (!isCognitiveSubstrate(input.substrate)) {
    invalidPossession('possession requires a structurally valid cognitive substrate');
  }
  await verifyCognitiveSubstrate(input.substrate);

  const runtime = toRuntimeProfileView(input.runtime);
  const environment = toEnvironmentProfileView(input.environment);
  const policies = toPolicyBundleView(input.policies);
  const modelSpecificArtifacts = toModelSpecificArtifactSet(input.modelSpecificArtifacts);

  const view: PossessionView = {
    recordVersion: POSSESSION_RECORD_VERSION,
    bodyVersion: input.bodyVersion,
    substrate: input.substrate,
    runtime,
    environment,
    policies,
    modelSpecificArtifacts,
  };

  const digest = toContentDigest(await computePossessionDigest(view));
  const possession: Possession = deepFreeze({ ...view, digest });
  return possession;
}

/** sha256 content digest over the canonical serialization of the digest-free view. */
export async function computePossessionDigest(view: PossessionView): Promise<string> {
  return digestCanonical(view);
}

/** The digest-free view of a possession (what the digest commits to). */
export function possessionView(possession: Possession): PossessionView {
  const { digest: _digest, ...view } = possession;
  return view;
}

/** Content-addressed reference to a possession. */
export async function possessionRef(possession: Possession): Promise<PossessionRef> {
  return Object.freeze({
    bodyVersion: bodyVersionRef(possession.bodyVersion),
    substrateDigest: possession.substrate.integrity.contentDigest,
    possessionDigest: possession.digest,
  });
}

export function isPossession(value: unknown): value is Possession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === POSSESSION_RECORD_VERSION &&
    isBodyVersion(candidate['bodyVersion']) &&
    isCognitiveSubstrate(candidate['substrate']) &&
    isRuntimeProfileView(candidate['runtime']) &&
    isEnvironmentProfileView(candidate['environment']) &&
    isPolicyBundleView(candidate['policies']) &&
    Array.isArray(candidate['modelSpecificArtifacts']) &&
    candidate['modelSpecificArtifacts'].every((artifact) => isModelSpecificArtifact(artifact)) &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Re-compute a possession's digest and compare it with the claimed one.
 * FAILS CLOSED with AGENT_BODY_POSSESSION_TAMPERED on any mismatch; the
 * embedded body version and substrate are verified recursively too.
 */
export async function verifyPossession(possession: Possession): Promise<string> {
  if (!isPossession(possession)) {
    invalidPossession('not a structurally valid possession');
  }
  await verifyBodyVersion(possession.bodyVersion);
  await verifyCognitiveSubstrate(possession.substrate);
  const actual = await computePossessionDigest(possessionView(possession));
  if (actual !== possession.digest) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.POSSESSION_TAMPERED, {
      message: `possession digest mismatch: expected ${possession.digest}, recomputed ${actual}`,
      details: { expected: possession.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// Artifact upgrades force new possession versions (lock rule 22)
// ---------------------------------------------------------------------------

export interface UpgradeModelArtifactInput {
  readonly artifact: {
    artifactId: string;
    artifactVersion: string;
    digest: string;
    materiality: string;
  };
}

/**
 * Upgrade one model-specific artifact of a possession (pure + async):
 * returns a NEW possession whose digest covers the upgraded artifact set.
 *   - unknown artifactId → AGENT_BODY_INVALID_POSSESSION;
 *   - identical (id, version, digest, materiality) → the SAME possession
 *     (idempotent);
 *   - same version with a different digest →
 *     AGENT_BODY_ARTIFACT_VERSION_CONFLICT (an artifact version cannot
 *     silently mutate a certified binding);
 *   - anything else (new version, new digest at a new version, or a
 *     materiality flip — the flag is part of the canonical content) → a NEW
 *     possession with a DIFFERENT digest: the materially changed content
 *     forces a new possession version, and the original binding object is
 *     never mutated (immutability + content addressing make silent mutation
 *     impossible — asserted by possession.test.ts).
 */
export async function upgradeModelSpecificArtifact(
  possession: Possession,
  input: UpgradeModelArtifactInput,
): Promise<Possession> {
  if (!isPossession(possession)) {
    invalidPossession('not a structurally valid possession');
  }
  await verifyPossession(possession);

  const artifact = toModelSpecificArtifact(input.artifact);
  const existing = possession.modelSpecificArtifacts.find(
    (candidate) => candidate.artifactId === artifact.artifactId,
  );
  if (existing === undefined) {
    invalidPossession(
      `unknown model-specific artifact: ${artifact.artifactId} (upgrades replace an existing artifact; use createPossession to add one)`,
    );
  }
  if (
    existing.artifactVersion === artifact.artifactVersion &&
    existing.digest !== artifact.digest
  ) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.ARTIFACT_VERSION_CONFLICT, {
      message: `model-specific artifact ${artifact.artifactId}@${artifact.artifactVersion} is bound to digest ${existing.digest}; binding a different digest under the same artifact version is a silent mutation of a certified possession (architecture-lock rule 22) — version the artifact instead`,
      details: {
        artifactId: artifact.artifactId,
        artifactVersion: artifact.artifactVersion,
        registered: existing.digest,
        attempted: artifact.digest,
      },
    });
  }
  if (
    existing.artifactVersion === artifact.artifactVersion &&
    existing.digest === artifact.digest &&
    existing.materiality === artifact.materiality
  ) {
    // Idempotent no-op upgrade (fully identical artifact, materiality
    // included — the flag is part of the canonical content).
    return possession;
  }

  const modelSpecificArtifacts = Object.freeze(
    possession.modelSpecificArtifacts.map((candidate) =>
      candidate.artifactId === artifact.artifactId ? artifact : candidate,
    ),
  );
  const view: PossessionView = {
    ...possessionView(possession),
    modelSpecificArtifacts,
  };
  const digest = toContentDigest(await computePossessionDigest(view));
  return deepFreeze({ ...view, digest });
}
