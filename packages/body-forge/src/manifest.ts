/**
 * BodyManifest — the versioned, content-addressed composition INPUT of
 * the Agent Body Forge (Work Order A021; requirement R18 — "Forge
 * immutable Agent Body Versions"; docs/architecture.md §12 — "The
 * Forge composes: Body Manifest + Skills + Knowledge + Tools +
 * Procedures/Policies + Verification + Evaluation + Environment
 * Requirements into an immutable Body Version"; architecture-lock
 * rules 5, 6, 18, 23).
 *
 * A manifest carries EVERY §12 composition input the forge will
 * project into a BodyVersion: mission/role; domain scope; capability
 * refs (REAL A004 CapabilityNodeRef shape, digest-addressed) + skill
 * refs (A003 VersionedArtifactRef shape, digest-addressed — the same
 * shape BodyVersion.skills commits to); knowledge refs; tool refs;
 * procedures/workflows; memory / planning / safety policy documents;
 * escalation/delegation rules; authority boundaries; evaluation
 * suite refs (A012 descriptor digests); verification suite refs
 * (A013 descriptor digests); environment requirements (A009-shaped
 * documents, content-addressed); the substrate compatibility profile
 * (A003 shape); provenance (author + timestamp + EXPLICIT learning
 * citations); MANDATORY rights metadata (lock rule 23); and the
 * parent/supersession lineage the forged version will carry.
 *
 * Learning-derived content (A020 experiment records, A019 skill
 * drafts) may enter a manifest ONLY as an EXPLICIT cited provenance
 * ref (closed vocabulary: `experiment-record` | `skill-draft`). A
 * manifest that silently embeds un-provenanced content is REJECTED
 * (the ForgePolicy's learningAdmission rules decide how strictly —
 * see policy.ts; the citation STRUCTURE is validated here).
 *
 * The HARD lineage rule (Work Order A021, non-negotiable): a
 * manifest whose lineage supersedes a prior BodyVersion MUST carry
 * that prior version among its parents — supersession is append-only
 * per the A003 registry semantics, and a superseding version always
 * descends from what it supersedes.
 *
 * Manifests are immutable, deep-frozen and content-addressed (sha256
 * over the canonical digest-free view, computed with
 * @arena/protocol-core's digestCanonical — never reimplemented).
 * Tamper detection: verifyBodyManifest recomputes the digest and
 * fails closed with BODY_FORGE_TAMPERED.
 *
 * ERROR POSTURE (disclosed): manifest-shape failures throw
 * BodyForgeError with BODY_FORGE_* codes. The A003 cross-cutting
 * tripwires reused here (assertNoCredentialFields,
 * assertProviderNeutralString) propagate their own AgentBodyError
 * codes — they are A003-owned governance tripwires, not forge
 * semantics.
 */

import { digestCanonical } from '@arena/protocol-core';
import type {
  BodyVersionRef,
  PolicyDocument,
  PrincipalRefView,
  RightsMetadataView,
  SubstrateCompatibilityProfile,
  VersionedArtifactRef,
} from '@arena/agent-body';
import {
  assertNoCredentialFields,
  assertProviderNeutralString,
  isBodyVersionRef,
  isPolicyDocument,
  isPrincipalRefView,
  isRightsMetadataView,
  isSubstrateCompatibilityProfile,
  isTimestampView,
  isVersionedArtifactRef,
  toBodyVersionRef,
  toPolicyDocument,
  toPrincipalRefView,
  toRightsMetadataView,
  toSubstrateCompatibilityProfile,
  toVersionedArtifactRef,
  versionedArtifactRefKey,
} from '@arena/agent-body';
import type { CreateSubstrateCompatibilityProfileInput } from '@arena/agent-body';
import { isCapabilityNodeRef, toCapabilityNodeRef } from '@arena/capability-graph';
import type { CapabilityNodeRef } from '@arena/capability-graph';
import { BODY_FORGE_ERROR_CODES, BodyForgeError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  isContentDigest,
  toContentDigest,
  toForgeSemver,
  toForgeTimestamp,
  toNeutralId,
} from './shared.js';
import type { ContentDigest, TimestampView } from './shared.js';

