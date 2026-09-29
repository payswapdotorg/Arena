/**
 * ForgePolicy — the versioned, content-addressed composition RULES of
 * the Agent Body Forge (Work Order A021; requirement R18;
 * architecture-lock rules 5, 6, 16, 18).
 *
 * A policy decides, for one forge execution:
 *
 *   - REQUIREMENTS — which manifest inputs are mandatory beyond the
 *     hard A003 AB1.0 floors. The A003 floors themselves (mission,
 *     role, domainScope >= 1, capabilities >= 1, authorityBoundaries
 *     >= 1, evaluation/verification/environment refs >= 1, mandatory
 *     rights, alias-free substrate profile) are enforced at MANIFEST
 *     CONSTRUCTION and are NOT policy-tunable — a policy may only
 *     strengthen. The tunable floors cover the §12 inputs A003
 *     leaves optional: skills, knowledge, tools, procedures.
 *
 *   - LEARNING ADMISSION — how learning-derived proposals (A020
 *     experiment records / A019 skill drafts) may enter a manifest.
 *     Every learning-derived contribution must be an EXPLICIT cited
 *     provenance ref (manifest.ts enforces the closed citation
 *     structure); the policy decides which citation kinds are
 *     admitted, whether skill-draft citations must be motivated by an
 *     experiment record, and whether UNCITED skills are allowed at
 *     all. A manifest that silently embeds un-provenanced content is
 *     REJECTED (BODY_FORGE_LEARNING_PROVENANCE_REJECTED).
 *
 *   - LINEAGE RULES — whether every forge must cite at least one
 *     parent version (bodies with existing history), and whether
 *     supersession is permitted at all. The HARD rule — a manifest
 *     that supersedes MUST carry the superseded version among its
 *     parents — is enforced at manifest construction and is NOT
 *     policy-tunable (Work Order A021: supersession is append-only
 *     per the A003 registry semantics).
 *
 * Policies are immutable, deep-frozen and content-addressed (sha256
 * over the canonical digest-free view). Tamper detection:
 * verifyForgePolicy recomputes the digest and fails closed with
 * BODY_FORGE_TAMPERED.
 */

import { digestCanonical } from '@arena/protocol-core';
import { BODY_FORGE_ERROR_CODES, BodyForgeError } from './errors.js';
import { deepFreeze, expectFields, toForgeSemver, toNeutralId, toContentDigest } from './shared.js';
import type { ContentDigest } from './shared.js';

/** Wire version of the forge-policy shape. */
export const FORGE_POLICY_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Requirements (mandatory-input rules)
// ---------------------------------------------------------------------------

/** Tunable input minimums (A003 floors are NOT tunable and live in manifest.ts). */
export interface ForgeRequirements {
  readonly minSkills: number;
  readonly minKnowledge: number;
  readonly minTools: number;
  readonly minProcedures: number;
  readonly minCapabilities: number;
  readonly minEvaluationSuites: number;
  readonly minVerificationSuites: number;
  readonly minEnvironmentRequirements: number;
}

/** Stable field list for requirements. */
export const FORGE_REQUIREMENTS_FIELDS = Object.freeze([
  'minSkills',
  'minKnowledge',
  'minTools',
  'minProcedures',
  'minCapabilities',
  'minEvaluationSuites',
  'minVerificationSuites',
  'minEnvironmentRequirements',
] as const);

/**
 * The A003 AB1.0 floors a policy may not undercut. Every
 * min*Capabilities/Suites/Environment value must be >= its floor;
 * skills/knowledge/tools/procedures floors are >= 0.
 */
export const A003_INPUT_FLOORS = Object.freeze({
  minSkills: 0,
  minKnowledge: 0,
  minTools: 0,
  minProcedures: 0,
  minCapabilities: 1,
  minEvaluationSuites: 1,
  minVerificationSuites: 1,
  minEnvironmentRequirements: 1,
} as const) as Readonly<Record<keyof ForgeRequirements, number>>;

// ---------------------------------------------------------------------------
// Learning admission (the anti-silent-embedding rules)
// ---------------------------------------------------------------------------

export interface LearningAdmission {
  /** Whether A020 experiment-record citations are admitted. */
  readonly allowExperimentRecordCitations: boolean;
  /** Whether A019 skill-draft citations are admitted. */
  readonly allowSkillDraftCitations: boolean;
  /** Whether every skill-draft citation must be motivated by an experiment-record citation. */
  readonly requireExperimentForSkillDraft: boolean;
  /**
   * Whether manifest skills may exist WITHOUT a skill-draft citation.
   * When false, EVERY skill must be claimed by exactly one skill-draft
   * citation — the strict "no silently embedded un-provenanced
   * content" posture.
   */
  readonly uncitedSkillsAllowed: boolean;
}

