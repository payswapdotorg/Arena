/**
 * EnvironmentIdentity and EnvironmentDefinition (spec ENV1.0 — the
 * versioned, content-addressed declaration of an executable world;
 * architecture §7; architecture-lock rules 8, 21, 23; requirements R9,
 * R23; Work Order A009 gate 2, 3).
 *
 * An EnvironmentDefinition declares ALL FIFTEEN ENV1.0 fields — every one
 * a typed, validated object; a missing or invalid field is a
 * structured EnvironmentError (validation), never a silent default:
 *
 *   1. identity (id/version)               9. filesystemPolicy
 *   2. image (image/build digest)         10. secretPolicy
 *   3. initialState (snapshot ref+digest) 11. timeLimits
 *   4. seedPolicy                         12. resetSemantics
 *   5. actionSurface                      13. checkpointSemantics
 *   6. observationSurface                  14. evidenceOutputs
 *   7. resourceLimits                     15. evaluationHooks
 *   8. networkPolicy
 *
 * Content addressing (gate 3): the sha256 digest is computed over the
 * canonical JSON serialization of the digest-free view, REUSING
 * @arena/protocol-core's digestCanonical (never reimplemented here):
 * same declaration ⇒ same digest; any field change ⇒ new digest. The
 * definition is deep-frozen at creation — there is no mutation API.
 *
 * Registry-style dedup (gate 3): registerEnvironmentDefinition is
 * idempotent for the same (identity, version, digest) and fails closed
 * with ENVIRONMENT_VERSION_CONFLICT when the same version number arrives
 * with different content — versions are immutable and history is never
 * rewritten.
 */

import { digestCanonical } from '@arena/protocol-core';
import { ENVIRONMENT_ERROR_CODES, EnvironmentError } from './errors.js';
import type { EnvironmentImage } from './image.js';
import { assertImageConsistency, isEnvironmentImage, toEnvironmentImage } from './image.js';
import type { EvidenceOutputs } from './evidence.js';
import { isEvidenceOutputs, toEvidenceOutputs } from './evidence.js';
import type { EvaluationHooks } from './evidence.js';
import { isEvaluationHooks, toEvaluationHooks } from './evidence.js';
import type {
  FilesystemPolicy,
  NetworkPolicy,
  ResourceLimits,
  SecretPolicy,
  TimeLimits,
} from './isolation.js';
import {
  assertTimeLimitsFitWallClock,
  isFilesystemPolicy,
  isNetworkPolicy,
  isResourceLimits,
  isSecretPolicy,
  isTimeLimits,
  toFilesystemPolicy,
  toNetworkPolicy,
  toResourceLimits,
  toSecretPolicy,
  toTimeLimits,
} from './isolation.js';
import type { CheckpointSemantics, ResetSemantics } from './lifecycle.js';
import {
  assertLifecycleConsistency,
  isCheckpointSemantics,
  isResetSemantics,
  toCheckpointSemantics,
  toResetSemantics,
} from './lifecycle.js';
import type { SeedPolicy } from './reproducibility.js';
import { isSeedPolicy, toSeedPolicy } from './reproducibility.js';
import type { InitialStateDeclaration } from './snapshot.js';
import { isInitialStateDeclaration, toInitialStateDeclaration } from './snapshot.js';
import type {
  ContentDigest,
  EnvironmentName,
  EnvironmentNamespace,
  EnvironmentSemver,
} from './shared.js';
import {
  assertNoSecretMaterialFields,
  assertRuntimeNeutralTree,
  deepFreeze,
  expectFields,
  isContentDigest,
  isEnvironmentName,
  isEnvironmentNamespace,
  isEnvironmentSemver,
  toEnvironmentName,
  toEnvironmentNamespace,
  toEnvironmentSemver,
} from './shared.js';
import type { ActionSurface, ObservationSurface } from './surfaces.js';
import {
  isActionSurface,
  isObservationSurface,
  toActionSurface,
  toObservationSurface,
} from './surfaces.js';

// ---------------------------------------------------------------------------
// EnvironmentIdentity (declare field 1 — environment id/version)
// ---------------------------------------------------------------------------

/** Stable identity of an environment (tenant namespace + name); versions are EnvironmentDefinitions. */
export interface EnvironmentIdentity {
  readonly namespace: string;
  readonly name: string;
}

/** String form of an environment identity: `arena:environment/<namespace>/<name>`. */
export const ENVIRONMENT_IDENTITY_PREFIX = 'arena:environment';

/** Exact pattern source for the identity string form (mirrors the contracts). */
export const ENVIRONMENT_IDENTITY_PATTERN_SOURCE =
  '^arena:environment/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{1,127}$';