/** Wire version of the body-manifest shape. */
export const BODY_MANIFEST_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * Closed citation vocabulary: the ONLY ways learning-derived content
 * may be cited in a manifest. `experiment-record` cites an A020
 * ExperimentRunRecord by digest; `skill-draft` cites an A019
 * SkillDraft by digest AND binds it to the skill refs it proposes.
 */
export const MANIFEST_CITATION_KINDS = Object.freeze(['experiment-record', 'skill-draft'] as const);
export type ManifestCitationKind = (typeof MANIFEST_CITATION_KINDS)[number];

/**
 * Closed A004 node kinds admissible as manifest capability refs: a
 * manifest's `capabilities` list addresses capability/sub-capability
 * nodes (skills are addressed separately through `skills`).
 */
export const MANIFEST_CAPABILITY_KINDS = Object.freeze(['capability', 'sub-capability'] as const);
export type ManifestCapabilityKind = (typeof MANIFEST_CAPABILITY_KINDS)[number];

// ---------------------------------------------------------------------------
// Learning citations (explicit provenance refs — the anti-silent-embedding shape)
// ---------------------------------------------------------------------------

/** A cited A020 ExperimentRunRecord (the experiment that motivates a composition). */
export interface ExperimentRecordCitation {
  readonly kind: 'experiment-record';
  /** Digest of the A020 ExperimentRunRecord. */
  readonly digest: string;
}

/** A cited A019 SkillDraft, bound to the skill refs it proposes. */
export interface SkillDraftCitation {
  readonly kind: 'skill-draft';
  /** Digest of the A019 SkillDraft. */
  readonly digest: string;
  /** The skill refs this draft proposes (each must appear in manifest.skills). */
  readonly skills: readonly VersionedArtifactRef[];
}

export type ManifestCitation = ExperimentRecordCitation | SkillDraftCitation;

/** Manifest provenance: author, timestamp and EXPLICIT learning citations. */
export interface ManifestProvenance {
  readonly author: PrincipalRefView;
  readonly authoredAt: TimestampView;
  readonly citations: readonly ManifestCitation[];
}

/** Parent/supersession lineage the forged BodyVersion will carry. */
export interface ManifestLineage {
  readonly parents: readonly BodyVersionRef[];
  readonly supersedes?: BodyVersionRef;
}

// ---------------------------------------------------------------------------
// BodyManifest
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the manifest digest commits to. */
export interface BodyManifestView {
  readonly recordVersion: typeof BODY_MANIFEST_VERSION;
  /** Manifest identity (neutral id + own semver — manifests are versioned artifacts). */
  readonly manifestId: string;
  readonly version: string;
  /** The target body identity and the BodyVersion number to forge. */
  readonly body: { readonly tenant: string; readonly name: string };
  readonly targetVersion: string;
  /** Mission and role. */
  readonly mission: string;
  readonly role: string;
  /** Domain scope. */
  readonly domainScope: readonly string[];
  /** Capability refs (REAL A004 CapabilityNodeRef shape, digest-addressed). */
  readonly capabilities: readonly CapabilityNodeRef[];
  /** Skill refs (A003 VersionedArtifactRef shape, digest-addressed). */
  readonly skills: readonly VersionedArtifactRef[];
  /** Knowledge refs. */
  readonly knowledge: readonly VersionedArtifactRef[];
  /** Tool refs. */
  readonly tools: readonly VersionedArtifactRef[];
  /** Procedure/workflow refs. */
  readonly procedures: readonly VersionedArtifactRef[];
  /** Memory / planning / safety policy documents (A003 PolicyDocument shape). */
  readonly memoryPolicy: PolicyDocument;
  readonly planningPolicy: PolicyDocument;
  readonly safetyPolicy: PolicyDocument;
  /** Escalation/delegation policy (A003 EscalationPolicy shape). */
  readonly escalation: {
    readonly rules: readonly { readonly condition: string; readonly target: PrincipalRefView }[];
  };
  /** Authority boundaries (explicit; lock rule 23). */
  readonly authorityBoundaries: readonly string[];
  /** Evaluation suite refs (A012 descriptor digests, content-addressed). */
  readonly evaluationSuites: readonly VersionedArtifactRef[];
  /** Verification suite refs (A013 descriptor digests, content-addressed). */
  readonly verificationSuites: readonly VersionedArtifactRef[];
  /** Environment requirements (A009-shaped documents, content-addressed). */
  readonly environmentRequirements: readonly VersionedArtifactRef[];
  /** Substrate compatibility profile (A003 shape; alias-forbidden there). */
  readonly substrateCompatibility: SubstrateCompatibilityProfile;
  /** MANDATORY rights metadata (lock rule 23). */
  readonly rights: RightsMetadataView;
  /** Provenance (author + EXPLICIT learning citations). */
  readonly provenance: ManifestProvenance;
  /** Parent/supersession lineage. */
  readonly lineage: ManifestLineage;
}

