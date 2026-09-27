/**
 * AgentBody and BodyVersion (spec AB1.0; architecture-lock rules 1, 2, 3, 5;
 * requirements R1, R2, R18, R45).
 *
 *   - AgentBody is a FIRST-CLASS PERSISTENT OBJECT (lock rule 1): the stable
 *     identity of a professional/capability composition, accumulating
 *     immutable BodyVersions through pure append operations.
 *   - BodyVersion is the IMMUTABLE, CONTENT-ADDRESSED snapshot (lock rule 5)
 *     of EVERYTHING the spec lists: body identity/version; mission and
 *     role; domain scope; capabilities and SkillRefs; KnowledgeRefs;
 *     ToolRefs; procedures/workflows; memory policy; planning/decision
 *     policy; escalation/delegation; authority boundaries; safety policy;
 *     evaluation suite refs; verification suite refs; environment
 *     requirements; substrate compatibility profile; provenance and
 *     lineage; parent/supersession refs. The sha256 digest over the
 *     canonical JSON of the digest-free view (computed with
 *     @arena/protocol-core — never reimplemented) content-addresses the
 *     version: same content ⇒ same digest, different content ⇒ different
 *     digest.
 *   - Evolution (spec AB1.0): a professional capability change creates a
 *     NEW BodyVersion — registerBodyVersion enforces registry-style
 *     dedup (same version + same digest is idempotent; same version with
 *     a different digest is an AGENT_BODY_VERSION_CONFLICT; body versions
 *     are immutable and content-addressed, so history is never rewritten).
 *   - A substrate upgrade NEVER touches a BodyVersion (lock rule 2: the
 *     substrate is distinct from the body; rule 3: a Possession is a
 *     versioned binding, not an alias): upgrades create new Possessions
 *     (see possession.ts).
 *
 * Everything is deep-frozen at creation; there is no mutation API.
 */

import { digestCanonical } from '@arena/protocol-core';
import { AGENT_BODY_ERROR_CODES, AgentBodyError } from './errors.js';
import type { SubstrateCompatibilityProfile } from './compatibility.js';
import { isSubstrateCompatibilityProfile, toSubstrateCompatibilityProfile } from './compatibility.js';
import type {
  ContentDigest,
  EnvironmentRequirementRef,
  KnowledgeRef,
  PolicyDocument,
  PrincipalRefView,
  ProcedureRef,
  RightsMetadataView,
  SkillRef,
  SuiteRef,
  TimestampView,
  ToolRef,
  VersionedArtifactRef,
} from './shared.js';
import {
  assertNoCredentialFields,
  assertProviderNeutralString,
  deepFreeze,
  isAgentBodyName,
  isAgentBodyNamespace,
  isAgentBodySemver,
  isContentDigest,
  isPolicyDocument,
  isPrincipalRefView,
  isRightsMetadataView,
  isTimestampView,
  isVersionedArtifactRef,
  toAgentBodyName,
  toAgentBodyNamespace,
  toAgentBodySemver,
  toContentDigest,
  toPrincipalRefView,
  toPolicyDocument,
  toRightsMetadataView,
  toTimestampView,
  toVersionedArtifactRef,
} from './shared.js';

// ---------------------------------------------------------------------------
// AgentBodyIdentity — the stable identity (no version: versions are BodyVersions)
// ---------------------------------------------------------------------------

/** Stable, provider-neutral identity of a professional agent body. */
export interface AgentBodyIdentity {
  readonly tenant: string;
  readonly name: string;
}

/** String form of a body identity: `arena:body/<tenant>/<name>`. */
export const AGENT_BODY_IDENTITY_PREFIX = 'arena:body';

/** Exact pattern source for the identity string form (mirrors the contracts). */
export const AGENT_BODY_IDENTITY_PATTERN_SOURCE =
  '^arena:body/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{1,127}$';