const IDENTITY_PARSE_PATTERN =
  /^arena:environment\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,127})$/;

export function isEnvironmentIdentity(value: unknown): value is EnvironmentIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isEnvironmentNamespace(candidate['namespace']) && isEnvironmentName(candidate['name'])
  );
}

export function toEnvironmentIdentity(value: {
  namespace: string;
  name: string;
}): EnvironmentIdentity {
  const namespace: EnvironmentNamespace = toEnvironmentNamespace(value.namespace);
  const name: EnvironmentName = toEnvironmentName(value.name);
  return Object.freeze({ namespace, name });
}

/** Format an environment identity as its stable string form. */
export function formatEnvironmentIdentity(identity: EnvironmentIdentity): string {
  return `${ENVIRONMENT_IDENTITY_PREFIX}/${identity.namespace}/${identity.name}`;
}

/** Strictly parse an environment identity string form; throws ENVIRONMENT_INVALID_IDENTITY otherwise. */
export function parseEnvironmentIdentity(value: string): EnvironmentIdentity {
  const match = IDENTITY_PARSE_PATTERN.exec(value);
  if (!match) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid environment identity string: ${JSON.stringify(value)}`,
      details: { pattern: ENVIRONMENT_IDENTITY_PATTERN_SOURCE },
    });
  }
  const namespace = match[1];
  const name = match[2];
  if (namespace === undefined || name === undefined) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid environment identity string: ${JSON.stringify(value)}`,
    });
  }
  return toEnvironmentIdentity({ namespace, name });
}

/** True iff both identities share namespace and name. */
export function isSameEnvironmentIdentity(a: EnvironmentIdentity, b: EnvironmentIdentity): boolean {
  return a.namespace === b.namespace && a.name === b.name;
}

// ---------------------------------------------------------------------------
// EnvironmentDefinition — the versioned, content-addressed declaration
// ---------------------------------------------------------------------------

/** Wire version of the environment definition record shape. */
export const ENVIRONMENT_DEFINITION_RECORD_VERSION = 1 as const;

/** The digest-free view — exactly what the digest commits to (all 15 fields + record version). */
export interface EnvironmentDefinitionView {
  readonly recordVersion: typeof ENVIRONMENT_DEFINITION_RECORD_VERSION;
  readonly identity: EnvironmentIdentity;
  readonly version: string;
  readonly image: EnvironmentImage;
  readonly initialState: InitialStateDeclaration;
  readonly seedPolicy: SeedPolicy;
  readonly actionSurface: ActionSurface;
  readonly observationSurface: ObservationSurface;
  readonly resourceLimits: ResourceLimits;
  readonly networkPolicy: NetworkPolicy;
  readonly filesystemPolicy: FilesystemPolicy;
  readonly secretPolicy: SecretPolicy;
  readonly timeLimits: TimeLimits;
  readonly resetSemantics: ResetSemantics;
  readonly checkpointSemantics: CheckpointSemantics;
  readonly evidenceOutputs: EvidenceOutputs;
  readonly evaluationHooks: EvaluationHooks;
}

/** A frozen environment definition: the view plus its sha256 content digest. */
export interface EnvironmentDefinition extends EnvironmentDefinitionView {
  readonly digest: ContentDigest;
}

/** The fifteen ENV1.0 declare fields, as a stable key list (tests + contracts mirror it). */
export const ENVIRONMENT_DECLARE_FIELDS = Object.freeze([
  'identity',
  'version',
  'image',
  'initialState',
  'seedPolicy',
  'actionSurface',
  'observationSurface',
  'resourceLimits',
  'networkPolicy',
  'filesystemPolicy',
  'secretPolicy',
  'timeLimits',
  'resetSemantics',
  'checkpointSemantics',
  'evidenceOutputs',
  'evaluationHooks',
] as const) as readonly string[];