/** A frozen, content-addressed body manifest: the view plus its sha256 digest. */
export interface BodyManifest extends BodyManifestView {
  readonly digest: ContentDigest;
}

/** Stable field list for the manifest view (tests mirror it). */
export const BODY_MANIFEST_FIELDS = Object.freeze([
  'recordVersion',
  'manifestId',
  'version',
  'body',
  'targetVersion',
  'mission',
  'role',
  'domainScope',
  'capabilities',
  'skills',
  'knowledge',
  'tools',
  'procedures',
  'memoryPolicy',
  'planningPolicy',
  'safetyPolicy',
  'escalation',
  'authorityBoundaries',
  'evaluationSuites',
  'verificationSuites',
  'environmentRequirements',
  'substrateCompatibility',
  'rights',
  'provenance',
  'lineage',
] as const) as readonly string[];

// ---------------------------------------------------------------------------
// Input shape (wire form; validated then frozen into the view)
// ---------------------------------------------------------------------------

/** Content-addressed artifact ref, wire form. */
export interface ArtifactRefInput {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

/** A004-shaped capability ref, wire form. */
export interface CapabilityRefInput {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

/** A003-shaped body version ref, wire form. */
export interface BodyVersionRefInput {
  readonly tenant: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

export interface CreateBodyManifestInput {
  readonly manifestId: string;
  readonly version: string;
  readonly body: { readonly tenant: string; readonly name: string };
  readonly targetVersion: string;
  readonly mission: string;
  readonly role: string;
  readonly domainScope: readonly string[];
  readonly capabilities: readonly CapabilityRefInput[];
  readonly skills?: readonly ArtifactRefInput[];
  readonly knowledge?: readonly ArtifactRefInput[];
  readonly tools?: readonly ArtifactRefInput[];
  readonly procedures?: readonly ArtifactRefInput[];
  readonly memoryPolicy: { readonly policyId: string; readonly statements: readonly string[] };
  readonly planningPolicy: { readonly policyId: string; readonly statements: readonly string[] };
  readonly safetyPolicy: { readonly policyId: string; readonly statements: readonly string[] };
  readonly escalation: {
    readonly rules: readonly {
      readonly condition: string;
      readonly target: { readonly type: string; readonly tenant: string; readonly principalId: string };
    }[];
  };
  readonly authorityBoundaries: readonly string[];
  readonly evaluationSuites: readonly ArtifactRefInput[];
  readonly verificationSuites: readonly ArtifactRefInput[];
  readonly environmentRequirements: readonly ArtifactRefInput[];
  readonly substrateCompatibility: SubstrateCompatibilityProfile | CreateSubstrateCompatibilityProfileInput;
  readonly rights: unknown;
  readonly provenance: {
    readonly author: { readonly type: string; readonly tenant: string; readonly principalId: string };
    readonly authoredAt: string;
    readonly citations: readonly (ExperimentRecordCitation | SkillDraftCitation)[];
  };
  readonly lineage: {
    readonly parents: readonly BodyVersionRefInput[];
    readonly supersedes?: BodyVersionRefInput;
  };
}

// ---------------------------------------------------------------------------
// Construction helpers (predicate-first; A003 constructors only after their
// predicates pass, so failures carry BODY_FORGE_* codes)
// ---------------------------------------------------------------------------

function invalidManifest(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_MANIFEST, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function conflict(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.CONFLICT, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function lineageViolation(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.LINEAGE_VIOLATION, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function toFreeText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalidManifest(`${field} must be a non-empty string`);
  }
  assertProviderNeutralString(value, field);
  return value;
}

function toStringList(value: unknown, field: string, min: number): readonly string[] {
  if (!Array.isArray(value)) {
    invalidManifest(`${field} must be an array of non-empty strings`);
  }
  const list = value.map((item) => {
    if (typeof item !== 'string' || item.length === 0) {
      invalidManifest(`${field} entries must be non-empty strings`);
    }
    assertProviderNeutralString(item, field);
    return item;
  });
  if (list.length < min) {
    invalidManifest(`${field} requires at least ${String(min)} entr${min === 1 ? 'y' : 'ies'}`);
  }
  const seen = new Set<string>();
  for (const item of list) {
    if (seen.has(item)) conflict(`duplicate ${field} entry: ${JSON.stringify(item)}`);
    seen.add(item);
  }
  return Object.freeze(list);
}

function toArtifactRef(value: unknown, context: string): VersionedArtifactRef {
  if (!isVersionedArtifactRef(value)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_REF, {
      message: `${context}: invalid versioned artifact reference: ${JSON.stringify(value)}`,
    });
  }
  return toVersionedArtifactRef(value);
}

function toRefList(value: unknown, field: string): readonly VersionedArtifactRef[] {
  if (!Array.isArray(value)) {
    invalidManifest(`${field} must be an array of versioned artifact refs`);
  }
  const refs = value.map((ref, index) => toArtifactRef(ref, `${field}[${String(index)}]`));
  const keys = new Set<string>();
  for (const ref of refs) {
    const key = versionedArtifactRefKey(ref);
    if (keys.has(key)) {
      conflict(
        `duplicate ${field} entry: ${key} (duplicate refs are a forge conflict — resolve the duplication or bump the version)`,
      );
    }
    keys.add(key);
  }
  return Object.freeze(refs);
}

function toEscalationRules(
  value: unknown,
): readonly { readonly condition: string; readonly target: PrincipalRefView }[] {
  if (!Array.isArray(value)) {
    invalidManifest('escalation.rules must be an array of rules');
  }
  const rules = value.map((rule) => {
    const record = expectFields(
      rule,
      ['condition', 'target'],
      [],
      BODY_FORGE_ERROR_CODES.INVALID_MANIFEST,
      'escalation rule',
    );
    const condition = toFreeText(record['condition'], 'escalation rule condition');
    if (!isPrincipalRefView(record['target'])) {
      invalidManifest(`escalation rule target must be a valid principal: ${JSON.stringify(record['target'])}`);
    }
    const target = toPrincipalRefView(record['target'] as never);
    return Object.freeze({ condition, target });
  });
  const seenConditions = new Set<string>();
  for (const rule of rules) {
    if (seenConditions.has(rule.condition)) {
      conflict(
        `contradictory escalation policy: condition ${JSON.stringify(rule.condition)} appears more than once (a condition must delegate to exactly one target)`,
      );
    }
    seenConditions.add(rule.condition);
  }
  return Object.freeze(rules);
}

function toCitations(value: unknown, skillKeys: ReadonlySet<string>): readonly ManifestCitation[] {
  if (!Array.isArray(value)) {
    invalidManifest('provenance.citations must be an array of citations');
  }
  const citations: ManifestCitation[] = [];
  const seenDigests = new Set<string>();
  const claimedSkills = new Map<string, string>();
  for (const entry of value) {
    const record = expectFields(
      entry,
      ['kind', 'digest'],
      [],
      BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE,
      'manifest citation',
    );
    const digestRaw = record['digest'];
    const digest = toContentDigest(
      typeof digestRaw === 'string' ? digestRaw : '',
      'manifest citation digest',
    );
    if (seenDigests.has(digest as string)) {
      conflict(`duplicate citation digest: ${digest} (each cited artifact is cited once)`);
    }
    seenDigests.add(digest as string);

    if (record['kind'] === 'experiment-record') {
      citations.push(Object.freeze({ kind: 'experiment-record', digest }));
      continue;
    }
    if (record['kind'] === 'skill-draft') {
      const skillsRaw = (entry as Record<string, unknown>)['skills'];
      if (!Array.isArray(skillsRaw) || skillsRaw.length === 0) {
        throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE, {
          message: 'skill-draft citation must bind at least one proposed skill ref',
        });
      }
      const skills = Object.freeze(
        skillsRaw.map((ref, index) => toArtifactRef(ref, `skill-draft citation skills[${String(index)}]`)),
      );
      for (const skill of skills) {
        const key = versionedArtifactRefKey(skill);
        if (!skillKeys.has(key)) {
          throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE, {
            message: `skill-draft citation binds skill ${key} which is NOT part of the manifest's skills (a citation must explain content the manifest actually embeds)`,
            details: { skill: key },
          });
        }
        const claimedBy = claimedSkills.get(key);
        if (claimedBy !== undefined) {
          conflict(
            `skill ${key} is claimed by two skill-draft citations (${claimedBy}, ${digest}) — provenance must be unambiguous`,
          );
        }
        claimedSkills.set(key, digest as string);
      }
      citations.push(Object.freeze({ kind: 'skill-draft', digest, skills }));
      continue;
    }
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE, {
      message: `unknown citation kind: ${JSON.stringify(record['kind'])} (learning-derived content may enter a manifest only as an explicit cited provenance ref)`,
      details: { known: [...MANIFEST_CITATION_KINDS] },
    });
  }
  return Object.freeze(citations);
}