const IDENTITY_PARSE_PATTERN =
  /^arena:body\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{1,127})$/;

export function isAgentBodyIdentity(value: unknown): value is AgentBodyIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isAgentBodyNamespace(candidate['tenant']) &&
    isAgentBodyName(candidate['name'])
  );
}

export function toAgentBodyIdentity(value: { tenant: string; name: string }): AgentBodyIdentity {
  const identity: AgentBodyIdentity = Object.freeze({
    tenant: toAgentBodyNamespace(value.tenant),
    name: toAgentBodyName(value.name),
  });
  return identity;
}

/** Format a body identity as its stable string form. */
export function formatAgentBodyIdentity(identity: AgentBodyIdentity): string {
  return `${AGENT_BODY_IDENTITY_PREFIX}/${identity.tenant}/${identity.name}`;
}

/** Strictly parse a body identity string form; throws AGENT_BODY_INVALID_IDENTITY otherwise. */
export function parseAgentBodyIdentity(value: string): AgentBodyIdentity {
  const match = IDENTITY_PARSE_PATTERN.exec(value);
  if (!match) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid agent body identity string: ${JSON.stringify(value)}`,
      details: { pattern: AGENT_BODY_IDENTITY_PATTERN_SOURCE },
    });
  }
  const tenant = match[1];
  const name = match[2];
  if (tenant === undefined || name === undefined) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid agent body identity string: ${JSON.stringify(value)}`,
    });
  }
  return toAgentBodyIdentity({ tenant, name });
}

/** True iff both identities share tenant and name. */
export function isSameAgentBodyIdentity(a: AgentBodyIdentity, b: AgentBodyIdentity): boolean {
  return a.tenant === b.tenant && a.name === b.name;
}

// ---------------------------------------------------------------------------
// Escalation / delegation
// ---------------------------------------------------------------------------

/** Closed escalation target kinds (reuses the principal vocabulary). */
export const ESCALATION_TARGET_TYPES = [
  'agent-body',
  'expert',
  'user',
  'service',
  'system',
] as const;

/**
 * One escalation/delegation rule: when `condition` holds, delegate or
 * escalate to the tenant-scoped `target` principal.
 */
export interface EscalationRule {
  readonly condition: string;
  readonly target: PrincipalRefView;
}

/** The body's escalation/delegation policy. */
export interface EscalationPolicy {
  readonly rules: readonly EscalationRule[];
}

function isEscalationRule(value: unknown): value is EscalationRule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['condition'] === 'string' &&
    candidate['condition'].length > 0 &&
    isPrincipalRefView(candidate['target'])
  );
}

export function isEscalationPolicy(value: unknown): value is EscalationPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['rules']) && candidate['rules'].every((rule) => isEscalationRule(rule))
  );
}

function toEscalationPolicy(value: {
  rules: readonly { condition: string; target: { type: string; tenant: string; principalId: string } }[];
}): EscalationPolicy {
  const rules: EscalationRule[] = value.rules.map((rule) => {
    if (typeof rule.condition !== 'string' || rule.condition.length === 0) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
        message: 'escalation rule condition must be a non-empty string',
      });
    }
    assertProviderNeutralString(rule.condition, 'escalation rule condition');
    const target = toPrincipalRefView(rule.target);
    return Object.freeze({ condition: rule.condition, target });
  });
  return Object.freeze({ rules: Object.freeze(rules) });
}

// ---------------------------------------------------------------------------
// Provenance and lineage
// ---------------------------------------------------------------------------

/**
 * Provenance for a body version: the forging principal, the creation
 * timestamp, MANDATORY rights metadata (lock rule 23), and content-addressed
 * provenance record artifacts (A002).
 */
export interface BodyProvenance {
  readonly creator: PrincipalRefView;
  readonly createdAt: TimestampView;
  readonly rights: RightsMetadataView;
  readonly records: readonly VersionedArtifactRef[];
}

