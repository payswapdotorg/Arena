/**
 * The forge core (Work Order A021; requirement R18 — "Forge immutable
 * Agent Body Versions"; docs/architecture.md §12; architecture-lock
 * rules 5, 6, 16, 17, 18).
 *
 *   - ForgeRecipe — the deterministic composition context: the
 *     forging principal, the forge timestamp and the correlation id.
 *     Composition is a PURE function of (manifest, policy, recipe):
 *     NO hidden clock reads, NO ambient state. Same manifest + same
 *     policy + same recipe ⇒ byte-identical BodyVersion (same digest
 *     inputs — property-tested).
 *
 *   - forgeBodyVersion — the pure compose core: verify manifest +
 *     policy (fail-closed tamper detection), apply the policy rules
 *     (requirements, learning admission, lineage), then project the
 *     manifest through the REAL @arena/agent-body constructor
 *     (createBodyVersion). The emitted proposal is therefore a REAL
 *     A003 BodyVersion BY CONSTRUCTION (disclosed: @arena/agent-body
 *     is a runtime dependency precisely so the forge never mirrors
 *     the BodyVersion contract; parity is by construction, not by
 *     resemblance). The forge NEVER mutates an existing BodyVersion
 *     (lock rule 5): there is no update or delete path anywhere; every
 *     compose mints a NEW immutable proposal.
 *
 *   - ForgeRecord — the append-only, idempotency-keyed record of one
 *     forge execution (lock rule 17): manifest digest + policy digest
 *     + emitted BodyVersion digest + the emitted version's ref +
 *     provenance. Re-running the same key returns the recorded result
 *     (the fabric's replay); the record itself is content-addressed
 *     and immutable.
 *
 *   - forge — compose + record in one deterministic step
 *     (ForgeResult: the BodyVersion proposal + its ForgeRecord).
 *
 * Provenance projection (deterministic, closed): the forged
 * BodyVersion's provenance.records cite EXACTLY the source manifest
 * and the applied policy (namespace `body-forge`, VersionedArtifactRef
 * shape) — the full lineage chain (including every learning citation)
 * stays reachable through the content-addressed manifest. The recipe's
 * forgePrincipal becomes the version's provenance.creator; the
 * recipe's forgedAt becomes provenance.createdAt.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import type { BodyVersion, BodyVersionRef } from '@arena/agent-body';
import {
  bodyVersionRef,
  createBodyVersion,
  isBodyVersion,
  isPrincipalRefView,
  toPrincipalRefView,
  verifyBodyVersion,
  versionedArtifactRefKey,
} from '@arena/agent-body';
import { BODY_FORGE_ERROR_CODES, BodyForgeError } from './errors.js';
import {
  FORGE_RECORD_NAMESPACE,
  deepFreeze,
  expectFields,
  isForgePrincipalId,
  isTimestampView,
  toContentDigest,
  toForgeTimestamp,
} from './shared.js';
import type { ContentDigest } from './shared.js';
import type { BodyManifest } from './manifest.js';
import { isBodyManifest, verifyBodyManifest } from './manifest.js';
import type { ForgePolicy } from './policy.js';
import { isForgePolicy, verifyForgePolicy } from './policy.js';

/** Wire version of the forge-record shape. */
export const FORGE_RECORD_VERSION = 1 as const;

/** Version of the forge implementation (recorded in run provenance). */
export const FORGE_IMPLEMENTATION_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// ForgeRecipe — the deterministic composition context
// ---------------------------------------------------------------------------

export interface ForgeRecipe {
  /** The principal accountable for the forged version (becomes provenance.creator). */
  readonly forgePrincipal: { readonly type: string; readonly tenant: string; readonly principalId: string };
  /** The forge timestamp (becomes provenance.createdAt; caller-supplied, never a clock read). */
  readonly forgedAt: string;
  /** The causal-flow correlation id (recorded on the ForgeRecord and envelopes). */
  readonly correlationId: string;
}