function toManifestLineage(
  body: { readonly tenant: string; readonly name: string },
  targetVersion: string,
  value: unknown,
): ManifestLineage {
  const record = expectFields(
    value,
    ['parents'],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_MANIFEST,
    'manifest lineage',
  );
  const parentsRaw = record['parents'];
  if (!Array.isArray(parentsRaw)) {
    invalidManifest('manifest lineage.parents must be an array of body version refs');
  }
  const parents = Object.freeze(
    parentsRaw.map((ref, index) => {
      if (!isBodyVersionRef(ref)) {
        invalidManifest(`lineage.parents[${String(index)}]: invalid body version ref: ${JSON.stringify(ref)}`);
      }
      return toBodyVersionRef(ref);
    }),
  );
  const parentKeys = new Set<string>();
  for (const parent of parents) {
    const key = `${parent.tenant}/${parent.name}@${parent.version}`;
    if (parentKeys.has(key)) {
      conflict(`duplicate parent body version: ${key}`);
    }
    parentKeys.add(key);
    if (parent.tenant !== body.tenant || parent.name !== body.name) {
      lineageViolation(
        `parent body version ${parent.tenant}/${parent.name}@${parent.version} belongs to a different body (a forged version's parents are prior versions of the SAME body)`,
      );
    }
    if (parent.version === targetVersion) {
      lineageViolation(`target version ${targetVersion} lists itself among its parents (self-reference)`);
    }
  }
  const supersedesRaw = (value as Record<string, unknown>)['supersedes'];
  if (supersedesRaw === undefined) {
    return Object.freeze({ parents });
  }
  if (!isBodyVersionRef(supersedesRaw)) {
    invalidManifest(`lineage.supersedes: invalid body version ref: ${JSON.stringify(supersedesRaw)}`);
  }
  const supersedes = toBodyVersionRef(supersedesRaw);
  if (supersedes.tenant !== body.tenant || supersedes.name !== body.name) {
    lineageViolation(
      `superseded body version ${supersedes.tenant}/${supersedes.name}@${supersedes.version} belongs to a different body`,
    );
  }
  if (supersedes.version === targetVersion) {
    lineageViolation(`target version ${targetVersion} supersedes itself`);
  }
  // THE HARD RULE (Work Order A021): a version that supersedes
  // another MUST carry the superseded version among its parents —
  // supersession is append-only and always descends from what it
  // supersedes. NOT policy-tunable.
  const supersedesKey = `${supersedes.tenant}/${supersedes.name}@${supersedes.version}`;
  if (!parentKeys.has(supersedesKey)) {
    lineageViolation(
      `lineage supersedes ${supersedesKey} but does not carry it among its parents — a BodyVersion that supersedes another MUST carry the parent ref (append-only supersession)`,
      { supersedes: supersedesKey, parents: [...parentKeys] },
    );
  }
  return Object.freeze({ parents, supersedes });
}

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