/** Stable field list for learning admission. */
export const LEARNING_ADMISSION_FIELDS = Object.freeze([
  'allowExperimentRecordCitations',
  'allowSkillDraftCitations',
  'requireExperimentForSkillDraft',
  'uncitedSkillsAllowed',
] as const);

// ---------------------------------------------------------------------------
// Lineage rules
// ---------------------------------------------------------------------------

export interface LineageRules {
  /** Whether every forge must cite at least one parent body version. */
  readonly requireParents: boolean;
  /** Whether manifests may declare a supersession at all. */
  readonly allowSupersession: boolean;
}

/** Stable field list for lineage rules. */
export const LINEAGE_RULES_FIELDS = Object.freeze(['requireParents', 'allowSupersession'] as const);

// ---------------------------------------------------------------------------
// ForgePolicy
// ---------------------------------------------------------------------------

/** The digest-free view — exactly what the policy digest commits to. */
export interface ForgePolicyView {
  readonly recordVersion: typeof FORGE_POLICY_VERSION;
  readonly policyId: string;
  readonly version: string;
  readonly requirements: ForgeRequirements;
  readonly learningAdmission: LearningAdmission;
  readonly lineage: LineageRules;
}

/** A frozen, content-addressed forge policy: the view plus its sha256 digest. */
export interface ForgePolicy extends ForgePolicyView {
  readonly digest: ContentDigest;
}

/** Stable field list for the policy view (tests mirror it). */
export const FORGE_POLICY_FIELDS = Object.freeze([
  'recordVersion',
  'policyId',
  'version',
  'requirements',
  'learningAdmission',
  'lineage',
] as const) as readonly string[];

export interface CreateForgePolicyInput {
  readonly policyId: string;
  readonly version: string;
  readonly requirements?: Partial<ForgeRequirements>;
  readonly learningAdmission?: Partial<LearningAdmission>;
  readonly lineage?: Partial<LineageRules>;
}

/** The documented default learning-admission posture (permissive-with-structure). */
export const DEFAULT_LEARNING_ADMISSION: LearningAdmission = Object.freeze({
  allowExperimentRecordCitations: true,
  allowSkillDraftCitations: true,
  requireExperimentForSkillDraft: false,
  uncitedSkillsAllowed: true,
});

/** The documented default lineage posture (first versions allowed, supersession allowed). */
export const DEFAULT_LINEAGE_RULES: LineageRules = Object.freeze({
  requireParents: false,
  allowSupersession: true,
});