export interface CreateEnvironmentDefinitionInput {
  readonly identity: { namespace: string; name: string };
  readonly version: string;
  readonly image: {
    imageKind: string;
    digest: string;
    buildDigest: string | null;
  };
  readonly initialState: {
    snapshot: { snapshotId: string; digest: string };
    snapshotSupport: string;
  };
  readonly seedPolicy: {
    reproducibility: {
      mode: string;
      capture: {
        seed: string;
        versions: string;
        externalInputs: string;
        timingContext: string;
      } | null;
      note?: string | null;
    };
    seed: string | null;
    seedAlgorithm: string | null;
    reseedPolicy: string;
    note?: string | null;
  };
  readonly actionSurface: {
    actions: readonly { actionId: string; description?: string | null }[];
    tools?: readonly { toolId: string; description?: string | null }[];
  };
  readonly observationSurface: {
    observations: readonly {
      observationId: string;
      channel: string;
      description?: string | null;
    }[];
  };
  readonly resourceLimits: {
    cpuMillis: number;
    memoryMiB: number;
    wallClockSeconds: number;
  };
  readonly networkPolicy: {
    egress: string;
    allows?: readonly { host: string; port: number; protocol: string }[];
  };
  readonly filesystemPolicy: {
    writeMode: string;
    mounts?: readonly { mountPath: string; access: string; source: string }[];
  };
  readonly secretPolicy: {
    isolation: string;
    injectionPoints?: readonly {
      secretId: string;
      mountPath: string;
      mechanism: string;
    }[];
  };
  readonly timeLimits: {
    startupSeconds: number;
    cleanupGraceSeconds: number;
    deadlineBehavior: string;
  };
  readonly resetSemantics: {
    mode: string;
    checkpoint: { checkpointId: string; digest: string } | null;
    cleanup: string;
  };
  readonly checkpointSemantics: {
    supported: boolean;
    triggers: readonly string[];
    retention: number | null;
  };
  readonly evidenceOutputs: {
    outputs: readonly {
      outputId: string;
      kind: string;
      addressing: string;
      description?: string | null;
    }[];
  };
  readonly evaluationHooks: {
    evaluators: readonly {
      hookId: string;
      role: string;
      phase: string;
      invocationSchema: string;
      description?: string | null;
    }[];
    verifiers: readonly {
      hookId: string;
      role: string;
      phase: string;
      invocationSchema: string;
      description?: string | null;
    }[];
  };
}

/** sha256 content digest over the canonical serialization of the digest-free view. */
export async function computeEnvironmentDigest(
  view: EnvironmentDefinitionView,
): Promise<ContentDigest> {
  const digest = await digestCanonical(view);
  return digest as ContentDigest;
}

/** The digest-free view of a definition (what the digest commits to). */
export function environmentDefinitionView(
  definition: EnvironmentDefinition,
): EnvironmentDefinitionView {
  const { digest: _digest, ...view } = definition;
  return view;
}

/**
 * Create an immutable environment definition: validates ALL fifteen
 * declare fields (each through its typed validator — a missing or invalid
 * field fails closed), enforces the cross-field invariants, guards the
 * canonical form against secret material and runner/provider leakage,
 * computes the sha256 digest over the canonical serialization of the
 * digest-free view, and deep-freezes the result. The returned object can
 * never be mutated in place.
 */