/** Parent/supersession refs: prior body versions this version derives from. */
export interface BodyLineage {
  readonly parents: readonly BodyVersionRef[];
  readonly supersedes?: BodyVersionRef;
}

/** Content-addressed reference to a body version (what lineage cites). */
export interface BodyVersionRef {
  readonly tenant: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

export function isBodyVersionRef(value: unknown): value is BodyVersionRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isAgentBodyNamespace(candidate['tenant']) &&
    isAgentBodyName(candidate['name']) &&
    typeof candidate['version'] === 'string' &&
    candidate['version'].length > 0 &&
    isContentDigest(candidate['digest'])
  );
}

export function toBodyVersionRef(value: {
  tenant: string;
  name: string;
  version: string;
  digest: string;
}): BodyVersionRef {
  toAgentBodyIdentity({ tenant: value.tenant, name: value.name });
  toAgentBodySemver(value.version);
  toContentDigest(value.digest);
  return Object.freeze({ ...value });
}

/** Stable key for a body version ref: `<tenant>/<name>@<version>#<digest>`. */
export function bodyVersionRefKey(ref: BodyVersionRef): string {
  return `${ref.tenant}/${ref.name}@${ref.version}#${ref.digest}`;
}

function toBodyProvenance(value: {
  creator: { type: string; tenant: string; principalId: string };
  createdAt: string;
  rights: unknown;
  records?: readonly { namespace: string; name: string; version: string; digest: string }[];
}): BodyProvenance {
  const creator = toPrincipalRefView(value.creator);
  const createdAt = toTimestampView(value.createdAt);
  const rights = toRightsMetadataView(value.rights);
  const records = (value.records ?? []).map((ref) => toVersionedArtifactRef(ref));
  const recordKeys = new Set<string>();
  for (const record of records) {
    const key = `${record.namespace}/${record.name}@${record.version}#${record.digest}`;
    if (recordKeys.has(key)) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
        message: `duplicate provenance record: ${key}`,
      });
    }
    recordKeys.add(key);
  }
  return Object.freeze({
    creator,
    createdAt,
    rights,
    records: Object.freeze(records),
  });
}

function toBodyLineage(
  identity: AgentBodyIdentity,
  ownVersion: string,
  value: {
    parents: readonly { tenant: string; name: string; version: string; digest: string }[];
    supersedes?: { tenant: string; name: string; version: string; digest: string };
  },
): BodyLineage {
  const parents = value.parents.map((ref) => toBodyVersionRef(ref));
  // Parents are keyed by identity+version: a body version has at most one
  // parent edge per prior VERSION (two refs to the same prior version with
  // different digests is a contradictory claim and is rejected).
  //
  // Check order: DUPLICATE parent keys first (a contradictory pair is
  // reported as a duplicate even when both entries are also self-refs),
  // then cross-body parents, then self-reference.
  const parentKeys = new Set<string>();
  for (const parent of parents) {
    const key = `${parent.tenant}/${parent.name}@${parent.version}`;
    if (parentKeys.has(key)) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
        message: `duplicate parent body version: ${key}`,
      });
    }
    parentKeys.add(key);
  }
  for (const parent of parents) {
    if (!isSameAgentBodyIdentity(parent, identity)) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
        message: `parent body version ${bodyVersionRefKey(parent)} belongs to a different body (a body version's parents are prior versions of the SAME body)`,
      });
    }
    if (parent.version === ownVersion) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
        message: `body version ${ownVersion} lists itself among its parents (self-reference)`,
      });
    }
  }
  let supersedes: BodyVersionRef | undefined;
  if (value.supersedes !== undefined) {
    supersedes = toBodyVersionRef(value.supersedes);
    if (!isSameAgentBodyIdentity(supersedes, identity)) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
        message: `superseded body version ${bodyVersionRefKey(supersedes)} belongs to a different body`,
      });
    }
    if (supersedes.version === ownVersion) {
      throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
        message: `body version ${ownVersion} supersedes itself`,
      });
    }
  }
  return Object.freeze({
    parents: Object.freeze(parents),
    ...(supersedes !== undefined ? { supersedes } : {}),
  });
}