function invalidRecipe(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_RECIPE, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function toRecipe(value: ForgeRecipe): ForgeRecipe {
  const record = expectFields(
    value,
    ['forgePrincipal', 'forgedAt', 'correlationId'],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_RECIPE,
    'forge recipe',
  );
  if (!isPrincipalRefView(record['forgePrincipal'])) {
    invalidRecipe(
      `forgePrincipal must be a valid principal: ${JSON.stringify(record['forgePrincipal'])}`,
    );
  }
  const forgePrincipal = toPrincipalRefView(record['forgePrincipal'] as never);
  const forgedAt = toForgeTimestamp(
    typeof record['forgedAt'] === 'string' ? record['forgedAt'] : '',
    'recipe.forgedAt',
  );
  if (!isCorrelationId(record['correlationId'])) {
    invalidRecipe(`recipe.correlationId must be a valid correlation id: ${JSON.stringify(record['correlationId'])}`);
  }
  return Object.freeze({
    forgePrincipal,
    forgedAt,
    correlationId: record['correlationId'] as CorrelationId,
  });
}

// ---------------------------------------------------------------------------
// Policy application (pure guards over a verified manifest + policy)
// ---------------------------------------------------------------------------

function requirementViolation(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.REQUIREMENT_VIOLATION, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function learningProvenanceRejected(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.LEARNING_PROVENANCE_REJECTED, {
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

/**
 * Apply the policy's rule sections to a verified manifest. Conflict
 * rules (duplicates, contradictions) and the HARD lineage rule are
 * enforced at manifest construction and hold for any verified
 * manifest; this pass applies the TUNABLE rules.
 */
export function applyForgePolicy(manifest: BodyManifest, policy: ForgePolicy): void {
  // 1. Requirements (mandatory-input minimums; A003 floors already hold).
  const checks: readonly (readonly [keyof typeof policy.requirements, number, string])[] = [
    ['minSkills', manifest.skills.length, 'skills'],
    ['minKnowledge', manifest.knowledge.length, 'knowledge'],
    ['minTools', manifest.tools.length, 'tools'],
    ['minProcedures', manifest.procedures.length, 'procedures'],
    ['minCapabilities', manifest.capabilities.length, 'capabilities'],
    ['minEvaluationSuites', manifest.evaluationSuites.length, 'evaluationSuites'],
    ['minVerificationSuites', manifest.verificationSuites.length, 'verificationSuites'],
    ['minEnvironmentRequirements', manifest.environmentRequirements.length, 'environmentRequirements'],
  ];
  for (const [minimum, actual, field] of checks) {
    const required = policy.requirements[minimum];
    if (actual < required) {
      requirementViolation(
        `policy ${policy.policyId}@${policy.version} requires at least ${String(required)} ${field} entr${required === 1 ? 'y' : 'ies'}; manifest has ${String(actual)}`,
        { field, required, actual },
      );
    }
  }

  // 2. Learning admission (the anti-silent-embedding rules).
  const admission = policy.learningAdmission;
  const experimentCitations = manifest.provenance.citations.filter(
    (citation) => citation.kind === 'experiment-record',
  );
  const draftCitations = manifest.provenance.citations.filter(
    (citation) => citation.kind === 'skill-draft',
  );
  if (experimentCitations.length > 0 && !admission.allowExperimentRecordCitations) {
    learningProvenanceRejected(
      `policy ${policy.policyId}@${policy.version} does not admit experiment-record citations; the manifest cites ${String(experimentCitations.length)}`,
    );
  }
  if (draftCitations.length > 0 && !admission.allowSkillDraftCitations) {
    learningProvenanceRejected(
      `policy ${policy.policyId}@${policy.version} does not admit skill-draft citations; the manifest cites ${String(draftCitations.length)}`,
    );
  }
  if (
    admission.requireExperimentForSkillDraft &&
    draftCitations.length > 0 &&
    experimentCitations.length === 0
  ) {
    learningProvenanceRejected(
      `policy ${policy.policyId}@${policy.version} requires every skill-draft citation to be motivated by an experiment-record citation; the manifest cites drafts but no experiment`,
    );
  }
  if (!admission.uncitedSkillsAllowed && manifest.skills.length > 0) {
    const cited = new Set<string>();
    for (const citation of draftCitations) {
      if (citation.kind !== 'skill-draft') continue;
      for (const skill of citation.skills) cited.add(versionedArtifactRefKey(skill));
    }
    const uncited = manifest.skills
      .map((skill) => versionedArtifactRefKey(skill))
      .filter((key) => !cited.has(key));
    if (uncited.length > 0) {
      learningProvenanceRejected(
        `policy ${policy.policyId}@${policy.version} rejects silently embedded un-provenanced content: every skill must be claimed by a skill-draft citation; uncited: ${uncited.join(', ')}`,
        { uncited },
      );
    }
  }

  // 3. Lineage rules (the HARD supersedes-requires-parent rule holds
  //    at construction; these are the tunable rules).
  if (policy.lineage.requireParents && manifest.lineage.parents.length === 0) {
    lineageViolation(
      `policy ${policy.policyId}@${policy.version} requires every forge to cite at least one parent body version; the manifest cites none`,
    );
  }
  if (!policy.lineage.allowSupersession && manifest.lineage.supersedes !== undefined) {
    lineageViolation(
      `policy ${policy.policyId}@${policy.version} does not permit supersession; the manifest supersedes ${manifest.lineage.supersedes.tenant}/${manifest.lineage.supersedes.name}@${manifest.lineage.supersedes.version}`,
    );
  }
}

// ---------------------------------------------------------------------------
// forgeBodyVersion — the pure compose core
// ---------------------------------------------------------------------------

/**
 * Compose a NEW immutable BodyVersion proposal from a manifest under
 * a policy (pure; deterministic in (manifest, policy, recipe)).
 *
 * Pipeline: verify manifest + policy (fail closed on tampering) →
 * validate recipe → apply the tunable policy rules → project the
 * manifest into the A003 CreateBodyVersionInput (provenance.records
 * cite EXACTLY the manifest and the policy) → build through the REAL
 * A003 constructor → re-verify the emitted digest. The forge NEVER
 * mutates an existing BodyVersion — there is no such code path.
 */
export async function forgeBodyVersion(
  manifest: BodyManifest,
  policy: ForgePolicy,
  recipe: ForgeRecipe,
): Promise<BodyVersion> {
  if (!isBodyManifest(manifest)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_MANIFEST, {
      message: 'not a structurally valid body manifest',
    });
  }
  await verifyBodyManifest(manifest);
  if (!isForgePolicy(policy)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_POLICY, {
      message: 'not a structurally valid forge policy',
    });
  }
  await verifyForgePolicy(policy);
  const context = toRecipe(recipe);

  applyForgePolicy(manifest, policy);

  const manifestRecord = Object.freeze({
    namespace: FORGE_RECORD_NAMESPACE,
    name: manifest.manifestId,
    version: manifest.version,
    digest: manifest.digest,
  });
  const policyRecord = Object.freeze({
    namespace: FORGE_RECORD_NAMESPACE,
    name: policy.policyId,
    version: policy.version,
    digest: policy.digest,
  });

  const bodyVersion = await createBodyVersion({
    body: { tenant: manifest.body.tenant, name: manifest.body.name },
    version: manifest.targetVersion,
    mission: manifest.mission,
    role: manifest.role,
    domainScope: [...manifest.domainScope],
    capabilities: manifest.capabilities.map((capability) => capability.id),
    skills: [...manifest.skills],
    knowledge: [...manifest.knowledge],
    tools: [...manifest.tools],
    procedures: [...manifest.procedures],
    memoryPolicy: manifest.memoryPolicy,
    planningPolicy: manifest.planningPolicy,
    escalation: {
      rules: manifest.escalation.rules.map((rule) => ({
        condition: rule.condition,
        target: {
          type: rule.target.type,
          tenant: rule.target.tenant,
          principalId: rule.target.principalId,
        },
      })),
    },
    authorityBoundaries: [...manifest.authorityBoundaries],
    safetyPolicy: manifest.safetyPolicy,
    evaluationSuites: [...manifest.evaluationSuites],
    verificationSuites: [...manifest.verificationSuites],
    environmentRequirements: [...manifest.environmentRequirements],
    substrateCompatibility: manifest.substrateCompatibility,
    provenance: {
      creator: {
        type: context.forgePrincipal.type,
        tenant: context.forgePrincipal.tenant,
        principalId: context.forgePrincipal.principalId,
      },
      createdAt: context.forgedAt,
      rights: manifest.rights,
      records: [manifestRecord, policyRecord],
    },
    lineage: {
      parents: manifest.lineage.parents.map((parent) => ({
        tenant: parent.tenant,
        name: parent.name,
        version: parent.version,
        digest: parent.digest,
      })),
      ...(manifest.lineage.supersedes === undefined
        ? {}
        : {
            supersedes: {
              tenant: manifest.lineage.supersedes.tenant,
              name: manifest.lineage.supersedes.name,
              version: manifest.lineage.supersedes.version,
              digest: manifest.lineage.supersedes.digest,
            },
          }),
    },
  });

  // Belt and braces: the emitted proposal must be a REAL, verified,
  // tamper-evident A003 BodyVersion.
  if (!isBodyVersion(bodyVersion)) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_RECORD, {
      message: 'internal invariant violated: the forged proposal is not a structurally valid A003 BodyVersion',
    });
  }
  await verifyBodyVersion(bodyVersion);
  return bodyVersion;
}

