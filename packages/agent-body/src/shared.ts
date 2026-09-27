/**
 * Shared agent-body view types (Work Order A003).
 *
 * @arena/agent-body is a domain package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer). The structural components shared
 * with the artifact/provenance world — content-addressed artifact
 * references, tenant-scoped principals, rights metadata, timestamps — are
 * defined HERE as validated plain-string view types, exactly like
 * @arena/provenance's shared.ts (the sibling domain package is not an
 * allowed import of this package; Work Order A003 acceptance criterion 12).
 *
 * These views are STRUCTURALLY COMPATIBLE with the corresponding
 * @arena/artifact-protocol types (plain strings accept branded strings):
 * an artifact-protocol ArtifactRef / PrincipalRef / RightsMetadata value
 * can be passed through these validators unchanged, and vice versa. The
 * pattern sources below are character-for-character the A002 constants;
 * the generated contracts (contracts/agent-body/*.v1.json) and
 * contracts.parity.test.ts keep this copy from drifting, and the A002
 * hygiene suites keep the originals frozen on their side.
 *
 * This module also hosts the two provider-neutrality tripwires shared by
 * every constructor in this package:
 *   - assertNoCredentialFields: credential-shaped FIELD NAMES never enter
 *     canonical objects (spec AB1.0: "Credentials never enter canonical
 *     objects");
 *   - assertProviderNeutralString: model/provider names never enter
 *     canonical objects (architecture-lock rule 10; the Cognitive Substrate
 *     references models through provider-neutral adapter identifiers, not
 *     through provider brand names).
 */

import type { Brand } from '@arena/protocol-core';
import { AGENT_BODY_ERROR_CODES, AgentBodyError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/artifact-protocol constants
// (character-for-character). Kept in sync with the generated contracts by
// contracts.parity.test.ts.
// ---------------------------------------------------------------------------

export const AGENT_BODY_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const AGENT_BODY_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const AGENT_BODY_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const AGENT_BODY_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const PRINCIPAL_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const LICENSE_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9 .+()\\-]{0,63}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const AGENT_BODY_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';