// ---------------------------------------------------------------------------
// BodyVersion — the immutable, content-addressed snapshot
// ---------------------------------------------------------------------------

/** Wire version of the body version shape. */
export const BODY_VERSION_RECORD_VERSION = 1 as const;

export interface BodyVersion {
  readonly recordVersion: typeof BODY_VERSION_RECORD_VERSION;
  /** Body identity (tenant/name). */
  readonly body: AgentBodyIdentity;
  /** Body version (semver, no build metadata). */
  readonly version: string;
  /** Mission and role. */
  readonly mission: string;
  readonly role: string;
  /** Domain scope. */
  readonly domainScope: readonly string[];
  /** Capabilities and SkillRefs. */
  readonly capabilities: readonly string[];
  readonly skills: readonly SkillRef[];
  /** KnowledgeRefs. */
  readonly knowledge: readonly KnowledgeRef[];
  /** ToolRefs. */
  readonly tools: readonly ToolRef[];
  /** Procedures/workflows. */
  readonly procedures: readonly ProcedureRef[];
  /** Memory policy. */
  readonly memoryPolicy: PolicyDocument;
  /** Planning/decision policy. */
  readonly planningPolicy: PolicyDocument;
  /** Escalation/delegation. */
  readonly escalation: EscalationPolicy;
  /** Authority boundaries (explicit; lock rule 23). */
  readonly authorityBoundaries: readonly string[];
  /** Safety policy (explicit; lock rule 23). */
  readonly safetyPolicy: PolicyDocument;
  /** Evaluation suite refs (lock rule 7: evaluation is a distinct responsibility). */
  readonly evaluationSuites: readonly SuiteRef[];
  /** Verification suite refs (lock rule 7). */
  readonly verificationSuites: readonly SuiteRef[];
  /** Environment requirements (content-addressed refs). */
  readonly environmentRequirements: readonly EnvironmentRequirementRef[];
  /** Substrate compatibility profile (per-profile, never identity). */
  readonly substrateCompatibility: SubstrateCompatibilityProfile;
  /** Provenance and lineage. */
  readonly provenance: BodyProvenance;
  /** Parent/supersession refs. */
  readonly lineage: BodyLineage;
  /** sha256 content digest over the canonical digest-free view. */
  readonly digest: ContentDigest;
}

/** Digest-free view of a body version — exactly what the digest covers. */
export type BodyVersionView = Omit<BodyVersion, 'digest'>;

export interface CreateBodyVersionInput {
  readonly body: { tenant: string; name: string };
  readonly version: string;
  readonly mission: string;
  readonly role: string;
  readonly domainScope: readonly string[];
  readonly capabilities: readonly string[];
  readonly skills?: readonly { namespace: string; name: string; version: string; digest: string }[];
  readonly knowledge?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly tools?: readonly { namespace: string; name: string; version: string; digest: string }[];
  readonly procedures?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly memoryPolicy: { policyId: string; statements: readonly string[] };
  readonly planningPolicy: { policyId: string; statements: readonly string[] };
  readonly escalation: {
    rules: readonly {
      condition: string;
      target: { type: string; tenant: string; principalId: string };
    }[];
  };
  readonly authorityBoundaries: readonly string[];
  readonly safetyPolicy: { policyId: string; statements: readonly string[] };
  readonly evaluationSuites: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly verificationSuites: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly environmentRequirements: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly substrateCompatibility: SubstrateCompatibilityProfile | CreateSubstrateCompatShape;
  readonly provenance: {
    creator: { type: string; tenant: string; principalId: string };
    createdAt: string;
    rights: unknown;
    records?: readonly {
      namespace: string;
      name: string;
      version: string;
      digest: string;
    }[];
  };
  readonly lineage: {
    parents: readonly { tenant: string; name: string; version: string; digest: string }[];
    supersedes?: { tenant: string; name: string; version: string; digest: string };
  };
}