function invalidPolicy(message: string, details?: Record<string, unknown>): never {
  throw new BodyForgeError(BODY_FORGE_ERROR_CODES.INVALID_POLICY, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function toRequirements(value: unknown): ForgeRequirements {
  const record = expectFields(
    value,
    [],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_POLICY,
    'policy requirements',
  );
  const resolved: Record<string, number> = {};
  for (const field of FORGE_REQUIREMENTS_FIELDS) {
    const raw = record[field];
    const floor = A003_INPUT_FLOORS[field];
    if (raw === undefined) {
      resolved[field] = floor;
      continue;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < floor) {
      invalidPolicy(
        `policy requirements.${field} must be an integer >= ${String(floor)} (the A003 AB1.0 input floor; a policy may only strengthen)`,
        { field, floor },
      );
    }
    resolved[field] = raw;
  }
  return Object.freeze(resolved as unknown as ForgeRequirements);
}

function toLearningAdmission(value: unknown): LearningAdmission {
  const record = expectFields(
    value,
    [],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_POLICY,
    'policy learningAdmission',
  );
  const resolved: Record<string, boolean> = {};
  for (const field of LEARNING_ADMISSION_FIELDS) {
    const raw = record[field];
    if (raw === undefined) {
      resolved[field] = (DEFAULT_LEARNING_ADMISSION as unknown as Record<string, boolean>)[field] ?? false;
      continue;
    }
    if (typeof raw !== 'boolean') {
      invalidPolicy(`policy learningAdmission.${field} must be a boolean`);
    }
    resolved[field] = raw;
  }
  return Object.freeze(resolved as unknown as LearningAdmission);
}

function toLineageRules(value: unknown): LineageRules {
  const record = expectFields(
    value,
    [],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_POLICY,
    'policy lineage',
  );
  const resolved: Record<string, boolean> = {};
  for (const field of LINEAGE_RULES_FIELDS) {
    const raw = record[field];
    if (raw === undefined) {
      resolved[field] = (DEFAULT_LINEAGE_RULES as unknown as Record<string, boolean>)[field] ?? false;
      continue;
    }
    if (typeof raw !== 'boolean') {
      invalidPolicy(`policy lineage.${field} must be a boolean`);
    }
    resolved[field] = raw;
  }
  return Object.freeze(resolved as unknown as LineageRules);
}

/**
 * Create a validated, deep-frozen, content-addressed ForgePolicy.
 * Unspecified rule sections fall back to the documented defaults;
 * specified values must respect the A003 input floors (a policy may
 * only strengthen, never weaken).
 */
export async function createForgePolicy(input: CreateForgePolicyInput): Promise<ForgePolicy> {
  const record = expectFields(
    input,
    ['policyId', 'version'],
    [],
    BODY_FORGE_ERROR_CODES.INVALID_POLICY,
    'forge policy',
  );
  const policyId = toNeutralId(
    typeof record['policyId'] === 'string' ? record['policyId'] : '',
    'policy.policyId',
  );
  const version = toForgeSemver(
    typeof record['version'] === 'string' ? record['version'] : '',
    'policy.version',
  );
  const requirements = toRequirements(record['requirements'] ?? {});
  const learningAdmission = toLearningAdmission(record['learningAdmission'] ?? {});
  const lineage = toLineageRules(record['lineage'] ?? {});

  const view: ForgePolicyView = {
    recordVersion: FORGE_POLICY_VERSION,
    policyId,
    version,
    requirements,
    learningAdmission,
    lineage,
  };
  const digest = toContentDigest(await digestCanonical(view), 'policy digest');
  return deepFreeze({ ...view, digest }) as ForgePolicy;
}

/** The documented default policy input (permissive-with-structure floors). */
export function defaultForgePolicyInput(): CreateForgePolicyInput {
  return {
    policyId: 'policy-body-forge-default',
    version: '1.0.0',
    requirements: { ...A003_INPUT_FLOORS },
    learningAdmission: { ...DEFAULT_LEARNING_ADMISSION },
    lineage: { ...DEFAULT_LINEAGE_RULES },
  };
}

/** sha256 content digest over the canonical digest-free policy view. */
export async function computeForgePolicyDigest(view: ForgePolicyView): Promise<string> {
  return digestCanonical(view);
}

/** The digest-free view of a policy (what the digest commits to). */
export function forgePolicyView(policy: ForgePolicy): ForgePolicyView {
  const { digest: _digest, ...view } = policy;
  return view;
}

// ---------------------------------------------------------------------------
// Structural (non-throwing) checks + tamper detection
// ---------------------------------------------------------------------------

export function isForgeRequirements(value: unknown): value is ForgeRequirements {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  for (const field of FORGE_REQUIREMENTS_FIELDS) {
    const raw = candidate[field];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < A003_INPUT_FLOORS[field]) {
      return false;
    }
  }
  return true;
}

export function isLearningAdmission(value: unknown): value is LearningAdmission {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  for (const field of LEARNING_ADMISSION_FIELDS) {
    if (typeof candidate[field] !== 'boolean') return false;
  }
  return true;
}

export function isLineageRules(value: unknown): value is LineageRules {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  for (const field of LINEAGE_RULES_FIELDS) {
    if (typeof candidate[field] !== 'boolean') return false;
  }
  return true;
}

export function isForgePolicyView(value: unknown): value is ForgePolicyView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === FORGE_POLICY_VERSION &&
    typeof candidate['policyId'] === 'string' &&
    candidate['policyId'].length > 0 &&
    typeof candidate['version'] === 'string' &&
    candidate['version'].length > 0 &&
    isForgeRequirements(candidate['requirements']) &&
    isLearningAdmission(candidate['learningAdmission']) &&
    isLineageRules(candidate['lineage'])
  );
}

export function isForgePolicy(value: unknown): value is ForgePolicy {
  if (!isForgePolicyView(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  return (
    typeof candidate['digest'] === 'string' && /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/**
 * Re-compute a policy's digest and compare it with the claimed one.
 * FAILS CLOSED with BODY_FORGE_TAMPERED on any mismatch.
 */
export async function verifyForgePolicy(policy: ForgePolicy): Promise<string> {
  if (!isForgePolicy(policy)) {
    invalidPolicy('not a structurally valid forge policy');
  }
  const { digest: _digest, ...view } = policy;
  const actual = await digestCanonical(view);
  if (actual !== policy.digest) {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.TAMPERED, {
      message: `forge policy digest mismatch: expected ${policy.digest}, recomputed ${actual}`,
      details: { expected: policy.digest, actual },
    });
  }
  return actual;
}

/** Content-addressed citation of a policy (provenance records, forge records). */
export function forgePolicyArtifactRef(
  policy: ForgePolicy,
): { readonly namespace: string; readonly name: string; readonly version: string; readonly digest: string } {
  return Object.freeze({
    namespace: 'body-forge',
    name: policy.policyId,
    version: policy.version,
    digest: policy.digest,
  });
}

/** Stable key for a policy: `<policyId>@<version>#<digest>`. */
export function forgePolicyKey(policy: ForgePolicy): string {
  return `${policy.policyId}@${policy.version}#${policy.digest}`;
}