const NAMESPACE_PATTERN = new RegExp(AGENT_BODY_NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(AGENT_BODY_NAME_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(AGENT_BODY_VERSION_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(AGENT_BODY_TIMESTAMP_PATTERN_SOURCE);
const PRINCIPAL_ID_PATTERN = new RegExp(PRINCIPAL_ID_PATTERN_SOURCE);
const LICENSE_PATTERN = new RegExp(LICENSE_PATTERN_SOURCE);
const ID_PATTERN = new RegExp(AGENT_BODY_ID_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type AgentBodyNamespace = Brand<string, 'AgentBodyNamespace'>;
export type AgentBodyName = Brand<string, 'AgentBodyName'>;
export type AgentBodySemver = Brand<string, 'AgentBodySemver'>;
export type ContentDigest = Brand<string, 'AgentBodyContentDigest'>;
export type TimestampView = Brand<string, 'AgentBodyTimestamp'>;
export type PrincipalIdView = Brand<string, 'AgentBodyPrincipalId'>;
export type NeutralId = Brand<string, 'AgentBodyNeutralId'>;

export function isAgentBodyNamespace(value: unknown): value is AgentBodyNamespace {
  return typeof value === 'string' && NAMESPACE_PATTERN.test(value);
}

export function isAgentBodyName(value: unknown): value is AgentBodyName {
  return typeof value === 'string' && NAME_PATTERN.test(value);
}

export function isAgentBodySemver(value: unknown): value is AgentBodySemver {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function isTimestampView(value: unknown): value is TimestampView {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function invalidIdentity(detail: string, pattern: string): never {
  throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
    message: `${detail} (pattern: ${pattern})`,
    details: { pattern },
  });
}

export function toAgentBodyNamespace(value: string): AgentBodyNamespace {
  if (!isAgentBodyNamespace(value)) {
    invalidIdentity(
      `invalid agent body namespace: ${JSON.stringify(value)}`,
      AGENT_BODY_NAMESPACE_PATTERN_SOURCE,
    );
  }
  return value;
}

export function toAgentBodyName(value: string): AgentBodyName {
  if (!isAgentBodyName(value)) {
    invalidIdentity(
      `invalid agent body name: ${JSON.stringify(value)}`,
      AGENT_BODY_NAME_PATTERN_SOURCE,
    );
  }
  return value;
}

export function toAgentBodySemver(value: string): AgentBodySemver {
  if (!isAgentBodySemver(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_VERSION, {
      message: `invalid agent body version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { pattern: AGENT_BODY_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toContentDigest(value: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid agent body identifier: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: AGENT_BODY_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toTimestampView(value: string): TimestampView {
  if (!isTimestampView(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid agent body timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-09-26T12:34:56.789Z)`,
      details: { pattern: AGENT_BODY_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Current time as a canonical timestamp view (Date#toISOString is always ms UTC). */
export function nowTimestampView(): TimestampView {
  return new Date().toISOString() as TimestampView;
}

// ---------------------------------------------------------------------------
// Principal view (structurally PrincipalRef; never a raw provider identity)
// ---------------------------------------------------------------------------

/** Closed principal types that may appear in agent-body records. */
export const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'] as const;
export type PrincipalTypeView = (typeof PRINCIPAL_TYPES)[number];

/** Tenant-scoped principal (structurally PrincipalRef). */
export interface PrincipalRefView {
  readonly type: PrincipalTypeView;
  readonly tenant: string;
  readonly principalId: string;
}

export function isPrincipalRefView(value: unknown): value is PrincipalRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['type'] === 'string' &&
    (PRINCIPAL_TYPES as readonly string[]).includes(candidate['type']) &&
    typeof candidate['tenant'] === 'string' &&
    NAMESPACE_PATTERN.test(candidate['tenant']) &&
    typeof candidate['principalId'] === 'string' &&
    PRINCIPAL_ID_PATTERN.test(candidate['principalId'])
  );
}

/** Validate and freeze a principal view; throws AGENT_BODY_INVALID_IDENTITY otherwise. */
export function toPrincipalRefView(value: {
  type: string;
  tenant: string;
  principalId: string;
}): PrincipalRefView {
  if (!isPrincipalRefView(value)) {
    if (typeof value?.type === 'string' && !(PRINCIPAL_TYPES as readonly string[]).includes(value.type)) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
        message: `unknown principal type: ${JSON.stringify(value.type)} (known: ${PRINCIPAL_TYPES.join(', ')})`,
        details: { known: [...PRINCIPAL_TYPES] },
      });
    }
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid agent body principal: ${JSON.stringify(value)}`,
      details: {
        principalId: PRINCIPAL_ID_PATTERN_SOURCE,
        tenant: AGENT_BODY_NAMESPACE_PATTERN_SOURCE,
      },
    });
  }
  return Object.freeze({ ...value });
}

// ---------------------------------------------------------------------------
// Rights view (structurally RightsMetadata; lock rule 23)
// ---------------------------------------------------------------------------

export const COMMERCIAL_USE_POLICIES = ['allowed', 'requires-license', 'prohibited'] as const;
export const REDISTRIBUTION_POLICIES = ['allowed', 'tenant-only', 'prohibited'] as const;
export const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'] as const;

export type CommercialUsePolicyView = (typeof COMMERCIAL_USE_POLICIES)[number];
export type RedistributionPolicyView = (typeof REDISTRIBUTION_POLICIES)[number];
export type CustomerDataPolicyView = (typeof CUSTOMER_DATA_POLICIES)[number];

/** Rights metadata (structurally RightsMetadata; mandatory on body records). */
export interface RightsMetadataView {
  readonly license: string;
  readonly commercialUse: CommercialUsePolicyView;
  readonly redistribution: RedistributionPolicyView;
  readonly customerData: CustomerDataPolicyView;
  readonly professionalLimitations?: readonly string[];
}

export function isRightsMetadataView(value: unknown): value is RightsMetadataView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['license'] !== 'string' ||
    !LICENSE_PATTERN.test(candidate['license']) ||
    typeof candidate['commercialUse'] !== 'string' ||
    !(COMMERCIAL_USE_POLICIES as readonly string[]).includes(candidate['commercialUse']) ||
    typeof candidate['redistribution'] !== 'string' ||
    !(REDISTRIBUTION_POLICIES as readonly string[]).includes(candidate['redistribution']) ||
    typeof candidate['customerData'] !== 'string' ||
    !(CUSTOMER_DATA_POLICIES as readonly string[]).includes(candidate['customerData'])
  ) {
    return false;
  }
  const limitations = candidate['professionalLimitations'];
  if (
    limitations !== undefined &&
    (!Array.isArray(limitations) ||
      !limitations.every((item) => typeof item === 'string' && item.length > 0))
  ) {
    return false;
  }
  return true;
}

/**
 * Validate and freeze rights metadata. Missing/not-an-object throws
 * AGENT_BODY_MISSING_RIGHTS (rights are mandatory); malformed values throw
 * AGENT_BODY_INVALID_RIGHTS.
 */
export function toRightsMetadataView(value: unknown): RightsMetadataView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.MISSING_RIGHTS, {
      message: 'rights metadata is required on agent body records (architecture-lock rule 23)',
    });
  }
  if (!isRightsMetadataView(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_RIGHTS, {
      message: `invalid agent body rights metadata: ${JSON.stringify(value)}`,
    });
  }
  const record = value as RightsMetadataView;
  return Object.freeze({
    license: record.license,
    commercialUse: record.commercialUse,
    redistribution: record.redistribution,
    customerData: record.customerData,
    ...(record.professionalLimitations !== undefined
      ? { professionalLimitations: Object.freeze([...record.professionalLimitations]) }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Content-addressed references to versioned material artifacts
// (skills, knowledge, tools, procedures, suites, environment requirements)
// ---------------------------------------------------------------------------

/**
 * A "SchemaRef-style" versioned reference to a material artifact:
 * `arena`-namespace + name + semver version + sha256 content digest. The
 * digest makes the reference CONTENT-ADDRESSED — stronger than a bare
 * SchemaRef — because a body version that cites a skill commits to the
 * exact bytes of that skill (lock rule 5: nothing redefines silently).
 */
export interface VersionedArtifactRef {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** SkillRefs — content-addressed skill artifacts. */
export type SkillRef = VersionedArtifactRef;
/** KnowledgeRefs — content-addressed knowledge artifacts. */
export type KnowledgeRef = VersionedArtifactRef;
/** ToolRefs — content-addressed tool artifacts. */
export type ToolRef = VersionedArtifactRef;
/** ProcedureRefs — content-addressed procedure/workflow artifacts. */
export type ProcedureRef = VersionedArtifactRef;
/** SuiteRefs — content-addressed evaluation/verification suite artifacts. */
export type SuiteRef = VersionedArtifactRef;
/** Environment requirement documents, content-addressed. */
export type EnvironmentRequirementRef = VersionedArtifactRef;

export function isVersionedArtifactRef(value: unknown): value is VersionedArtifactRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    NAMESPACE_PATTERN.test(candidate['namespace']) &&
    typeof candidate['name'] === 'string' &&
    NAME_PATTERN.test(candidate['name']) &&
    typeof candidate['version'] === 'string' &&
    VERSION_PATTERN.test(candidate['version']) &&
    typeof candidate['digest'] === 'string' &&
    DIGEST_PATTERN.test(candidate['digest'])
  );
}

/** Validate and freeze a versioned artifact reference. */
export function toVersionedArtifactRef(value: {
  namespace: string;
  name: string;
  version: string;
  digest: string;
}): VersionedArtifactRef {
  if (!isVersionedArtifactRef(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_REF, {
      message: `invalid versioned artifact reference: ${JSON.stringify(value)}`,
      details: {
        namespace: AGENT_BODY_NAMESPACE_PATTERN_SOURCE,
        name: AGENT_BODY_NAME_PATTERN_SOURCE,
        version: AGENT_BODY_VERSION_PATTERN_SOURCE,
        digest: CONTENT_DIGEST_PATTERN_SOURCE,
      },
    });
  }
  return Object.freeze({ ...value });
}

/** Stable key for a reference: `<namespace>/<name>@<version>#<digest>`. */
export function versionedArtifactRefKey(ref: VersionedArtifactRef): string {
  return `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
}

// ---------------------------------------------------------------------------
// Policy documents (memory / planning / safety / bundle policies)
// ---------------------------------------------------------------------------

/**
 * An explicit, content-addressed policy document: a neutral identifier, at
 * least one statement, and optional references to the policy source
 * artifacts. Safety, privacy, licensing and professional limitations are
 * explicit metadata (architecture-lock rule 23) — policies are never
 * implicit behaviors.
 */
export interface PolicyDocument {
  readonly policyId: string;
  readonly statements: readonly string[];
  readonly sources?: readonly VersionedArtifactRef[];
}

export function isPolicyDocument(value: unknown): value is PolicyDocument {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['policyId'] !== 'string' ||
    !ID_PATTERN.test(candidate['policyId'])
  ) {
    return false;
  }
  const statements = candidate['statements'];
  if (
    !Array.isArray(statements) ||
    statements.length === 0 ||
    !statements.every((item) => typeof item === 'string' && item.length > 0)
  ) {
    return false;
  }
  const sources = candidate['sources'];
  if (
    sources !== undefined &&
    (!Array.isArray(sources) || !sources.every((item) => isVersionedArtifactRef(item)))
  ) {
    return false;
  }
  return true;
}

/** Validate and freeze a policy document. */
export function toPolicyDocument(value: {
  policyId: string;
  statements: readonly string[];
  sources?: readonly { namespace: string; name: string; version: string; digest: string }[];
}): PolicyDocument {
  if (!isPolicyDocument(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_POLICY, {
      message: `invalid policy document: ${JSON.stringify(value)} (policyId must be a neutral identifier; statements must be a non-empty array of non-empty strings)`,
      details: { policyId: AGENT_BODY_ID_PATTERN_SOURCE },
    });
  }
  const sources = value.sources;
  return Object.freeze({
    policyId: value.policyId,
    statements: Object.freeze([...value.statements]),
    ...(sources !== undefined
      ? { sources: Object.freeze(sources.map((ref) => toVersionedArtifactRef(ref))) }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Provider-neutrality tripwires
// ---------------------------------------------------------------------------

/**
 * Credential-shaped field names that must NEVER appear in a canonical
 * agent-body object (spec AB1.0: "Credentials never enter canonical
 * objects"). Substring semantics, case-insensitive: `apiKey`, `api_key`,
 * `accessKey`, `clientSecret`, `bearer`, `authorization`, `password`,
 * `secret`, `credential`, `privateKey`, and plain `token` all match.
 */
const CREDENTIAL_FIELD_PATTERN =
  /api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|bearer|authorization|password|passwd|secret|credential|token/i;

/**
 * Recursively reject any credential-shaped FIELD NAME anywhere in a value
 * about to enter a canonical agent-body object. Throws
 * AGENT_BODY_SUBSTRATE_CREDENTIAL_REJECTED naming the offending path.
 */
export function assertNoCredentialFields(value: unknown, path = 'value'): void {
  if (typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${String(index)}]`));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_FIELD_PATTERN.test(key)) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.SUBSTRATE_CREDENTIAL_REJECTED, {
        message: `credential-shaped field ${JSON.stringify(key)} at ${path} is rejected: credentials never enter canonical agent body objects (spec AB1.0)`,
        details: { field: key, path },
      });
    }
    assertNoCredentialFields(child, `${path}.${key}`);
  }
}

/**
 * Model/provider brand names that must never appear in a canonical
 * agent-body object (architecture-lock rule 10: model/provider details
 * remain behind adapters; a CognitiveSubstrate references its provider
 * through the neutral adapter identifier only). Mirrors the governance
 * provider deny vocabulary.
 */
const PROVIDER_NAME_PATTERN =
  /openai|anthropic|claude|gemini|gpt-|bedrock|mistral|groq|ollama|deepseek|copilot/i;

/**
 * Reject provider brand names in a string about to enter a canonical
 * agent-body object. Throws AGENT_BODY_PROVIDER_NAME_REJECTED.
 */
export function assertProviderNeutralString(value: string, field: string): void {
  if (PROVIDER_NAME_PATTERN.test(value)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.PROVIDER_NAME_REJECTED, {
      message: `provider brand name in ${field} is rejected: model/provider details remain behind adapters (architecture-lock rule 10); use the provider-neutral adapter identifier instead`,
      details: { field },
    });
  }
}

// ---------------------------------------------------------------------------
// Deep freeze
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