/** Shape accepted for `substrateCompatibility` before freezing (profile or raw input). */
interface CreateSubstrateCompatShape {
  readonly requiredModalities: readonly string[];
  readonly requiredToolCalling: string;
  readonly contextRequirements: { minContextUnits: number };
  readonly costConstraints?: { maxCostPerMillionRequests?: number; maxP95LatencyMs?: number };
  readonly requiredEvaluationSuites?: readonly {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }[];
  readonly prohibitedConditions?: readonly string[];
  readonly substrateAdaptations?: readonly {
    substrateDigest: string;
    adaptation: { namespace: string; name: string; version: string; digest: string };
  }[];
}

function invalidBodyVersion(message: string, details?: Record<string, unknown>): never {
  throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function toNonEmptyStringList(
  values: readonly string[] | undefined,
  field: string,
  min: number,
): readonly string[] {
  if (values === undefined || !Array.isArray(values)) {
    invalidBodyVersion(`${field} must be an array of non-empty strings`);
  }
  const list = values.map((item) => {
    if (typeof item !== 'string' || item.length === 0) {
      invalidBodyVersion(`${field} entries must be non-empty strings`);
    }
    assertProviderNeutralString(item, field);
    return item;
  });
  if (list.length < min) {
    invalidBodyVersion(`${field} requires at least ${String(min)} entr${min === 1 ? 'y' : 'ies'}`);
  }
  return Object.freeze(list);
}

function toRefList(
  values:
    | readonly { namespace: string; name: string; version: string; digest: string }[]
    | undefined,
  field: string,
): readonly VersionedArtifactRef[] {
  const refs = (values ?? []).map((ref) => toVersionedArtifactRef(ref));
  const keys = new Set<string>();
  for (const ref of refs) {
    const key = `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
    if (keys.has(key)) {
      invalidBodyVersion(`duplicate ${field} entry: ${key}`);
    }
    keys.add(key);
  }
  return Object.freeze(refs);
}

function toFreeText(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalidBodyVersion(`${field} must be a non-empty string`);
  }
  assertProviderNeutralString(value, field);
  return value;
}

/**
 * Create an immutable, content-addressed BodyVersion: validates every
 * AB1.0 field, computes the sha256 digest over the canonical JSON of the
 * digest-free view (digestCanonical from @arena/protocol-core — never
 * reimplemented), and deep-freezes the result. Same content always yields
 * the same version digest; different content always yields a different
 * digest (asserted by body.test.ts).
 */
export async function createBodyVersion(
  input: CreateBodyVersionInput,
): Promise<BodyVersion> {
  // Credentials never enter canonical objects (spec AB1.0).
  assertNoCredentialFields(input, 'bodyVersion');

  const body = toAgentBodyIdentity(input.body);
  const version = toAgentBodySemver(input.version);
  const mission = toFreeText(input.mission, 'mission');
  const role = toFreeText(input.role, 'role');
  const domainScope = toNonEmptyStringList(input.domainScope, 'domainScope', 1);
  const capabilities = toNonEmptyStringList(input.capabilities, 'capabilities', 1);
  const skills = toRefList(input.skills, 'skills');
  const knowledge = toRefList(input.knowledge, 'knowledge');
  const tools = toRefList(input.tools, 'tools');
  const procedures = toRefList(input.procedures, 'procedures');
  const memoryPolicy = toPolicyDocument(input.memoryPolicy);
  const planningPolicy = toPolicyDocument(input.planningPolicy);
  const escalation = toEscalationPolicy(input.escalation);
  const authorityBoundaries = toNonEmptyStringList(
    input.authorityBoundaries,
    'authorityBoundaries',
    1,
  );
  const safetyPolicy = toPolicyDocument(input.safetyPolicy);
  const policyIds = [memoryPolicy.policyId, planningPolicy.policyId, safetyPolicy.policyId];
  const distinctPolicyIds = new Set<string>(policyIds);
  if (distinctPolicyIds.size !== policyIds.length) {
    const duplicates = policyIds.filter(
      (id) => policyIds.indexOf(id) !== policyIds.lastIndexOf(id),
    );
    invalidBodyVersion(
      `duplicate policy id: ${[...new Set(duplicates)].join(', ')} (body version policies memoryPolicy/planningPolicy/safetyPolicy must have pairwise-distinct ids; got: ${policyIds.join(', ')})`,
    );
  }
  const evaluationSuites = toRefList(input.evaluationSuites, 'evaluationSuites');
  if (evaluationSuites.length === 0) {
    invalidBodyVersion('evaluationSuites requires at least one suite (a body version is evaluated; lock rule 7)');
  }
  const verificationSuites = toRefList(input.verificationSuites, 'verificationSuites');
  if (verificationSuites.length === 0) {
    invalidBodyVersion('verificationSuites requires at least one suite (a body version is verified; lock rule 7)');
  }
  const environmentRequirements = toRefList(input.environmentRequirements, 'environmentRequirements');
  if (environmentRequirements.length === 0) {
    invalidBodyVersion('environmentRequirements requires at least one environment profile');
  }

  // Always re-normalize through the validator: the closed-shape check and
  // the substrate-alias tripwire (AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN) must
  // apply even when the caller passes an already-frozen profile object, so
  // no identity-asserting field can ride along into the canonical form.
  const substrateCompatibility = toSubstrateCompatibilityProfile(
    input.substrateCompatibility as CreateSubstrateCompatShape,
  );

  const provenance = toBodyProvenance(input.provenance);
  const lineage = toBodyLineage(body, version, input.lineage);

  const view: BodyVersionView = {
    recordVersion: BODY_VERSION_RECORD_VERSION,
    body,
    version,
    mission,
    role,
    domainScope,
    capabilities,
    skills,
    knowledge,
    tools,
    procedures,
    memoryPolicy,
    planningPolicy,
    escalation,
    authorityBoundaries,
    safetyPolicy,
    evaluationSuites,
    verificationSuites,
    environmentRequirements,
    substrateCompatibility,
    provenance,
    lineage,
  };

  const digest = toContentDigest(await computeBodyVersionDigest(view));
  const bodyVersion: BodyVersion = deepFreeze({ ...view, digest });
  return bodyVersion;
}

/** sha256 content digest over the canonical serialization of the digest-free view. */
export async function computeBodyVersionDigest(view: BodyVersionView): Promise<string> {
  return digestCanonical(view);
}

/** The digest-free view of a body version (what the digest commits to). */
export function bodyVersionView(version: BodyVersion): BodyVersionView {
  const { digest: _digest, ...view } = version;
  return view;
}

/** Content-addressed reference to a body version. */
export function bodyVersionRef(version: BodyVersion): BodyVersionRef {
  return Object.freeze({
    tenant: version.body.tenant,
    name: version.body.name,
    version: version.version,
    digest: version.digest,
  });
}

export function isBodyVersion(value: unknown): value is BodyVersion {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== BODY_VERSION_RECORD_VERSION) return false;
  if (!isAgentBodyIdentity(candidate['body'])) return false;
  if (!isAgentBodySemver(candidate['version'])) return false;
  if (typeof candidate['mission'] !== 'string' || candidate['mission'].length === 0) return false;
  if (typeof candidate['role'] !== 'string' || candidate['role'].length === 0) return false;
  if (!Array.isArray(candidate['domainScope']) || candidate['domainScope'].length === 0) return false;
  if (!Array.isArray(candidate['capabilities']) || candidate['capabilities'].length === 0) {
    return false;
  }
  if (
    !Array.isArray(candidate['skills']) ||
    !candidate['skills'].every((ref) => isVersionedArtifactRef(ref)) ||
    !Array.isArray(candidate['knowledge']) ||
    !candidate['knowledge'].every((ref) => isVersionedArtifactRef(ref)) ||
    !Array.isArray(candidate['tools']) ||
    !candidate['tools'].every((ref) => isVersionedArtifactRef(ref)) ||
    !Array.isArray(candidate['procedures']) ||
    !candidate['procedures'].every((ref) => isVersionedArtifactRef(ref))
  ) {
    return false;
  }
  if (
    !isPolicyDocument(candidate['memoryPolicy']) ||
    !isPolicyDocument(candidate['planningPolicy']) ||
    !isPolicyDocument(candidate['safetyPolicy'])
  ) {
    return false;
  }
  if (!isEscalationPolicy(candidate['escalation'])) return false;
  if (
    !Array.isArray(candidate['authorityBoundaries']) ||
    candidate['authorityBoundaries'].length === 0
  ) {
    return false;
  }
  if (
    !Array.isArray(candidate['evaluationSuites']) ||
    candidate['evaluationSuites'].length === 0 ||
    !Array.isArray(candidate['verificationSuites']) ||
    candidate['verificationSuites'].length === 0 ||
    !Array.isArray(candidate['environmentRequirements']) ||
    candidate['environmentRequirements'].length === 0
  ) {
    return false;
  }
  if (!isSubstrateCompatibilityProfile(candidate['substrateCompatibility'])) return false;

  const provenance = candidate['provenance'];
  if (typeof provenance !== 'object' || provenance === null) return false;
  const provenanceRecord = provenance as Record<string, unknown>;
  if (
    !isPrincipalRefView(provenanceRecord['creator']) ||
    !isTimestampView(provenanceRecord['createdAt']) ||
    !isRightsMetadataView(provenanceRecord['rights']) ||
    !Array.isArray(provenanceRecord['records']) ||
    !provenanceRecord['records'].every((ref) => isVersionedArtifactRef(ref))
  ) {
    return false;
  }

  const lineage = candidate['lineage'];
  if (typeof lineage !== 'object' || lineage === null) return false;
  const lineageRecord = lineage as Record<string, unknown>;
  if (
    !Array.isArray(lineageRecord['parents']) ||
    !lineageRecord['parents'].every((ref) => isBodyVersionRef(ref))
  ) {
    return false;
  }
  const supersedes = lineageRecord['supersedes'];
  if (supersedes !== undefined && !isBodyVersionRef(supersedes)) return false;

  return isContentDigest(candidate['digest']);
}

/**
 * Re-compute a body version's digest and compare it with the claimed one.
 * FAILS CLOSED with AGENT_BODY_TAMPERED on any mismatch.
 */
export async function verifyBodyVersion(version: BodyVersion): Promise<string> {
  if (!isBodyVersion(version)) {
    invalidBodyVersion('not a structurally valid body version');
  }
  const actual = await computeBodyVersionDigest(bodyVersionView(version));
  if (actual !== version.digest) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.TAMPERED, {
      message: `body version digest mismatch: expected ${version.digest}, recomputed ${actual}`,
      details: { expected: version.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// AgentBody — the first-class persistent object (lock rule 1)
// ---------------------------------------------------------------------------

/** Wire version of the agent body registry object shape. */
export const AGENT_BODY_RECORD_VERSION = 1 as const;

/**
 * The persistent AgentBody object: stable identity, creation metadata,
 * MANDATORY rights (lock rule 23), and the content-addressed registry of
 * its immutable BodyVersions in append order. The object is deep-frozen;
 * new versions are appended purely via registerBodyVersion.
 */
export interface AgentBody {
  readonly recordVersion: typeof AGENT_BODY_RECORD_VERSION;
  readonly identity: AgentBodyIdentity;
  readonly createdAt: TimestampView;
  readonly creator: PrincipalRefView;
  readonly rights: RightsMetadataView;
  readonly versions: readonly BodyVersionRef[];
}

export interface CreateAgentBodyInput {
  readonly identity: { tenant: string; name: string };
  readonly createdAt: string;
  readonly creator: { type: string; tenant: string; principalId: string };
  readonly rights: unknown;
}

/**
 * Create the persistent AgentBody object (no versions yet). Validates
 * identity, creator, timestamp and rights; deep-freezes the result.
 */
export function createAgentBody(input: CreateAgentBodyInput): AgentBody {
  assertNoCredentialFields(input, 'agentBody');
  const identity = toAgentBodyIdentity(input.identity);
  const createdAt = toTimestampView(input.createdAt);
  const creator = toPrincipalRefView(input.creator);
  const rights = toRightsMetadataView(input.rights);
  const body: AgentBody = Object.freeze({
    recordVersion: AGENT_BODY_RECORD_VERSION,
    identity,
    createdAt,
    creator,
    rights,
    versions: Object.freeze([]),
  });
  return body;
}

export function isAgentBody(value: unknown): value is AgentBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === AGENT_BODY_RECORD_VERSION &&
    isAgentBodyIdentity(candidate['identity']) &&
    isTimestampView(candidate['createdAt']) &&
    isPrincipalRefView(candidate['creator']) &&
    isRightsMetadataView(candidate['rights']) &&
    Array.isArray(candidate['versions']) &&
    candidate['versions'].every((ref) => isBodyVersionRef(ref))
  );
}

/**
 * Append an immutable BodyVersion to the body's registry (pure): returns a
 * NEW frozen AgentBody, the input is never modified. Registry-style dedup
 * and immutability enforcement:
 *   - the version must belong to THIS body (identity match);
 *   - the version is verified fail-closed first (tamper detection);
 *   - an exact same (version, digest) ref already present → idempotent:
 *     the same body is returned (same content ⇒ same version digest);
 *   - the same version number already present with a DIFFERENT digest →
 *     AGENT_BODY_VERSION_CONFLICT (lock rule 5: body versions are immutable
 *     and content-addressed; history is never rewritten);
 *   - a new version number → appended in order.
 */
export async function registerBodyVersion(
  body: AgentBody,
  version: BodyVersion,
): Promise<AgentBody> {
  if (!isAgentBody(body)) {
    invalidBodyVersion('not a structurally valid agent body');
  }
  if (!isBodyVersion(version)) {
    invalidBodyVersion('not a structurally valid body version');
  }
  if (!isSameAgentBodyIdentity(version.body, body.identity)) {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.INVALID_BODY_VERSION, {
      message: `body version ${formatAgentBodyIdentity(version.body)} does not belong to body ${formatAgentBodyIdentity(body.identity)}`,
    });
  }
  // Fail closed on tampered content before registering anything.
  await verifyBodyVersion(version);

  for (const existing of body.versions) {
    if (existing.version !== version.version) continue;
    if (existing.digest === version.digest) {
      // Idempotent re-registration of identical content.
      return body;
    }
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.VERSION_CONFLICT, {
      message: `body version ${version.version} is already registered with a different digest (registered: ${existing.digest}; attempted: ${version.digest}) — body versions are immutable and content-addressed, so history is never rewritten`,
      details: { version: version.version, registered: existing.digest, attempted: version.digest },
    });
  }
  const updated: AgentBody = Object.freeze({
    ...body,
    versions: Object.freeze([...body.versions, bodyVersionRef(version)]),
  });
  return updated;
}

/** Resolve a registered body version ref by version number (null when absent). */
export function findBodyVersionRef(
  body: AgentBody,
  version: string,
): BodyVersionRef | null {
  for (const ref of body.versions) {
    if (ref.version === version) return ref;
  }
  return null;
}