/**
 * Create a validated, deep-frozen, content-addressed BodyManifest.
 * Enforces (with typed BodyForgeErrors): neutral ids and semvers;
 * provider-neutral free text; the A003 AB1.0 floors (domainScope,
 * capabilities, authorityBoundaries, evaluationSuites,
 * verificationSuites, environmentRequirements each >= 1); duplicate
 * and conflict rejection (duplicate refs, duplicate capability ids,
 * duplicate escalation conditions, duplicate policy ids); the closed
 * citation vocabulary with dangling/double-claim rejection; the HARD
 * supersedes-requires-parent lineage rule; and mandatory rights
 * metadata (lock rule 23). Credential-shaped fields anywhere in the
 * input are rejected (A003 tripwire, AgentBodyError).
 */
export async function createBodyManifest(input: CreateBodyManifestInput): Promise<BodyManifest> {
  assertNoCredentialFields(input, 'bodyManifest');

  const manifestId = toNeutralId(input.manifestId, 'manifest.manifestId');
  const version = toForgeSemver(input.version, 'manifest.version');
  if (
    typeof input.body?.tenant !== 'string' ||
    typeof input.body?.name !== 'string' ||
    !/^[a-z][a-z0-9-]{1,62}$/.test(input.body.tenant) ||
    !/^[a-z][a-z0-9-]{1,127}$/.test(input.body.name)
  ) {
    invalidManifest(
      `manifest.body must be a valid agent body identity (tenant/name): ${JSON.stringify(input.body)}`,
    );
  }
  const body = Object.freeze({ tenant: input.body.tenant, name: input.body.name });
  const targetVersion = toForgeSemver(input.targetVersion, 'manifest.targetVersion');
  const mission = toFreeText(input.mission, 'mission');
  const role = toFreeText(input.role, 'role');
  const domainScope = toStringList(input.domainScope, 'domainScope', 1);

  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    invalidManifest('capabilities requires at least one A004 capability ref');
  }
  const capabilityIds = new Set<string>();
  const capabilities = Object.freeze(
    input.capabilities.map((ref, index) => {
      if (!isCapabilityNodeRef(ref)) {
        invalidManifest(
          `capabilities[${String(index)}]: invalid A004 capability node ref: ${JSON.stringify(ref)}`,
        );
      }
      const capability = toCapabilityNodeRef(ref);
      if (!(MANIFEST_CAPABILITY_KINDS as readonly string[]).includes(capability.kind)) {
        invalidManifest(
          `capability ref kind ${JSON.stringify(capability.kind)} is not admissible (manifest capabilities address capability/sub-capability nodes; skills are addressed through skills)`,
          { known: [...MANIFEST_CAPABILITY_KINDS] },
        );
      }
      if (capabilityIds.has(capability.id)) {
        conflict(`duplicate capability id: ${capability.id}`);
      }
      capabilityIds.add(capability.id);
      return capability;
    }),
  );

  const skills = toRefList(input.skills ?? [], 'skills');
  const knowledge = toRefList(input.knowledge ?? [], 'knowledge');
  const tools = toRefList(input.tools ?? [], 'tools');
  const procedures = toRefList(input.procedures ?? [], 'procedures');

  for (const [field, raw] of [
    ['memoryPolicy', input.memoryPolicy],
    ['planningPolicy', input.planningPolicy],
    ['safetyPolicy', input.safetyPolicy],
  ] as const) {
    if (!isPolicyDocument(raw)) {
      invalidManifest(`${field} must be a valid policy document: ${JSON.stringify(raw)}`);
    }
  }
  const memoryPolicy = toPolicyDocument(input.memoryPolicy as never);
  const planningPolicy = toPolicyDocument(input.planningPolicy as never);
  const safetyPolicy = toPolicyDocument(input.safetyPolicy as never);
  const policyIds = [memoryPolicy.policyId, planningPolicy.policyId, safetyPolicy.policyId];
  if (new Set(policyIds).size !== policyIds.length) {
    conflict(
      `contradictory policies: memoryPolicy/planningPolicy/safetyPolicy must have pairwise-distinct ids; got: ${policyIds.join(', ')}`,
    );
  }

  const escalationRules = toEscalationRules(input.escalation?.rules);
  const authorityBoundaries = toStringList(input.authorityBoundaries, 'authorityBoundaries', 1);
  const evaluationSuites = toRefList(input.evaluationSuites, 'evaluationSuites');
  if (evaluationSuites.length === 0) {
    invalidManifest(
      'evaluationSuites requires at least one suite (a forged body version is evaluated; lock rule 7)',
    );
  }
  const verificationSuites = toRefList(input.verificationSuites, 'verificationSuites');
  if (verificationSuites.length === 0) {
    invalidManifest(
      'verificationSuites requires at least one suite (a forged body version is verified; lock rule 7)',
    );
  }
  const environmentRequirements = toRefList(input.environmentRequirements, 'environmentRequirements');
  if (environmentRequirements.length === 0) {
    invalidManifest('environmentRequirements requires at least one environment profile');
  }

  // The substrate compatibility profile re-normalizes through the REAL
  // A003 validator (closed shape, credential and alias tripwires
  // included). Its AgentBodyError is wrapped into a forge-typed
  // rejection so manifest-shape failures stay in this taxonomy.
  let substrateCompatibility: SubstrateCompatibilityProfile;
  try {
    substrateCompatibility = toSubstrateCompatibilityProfile(
      input.substrateCompatibility as CreateSubstrateCompatibilityProfileInput,
    );
  } catch (error) {
    invalidManifest(
      `substrateCompatibility must be a valid A003 substrate compatibility profile (closed shape; alias-forbidden): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isRightsMetadataView(input.rights)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE, {
      message:
        'rights metadata is required on a body manifest and must be valid (architecture-lock rule 23)',
    });
  }
  const rights = toRightsMetadataView(input.rights);

  const provenanceRecord = expectFields(
    input.provenance,
    ['author', 'authoredAt', 'citations'],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_PROVENANCE,
    'manifest provenance',
  );
  if (!isPrincipalRefView(provenanceRecord['author'])) {
    invalidManifest(
      `manifest provenance.author must be a valid principal: ${JSON.stringify(provenanceRecord['author'])}`,
    );
  }
  const author = toPrincipalRefView(provenanceRecord['author'] as never);
  const authoredAt = toForgeTimestamp(
    typeof provenanceRecord['authoredAt'] === 'string' ? provenanceRecord['authoredAt'] : '',
    'manifest provenance.authoredAt',
  );
  const skillKeys = new Set(skills.map((ref) => versionedArtifactRefKey(ref)));
  const citations = toCitations(provenanceRecord['citations'], skillKeys);

  const lineage = toManifestLineage(body, targetVersion, input.lineage);

  const view: BodyManifestView = {
    recordVersion: BODY_MANIFEST_VERSION,
    manifestId,
    version,
    body,
    targetVersion,
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
    safetyPolicy,
    escalation: Object.freeze({ rules: escalationRules }),
    authorityBoundaries,
    evaluationSuites,
    verificationSuites,
    environmentRequirements,
    substrateCompatibility,
    rights,
    provenance: Object.freeze({ author, authoredAt, citations }),
    lineage,
  };

  const digest = toContentDigest(await digestCanonical(view), 'manifest digest');
  return deepFreeze({ ...view, digest }) as BodyManifest;
}

/** sha256 content digest over the canonical digest-free manifest view. */
export async function computeBodyManifestDigest(view: BodyManifestView): Promise<string> {
  return digestCanonical(view);
}

/** The digest-free view of a manifest (what the digest commits to). */
export function bodyManifestView(manifest: BodyManifest): BodyManifestView {
  const { digest: _digest, ...view } = manifest;
  return view;
}

// ---------------------------------------------------------------------------
// Structural (non-throwing) checks + tamper detection
// ---------------------------------------------------------------------------

export function isManifestCitation(value: unknown): value is ManifestCitation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['kind'] === 'experiment-record') {
    return typeof candidate['digest'] === 'string' && isContentDigest(candidate['digest']);
  }
  if (candidate['kind'] === 'skill-draft') {
    return (
      typeof candidate['digest'] === 'string' &&
      isContentDigest(candidate['digest']) &&
      Array.isArray(candidate['skills']) &&
      candidate['skills'].length > 0 &&
      candidate['skills'].every((ref) => isVersionedArtifactRef(ref))
    );
  }
  return false;
}

export function isBodyManifestView(value: unknown): value is BodyManifestView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== BODY_MANIFEST_VERSION) return false;
  if (typeof candidate['manifestId'] !== 'string' || candidate['manifestId'].length === 0) return false;
  if (typeof candidate['version'] !== 'string' || candidate['version'].length === 0) return false;
  const body = candidate['body'];
  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>)['tenant'] !== 'string' ||
    typeof (body as Record<string, unknown>)['name'] !== 'string'
  ) {
    return false;
  }
  if (typeof candidate['targetVersion'] !== 'string' || candidate['targetVersion'].length === 0) {
    return false;
  }
  if (typeof candidate['mission'] !== 'string' || candidate['mission'].length === 0) return false;
  if (typeof candidate['role'] !== 'string' || candidate['role'].length === 0) return false;
  if (!Array.isArray(candidate['domainScope']) || candidate['domainScope'].length === 0) return false;
  if (
    !Array.isArray(candidate['capabilities']) ||
    candidate['capabilities'].length === 0 ||
    !candidate['capabilities'].every(
      (ref) =>
        isCapabilityNodeRef(ref) && (MANIFEST_CAPABILITY_KINDS as readonly string[]).includes(ref.kind),
    )
  ) {
    return false;
  }
  for (const field of ['skills', 'knowledge', 'tools', 'procedures'] as const) {
    const list = candidate[field];
    if (!Array.isArray(list) || !list.every((ref) => isVersionedArtifactRef(ref))) return false;
  }
  if (
    !isPolicyDocument(candidate['memoryPolicy']) ||
    !isPolicyDocument(candidate['planningPolicy']) ||
    !isPolicyDocument(candidate['safetyPolicy'])
  ) {
    return false;
  }
  const escalation = candidate['escalation'];
  if (
    typeof escalation !== 'object' ||
    escalation === null ||
    !Array.isArray((escalation as Record<string, unknown>)['rules'])
  ) {
    return false;
  }
  if (!Array.isArray(candidate['authorityBoundaries']) || candidate['authorityBoundaries'].length === 0) {
    return false;
  }
  for (const field of ['evaluationSuites', 'verificationSuites', 'environmentRequirements'] as const) {
    const list = candidate[field];
    if (!Array.isArray(list) || list.length === 0) return false;
    if (!list.every((ref) => isVersionedArtifactRef(ref))) return false;
  }
  if (!isSubstrateCompatibilityProfile(candidate['substrateCompatibility'])) return false;
  if (!isRightsMetadataView(candidate['rights'])) return false;
  const provenance = candidate['provenance'];
  if (typeof provenance !== 'object' || provenance === null) return false;
  const provenanceRecord = provenance as Record<string, unknown>;
  if (
    !isPrincipalRefView(provenanceRecord['author']) ||
    !isTimestampView(provenanceRecord['authoredAt']) ||
    !Array.isArray(provenanceRecord['citations']) ||
    !provenanceRecord['citations'].every((citation) => isManifestCitation(citation))
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
  if (lineageRecord['supersedes'] !== undefined && !isBodyVersionRef(lineageRecord['supersedes'])) {
    return false;
  }
  return true;
}

export function isBodyManifest(value: unknown): value is BodyManifest {
  if (!isBodyManifestView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && isContentDigest(candidate['digest']);
}

/**
 * Re-compute a manifest's digest and compare it with the claimed one.
 * FAILS CLOSED with BODY_FORGE_TAMPERED on any mismatch.
 */
export async function verifyBodyManifest(manifest: BodyManifest): Promise<string> {
  if (!isBodyManifest(manifest)) {
    invalidManifest('not a structurally valid body manifest');
  }
  const { digest: _digest, ...view } = manifest;
  const actual = await digestCanonical(view);
  if (actual !== manifest.digest) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.TAMPERED, {
      message: `body manifest digest mismatch: expected ${manifest.digest}, recomputed ${actual}`,
      details: { expected: manifest.digest, actual },
    });
  }
  return actual;
}

/** Content-addressed citation of a manifest (provenance records, forge records). */
export function manifestArtifactRef(manifest: BodyManifest): VersionedArtifactRef {
  return Object.freeze({
    namespace: 'body-forge',
    name: manifest.manifestId,
    version: manifest.version,
    digest: manifest.digest,
  });
}

/** Stable key for a manifest: `<manifestId>@<version>#<digest>`. */
export function bodyManifestKey(manifest: BodyManifest): string {
  return `${manifest.manifestId}@${manifest.version}#${manifest.digest}`;
}