export async function createEnvironmentDefinition(
  input: CreateEnvironmentDefinitionInput,
): Promise<EnvironmentDefinition> {
  // Secrets never enter canonical objects (field-name tripwire).
  assertNoSecretMaterialFields(input, 'environmentDefinition');

  const record = expectFields(
    input,
    [...ENVIRONMENT_DECLARE_FIELDS],
    [],
    ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION,
    'environment definition',
  );

  const identity = toEnvironmentIdentity(
    (typeof record['identity'] === 'object' && record['identity'] !== null
      ? record['identity']
      : {}) as { namespace: string; name: string },
  );
  const version: EnvironmentSemver = toEnvironmentSemver(
    typeof record['version'] === 'string' ? record['version'] : '',
  );
  const image = toEnvironmentImage(
    (typeof record['image'] === 'object' && record['image'] !== null
      ? record['image']
      : {}) as CreateEnvironmentDefinitionInput['image'],
  );
  const initialState = toInitialStateDeclaration(
    (typeof record['initialState'] === 'object' && record['initialState'] !== null
      ? record['initialState']
      : {}) as CreateEnvironmentDefinitionInput['initialState'],
  );
  const seedPolicy = toSeedPolicy(
    (typeof record['seedPolicy'] === 'object' && record['seedPolicy'] !== null
      ? record['seedPolicy']
      : {}) as CreateEnvironmentDefinitionInput['seedPolicy'],
  );
  const actionSurface = toActionSurface(
    (typeof record['actionSurface'] === 'object' && record['actionSurface'] !== null
      ? record['actionSurface']
      : {}) as CreateEnvironmentDefinitionInput['actionSurface'],
  );
  const observationSurface = toObservationSurface(
    (typeof record['observationSurface'] === 'object' && record['observationSurface'] !== null
      ? record['observationSurface']
      : {}) as CreateEnvironmentDefinitionInput['observationSurface'],
  );
  const resourceLimits = toResourceLimits(
    (typeof record['resourceLimits'] === 'object' && record['resourceLimits'] !== null
      ? record['resourceLimits']
      : {}) as CreateEnvironmentDefinitionInput['resourceLimits'],
  );
  const networkPolicy = toNetworkPolicy(
    (typeof record['networkPolicy'] === 'object' && record['networkPolicy'] !== null
      ? record['networkPolicy']
      : {}) as CreateEnvironmentDefinitionInput['networkPolicy'],
  );
  const filesystemPolicy = toFilesystemPolicy(
    (typeof record['filesystemPolicy'] === 'object' && record['filesystemPolicy'] !== null
      ? record['filesystemPolicy']
      : {}) as CreateEnvironmentDefinitionInput['filesystemPolicy'],
  );
  const secretPolicy = toSecretPolicy(
    (typeof record['secretPolicy'] === 'object' && record['secretPolicy'] !== null
      ? record['secretPolicy']
      : {}) as CreateEnvironmentDefinitionInput['secretPolicy'],
  );
  const timeLimits = toTimeLimits(
    (typeof record['timeLimits'] === 'object' && record['timeLimits'] !== null
      ? record['timeLimits']
      : {}) as CreateEnvironmentDefinitionInput['timeLimits'],
  );
  const resetSemantics = toResetSemantics(
    (typeof record['resetSemantics'] === 'object' && record['resetSemantics'] !== null
      ? record['resetSemantics']
      : {}) as CreateEnvironmentDefinitionInput['resetSemantics'],
  );
  const checkpointSemantics = toCheckpointSemantics(
    (typeof record['checkpointSemantics'] === 'object' &&
    record['checkpointSemantics'] !== null
      ? record['checkpointSemantics']
      : {}) as CreateEnvironmentDefinitionInput['checkpointSemantics'],
  );
  const evidenceOutputs = toEvidenceOutputs(
    (typeof record['evidenceOutputs'] === 'object' && record['evidenceOutputs'] !== null
      ? record['evidenceOutputs']
      : {}) as CreateEnvironmentDefinitionInput['evidenceOutputs'],
  );
  const evaluationHooks = toEvaluationHooks(
    (typeof record['evaluationHooks'] === 'object' && record['evaluationHooks'] !== null
      ? record['evaluationHooks']
      : {}) as CreateEnvironmentDefinitionInput['evaluationHooks'],
  );

  // Cross-field invariants.
  assertImageConsistency(image);
  assertTimeLimitsFitWallClock(timeLimits, resourceLimits);
  assertLifecycleConsistency(initialState, resetSemantics, checkpointSemantics);
  // Deterministic + seed contradiction (gate 4) is enforced inside
  // toSeedPolicy; reproducibility capture rules inside toReproducibilityProfile.

  const view: EnvironmentDefinitionView = {
    recordVersion: ENVIRONMENT_DEFINITION_RECORD_VERSION,
    identity,
    version,
    image,
    initialState,
    seedPolicy,
    actionSurface,
    observationSurface,
    resourceLimits,
    networkPolicy,
    filesystemPolicy,
    secretPolicy,
    timeLimits,
    resetSemantics,
    checkpointSemantics,
    evidenceOutputs,
    evaluationHooks,
  };

  // Runtime neutrality over the whole canonical form (gate 10).
  assertRuntimeNeutralTree(view, 'environmentDefinition');

  const digest = await computeEnvironmentDigest(view);
  const definition: EnvironmentDefinition = deepFreeze({ ...view, digest });
  return definition;
}

/** Structural (non-throwing) check for a fully materialized definition. */
export function isEnvironmentDefinition(value: unknown): value is EnvironmentDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ENVIRONMENT_DEFINITION_RECORD_VERSION) return false;
  if (!isEnvironmentIdentity(candidate['identity'])) return false;
  if (!isEnvironmentSemver(candidate['version'])) return false;
  if (!isEnvironmentImage(candidate['image'])) return false;
  if (!isInitialStateDeclaration(candidate['initialState'])) return false;
  if (!isSeedPolicy(candidate['seedPolicy'])) return false;
  if (!isActionSurface(candidate['actionSurface'])) return false;
  if (!isObservationSurface(candidate['observationSurface'])) return false;
  if (!isResourceLimits(candidate['resourceLimits'])) return false;
  if (!isNetworkPolicy(candidate['networkPolicy'])) return false;
  if (!isFilesystemPolicy(candidate['filesystemPolicy'])) return false;
  if (!isSecretPolicy(candidate['secretPolicy'])) return false;
  if (!isTimeLimits(candidate['timeLimits'])) return false;
  if (!isResetSemantics(candidate['resetSemantics'])) return false;
  if (!isCheckpointSemantics(candidate['checkpointSemantics'])) return false;
  if (!isEvidenceOutputs(candidate['evidenceOutputs'])) return false;
  if (!isEvaluationHooks(candidate['evaluationHooks'])) return false;
  return isContentDigest(candidate['digest']);
}