// ---------------------------------------------------------------------------
// ForgeRecord — the append-only, idempotency-keyed execution record
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the record digest commits to. */
export interface ForgeRecordView {
  readonly recordVersion: typeof FORGE_RECORD_VERSION;
  /** REQUIRED idempotency key — the forge execution address (lock rule 17). */
  readonly forgeKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  /** Digest of the source BodyManifest. */
  readonly manifestDigest: string;
  /** Digest of the applied ForgePolicy. */
  readonly policyDigest: string;
  /** Digest of the emitted BodyVersion proposal. */
  readonly bodyVersionDigest: string;
  /** The emitted proposal's content-addressed ref. */
  readonly bodyVersionRef: BodyVersionRef;
  readonly provenance: {
    readonly forgedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** A frozen, content-addressed forge record: the view plus its sha256 digest. */
export interface ForgeRecord extends ForgeRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the record view (tests mirror it). */
export const FORGE_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'forgeKey',
  'correlationId',
  'manifestDigest',
  'policyDigest',
  'bodyVersionDigest',
  'bodyVersionRef',
  'provenance',
] as const) as readonly string[];

export interface CreateForgeRecordInput {
  readonly forgeKey: string;
  readonly correlationId: string;
  readonly manifestDigest: string;
  readonly policyDigest: string;
  readonly bodyVersionDigest: string;
  readonly bodyVersionRef: {
    readonly tenant: string;
    readonly name: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly provenance: {
    readonly forgedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

function invalidRecord(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_RECORD, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

export function isForgeRecordProvenance(
  value: unknown,
): value is ForgeRecordView['provenance'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isForgePrincipalId(candidate['forgedBy']) &&
    isTimestampView(candidate['recordedAt']) &&
    (candidate['notes'] === null || typeof candidate['notes'] === 'string')
  );
}

export function isForgeRecordView(value: unknown): value is ForgeRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== FORGE_RECORD_VERSION) return false;
  if (!isIdempotencyKey(candidate['forgeKey'])) return false;
  if (!isCorrelationId(candidate['correlationId'])) return false;
  for (const field of ['manifestDigest', 'policyDigest', 'bodyVersionDigest'] as const) {
    const digest = candidate[field];
    if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) return false;
  }
  const ref = candidate['bodyVersionRef'];
  if (
    typeof ref !== 'object' ||
    ref === null ||
    typeof (ref as Record<string, unknown>)['tenant'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['name'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['version'] !== 'string' ||
    typeof (ref as Record<string, unknown>)['digest'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test((ref as Record<string, unknown>)['digest'] as string)
  ) {
    return false;
  }
  return isForgeRecordProvenance(candidate['provenance']);
}

export function isForgeRecord(value: unknown): value is ForgeRecord {
  if (!isForgeRecordView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest']);
}

/** Create a validated, deep-frozen, content-addressed ForgeRecord. */
export async function createForgeRecord(input: CreateForgeRecordInput): Promise<ForgeRecord> {
  if (!isIdempotencyKey(input.forgeKey)) {
    invalidRecord(`forge record requires a valid forge key (idempotency key): ${JSON.stringify(input.forgeKey)}`);
  }
  if (!isCorrelationId(input.correlationId)) {
    invalidRecord(`forge record requires a valid correlation id: ${JSON.stringify(input.correlationId)}`);
  }
  const manifestDigest = toContentDigest(input.manifestDigest, 'forge record manifestDigest');
  const policyDigest = toContentDigest(input.policyDigest, 'forge record policyDigest');
  const bodyVersionDigest = toContentDigest(input.bodyVersionDigest, 'forge record bodyVersionDigest');
  const provenance = expectFields(
    input.provenance,
    ['forgedBy', 'recordedAt', 'notes'],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_RECORD,
    'forge record provenance',
  );
  if (!isForgePrincipalId(provenance['forgedBy'])) {
    invalidRecord(`forge record provenance.forgedBy must be a principal id: ${JSON.stringify(provenance['forgedBy'])}`);
  }
  const recordedAt = toForgeTimestamp(
    typeof provenance['recordedAt'] === 'string' ? provenance['recordedAt'] : '',
    'forge record provenance.recordedAt',
  );
  const notes = provenance['notes'];
  if (notes !== null && typeof notes !== 'string') {
    invalidRecord('forge record provenance.notes must be neutral text or null');
  }

  const view: ForgeRecordView = {
    recordVersion: FORGE_RECORD_VERSION,
    forgeKey: input.forgeKey as IdempotencyKey,
    correlationId: input.correlationId as CorrelationId,
    manifestDigest,
    policyDigest,
    bodyVersionDigest,
    bodyVersionRef: Object.freeze({ ...input.bodyVersionRef }),
    provenance: Object.freeze({
      forgedBy: provenance['forgedBy'] as string,
      recordedAt,
      notes: (notes ?? null) as string | null,
    }),
  };
  const digest = toContentDigest(await digestCanonical(view), 'forge record digest');
  return deepFreeze({ ...view, digest }) as ForgeRecord;
}

/**
 * Re-compute a forge record's digest and compare it with the claimed
 * one. FAILS CLOSED with BODY_FORGE_TAMPERED on any mismatch.
 */
export async function verifyForgeRecord(record: ForgeRecord): Promise<string> {
  if (!isForgeRecord(record)) {
    invalidRecord('not a structurally valid forge record');
  }
  const { digest: _digest, ...view } = record;
  const actual = await digestCanonical(view);
  if (actual !== record.digest) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.TAMPERED, {
      message: `forge record digest mismatch: expected ${record.digest}, recomputed ${actual}`,
      details: { expected: record.digest, actual },
    });
  }
  return actual;
}

// ---------------------------------------------------------------------------
// forge — compose + record (the deterministic full step)
// ---------------------------------------------------------------------------

/** The full output of one forge execution. */
export interface ForgeResult {
  /** The NEW immutable BodyVersion proposal (never a mutation of an existing version). */
  readonly bodyVersion: BodyVersion;
  /** The append-only, idempotency-keyed execution record. */
  readonly record: ForgeRecord;
}

export interface ForgeOptions {
  /** REQUIRED idempotency key — the forge execution address (lock rule 17). */
  readonly forgeKey: string;
  /** Optional provenance notes recorded onto the ForgeRecord. */
  readonly notes?: string | null;
}

/**
 * Compose a new BodyVersion proposal and its ForgeRecord in one
 * deterministic step. `record.provenance.recordedAt` is the recipe's
 * `forgedAt` (no hidden clock reads); `forgedBy` is the recipe
 * principal's id.
 */
export async function forge(
  manifest: BodyManifest,
  policy: ForgePolicy,
  recipe: ForgeRecipe,
  options: ForgeOptions,
): Promise<ForgeResult> {
  const context = toRecipe(recipe);
  const bodyVersion = await forgeBodyVersion(manifest, policy, recipe);
  const ref = bodyVersionRef(bodyVersion);
  const record = await createForgeRecord({
    forgeKey: options.forgeKey,
    correlationId: context.correlationId,
    manifestDigest: manifest.digest,
    policyDigest: policy.digest,
    bodyVersionDigest: bodyVersion.digest,
    bodyVersionRef: {
      tenant: ref.tenant,
      name: ref.name,
      version: ref.version,
      digest: ref.digest,
    },
    provenance: {
      forgedBy: context.forgePrincipal.principalId,
      recordedAt: context.forgedAt,
      notes: options.notes === undefined ? null : options.notes,
    },
  });
  return Object.freeze({ bodyVersion, record });
}