/**
 * Re-compute a definition's digest and compare it with the claimed one.
 * FAILS CLOSED with ENVIRONMENT_TAMPERED on any mismatch — a mutation of
 * ANY of the fifteen declare fields is always detected.
 */
export async function verifyEnvironmentDefinition(
  definition: EnvironmentDefinition,
): Promise<ContentDigest> {
  if (!isEnvironmentDefinition(definition)) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, {
      message: 'not a structurally valid environment definition',
    });
  }
  const actual = await computeEnvironmentDigest(environmentDefinitionView(definition));
  if (actual !== definition.digest) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.TAMPERED, {
      message: `environment definition digest mismatch: expected ${definition.digest}, recomputed ${actual}`,
      details: { expected: definition.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// EnvironmentVersionRef — the content-addressed reference
// ---------------------------------------------------------------------------

/** Content-addressed reference to a registered environment version. */
export interface EnvironmentVersionRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: ContentDigest;
}

export function isEnvironmentVersionRef(value: unknown): value is EnvironmentVersionRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isEnvironmentNamespace(candidate['namespace']) &&
    isEnvironmentName(candidate['name']) &&
    isEnvironmentSemver(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Derive the content-addressed version ref of a definition. */
export function environmentVersionRef(definition: EnvironmentDefinition): EnvironmentVersionRef {
  return Object.freeze({
    namespace: definition.identity.namespace,
    name: definition.identity.name,
    version: definition.version,
    digest: definition.digest,
  });
}

/** Stable key for a version ref: `<namespace>/<name>@<version>#<digest>`. */
export function environmentVersionRefKey(ref: EnvironmentVersionRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
}

// ---------------------------------------------------------------------------
// EnvironmentRegistry — append-only, registry-style dedup (gate 3)
// ---------------------------------------------------------------------------

/** An append-only registry of registered environment versions. */
export interface EnvironmentRegistry {
  readonly entries: readonly EnvironmentVersionRef[];
}

/** Create an empty, frozen environment registry. */
export function createEnvironmentRegistry(): EnvironmentRegistry {
  return Object.freeze({ entries: Object.freeze([]) });
}

/**
 * Append an immutable environment definition to a registry (pure): returns
 * a NEW frozen registry; the input registry is never modified.
 * Registry-style dedup and immutability enforcement:
 *   - the definition is verified fail-closed first (tamper detection);
 *   - the same (identity, version, digest) already present → idempotent:
 *     the same registry is returned (same declaration ⇒ same digest);
 *   - the same version number already present with a DIFFERENT digest →
 *     ENVIRONMENT_VERSION_CONFLICT (environment versions are immutable and
 *     content-addressed; history is never rewritten);
 *   - a new version number → appended in order.
 */
export async function registerEnvironmentDefinition(
  registry: EnvironmentRegistry,
  definition: EnvironmentDefinition,
): Promise<EnvironmentRegistry> {
  if (
    typeof registry !== 'object' ||
    registry === null ||
    !Array.isArray((registry as unknown as Record<string, unknown>)['entries'])
  ) {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.INVALID_DEFINITION, {
      message: 'not a structurally valid environment registry',
    });
  }
  await verifyEnvironmentDefinition(definition);
  const ref = environmentVersionRef(definition);

  for (const existing of registry.entries) {
    if (!isSameEnvironmentIdentity(existing, definition.identity)) continue;
    if (existing.version !== definition.version) continue;
    if (existing.digest === definition.digest) {
      return registry; // idempotent re-registration of identical content
    }
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.VERSION_CONFLICT, {
      message: `environment version ${definition.version} is already registered with a different digest (registered: ${existing.digest}; attempted: ${definition.digest}) — environment versions are immutable and content-addressed, so history is never rewritten`,
      details: {
        identity: formatEnvironmentIdentity(definition.identity),
        version: definition.version,
        registered: existing.digest,
        attempted: definition.digest,
      },
    });
  }
  return Object.freeze({ entries: Object.freeze([...registry.entries, ref]) });
}

/** Resolve a registered environment version ref (null when absent). */
export function findEnvironmentVersionRef(
  registry: EnvironmentRegistry,
  identity: EnvironmentIdentity,
  version: string,
): EnvironmentVersionRef | null {
  for (const ref of registry.entries) {
    if (isSameEnvironmentIdentity(ref, identity) && ref.version === version) return ref;
  }
  return null;
}
